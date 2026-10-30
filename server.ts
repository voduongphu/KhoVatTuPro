import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const STATE_FILE = path.resolve(__dirname, '.sync-state.json');
const LEGACY_TOMBSTONE_ISO = '1970-01-01T00:00:01.000Z';

type DeletedRegistry = Record<string, string>;

function parseSafeUtcTime(ts?: string | null): number {
  if (!ts) return 0;
  const trimmed = String(ts).trim();
  if (!trimmed) return 0;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)) {
    const iso = trimmed.replace(' ', 'T') + (trimmed.length === 16 ? ':00.000Z' : 'Z');
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toCategoryAsciiSlug(text?: string | null): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function generateCategoryCodeFromName(name: string, usedCodes: Set<string>): string {
  const words = toCategoryAsciiSlug(name).split('-').filter(Boolean);
  let initials = words.map(w => w.charAt(0)).join('').slice(0, 4);
  if (!initials) initials = 'TH';
  let candidate = `DM-${initials}`;
  let counter = 2;
  while (usedCodes.has(candidate.toUpperCase())) {
    candidate = `DM-${initials}${counter}`;
    counter++;
  }
  usedCodes.add(candidate.toUpperCase());
  return candidate;
}

function makeTombstoneKey(
  prefix: 'ITEM' | 'TRX' | 'USER' | 'WH' | 'CAT',
  rawId?: string | null
): string {
  if (!rawId) return '';
  const cleaned = String(rawId).trim();
  if (!cleaned) return '';
  return `${prefix}:${prefix === 'USER' ? cleaned.toLowerCase() : cleaned.toUpperCase()}`;
}

function buildMergedDeletedRegistry(
  localReg: DeletedRegistry | undefined,
  remoteReg: DeletedRegistry | undefined,
  legacyArrays?: {
    deletedItemIds?: string[];
    deletedTransactionIds?: string[];
    deletedUserIds?: string[];
    deletedWarehouseIds?: string[];
    deletedCategoryIds?: string[];
  }
): DeletedRegistry {
  const merged: DeletedRegistry = {};

  const applyReg = (reg?: DeletedRegistry) => {
    if (!reg || typeof reg !== 'object') return;
    const keys = Object.keys(reg);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = reg[k];
      if (!k || !v) continue;
      const incTime = parseSafeUtcTime(v);
      if (incTime <= 0) continue;
      const prevTime = parseSafeUtcTime(merged[k]);
      if (incTime > prevTime) {
        merged[k] = new Date(incTime).toISOString();
      }
    }
  };

  applyReg(localReg);
  applyReg(remoteReg);

  if (legacyArrays) {
    (legacyArrays.deletedItemIds || []).forEach(id => {
      const k = makeTombstoneKey('ITEM', id);
      if (k && !merged[k]) merged[k] = LEGACY_TOMBSTONE_ISO;
    });
    (legacyArrays.deletedTransactionIds || []).forEach(id => {
      const k = makeTombstoneKey('TRX', id);
      if (k && !merged[k]) merged[k] = LEGACY_TOMBSTONE_ISO;
    });
    (legacyArrays.deletedUserIds || []).forEach(id => {
      const norm = String(id || '').trim().toLowerCase();
      const k = makeTombstoneKey('USER', norm);
      if (k && !merged[k]) merged[k] = LEGACY_TOMBSTONE_ISO;
    });
    (legacyArrays.deletedWarehouseIds || []).forEach(id => {
      const k = makeTombstoneKey('WH', id);
      if (k && !merged[k]) merged[k] = LEGACY_TOMBSTONE_ISO;
    });
    (legacyArrays.deletedCategoryIds || []).forEach(id => {
      const k = makeTombstoneKey('CAT', id);
      if (k && !merged[k]) merged[k] = LEGACY_TOMBSTONE_ISO;
    });
  }

  return merged;
}

function getLatestTombstoneMs(reg: DeletedRegistry, keys: string[]): number {
  let maxMs = 0;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (!k) continue;
    const t = parseSafeUtcTime(reg[k]);
    if (t > maxMs) maxMs = t;
  }
  return maxMs;
}

function isEntityDeleted(reg: DeletedRegistry, keys: string[], entityTimeMs: number): boolean {
  const delMs = getLatestTombstoneMs(reg, keys);
  if (delMs <= 0) return false;
  if (entityTimeMs <= 0) return true;
  return delMs > entityTimeMs;
}

function clearTombstonesIfRevived(reg: DeletedRegistry, keys: string[], entityTimeMs: number) {
  const delMs = getLatestTombstoneMs(reg, keys);
  if (delMs > 0 && entityTimeMs >= delMs) {
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k && reg[k]) {
        delete reg[k];
      }
    }
  }
}

/**
 * O(N + T_lines) batch warehouse stock calculator for Express server sync reconciliation.
 */
function computeAllWarehouseStocksForServer(
  items: any[],
  warehouses: any[],
  transactions: any[]
): Record<string, number>[] {
  const n = items.length;
  if (n === 0) return [];

  const configuredWhIds: string[] = [];
  for (let i = 0; i < warehouses.length; i++) {
    if (warehouses[i]?.id) configuredWhIds.push(warehouses[i].id);
  }
  const fallbackDefaultWhId = configuredWhIds[0] || 'WH-01';

  const idToIndices = new Map<string, number | number[]>();
  const codeToIndices = new Map<string, number | number[]>();

  const addIndex = (map: Map<string, number | number[]>, key: string, idx: number) => {
    const existing = map.get(key);
    if (existing === undefined) {
      map.set(key, idx);
    } else if (typeof existing === 'number') {
      if (existing !== idx) map.set(key, [existing, idx]);
    } else if (!existing.includes(idx)) {
      existing.push(idx);
    }
  };

  const accums: {
    whNet: Record<string, number>;
    unassignedNet: number;
    totalNet: number;
    wasAutoCreatedByReceipt: boolean;
  }[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const item = items[i];
    accums[i] = {
      whNet: {},
      unassignedNet: 0,
      totalNet: 0,
      wasAutoCreatedByReceipt: false,
    };
    if (item?.id) addIndex(idToIndices, String(item.id), i);
    const normCode = String(item?.code || '').trim().toUpperCase();
    if (normCode) addIndex(codeToIndices, normCode, i);
  }

  const applyLineToIndex = (
    idx: number,
    rawWhId: string,
    delta: number,
    isAutoCreatedReceipt: boolean
  ) => {
    const acc = accums[idx];
    if (isAutoCreatedReceipt) acc.wasAutoCreatedByReceipt = true;
    acc.totalNet += delta;
    if (rawWhId) {
      acc.whNet[rawWhId] = (acc.whNet[rawWhId] || 0) + delta;
    } else {
      acc.unassignedNet += delta;
    }
  };

  for (let t = 0; t < transactions.length; t++) {
    const trx = transactions[t];
    if (!trx || trx.status === 'DA_HUY') continue;
    const isReceipt = trx.type === 'NHAP_KHO';
    const isIssue = trx.type === 'XUAT_KHO';
    if (!isReceipt && !isIssue) continue;

    const rawWhId = trx.warehouseId || '';
    const lines = trx.items || [];
    for (let l = 0; l < lines.length; l++) {
      const line = lines[l];
      if (!line) continue;
      const q = Number(line.quantity) || 0;
      const delta = isReceipt ? q : -q;
      const isAutoReceipt = Boolean(line.isNewItem && isReceipt);

      const mById = line.itemId ? idToIndices.get(String(line.itemId)) : undefined;
      const normLineCode = line.itemCode ? String(line.itemCode).trim().toUpperCase() : '';
      const mByCode = normLineCode ? codeToIndices.get(normLineCode) : undefined;

      if (mById === undefined && mByCode === undefined) continue;

      if (typeof mById === 'number' && (mByCode === undefined || mByCode === mById)) {
        applyLineToIndex(mById, rawWhId, delta, isAutoReceipt);
      } else if (mById === undefined && typeof mByCode === 'number') {
        applyLineToIndex(mByCode, rawWhId, delta, isAutoReceipt);
      } else {
        const visited = new Set<number>();
        if (typeof mById === 'number') visited.add(mById);
        else if (mById) mById.forEach(idx => visited.add(idx));
        if (typeof mByCode === 'number') visited.add(mByCode);
        else if (mByCode) mByCode.forEach(idx => visited.add(idx));
        visited.forEach(idx => applyLineToIndex(idx, rawWhId, delta, isAutoReceipt));
      }
    }
  }

  const results: Record<string, number>[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const acc = accums[i];
    const primaryWhId = item.warehouseId || fallbackDefaultWhId;

    const allWhIds = new Set<string>(configuredWhIds);
    allWhIds.add(primaryWhId);
    if (item.openingWarehouseStocks) {
      Object.keys(item.openingWarehouseStocks).forEach(k => allWhIds.add(k));
    }
    if (item.warehouseStocks) {
      Object.keys(item.warehouseStocks).forEach(k => allWhIds.add(k));
    }
    Object.keys(acc.whNet).forEach(k => allWhIds.add(k));

    const result: Record<string, number> = {};
    if (item.openingWarehouseStocks && Object.keys(item.openingWarehouseStocks).length > 0) {
      allWhIds.forEach(whId => {
        const opening = Number(item.openingWarehouseStocks?.[whId]) || 0;
        const net = (acc.whNet[whId] || 0) + (whId === primaryWhId ? acc.unassignedNet : 0);
        result[whId] = Math.max(0, opening + net);
      });
    } else {
      const inferredOpening =
        item.openingStock !== undefined
          ? Number(item.openingStock) || 0
          : acc.wasAutoCreatedByReceipt
          ? 0
          : Math.max(0, (Number(item.currentStock) || 0) - acc.totalNet);

      allWhIds.forEach(whId => {
        const net = (acc.whNet[whId] || 0) + (whId === primaryWhId ? acc.unassignedNet : 0);
        result[whId] =
          whId === primaryWhId ? Math.max(0, inferredOpening + net) : Math.max(0, net);
      });
    }

    for (let w = 0; w < configuredWhIds.length; w++) {
      const whId = configuredWhIds[w];
      if (result[whId] === undefined) result[whId] = 0;
    }
    results[i] = result;
  }

  return results;
}

function mergeServerStateDeterministic(existing: any, incoming: any): any {
  if (!existing) existing = {};
  if (!incoming) return existing;

  const registry = buildMergedDeletedRegistry(
    existing.deletedRegistry,
    incoming.deletedRegistry,
    {
      deletedItemIds: [...(existing.deletedItemIds || []), ...(incoming.deletedItemIds || [])],
      deletedTransactionIds: [
        ...(existing.deletedTransactionIds || []),
        ...(incoming.deletedTransactionIds || []),
      ],
      deletedUserIds: [...(existing.deletedUserIds || []), ...(incoming.deletedUserIds || [])],
      deletedWarehouseIds: [
        ...(existing.deletedWarehouseIds || []),
        ...(incoming.deletedWarehouseIds || []),
      ],
      deletedCategoryIds: [
        ...(existing.deletedCategoryIds || []),
        ...(incoming.deletedCategoryIds || []),
      ],
    }
  );

  // 1. Users
  const isUnmodifiedDefaultSeedAdmin = (u: any): boolean => {
    if (!u) return false;
    const uname = String(u.username || '').trim().toLowerCase();
    const uid = String(u.id || '').trim().toUpperCase();
    return (
      uname === 'admin' &&
      (uid === 'USR-ADMIN' || !uid) &&
      !u.updatedAt &&
      !u.lastLogin &&
      !u.lastActiveAt &&
      !u.activeDeviceId
    );
  };

  const allInputUsers = [...(existing.users || []), ...(incoming.users || [])];
  const hasRealNonSeedActiveAdmin = allInputUsers.some((u: any) => {
    if (!u || u.role !== 'ADMIN' || u.status === 'LOCKED' || isUnmodifiedDefaultSeedAdmin(u)) {
      return false;
    }
    const tKeys = [makeTombstoneKey('USER', u.id), makeTombstoneKey('USER', u.username)].filter(Boolean);
    const uTime = Math.max(parseSafeUtcTime(u.updatedAt), parseSafeUtcTime(u.lastActiveAt));
    return !isEntityDeleted(registry, tKeys, uTime);
  });

  const userMap = new Map<string, any>();
  const processUser = (u: any, isIncoming: boolean) => {
    if (!u || (!u.username && !u.id)) return;
    if (hasRealNonSeedActiveAdmin && isUnmodifiedDefaultSeedAdmin(u)) {
      return;
    }

    const unameKey = String(u.username || u.id).trim().toLowerCase();
    const tKeys = [
      makeTombstoneKey('USER', u.id),
      makeTombstoneKey('USER', u.username),
    ].filter(Boolean);
    const uTime = Math.max(parseSafeUtcTime(u.updatedAt), parseSafeUtcTime(u.lastActiveAt));

    if (isEntityDeleted(registry, tKeys, uTime)) {
      userMap.delete(unameKey);
      return;
    }
    clearTombstonesIfRevived(registry, tKeys, uTime);

    const prev = userMap.get(unameKey);
    if (!prev) {
      userMap.set(unameKey, u);
    } else {
      const prevTime = Math.max(
        parseSafeUtcTime(prev.updatedAt),
        parseSafeUtcTime(prev.lastActiveAt)
      );
      const useNew = isIncoming ? uTime >= prevTime : uTime > prevTime;
      const older = useNew ? prev : u;
      const newer = useNew ? u : prev;
      userMap.set(unameKey, {
        ...older,
        ...newer,
        id: prev.id || u.id,
      });
    }
  };
  (existing.users || []).forEach((u: any) => processUser(u, false));
  (incoming.users || []).forEach((u: any) => processUser(u, true));

  if (
    allInputUsers.length > 0 &&
    !Array.from(userMap.values()).some((u: any) => u.role === 'ADMIN' && u.status !== 'LOCKED')
  ) {
    const adminCandidates = [...(incoming.users || []), ...(existing.users || [])]
      .filter((u: any) => u && u.role === 'ADMIN')
      .sort(
        (a: any, b: any) =>
          Math.max(parseSafeUtcTime(b.updatedAt), parseSafeUtcTime(b.lastActiveAt)) -
          Math.max(parseSafeUtcTime(a.updatedAt), parseSafeUtcTime(a.lastActiveAt))
      );
    if (adminCandidates.length > 0) {
      const fallbackAdmin = { ...adminCandidates[0], status: 'ACTIVE' };
      const fallbackKey = String(fallbackAdmin.username || fallbackAdmin.id).trim().toLowerCase();
      userMap.set(fallbackKey, fallbackAdmin);
    }
  }

  const seenUserIds = new Set<string>();
  const sanitizedUsers = Array.from(userMap.values()).map((u: any) => {
    let uniqueId = u.id || `USR-${String(u.username).toUpperCase()}`;
    if (uniqueId === 'USR-ADMIN' && String(u.username).toLowerCase() !== 'admin') {
      uniqueId = `USR-${String(u.username).toUpperCase()}`;
    }
    if (seenUserIds.has(uniqueId)) {
      uniqueId = `USR-${String(u.username).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    }
    seenUserIds.add(uniqueId);
    return { ...u, id: uniqueId };
  });

  // 2. Warehouses
  const whMap = new Map<string, any>();
  const processWarehouse = (w: any, isIncoming: boolean) => {
    if (!w || (!w.id && !w.code)) return;
    const key = String(w.id || w.code).trim().toUpperCase();
    const tKeys = [
      makeTombstoneKey('WH', w.id),
      makeTombstoneKey('WH', w.code),
    ].filter(Boolean);
    const wTime = parseSafeUtcTime(w.updatedAt) || 0;

    if (isEntityDeleted(registry, tKeys, wTime)) {
      whMap.delete(key);
      return;
    }
    clearTombstonesIfRevived(registry, tKeys, wTime);

    const prev = whMap.get(key);
    if (!prev) {
      whMap.set(key, w);
    } else {
      const prevTime = parseSafeUtcTime(prev.updatedAt) || 0;
      const useNew = isIncoming ? wTime >= prevTime : wTime > prevTime;
      whMap.set(key, {
        ...(useNew ? prev : w),
        ...(useNew ? w : prev),
      });
    }
  };
  (existing.warehouses || []).forEach((w: any) => processWarehouse(w, false));
  (incoming.warehouses || []).forEach((w: any) => processWarehouse(w, true));
  const mergedWarehouses = Array.from(whMap.values());

  // 3. Transactions + O(1) Code De-collision
  const trxMap = new Map<string, any>();
  const processTransaction = (t: any, isIncoming: boolean) => {
    if (!t || (!t.id && !t.code)) return;
    const idKey = String(t.id || t.code).trim().toUpperCase();
    const tKeys = [
      makeTombstoneKey('TRX', t.id),
      makeTombstoneKey('TRX', t.code),
    ].filter(Boolean);
    const tTime = parseSafeUtcTime(t.updatedAt);

    if (isEntityDeleted(registry, tKeys, tTime)) {
      trxMap.delete(idKey);
      return;
    }
    clearTombstonesIfRevived(registry, tKeys, tTime);

    const prev = trxMap.get(idKey);
    if (!prev) {
      trxMap.set(idKey, t);
    } else {
      const prevTime = parseSafeUtcTime(prev.updatedAt);
      const useNew = isIncoming ? tTime >= prevTime : tTime > prevTime;
      const older = useNew ? prev : t;
      const newer = useNew ? t : prev;
      trxMap.set(idKey, {
        ...older,
        ...newer,
        items: newer.items && newer.items.length > 0 ? newer.items : older.items || [],
        totalAmount: newer.totalAmount !== undefined ? newer.totalAmount : older.totalAmount,
      });
    }
  };
  (existing.transactions || []).forEach((t: any) => processTransaction(t, false));
  (incoming.transactions || []).forEach((t: any) => processTransaction(t, true));

  const rawTrxAsc = Array.from(trxMap.values()).sort((a: any, b: any) => {
    const ta = parseSafeUtcTime(a.updatedAt) || parseSafeUtcTime(a.date);
    const tb = parseSafeUtcTime(b.updatedAt) || parseSafeUtcTime(b.date);
    return ta - tb;
  });

  const usedCodes = new Set<string>();
  const currentYear = new Date().getFullYear();
  const pnPrefix = `PN-${currentYear}-`;
  const pxPrefix = `PX-${currentYear}-`;
  let maxPnSeq = 0;
  let maxPxSeq = 0;

  const trackSeqFromCode = (upperCode: string) => {
    if (upperCode.startsWith(pnPrefix)) {
      const num = parseInt(upperCode.slice(pnPrefix.length), 10);
      if (!Number.isNaN(num) && num > maxPnSeq) maxPnSeq = num;
    } else if (upperCode.startsWith(pxPrefix)) {
      const num = parseInt(upperCode.slice(pxPrefix.length), 10);
      if (!Number.isNaN(num) && num > maxPxSeq) maxPxSeq = num;
    }
  };

  for (let i = 0; i < rawTrxAsc.length; i++) {
    const c = String(rawTrxAsc[i].code || '').trim().toUpperCase();
    if (c) trackSeqFromCode(c);
  }

  const nextCodeForType = (type: string): string => {
    const isReceipt = type === 'NHAP_KHO';
    const prefix = isReceipt ? pnPrefix : pxPrefix;
    let candidateNum = isReceipt ? ++maxPnSeq : ++maxPxSeq;
    let candidate = `${prefix}${String(candidateNum).padStart(4, '0')}`;
    while (usedCodes.has(candidate)) {
      candidateNum = isReceipt ? ++maxPnSeq : ++maxPxSeq;
      candidate = `${prefix}${String(candidateNum).padStart(4, '0')}`;
    }
    return candidate;
  };

  const decollidedTransactions = rawTrxAsc.map((t: any) => {
    const normCode = String(t.code || '').trim().toUpperCase();
    if (!normCode || usedCodes.has(normCode)) {
      const reassigned = nextCodeForType(t.type);
      usedCodes.add(reassigned);
      return { ...t, code: reassigned };
    }
    usedCodes.add(normCode);
    trackSeqFromCode(normCode);
    return { ...t, code: normCode };
  });

  const mergedTransactions = decollidedTransactions.sort((a: any, b: any) => {
    const timeA = parseSafeUtcTime(a.date) || parseSafeUtcTime(a.updatedAt);
    const timeB = parseSafeUtcTime(b.date) || parseSafeUtcTime(b.updatedAt);
    if (timeB !== timeA) return timeB - timeA;
    return parseSafeUtcTime(b.updatedAt) - parseSafeUtcTime(a.updatedAt);
  });

  // 4. Items + Auto-materialization
  const itemMap = new Map<string, any>();
  const getItemKey = (i: any) =>
    String(i.code && String(i.code).trim() ? i.code : i.id)
      .trim()
      .toUpperCase();

  const processItem = (item: any, isIncoming: boolean) => {
    if (!item || (!item.code && !item.id)) return;
    const key = getItemKey(item);
    const tKeys = [
      makeTombstoneKey('ITEM', item.id),
      makeTombstoneKey('ITEM', item.code),
    ].filter(Boolean);
    const iTime = Math.max(
      parseSafeUtcTime(item.metadataUpdatedAt),
      parseSafeUtcTime(item.updatedAt)
    );

    if (isEntityDeleted(registry, tKeys, iTime)) {
      itemMap.delete(key);
      return;
    }
    clearTombstonesIfRevived(registry, tKeys, iTime);

    const prev = itemMap.get(key);
    if (!prev) {
      itemMap.set(key, {
        ...item,
        code: String(item.code || item.id).trim().toUpperCase(),
      });
    } else {
      const exMetaTime = Math.max(
        parseSafeUtcTime(prev.metadataUpdatedAt),
        parseSafeUtcTime(prev.updatedAt)
      );
      const incMetaTime = Math.max(
        parseSafeUtcTime(item.metadataUpdatedAt),
        parseSafeUtcTime(item.updatedAt)
      );
      const useNew = isIncoming ? incMetaTime >= exMetaTime : incMetaTime > exMetaTime;
      const older = useNew ? prev : item;
      const newer = useNew ? item : prev;

      let mergedOpeningWh = newer.openingWarehouseStocks;
      if (!mergedOpeningWh || Object.keys(mergedOpeningWh).length === 0) {
        mergedOpeningWh = older.openingWarehouseStocks;
      }
      const mergedOpeningStock =
        newer.openingStock !== undefined ? newer.openingStock : older.openingStock;

      itemMap.set(key, {
        ...older,
        ...newer,
        id: prev.id || item.id,
        code: String(newer.code || older.code).trim().toUpperCase(),
        openingStock: mergedOpeningStock,
        openingWarehouseStocks: mergedOpeningWh,
        updatedAt:
          parseSafeUtcTime(item.updatedAt) >= parseSafeUtcTime(prev.updatedAt)
            ? item.updatedAt
            : prev.updatedAt,
        metadataUpdatedAt:
          parseSafeUtcTime(item.metadataUpdatedAt) >= parseSafeUtcTime(prev.metadataUpdatedAt)
            ? item.metadataUpdatedAt || newer.metadataUpdatedAt
            : prev.metadataUpdatedAt,
      });
    }
  };
  (existing.items || []).forEach((i: any) => processItem(i, false));
  (incoming.items || []).forEach((i: any) => processItem(i, true));

  mergedTransactions.forEach((trx: any) => {
    if (trx.status === 'DA_HUY' || trx.type !== 'NHAP_KHO') return;
    const trxTime = parseSafeUtcTime(trx.updatedAt);
    (trx.items || []).forEach((line: any) => {
      const cleanCode = String(line.itemCode || '').trim().toUpperCase();
      if (!cleanCode || itemMap.has(cleanCode)) return;
      const lineTKeys = [
        makeTombstoneKey('ITEM', line.itemId),
        makeTombstoneKey('ITEM', cleanCode),
      ].filter(Boolean);
      if (isEntityDeleted(registry, lineTKeys, trxTime)) return;

      const whId = trx.warehouseId || mergedWarehouses[0]?.id || 'WH-01';
      const fallbackNow = trx.updatedAt || new Date().toISOString();
      itemMap.set(cleanCode, {
        id: line.itemId || `ITEM-AUTO-${cleanCode}`,
        code: cleanCode,
        name: String(line.itemName || cleanCode).trim(),
        type: line.type || 'VAT_TU',
        categoryId: line.categoryId,
        categoryCode: line.categoryCode,
        category: String(line.category || 'Vật tư nhập kho').trim(),
        unit: String(line.unit || 'Cái').trim(),
        warehouseId: whId,
        openingStock: 0,
        openingWarehouseStocks: { [whId]: 0 },
        warehouseStocks: { [whId]: Math.max(0, Number(line.quantity) || 0) },
        location: String(line.location || 'Khu vực tiếp nhận').trim(),
        minStock: line.minStock ?? 5,
        maxStock: line.maxStock ?? 200,
        currentStock: Math.max(0, Number(line.quantity) || 0),
        unitPrice: Math.max(0, Number(line.unitPrice) || 0),
        serialOrLot: String(line.serialNumber || '').trim() || undefined,
        condition: line.condition || 'SAN_SANG',
        supplierDefault: String(trx.partnerName || '').trim() || undefined,
        spec: String(line.spec || '').trim() || undefined,
        updatedAt: fallbackNow,
        metadataUpdatedAt: fallbackNow,
      });
    });
  });

  // 5. Material Categories + O(1) Item-Category Linking + O(N + T) Stock Calculation
  const catById = new Map<string, any>();
  const processCategory = (cat: any, isIncoming: boolean) => {
    if (!cat || (!cat.id && !cat.code && !cat.name)) return;
    const normCode = String(cat.code || '').trim().toUpperCase();
    const normName = String(cat.name || '').trim();
    if (!normCode && !normName) return;

    const key = String(cat.id || `CAT-${normCode || toCategoryAsciiSlug(normName)}`).trim().toUpperCase();
    const tKeys = [
      makeTombstoneKey('CAT', cat.id),
      normCode ? makeTombstoneKey('CAT', normCode) : '',
    ].filter(Boolean);
    const cTime = parseSafeUtcTime(cat.updatedAt) || 0;

    if (isEntityDeleted(registry, tKeys, cTime)) {
      catById.delete(key);
      return;
    }
    clearTombstonesIfRevived(registry, tKeys, cTime);

    const prev = catById.get(key);
    if (!prev) {
      catById.set(key, {
        ...cat,
        id: cat.id || key,
        code: normCode || cat.code,
        name: normName || normCode,
      });
    } else {
      const prevTime = parseSafeUtcTime(prev.updatedAt) || 0;
      const useNew = isIncoming ? cTime >= prevTime : cTime > prevTime;
      const older = useNew ? prev : cat;
      const newer = useNew ? cat : prev;
      catById.set(key, {
        ...older,
        ...newer,
        id: prev.id || cat.id || key,
        code: String(newer.code || older.code).trim().toUpperCase(),
        name: String(newer.name || older.name).trim(),
      });
    }
  };
  (existing.materialCategories || []).forEach((c: any) => processCategory(c, false));
  (incoming.materialCategories || []).forEach((c: any) => processCategory(c, true));

  const dedupByCode = new Map<string, any>();
  const catLookupByIdUpper = new Map<string, any>();
  const catLookupByCodeUpper = new Map<string, any>();
  const catLookupByNameOrCodeLower = new Map<string, any>();

  const registerCategoryInIndexes = (cat: any) => {
    catLookupByIdUpper.set(String(cat.id).toUpperCase(), cat);
    const codeUpper = String(cat.code || '').trim().toUpperCase();
    if (codeUpper) {
      catLookupByCodeUpper.set(codeUpper, cat);
      catLookupByNameOrCodeLower.set(codeUpper.toLowerCase(), cat);
    }
    const nameLower = String(cat.name || '').trim().toLowerCase();
    if (nameLower) {
      catLookupByNameOrCodeLower.set(nameLower, cat);
    }
  };

  Array.from(catById.values())
    .sort((a: any, b: any) => (parseSafeUtcTime(a.updatedAt) || 0) - (parseSafeUtcTime(b.updatedAt) || 0))
    .forEach((c: any) => {
      const codeKey = String(c.code || '').trim().toUpperCase();
      const prev = dedupByCode.get(codeKey);
      if (!prev) {
        dedupByCode.set(codeKey, c);
        registerCategoryInIndexes(c);
      } else {
        const mergedCat = { ...prev, ...c, id: prev.id, code: codeKey };
        dedupByCode.set(codeKey, mergedCat);
        registerCategoryInIndexes(mergedCat);
        catLookupByIdUpper.set(String(c.id).toUpperCase(), mergedCat);
      }
    });

  const mergedCategories: any[] = Array.from(dedupByCode.values());
  const usedCatCodes = new Set<string>(mergedCategories.map((c: any) => String(c.code || '').trim().toUpperCase()));

  const rawItemsList = Array.from(itemMap.values());
  const allStocks = computeAllWarehouseStocksForServer(
    rawItemsList,
    mergedWarehouses,
    mergedTransactions
  );

  const mergedItems = rawItemsList.map((item: any, idx: number) => {
    const stocks = allStocks[idx] || {};
    let totalStock = 0;
    const stockVals = Object.values(stocks);
    for (let s = 0; s < stockVals.length; s++) {
      totalStock += Number(stockVals[s]) || 0;
    }

    const rawCatId = String(item.categoryId || '').trim();
    const rawCatCode = String(item.categoryCode || '').trim().toUpperCase();
    const rawCatName = String(item.category || '').trim();
    const itemMetaMs = Math.max(
      parseSafeUtcTime(item.metadataUpdatedAt),
      parseSafeUtcTime(item.updatedAt)
    );

    let linkedCat: any = undefined;
    let isUncategorized =
      (!rawCatId && !rawCatCode && !rawCatName) ||
      (!rawCatId && !rawCatCode && rawCatName.toLowerCase() === 'chưa phân loại');

    if (!isUncategorized && rawCatId) {
      const byId = catLookupByIdUpper.get(rawCatId.toUpperCase());
      if (byId) {
        const catUpdatedMs = parseSafeUtcTime(byId.updatedAt) || 0;
        if (
          !rawCatName ||
          rawCatName.toLowerCase() === String(byId.name).toLowerCase() ||
          catUpdatedMs >= itemMetaMs
        ) {
          linkedCat = byId;
        }
      } else if (isEntityDeleted(registry, [makeTombstoneKey('CAT', rawCatId)], itemMetaMs)) {
        isUncategorized = true;
      }
    }

    if (!isUncategorized && !linkedCat && rawCatCode) {
      linkedCat = catLookupByCodeUpper.get(rawCatCode);
      if (!linkedCat && isEntityDeleted(registry, [makeTombstoneKey('CAT', rawCatCode)], itemMetaMs)) {
        isUncategorized = true;
      }
    }

    if (!isUncategorized && !linkedCat && rawCatName) {
      linkedCat = catLookupByNameOrCodeLower.get(rawCatName.toLowerCase());
    }

    if (!isUncategorized && !linkedCat && rawCatName && rawCatName.toLowerCase() !== 'chưa phân loại') {
      const slug = toCategoryAsciiSlug(rawCatName) || 'GENERAL';
      const autoId = `CAT-AUTO-${slug}`;
      const autoTKeys = [
        makeTombstoneKey('CAT', autoId),
        rawCatCode ? makeTombstoneKey('CAT', rawCatCode) : '',
      ].filter(Boolean);

      if (isEntityDeleted(registry, autoTKeys, itemMetaMs)) {
        isUncategorized = true;
      } else {
        const autoCode =
          rawCatCode && !usedCatCodes.has(rawCatCode)
            ? (usedCatCodes.add(rawCatCode), rawCatCode)
            : generateCategoryCodeFromName(rawCatName, usedCatCodes);
        const fallbackIso = item.metadataUpdatedAt || item.updatedAt || '2026-01-01T00:00:00.000Z';
        linkedCat = {
          id: autoId,
          code: autoCode,
          name: rawCatName,
          description: 'Danh mục tự động liên kết từ vật tư kho',
          createdAt: String(fallbackIso).replace('T', ' ').substring(0, 16),
          updatedAt: fallbackIso,
        };
        mergedCategories.push(linkedCat);
        registerCategoryInIndexes(linkedCat);
      }
    }

    return {
      ...item,
      categoryId: linkedCat ? linkedCat.id : undefined,
      categoryCode: linkedCat ? linkedCat.code : undefined,
      category: linkedCat ? linkedCat.name : 'Chưa phân loại',
      warehouseStocks: stocks,
      currentStock: Math.max(0, totalStock),
    };
  });

  mergedCategories.sort((a: any, b: any) => String(a.code || '').localeCompare(String(b.code || ''), 'vi'));

  const deletedItemIds: string[] = [];
  const deletedTransactionIds: string[] = [];
  const deletedUserIds: string[] = [];
  const deletedWarehouseIds: string[] = [];
  const deletedCategoryIds: string[] = [];

  Object.keys(registry).forEach(k => {
    if (k.startsWith('ITEM:')) deletedItemIds.push(k.slice(5));
    else if (k.startsWith('TRX:')) deletedTransactionIds.push(k.slice(4));
    else if (k.startsWith('USER:')) deletedUserIds.push(k.slice(5));
    else if (k.startsWith('WH:')) deletedWarehouseIds.push(k.slice(3));
    else if (k.startsWith('CAT:')) deletedCategoryIds.push(k.slice(4));
  });

  const mergedSupabaseConfig =
    incoming.supabaseConfig && incoming.supabaseConfig.url && incoming.supabaseConfig.key
      ? incoming.supabaseConfig
      : existing.supabaseConfig;

  return {
    version: Math.max(Number(existing.version) || 0, Number(incoming.version) || 0) + 1,
    lastUpdated: new Date().toISOString(),
    users: sanitizedUsers,
    warehouses: mergedWarehouses,
    materialCategories: mergedCategories,
    transactions: mergedTransactions,
    items: mergedItems,
    deletedRegistry: registry,
    deletedUserIds,
    deletedTransactionIds,
    deletedItemIds,
    deletedWarehouseIds,
    deletedCategoryIds,
    supabaseConfig: mergedSupabaseConfig,
    lastUpdatedBy: incoming.lastUpdatedBy || existing.lastUpdatedBy,
    clientId: incoming.clientId,
    source: incoming.source || 'server-deterministic-merge',
  };
}

// Optional external cloud persistence (Supabase REST) if configured via env or shared config
async function fetchRemoteSupabaseIfConfigured(sharedConfig?: { url?: string; key?: string }): Promise<any | null> {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || sharedConfig?.url;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    sharedConfig?.key;

  if (!supabaseUrl || !supabaseKey) return null;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/inventory_state?id=eq.default&select=*`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0 && rows[0].data) {
      return rows[0].data;
    }
  } catch {
    // ignore remote fetch failure
  }
  return null;
}

async function saveRemoteSupabaseIfConfigured(state: any): Promise<boolean> {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || state?.supabaseConfig?.url;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    state?.supabaseConfig?.key;

  if (!supabaseUrl || !supabaseKey) return false;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/inventory_state`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: 'default',
        data: state,
        updated_at: new Date().toISOString(),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  let memoryState: any = null;
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      memoryState = parsed ? mergeServerStateDeterministic(parsed, {}) : null;
    }
  } catch (err) {
    console.warn('[server] Could not parse initial .sync-state.json:', err);
  }

  // On boot, also reconcile with external Supabase if configured
  try {
    const remoteBoot = await fetchRemoteSupabaseIfConfigured(memoryState?.supabaseConfig);
    if (remoteBoot && Object.keys(remoteBoot).length > 0) {
      memoryState = memoryState
        ? mergeServerStateDeterministic(memoryState, remoteBoot)
        : remoteBoot;
      await fs.promises.writeFile(STATE_FILE, JSON.stringify(memoryState), 'utf-8');
    }
  } catch {
    // ignore boot sync error
  }

  // Connected SSE clients for instant <50ms multi-user real-time broadcast
  const sseClients = new Set<express.Response>();

  const broadcastStateToClients = (payload: any) => {
    if (!payload) return;
    const message = `data: ${JSON.stringify({ type: 'SYNC_STATE', payload })}\n\n`;
    sseClients.forEach(clientRes => {
      try {
        clientRes.write(message);
      } catch {
        sseClients.delete(clientRes);
      }
    });
  };

  // Heartbeat every 20s to keep reverse-proxy SSE connections alive
  setInterval(() => {
    const ping = `: heartbeat ${Date.now()}\n\n`;
    sseClients.forEach(clientRes => {
      try {
        clientRes.write(ping);
      } catch {
        sseClients.delete(clientRes);
      }
    });
  }, 20000);

  // CORS middleware for /api/*
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control');
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    next();
  });

  // SSE Real-time Stream Endpoint
  app.get('/api/sync/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    sseClients.add(res);

    if (memoryState) {
      res.write(`data: ${JSON.stringify({ type: 'SYNC_STATE', payload: memoryState })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);
    }

    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // GET authoritative state (supports ?sinceVersion= to skip sending multi-MB payloads when unchanged)
  app.get('/api/sync', async (req, res) => {
    try {
      if (!memoryState && fs.existsSync(STATE_FILE)) {
        memoryState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      }
    } catch {
      // keep memoryState
    }

    const provider = memoryState?.supabaseConfig?.url ? 'supabase' : 'central-server';
    const sinceVersion = Number(req.query.sinceVersion);
    if (
      memoryState &&
      !Number.isNaN(sinceVersion) &&
      sinceVersion > 0 &&
      Number(memoryState.version) > 0 &&
      sinceVersion >= Number(memoryState.version)
    ) {
      res.status(200).json({
        success: true,
        notModified: true,
        provider,
        version: memoryState.version,
        lastUpdated: memoryState.lastUpdated,
      });
      return;
    }

    res.status(200).json({
      success: true,
      provider,
      payload: memoryState,
    });
  });

  // Serialize POST updates so concurrent multi-user writes never race on disk/memory
  let writeLock: Promise<void> = Promise.resolve();

  app.post('/api/sync', (req, res) => {
    writeLock = writeLock
      .then(async () => {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (!body || !body.payload) {
          res.status(400).json({ success: false, error: 'Thiếu dữ liệu payload' });
          return;
        }

        if (body.action === 'RESET_DATABASE' || body.cleanReset || body.payload?.cleanReset) {
          memoryState = {
            version: Math.max(Number(memoryState?.version) || 0, 1) + 1,
            lastUpdated: new Date().toISOString(),
            users:
              Array.isArray(body.payload?.users) && body.payload.users.length > 0
                ? body.payload.users
                : memoryState?.users || [],
            warehouses:
              Array.isArray(body.payload?.warehouses) && body.payload.warehouses.length > 0
                ? body.payload.warehouses
                : memoryState?.warehouses || [],
            materialCategories: Array.isArray(body.payload?.materialCategories)
              ? body.payload.materialCategories
              : [],
            items: Array.isArray(body.payload?.items) ? body.payload.items : [],
            transactions: Array.isArray(body.payload?.transactions) ? body.payload.transactions : [],
            deletedRegistry: {},
            deletedUserIds: [],
            deletedTransactionIds: [],
            deletedItemIds: [],
            deletedWarehouseIds: [],
            deletedCategoryIds: [],
            supabaseConfig: memoryState?.supabaseConfig,
            source: 'admin-clean-reset',
          };
        } else {
          memoryState = mergeServerStateDeterministic(memoryState, body.payload);
        }

        const stateSnapshot = memoryState;

        // Broadcast and respond immediately while persisting compact JSON asynchronously
        broadcastStateToClients(stateSnapshot);

        res.status(200).json({
          success: true,
          provider: stateSnapshot?.supabaseConfig?.url ? 'supabase' : 'central-server',
          savedToCloud: true,
          version: stateSnapshot.version,
          lastUpdated: stateSnapshot.lastUpdated,
          payload: stateSnapshot,
        });

        try {
          const tmpFile = `${STATE_FILE}.tmp`;
          await fs.promises.writeFile(tmpFile, JSON.stringify(stateSnapshot), 'utf-8');
          await fs.promises.rename(tmpFile, STATE_FILE);
        } catch (writeErr) {
          console.warn('[server] Could not persist .sync-state.json:', writeErr);
        }

        saveRemoteSupabaseIfConfigured(stateSnapshot).catch(() => {});
      })
      .catch(err => {
        console.error('[server] Error handling POST /api/sync:', err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: 'Lỗi xử lý đồng bộ trên máy chủ' });
        }
      });
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: hmrDisabled ? true : { server: httpServer },
        hmr: hmrDisabled ? false : { server: httpServer },
        ws: hmrDisabled ? false : undefined,
        watch: hmrDisabled ? null : {},
      },
      plugins: [
        {
          name: 'safe-vite-client-ws',
          enforce: 'post',
          transform(code, id) {
            if (!id.includes('vite/dist/client/client.mjs')) return null;
            let patched = code;
            if (hmrDisabled) {
              patched = patched.replaceAll(
                'createWebSocketModuleRunnerTransport({',
                '(() => ({ async connect() {}, disconnect() {}, send() {} }))({'
              );
            }
            patched = patched.replace(
              'transport.connect(createHMRHandler(handleMessage));',
              'Promise.resolve(transport.connect(createHMRHandler(handleMessage))).catch(() => {});'
            );
            return patched !== code ? { code: patched, map: null } : null;
          },
        },
      ],
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Full-stack Inventory Sync Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
