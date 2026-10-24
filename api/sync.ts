/**
 * Vercel Serverless Function: /api/sync
 *
 * Supports:
 * 1. Vercel Edge Config (Global Config Store)
 * 2. Vercel KV (Upstash Redis REST)
 * 3. Supabase (PostgreSQL REST with RLS)
 * 4. In-Memory fallback
 */

import { get as getEdgeConfig } from '@vercel/edge-config';

let localMemoryState: any = null;

const STATE_KEY = 'nxt_inventory_state_v1';
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

function makeTombstoneKey(prefix: 'ITEM' | 'TRX' | 'USER' | 'WH', rawId?: string | null): string {
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
  }
): DeletedRegistry {
  const merged: DeletedRegistry = {};
  const applyReg = (reg?: DeletedRegistry) => {
    if (!reg || typeof reg !== 'object') return;
    Object.entries(reg).forEach(([k, v]) => {
      if (!k || !v) return;
      const incTime = parseSafeUtcTime(v);
      if (incTime <= 0) return;
      const prevTime = parseSafeUtcTime(merged[k]);
      if (incTime > prevTime) {
        merged[k] = new Date(incTime).toISOString();
      }
    });
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
      if (norm === 'admin' || norm === 'usr-admin') return;
      const k = makeTombstoneKey('USER', norm);
      if (k && !merged[k]) merged[k] = LEGACY_TOMBSTONE_ISO;
    });
    (legacyArrays.deletedWarehouseIds || []).forEach(id => {
      const k = makeTombstoneKey('WH', id);
      if (k && !merged[k]) merged[k] = LEGACY_TOMBSTONE_ISO;
    });
  }
  return merged;
}

function getLatestTombstoneMs(reg: DeletedRegistry, keys: string[]): number {
  let maxMs = 0;
  for (const k of keys) {
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
    for (const k of keys) {
      if (k && reg[k]) delete reg[k];
    }
  }
}

function computeWarehouseStocks(item: any, warehouses: any[], transactions: any[]): Record<string, number> {
  const allWhIds = new Set<string>();
  warehouses.forEach((w: any) => {
    if (w && w.id) allWhIds.add(w.id);
  });
  if (item.warehouseId) allWhIds.add(item.warehouseId);
  if (item.openingWarehouseStocks) {
    Object.keys(item.openingWarehouseStocks).forEach(k => allWhIds.add(k));
  }
  if (item.warehouseStocks) {
    Object.keys(item.warehouseStocks).forEach(k => allWhIds.add(k));
  }

  const activeTrx = transactions.filter((t: any) => t && t.status !== 'DA_HUY');
  const whMovements: Record<string, { inQty: number; outQty: number }> = {};
  allWhIds.forEach(whId => {
    whMovements[whId] = { inQty: 0, outQty: 0 };
  });

  let totalNetTransactions = 0;
  let wasAutoCreatedByReceipt = false;
  const normCode = String(item.code || '').trim().toUpperCase();

  activeTrx.forEach((trx: any) => {
    const whId = trx.warehouseId || item.warehouseId || warehouses[0]?.id || 'WH-01';
    allWhIds.add(whId);
    if (!whMovements[whId]) whMovements[whId] = { inQty: 0, outQty: 0 };
    const matchingLines = (trx.items || []).filter(
      (l: any) =>
        (l.itemId && l.itemId === item.id) ||
        (normCode && l.itemCode && String(l.itemCode).trim().toUpperCase() === normCode)
    );
    matchingLines.forEach((line: any) => {
      const q = Number(line.quantity) || 0;
      if (line.isNewItem && trx.type === 'NHAP_KHO') wasAutoCreatedByReceipt = true;
      if (trx.type === 'NHAP_KHO') {
        whMovements[whId].inQty += q;
        totalNetTransactions += q;
      } else if (trx.type === 'XUAT_KHO') {
        whMovements[whId].outQty += q;
        totalNetTransactions -= q;
      }
    });
  });

  const primaryWhId = item.warehouseId || warehouses[0]?.id || 'WH-01';
  allWhIds.add(primaryWhId);

  const result: Record<string, number> = {};
  if (item.openingWarehouseStocks && Object.keys(item.openingWarehouseStocks).length > 0) {
    allWhIds.forEach(whId => {
      const opening = Number(item.openingWarehouseStocks?.[whId]) || 0;
      const net = (whMovements[whId]?.inQty || 0) - (whMovements[whId]?.outQty || 0);
      result[whId] = Math.max(0, opening + net);
    });
  } else {
    const inferredOpening =
      item.openingStock !== undefined
        ? Number(item.openingStock) || 0
        : wasAutoCreatedByReceipt
        ? 0
        : Math.max(0, (Number(item.currentStock) || 0) - totalNetTransactions);
    allWhIds.forEach(whId => {
      const net = (whMovements[whId]?.inQty || 0) - (whMovements[whId]?.outQty || 0);
      result[whId] = whId === primaryWhId ? Math.max(0, inferredOpening + net) : Math.max(0, net);
    });
  }
  warehouses.forEach((w: any) => {
    if (w && w.id && result[w.id] === undefined) result[w.id] = 0;
  });
  return result;
}

function mergeStateAdditive(existing: any, incoming: any): any {
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
    }
  );

  const userMap = new Map<string, any>();
  const processUser = (u: any, isIncoming: boolean) => {
    if (!u || (!u.username && !u.id)) return;
    const unameKey = String(u.username || u.id).trim().toLowerCase();
    const tKeys = [makeTombstoneKey('USER', u.id), makeTombstoneKey('USER', u.username)].filter(Boolean);
    const uTime = parseSafeUtcTime(u.updatedAt) || parseSafeUtcTime(u.lastActiveAt) || 0;
    if (unameKey !== 'admin' && isEntityDeleted(registry, tKeys, uTime)) {
      userMap.delete(unameKey);
      return;
    }
    clearTombstonesIfRevived(registry, tKeys, uTime);
    const prev = userMap.get(unameKey);
    if (!prev) {
      userMap.set(unameKey, u);
    } else {
      const prevTime =
        parseSafeUtcTime(prev.updatedAt) || parseSafeUtcTime(prev.lastActiveAt) || 0;
      const useNew = isIncoming ? uTime >= prevTime : uTime > prevTime;
      userMap.set(unameKey, { ...(useNew ? prev : u), ...(useNew ? u : prev), id: prev.id || u.id });
    }
  };
  (existing.users || []).forEach((u: any) => processUser(u, false));
  (incoming.users || []).forEach((u: any) => processUser(u, true));

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

  const whMap = new Map<string, any>();
  const processWarehouse = (w: any, isIncoming: boolean) => {
    if (!w || (!w.id && !w.code)) return;
    const key = String(w.id || w.code).trim().toUpperCase();
    const tKeys = [makeTombstoneKey('WH', w.id), makeTombstoneKey('WH', w.code)].filter(Boolean);
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
      whMap.set(key, { ...(useNew ? prev : w), ...(useNew ? w : prev) });
    }
  };
  (existing.warehouses || []).forEach((w: any) => processWarehouse(w, false));
  (incoming.warehouses || []).forEach((w: any) => processWarehouse(w, true));
  const mergedWarehouses = Array.from(whMap.values());

  const trxMap = new Map<string, any>();
  const processTransaction = (t: any, isIncoming: boolean) => {
    if (!t || (!t.id && !t.code)) return;
    const idKey = String(t.id || t.code).trim().toUpperCase();
    const tKeys = [makeTombstoneKey('TRX', t.id), makeTombstoneKey('TRX', t.code)].filter(Boolean);
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

  const rawTrxAsc = Array.from(trxMap.values()).sort(
    (a: any, b: any) =>
      (parseSafeUtcTime(a.updatedAt) || parseSafeUtcTime(a.date)) -
      (parseSafeUtcTime(b.updatedAt) || parseSafeUtcTime(b.date))
  );
  const usedCodes = new Set<string>();
  const nextCodeForType = (type: string): string => {
    const prefix = type === 'NHAP_KHO' ? 'PN' : 'PX';
    const year = new Date().getFullYear();
    const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`, 'i');
    let maxNum = 0;
    usedCodes.forEach(c => {
      const m = c.match(pattern);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    let candidateNum = maxNum + 1;
    let candidate = `${prefix}-${year}-${String(candidateNum).padStart(4, '0')}`;
    while (usedCodes.has(candidate)) {
      candidateNum++;
      candidate = `${prefix}-${year}-${String(candidateNum).padStart(4, '0')}`;
    }
    return candidate;
  };
  const mergedTransactions = rawTrxAsc
    .map((t: any) => {
      const normCode = String(t.code || '').trim().toUpperCase();
      if (!normCode || usedCodes.has(normCode)) {
        const reassigned = nextCodeForType(t.type);
        usedCodes.add(reassigned);
        return { ...t, code: reassigned };
      }
      usedCodes.add(normCode);
      return { ...t, code: normCode };
    })
    .sort((a: any, b: any) => {
      const timeA = parseSafeUtcTime(a.date) || parseSafeUtcTime(a.updatedAt);
      const timeB = parseSafeUtcTime(b.date) || parseSafeUtcTime(b.updatedAt);
      return timeB !== timeA ? timeB - timeA : parseSafeUtcTime(b.updatedAt) - parseSafeUtcTime(a.updatedAt);
    });

  const itemMap = new Map<string, any>();
  const getItemKey = (i: any) => String(i.code && String(i.code).trim() ? i.code : i.id).trim().toUpperCase();
  const processItem = (item: any, isIncoming: boolean) => {
    if (!item || (!item.code && !item.id)) return;
    const key = getItemKey(item);
    const tKeys = [makeTombstoneKey('ITEM', item.id), makeTombstoneKey('ITEM', item.code)].filter(Boolean);
    const iTime = Math.max(parseSafeUtcTime(item.metadataUpdatedAt), parseSafeUtcTime(item.updatedAt));
    if (isEntityDeleted(registry, tKeys, iTime)) {
      itemMap.delete(key);
      return;
    }
    clearTombstonesIfRevived(registry, tKeys, iTime);
    const prev = itemMap.get(key);
    if (!prev) {
      itemMap.set(key, { ...item, code: String(item.code || item.id).trim().toUpperCase() });
    } else {
      const exMetaTime = Math.max(parseSafeUtcTime(prev.metadataUpdatedAt), parseSafeUtcTime(prev.updatedAt));
      const incMetaTime = Math.max(parseSafeUtcTime(item.metadataUpdatedAt), parseSafeUtcTime(item.updatedAt));
      const useNew = isIncoming ? incMetaTime >= exMetaTime : incMetaTime > exMetaTime;
      const older = useNew ? prev : item;
      const newer = useNew ? item : prev;
      let mergedOpeningWh = newer.openingWarehouseStocks;
      if (!mergedOpeningWh || Object.keys(mergedOpeningWh).length === 0) {
        mergedOpeningWh = older.openingWarehouseStocks;
      }
      itemMap.set(key, {
        ...older,
        ...newer,
        id: prev.id || item.id,
        code: String(newer.code || older.code).trim().toUpperCase(),
        openingStock: newer.openingStock !== undefined ? newer.openingStock : older.openingStock,
        openingWarehouseStocks: mergedOpeningWh,
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
      const lineTKeys = [makeTombstoneKey('ITEM', line.itemId), makeTombstoneKey('ITEM', cleanCode)].filter(Boolean);
      if (isEntityDeleted(registry, lineTKeys, trxTime)) return;
      const whId = trx.warehouseId || mergedWarehouses[0]?.id || 'WH-01';
      const fallbackNow = trx.updatedAt || new Date().toISOString();
      itemMap.set(cleanCode, {
        id: line.itemId || `ITEM-AUTO-${cleanCode}`,
        code: cleanCode,
        name: String(line.itemName || cleanCode).trim(),
        type: line.type || 'VAT_TU',
        category: String(line.category || 'Vật tư nhập kho').trim(),
        unit: String(line.unit || 'Cái').trim(),
        warehouseId: whId,
        openingStock: 0,
        openingWarehouseStocks: { [whId]: 0 },
        location: String(line.location || 'Khu vực tiếp nhận').trim(),
        minStock: line.minStock ?? 5,
        maxStock: line.maxStock ?? 200,
        currentStock: Math.max(0, Number(line.quantity) || 0),
        unitPrice: Math.max(0, Number(line.unitPrice) || 0),
        condition: line.condition || 'SAN_SANG',
        updatedAt: fallbackNow,
        metadataUpdatedAt: fallbackNow,
      });
    });
  });

  const mergedItems = Array.from(itemMap.values()).map((item: any) => {
    const stocks = computeWarehouseStocks(item, mergedWarehouses, mergedTransactions);
    const totalStock = Object.values(stocks).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
    return { ...item, warehouseStocks: stocks, currentStock: Math.max(0, totalStock) };
  });

  const deletedItemIds: string[] = [];
  const deletedTransactionIds: string[] = [];
  const deletedUserIds: string[] = [];
  const deletedWarehouseIds: string[] = [];
  Object.keys(registry).forEach(k => {
    if (k.startsWith('ITEM:')) deletedItemIds.push(k.slice(5));
    else if (k.startsWith('TRX:')) deletedTransactionIds.push(k.slice(4));
    else if (k.startsWith('USER:')) deletedUserIds.push(k.slice(5));
    else if (k.startsWith('WH:')) deletedWarehouseIds.push(k.slice(3));
  });

  return {
    version: Math.max(Number(existing.version) || 0, Number(incoming.version) || 0) + 1,
    lastUpdated: new Date().toISOString(),
    users: sanitizedUsers,
    transactions: mergedTransactions,
    warehouses: mergedWarehouses,
    items: mergedItems,
    deletedRegistry: registry,
    deletedUserIds,
    deletedTransactionIds,
    deletedItemIds,
    deletedWarehouseIds,
    supabaseConfig:
      incoming.supabaseConfig?.url && incoming.supabaseConfig?.key
        ? incoming.supabaseConfig
        : existing.supabaseConfig,
    source: incoming.source || 'server-deterministic-merge',
  };
}

async function fetchFromEdgeConfig(): Promise<any | null> {
  const edgeConfigUrl = process.env.EDGE_CONFIG;
  if (!edgeConfigUrl) return null;
  try {
    const data = await getEdgeConfig(STATE_KEY);
    if (data) return typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    // fallback REST
  }
  try {
    const url = new URL(edgeConfigUrl);
    const cleanPath = url.pathname.replace(/\/items?$/, '');
    const itemEndpoint = `${url.origin}${cleanPath}/item/${STATE_KEY}${url.search}`;
    const res = await fetch(itemEndpoint, { cache: 'no-store' });
    if (res.ok) {
      const result = await res.json();
      return typeof result === 'string' ? JSON.parse(result) : result;
    }
  } catch {
    // ignore
  }
  return null;
}

async function saveToEdgeConfig(state: any): Promise<boolean> {
  const edgeConfigUrl = process.env.EDGE_CONFIG;
  const writeToken = process.env.VERCEL_API_TOKEN || process.env.EDGE_CONFIG_WRITE_TOKEN;
  if (!edgeConfigUrl || !writeToken) return false;
  let edgeConfigId = process.env.EDGE_CONFIG_ID;
  if (!edgeConfigId) {
    const match = edgeConfigUrl.match(/ecfg_[a-zA-Z0-9_-]+/);
    if (match) edgeConfigId = match[0];
  }
  if (!edgeConfigId) return false;
  try {
    const res = await fetch(`https://api.vercel.com/v1/edge-config/${edgeConfigId}/items`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{ operation: 'upsert', key: STATE_KEY, value: state }],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchFromVercelKV(): Promise<any | null> {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return null;
  try {
    const res = await fetch(`${kvUrl}/get/${STATE_KEY}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.result) {
      return typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
    }
  } catch {
    // ignore
  }
  return null;
}

async function saveToVercelKV(state: any): Promise<boolean> {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return false;
  try {
    const res = await fetch(`${kvUrl}/set/${STATE_KEY}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kvToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(typeof state === 'string' ? state : JSON.stringify(state)),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchFromSupabase(): Promise<any | null> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/inventory_state?id=eq.default&select=*`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0) return rows[0].data;
  } catch {
    // ignore
  }
  return null;
}

async function saveToSupabase(state: any): Promise<boolean> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
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

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const hasEdgeConfig = !!process.env.EDGE_CONFIG;
  const hasKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  const hasSupabase = !!(
    (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  );

  const provider = hasEdgeConfig
    ? 'vercel-edge-config'
    : hasKV
    ? 'vercel-kv'
    : hasSupabase
    ? 'supabase'
    : 'local-memory';

  if (req.method === 'GET') {
    let state = null;
    if (hasEdgeConfig) state = await fetchFromEdgeConfig();
    else if (hasKV) state = await fetchFromVercelKV();
    else if (hasSupabase) state = await fetchFromSupabase();
    if (!state) state = localMemoryState;

    return res.status(200).json({
      success: true,
      provider,
      payload: state,
    });
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const payload = body?.payload;
    if (!payload) {
      return res.status(400).json({ success: false, error: 'Thiếu dữ liệu payload' });
    }

    let existingState = null;
    if (hasEdgeConfig) existingState = await fetchFromEdgeConfig();
    else if (hasKV) existingState = await fetchFromVercelKV();
    else if (hasSupabase) existingState = await fetchFromSupabase();
    if (!existingState) existingState = localMemoryState;

    const mergedPayload =
      body.cleanReset || payload.cleanReset
        ? payload
        : mergeStateAdditive(existingState, payload);
    localMemoryState = mergedPayload;

    let saved = false;
    if (hasEdgeConfig) saved = await saveToEdgeConfig(mergedPayload);
    else if (hasKV) saved = await saveToVercelKV(mergedPayload);
    else if (hasSupabase) saved = await saveToSupabase(mergedPayload);
    else saved = true;

    return res.status(200).json({
      success: true,
      provider,
      savedToCloud: saved,
      version: mergedPayload.version,
      lastUpdated: mergedPayload.lastUpdated,
      payload: mergedPayload,
    });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
