import { InventoryItem, MaterialCategory, Transaction, User, Warehouse } from '../types/inventory';
import { calculateAllItemsWarehouseStocks } from './formatters';

export type DeletedRegistry = Record<string, string>;

const LEGACY_TOMBSTONE_ISO = '1970-01-01T00:00:01.000Z';

export function toCategoryAsciiSlug(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function generateCategoryCodeFromName(name: string, usedCodes: Set<string>): string {
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

/**
 * Chuẩn hóa chuỗi thời gian về epoch ms UTC an toàn, tránh lệch múi giờ 7 tiếng (UTC+7)
 * đối với các bản ghi cũ bị cắt ngắn định dạng "YYYY-MM-DD HH:mm".
 */
export function parseSafeUtcTime(ts?: string | null): number {
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

export type TimestampRefInput =
  | string
  | undefined
  | null
  | ReadonlyArray<string | undefined | null>;

/**
 * Sinh chuỗi ISO UTC đơn điệu tăng dần (Monotonic Timestamp), hỗ trợ truyền cả mảng lớn
 * mà không dùng toán tử spread `...` gây tràn Call Stack khi có >5.000 - 50.000 bản ghi.
 */
export function nextMonotonicIso(...refs: TimestampRefInput[]): string {
  let candidate = Date.now();
  for (let i = 0; i < refs.length; i++) {
    const entry = refs[i];
    if (!entry) continue;
    if (Array.isArray(entry)) {
      for (let j = 0; j < entry.length; j++) {
        const ms = parseSafeUtcTime(entry[j]);
        if (ms >= candidate) {
          candidate = ms + 1;
        }
      }
    } else if (typeof entry === 'string') {
      const ms = parseSafeUtcTime(entry);
      if (ms >= candidate) {
        candidate = ms + 1;
      }
    }
  }
  return new Date(candidate).toISOString();
}

export function makeTombstoneKey(
  prefix: 'ITEM' | 'TRX' | 'USER' | 'WH' | 'CAT',
  rawId?: string | null
): string {
  if (!rawId) return '';
  const cleaned = String(rawId).trim();
  if (!cleaned) return '';
  return `${prefix}:${prefix === 'USER' ? cleaned.toLowerCase() : cleaned.toUpperCase()}`;
}

export function buildMergedDeletedRegistry(
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

export interface SyncStateSnapshot {
  users: User[];
  warehouses: Warehouse[];
  materialCategories?: MaterialCategory[];
  transactions: Transaction[];
  items: InventoryItem[];
  deletedRegistry?: DeletedRegistry;
  deletedUserIds?: string[];
  deletedWarehouseIds?: string[];
  deletedCategoryIds?: string[];
  deletedTransactionIds?: string[];
  deletedItemIds?: string[];
}

export interface ReconciledSyncState {
  users: User[];
  warehouses: Warehouse[];
  materialCategories: MaterialCategory[];
  transactions: Transaction[];
  items: InventoryItem[];
  deletedRegistry: DeletedRegistry;
  deletedUserIds: string[];
  deletedWarehouseIds: string[];
  deletedCategoryIds: string[];
  deletedTransactionIds: string[];
  deletedItemIds: string[];
}

/**
 * Bộ hợp nhất trạng thái đa người dùng chuẩn xác (Deterministic CRDT-style State Reconciliation) - Độ phức tạp O(N + T).
 */
export function reconcileSyncPayloads(
  baseState: SyncStateSnapshot,
  incomingState: SyncStateSnapshot
): ReconciledSyncState {
  const registry = buildMergedDeletedRegistry(
    baseState.deletedRegistry,
    incomingState.deletedRegistry,
    {
      deletedItemIds: [
        ...(baseState.deletedItemIds || []),
        ...(incomingState.deletedItemIds || []),
      ],
      deletedTransactionIds: [
        ...(baseState.deletedTransactionIds || []),
        ...(incomingState.deletedTransactionIds || []),
      ],
      deletedUserIds: [
        ...(baseState.deletedUserIds || []),
        ...(incomingState.deletedUserIds || []),
      ],
      deletedWarehouseIds: [
        ...(baseState.deletedWarehouseIds || []),
        ...(incomingState.deletedWarehouseIds || []),
      ],
      deletedCategoryIds: [
        ...(baseState.deletedCategoryIds || []),
        ...(incomingState.deletedCategoryIds || []),
      ],
    }
  );

  // 1. HỢP NHẤT NGƯỜI DÙNG (USERS)
  const isUnmodifiedDefaultSeedAdmin = (u: User | undefined | null): boolean => {
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

  const allInputUsers = [...(baseState.users || []), ...(incomingState.users || [])];
  const hasRealNonSeedActiveAdmin = allInputUsers.some(u => {
    if (!u || u.role !== 'ADMIN' || u.status === 'LOCKED' || isUnmodifiedDefaultSeedAdmin(u)) {
      return false;
    }
    const tKeys = [makeTombstoneKey('USER', u.id), makeTombstoneKey('USER', u.username)].filter(Boolean);
    const uTime = Math.max(parseSafeUtcTime(u.updatedAt), parseSafeUtcTime(u.lastActiveAt));
    return !isEntityDeleted(registry, tKeys, uTime);
  });

  const userMap = new Map<string, User>();
  const processUser = (u: User, isIncoming: boolean) => {
    if (!u || (!u.username && !u.id)) return;
    if (hasRealNonSeedActiveAdmin && isUnmodifiedDefaultSeedAdmin(u)) {
      return;
    }

    const unameKey = (u.username || u.id).trim().toLowerCase();
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

    const existing = userMap.get(unameKey);
    if (!existing) {
      userMap.set(unameKey, u);
    } else {
      const exTime = Math.max(
        parseSafeUtcTime(existing.updatedAt),
        parseSafeUtcTime(existing.lastActiveAt)
      );
      const useNew = isIncoming ? uTime >= exTime : uTime > exTime;
      const older = useNew ? existing : u;
      const newer = useNew ? u : existing;
      userMap.set(unameKey, {
        ...older,
        ...newer,
        id: existing.id || u.id,
      });
    }
  };

  (baseState.users || []).forEach(u => processUser(u, false));
  (incomingState.users || []).forEach(u => processUser(u, true));

  if (
    allInputUsers.length > 0 &&
    !Array.from(userMap.values()).some(u => u.role === 'ADMIN' && u.status !== 'LOCKED')
  ) {
    const adminCandidates = [...(incomingState.users || []), ...(baseState.users || [])]
      .filter(u => u && u.role === 'ADMIN')
      .sort(
        (a, b) =>
          Math.max(parseSafeUtcTime(b.updatedAt), parseSafeUtcTime(b.lastActiveAt)) -
          Math.max(parseSafeUtcTime(a.updatedAt), parseSafeUtcTime(a.lastActiveAt))
      );
    if (adminCandidates.length > 0) {
      const fallbackAdmin = { ...adminCandidates[0], status: 'ACTIVE' as const };
      const fallbackKey = (fallbackAdmin.username || fallbackAdmin.id).trim().toLowerCase();
      userMap.set(fallbackKey, fallbackAdmin);
    }
  }

  const seenUserIds = new Set<string>();
  const mergedUsers = Array.from(userMap.values()).map(u => {
    let uniqueId = u.id || `USR-${u.username.toUpperCase()}`;
    if (uniqueId === 'USR-ADMIN' && u.username.toLowerCase() !== 'admin') {
      uniqueId = `USR-${u.username.toUpperCase()}`;
    }
    if (seenUserIds.has(uniqueId)) {
      uniqueId = `USR-${u.username.toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    }
    seenUserIds.add(uniqueId);
    return { ...u, id: uniqueId };
  });

  // 2. HỢP NHẤT KHO LƯU TRỮ (WAREHOUSES)
  const whMap = new Map<string, Warehouse>();
  const processWarehouse = (w: Warehouse, isIncoming: boolean) => {
    if (!w || (!w.id && !w.code)) return;
    const key = (w.id || w.code).trim().toUpperCase();
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

    const existing = whMap.get(key);
    if (!existing) {
      whMap.set(key, w);
    } else {
      const exTime = parseSafeUtcTime(existing.updatedAt) || 0;
      const useNew = isIncoming ? wTime >= exTime : wTime > exTime;
      whMap.set(key, {
        ...(useNew ? existing : w),
        ...(useNew ? w : existing),
      });
    }
  };

  (baseState.warehouses || []).forEach(w => processWarehouse(w, false));
  (incomingState.warehouses || []).forEach(w => processWarehouse(w, true));
  const mergedWarehouses = Array.from(whMap.values());

  // 3. HỢP NHẤT PHIẾU NHẬP / PHIẾU XUẤT (TRANSACTIONS) TRONG O(T log T)
  const trxMap = new Map<string, Transaction>();
  const processTransaction = (t: Transaction, isIncoming: boolean) => {
    if (!t || (!t.id && !t.code)) return;
    const idKey = (t.id || t.code).trim().toUpperCase();
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

    const existing = trxMap.get(idKey);
    if (!existing) {
      trxMap.set(idKey, t);
    } else {
      const exTime = parseSafeUtcTime(existing.updatedAt);
      const useNew = isIncoming ? tTime >= exTime : tTime > exTime;
      const older = useNew ? existing : t;
      const newer = useNew ? t : existing;
      trxMap.set(idKey, {
        ...older,
        ...newer,
        items: newer.items && newer.items.length > 0 ? newer.items : older.items || [],
        totalAmount: newer.totalAmount !== undefined ? newer.totalAmount : older.totalAmount,
      });
    }
  };

  (baseState.transactions || []).forEach(t => processTransaction(t, false));
  (incomingState.transactions || []).forEach(t => processTransaction(t, true));

  const rawTrxAsc = Array.from(trxMap.values()).sort((a, b) => {
    const ta = parseSafeUtcTime(a.updatedAt) || parseSafeUtcTime(a.date);
    const tb = parseSafeUtcTime(b.updatedAt) || parseSafeUtcTime(b.date);
    return ta - tb;
  });

  // O(1) sequential counter for code de-collision
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
    const c = (rawTrxAsc[i].code || '').trim().toUpperCase();
    if (c) trackSeqFromCode(c);
  }

  const nextCodeForType = (type: Transaction['type']): string => {
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

  const decollidedTransactions = rawTrxAsc.map(t => {
    const normCode = (t.code || '').trim().toUpperCase();
    if (!normCode || usedCodes.has(normCode)) {
      const reassigned = nextCodeForType(t.type);
      usedCodes.add(reassigned);
      return { ...t, code: reassigned };
    }
    usedCodes.add(normCode);
    trackSeqFromCode(normCode);
    return { ...t, code: normCode };
  });

  const mergedTransactions = decollidedTransactions.sort((a, b) => {
    const timeA = parseSafeUtcTime(a.date) || parseSafeUtcTime(a.updatedAt);
    const timeB = parseSafeUtcTime(b.date) || parseSafeUtcTime(b.updatedAt);
    if (timeB !== timeA) return timeB - timeA;
    return parseSafeUtcTime(b.updatedAt) - parseSafeUtcTime(a.updatedAt);
  });

  // 4. HỢP NHẤT DANH MỤC VẬT TƯ / THIẾT BỊ (ITEMS)
  const itemMap = new Map<string, InventoryItem>();
  const getItemKey = (i: InventoryItem) =>
    (i.code && i.code.trim() ? i.code.trim() : i.id.trim()).toUpperCase();

  const processItem = (item: InventoryItem, isIncoming: boolean) => {
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

    const existing = itemMap.get(key);
    if (!existing) {
      itemMap.set(key, {
        ...item,
        code: (item.code || item.id).trim().toUpperCase(),
      });
    } else {
      const exMetaTime = Math.max(
        parseSafeUtcTime(existing.metadataUpdatedAt),
        parseSafeUtcTime(existing.updatedAt)
      );
      const incMetaTime = Math.max(
        parseSafeUtcTime(item.metadataUpdatedAt),
        parseSafeUtcTime(item.updatedAt)
      );
      const useNew = isIncoming ? incMetaTime >= exMetaTime : incMetaTime > exMetaTime;
      const older = useNew ? existing : item;
      const newer = useNew ? item : existing;

      let mergedOpeningWh = newer.openingWarehouseStocks;
      if (!mergedOpeningWh || Object.keys(mergedOpeningWh).length === 0) {
        mergedOpeningWh = older.openingWarehouseStocks;
      }
      const mergedOpeningStock =
        newer.openingStock !== undefined ? newer.openingStock : older.openingStock;

      itemMap.set(key, {
        ...older,
        ...newer,
        id: existing.id || item.id,
        code: (newer.code || older.code).trim().toUpperCase(),
        openingStock: mergedOpeningStock,
        openingWarehouseStocks: mergedOpeningWh,
        updatedAt:
          parseSafeUtcTime(item.updatedAt) >= parseSafeUtcTime(existing.updatedAt)
            ? item.updatedAt
            : existing.updatedAt,
        metadataUpdatedAt:
          parseSafeUtcTime(item.metadataUpdatedAt) >= parseSafeUtcTime(existing.metadataUpdatedAt)
            ? item.metadataUpdatedAt || newer.metadataUpdatedAt
            : existing.metadataUpdatedAt,
      });
    }
  };

  (baseState.items || []).forEach(i => processItem(i, false));
  (incomingState.items || []).forEach(i => processItem(i, true));

  mergedTransactions.forEach(trx => {
    if (trx.status === 'DA_HUY' || trx.type !== 'NHAP_KHO') return;
    const trxTime = parseSafeUtcTime(trx.updatedAt);
    (trx.items || []).forEach(line => {
      const cleanCode = (line.itemCode || '').trim().toUpperCase();
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
        name: (line.itemName || cleanCode).trim(),
        type: line.type || 'VAT_TU',
        categoryId: line.categoryId,
        categoryCode: line.categoryCode,
        category: (line.category || 'Vật tư nhập kho').trim(),
        unit: (line.unit || 'Cái').trim(),
        warehouseId: whId,
        openingStock: 0,
        openingWarehouseStocks: { [whId]: 0 },
        warehouseStocks: { [whId]: Math.max(0, Number(line.quantity) || 0) },
        location: (line.location || 'Khu vực tiếp nhận').trim(),
        minStock: line.minStock ?? 5,
        maxStock: line.maxStock ?? 200,
        currentStock: Math.max(0, Number(line.quantity) || 0),
        unitPrice: Math.max(0, Number(line.unitPrice) || 0),
        serialOrLot: (line.serialNumber || '').trim() || undefined,
        condition: line.condition || 'SAN_SANG',
        supplierDefault: (trx.partnerName || '').trim() || undefined,
        spec: (line.spec || '').trim() || undefined,
        updatedAt: fallbackNow,
        metadataUpdatedAt: fallbackNow,
      });
    });
  });

  // 5. HỢP NHẤT NHÓM DANH MỤC VẬT TƯ & TÍNH TỒN KHO HÀNG LOẠT TRONG O(N + T)
  const catById = new Map<string, MaterialCategory>();
  const processCategory = (cat: MaterialCategory, isIncoming: boolean) => {
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

    const existing = catById.get(key);
    if (!existing) {
      catById.set(key, {
        ...cat,
        id: cat.id || key,
        code: normCode || cat.code,
        name: normName || normCode,
      });
    } else {
      const exTime = parseSafeUtcTime(existing.updatedAt) || 0;
      const useNew = isIncoming ? cTime >= exTime : cTime > exTime;
      const older = useNew ? existing : cat;
      const newer = useNew ? cat : existing;
      catById.set(key, {
        ...older,
        ...newer,
        id: existing.id || cat.id || key,
        code: String(newer.code || older.code).trim().toUpperCase(),
        name: String(newer.name || older.name).trim(),
      });
    }
  };

  (baseState.materialCategories || []).forEach(c => processCategory(c, false));
  (incomingState.materialCategories || []).forEach(c => processCategory(c, true));

  const dedupByCode = new Map<string, MaterialCategory>();
  const catLookupByIdUpper = new Map<string, MaterialCategory>();
  const catLookupByCodeUpper = new Map<string, MaterialCategory>();
  const catLookupByNameOrCodeLower = new Map<string, MaterialCategory>();

  const registerCategoryInIndexes = (cat: MaterialCategory) => {
    catLookupByIdUpper.set(cat.id.toUpperCase(), cat);
    const codeUpper = cat.code.trim().toUpperCase();
    if (codeUpper) {
      catLookupByCodeUpper.set(codeUpper, cat);
      catLookupByNameOrCodeLower.set(codeUpper.toLowerCase(), cat);
    }
    const nameLower = cat.name.trim().toLowerCase();
    if (nameLower) {
      catLookupByNameOrCodeLower.set(nameLower, cat);
    }
  };

  Array.from(catById.values())
    .sort((a, b) => (parseSafeUtcTime(a.updatedAt) || 0) - (parseSafeUtcTime(b.updatedAt) || 0))
    .forEach(c => {
      const codeKey = c.code.trim().toUpperCase();
      const prev = dedupByCode.get(codeKey);
      if (!prev) {
        dedupByCode.set(codeKey, c);
        registerCategoryInIndexes(c);
      } else {
        const mergedCat: MaterialCategory = {
          ...prev,
          ...c,
          id: prev.id,
          code: codeKey,
        };
        dedupByCode.set(codeKey, mergedCat);
        registerCategoryInIndexes(mergedCat);
        catLookupByIdUpper.set(c.id.toUpperCase(), mergedCat);
      }
    });

  const mergedCategories: MaterialCategory[] = Array.from(dedupByCode.values());
  const usedCatCodes = new Set<string>(mergedCategories.map(c => c.code.trim().toUpperCase()));

  const rawItemsList = Array.from(itemMap.values());
  const allStocks = calculateAllItemsWarehouseStocks(
    rawItemsList,
    mergedWarehouses,
    mergedTransactions
  );

  const mergedItems = rawItemsList.map((item, idx) => {
    const stocks = allStocks[idx] || {};
    let totalStock = 0;
    const stockVals = Object.values(stocks);
    for (let s = 0; s < stockVals.length; s++) {
      totalStock += Number(stockVals[s]) || 0;
    }

    const rawCatId = (item.categoryId || '').trim();
    const rawCatCode = (item.categoryCode || '').trim().toUpperCase();
    const rawCatName = (item.category || '').trim();
    const itemMetaMs = Math.max(
      parseSafeUtcTime(item.metadataUpdatedAt),
      parseSafeUtcTime(item.updatedAt)
    );

    let linkedCat: MaterialCategory | undefined;
    let isUncategorized =
      (!rawCatId && !rawCatCode && !rawCatName) ||
      (!rawCatId && !rawCatCode && rawCatName.toLowerCase() === 'chưa phân loại');

    if (!isUncategorized && rawCatId) {
      const byId = catLookupByIdUpper.get(rawCatId.toUpperCase());
      if (byId) {
        const catUpdatedMs = parseSafeUtcTime(byId.updatedAt) || 0;
        if (
          !rawCatName ||
          rawCatName.toLowerCase() === byId.name.toLowerCase() ||
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
          createdAt: fallbackIso.replace('T', ' ').substring(0, 16),
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

  mergedCategories.sort((a, b) => a.code.localeCompare(b.code, 'vi'));

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

  return {
    users: mergedUsers,
    warehouses: mergedWarehouses,
    materialCategories: mergedCategories,
    transactions: mergedTransactions,
    items: mergedItems,
    deletedRegistry: registry,
    deletedItemIds,
    deletedTransactionIds,
    deletedUserIds,
    deletedWarehouseIds,
    deletedCategoryIds,
  };
}

export function mergeUsersAdditive(
  localUsers: User[],
  remoteUsers: User[],
  deletedIds: string[] = [],
  deletedRegistry?: DeletedRegistry
): User[] {
  return reconcileSyncPayloads(
    { users: localUsers, warehouses: [], transactions: [], items: [], deletedUserIds: deletedIds, deletedRegistry },
    { users: remoteUsers, warehouses: [], transactions: [], items: [], deletedUserIds: deletedIds, deletedRegistry }
  ).users;
}

export function mergeWarehousesAdditive(
  localWh: Warehouse[],
  remoteWh: Warehouse[],
  deletedIds: string[] = [],
  deletedRegistry?: DeletedRegistry
): Warehouse[] {
  return reconcileSyncPayloads(
    { users: [], warehouses: localWh, transactions: [], items: [], deletedWarehouseIds: deletedIds, deletedRegistry },
    { users: [], warehouses: remoteWh, transactions: [], items: [], deletedWarehouseIds: deletedIds, deletedRegistry }
  ).warehouses;
}

export function mergeTransactionsAdditive(
  localTrx: Transaction[],
  remoteTrx: Transaction[],
  deletedIds: string[] = [],
  deletedRegistry?: DeletedRegistry
): Transaction[] {
  return reconcileSyncPayloads(
    { users: [], warehouses: [], transactions: localTrx, items: [], deletedTransactionIds: deletedIds, deletedRegistry },
    { users: [], warehouses: [], transactions: remoteTrx, items: [], deletedTransactionIds: deletedIds, deletedRegistry }
  ).transactions;
}

export function mergeItemsAdditive(
  localItems: InventoryItem[],
  remoteItems: InventoryItem[],
  warehouses: Warehouse[],
  mergedTransactions: Transaction[],
  deletedIds: string[] = [],
  deletedRegistry?: DeletedRegistry
): InventoryItem[] {
  return reconcileSyncPayloads(
    { users: [], warehouses, transactions: mergedTransactions, items: localItems, deletedItemIds: deletedIds, deletedRegistry },
    { users: [], warehouses, transactions: mergedTransactions, items: remoteItems, deletedItemIds: deletedIds, deletedRegistry }
  ).items;
}
