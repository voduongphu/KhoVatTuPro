import 'dotenv/config';
import express from 'express';
import fs from 'fs';
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
      if (k && reg[k]) {
        delete reg[k];
      }
    }
  }
}

function computeWarehouseStocksForServer(
  item: any,
  warehouses: any[],
  transactions: any[]
): Record<string, number> {
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
    if (!whMovements[whId]) {
      whMovements[whId] = { inQty: 0, outQty: 0 };
    }
    const matchingLines = (trx.items || []).filter(
      (l: any) =>
        (l.itemId && l.itemId === item.id) ||
        (normCode && l.itemCode && String(l.itemCode).trim().toUpperCase() === normCode)
    );
    matchingLines.forEach((line: any) => {
      const q = Number(line.quantity) || 0;
      if (line.isNewItem && trx.type === 'NHAP_KHO') {
        wasAutoCreatedByReceipt = true;
      }
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
      if (whId === primaryWhId) {
        result[whId] = Math.max(0, inferredOpening + net);
      } else {
        result[whId] = Math.max(0, net);
      }
    });
  }

  warehouses.forEach((w: any) => {
    if (w && w.id && result[w.id] === undefined) {
      result[w.id] = 0;
    }
  });

  return result;
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
    }
  );

  // 1. Users
  const userMap = new Map<string, any>();
  const processUser = (u: any, isIncoming: boolean) => {
    if (!u || (!u.username && !u.id)) return;
    const unameKey = String(u.username || u.id).trim().toLowerCase();
    const tKeys = [
      makeTombstoneKey('USER', u.id),
      makeTombstoneKey('USER', u.username),
    ].filter(Boolean);
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

  // 3. Transactions + Code De-collision
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

  const decollidedTransactions = rawTrxAsc.map((t: any) => {
    const normCode = String(t.code || '').trim().toUpperCase();
    if (!normCode || usedCodes.has(normCode)) {
      const reassigned = nextCodeForType(t.type);
      usedCodes.add(reassigned);
      return { ...t, code: reassigned };
    }
    usedCodes.add(normCode);
    return { ...t, code: normCode };
  });

  const mergedTransactions = decollidedTransactions.sort((a: any, b: any) => {
    const timeA = parseSafeUtcTime(a.date) || parseSafeUtcTime(a.updatedAt);
    const timeB = parseSafeUtcTime(b.date) || parseSafeUtcTime(b.updatedAt);
    if (timeB !== timeA) return timeB - timeA;
    return parseSafeUtcTime(b.updatedAt) - parseSafeUtcTime(a.updatedAt);
  });

  // 4. Items + Auto-materialization + Exact Stock Calculation
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

  const mergedItems = Array.from(itemMap.values()).map((item: any) => {
    const stocks = computeWarehouseStocksForServer(item, mergedWarehouses, mergedTransactions);
    const totalStock = Object.values(stocks).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
    return {
      ...item,
      warehouseStocks: stocks,
      currentStock: Math.max(0, totalStock),
    };
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

  const mergedSupabaseConfig =
    incoming.supabaseConfig && incoming.supabaseConfig.url && incoming.supabaseConfig.key
      ? incoming.supabaseConfig
      : existing.supabaseConfig;

  return {
    version: Math.max(Number(existing.version) || 0, Number(incoming.version) || 0) + 1,
    lastUpdated: new Date().toISOString(),
    users: sanitizedUsers,
    warehouses: mergedWarehouses,
    transactions: mergedTransactions,
    items: mergedItems,
    deletedRegistry: registry,
    deletedUserIds,
    deletedTransactionIds,
    deletedItemIds,
    deletedWarehouseIds,
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
      memoryState = JSON.parse(raw);
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
      fs.writeFileSync(STATE_FILE, JSON.stringify(memoryState, null, 2), 'utf-8');
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

    // Immediately push authoritative server state upon connection
    if (memoryState) {
      res.write(`data: ${JSON.stringify({ type: 'SYNC_STATE', payload: memoryState })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);
    }

    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // GET authoritative state
  app.get('/api/sync', async (_req, res) => {
    try {
      if (!memoryState && fs.existsSync(STATE_FILE)) {
        memoryState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      }
    } catch {
      // keep memoryState
    }

    res.status(200).json({
      success: true,
      provider: memoryState?.supabaseConfig?.url ? 'supabase' : 'central-server',
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
            items: Array.isArray(body.payload?.items) ? body.payload.items : [],
            transactions: Array.isArray(body.payload?.transactions) ? body.payload.transactions : [],
            deletedRegistry: {},
            deletedUserIds: [],
            deletedTransactionIds: [],
            deletedItemIds: [],
            deletedWarehouseIds: [],
            supabaseConfig: memoryState?.supabaseConfig,
            source: 'admin-clean-reset',
          };
        } else {
          memoryState = mergeServerStateDeterministic(memoryState, body.payload);
        }

        try {
          const tmpFile = `${STATE_FILE}.tmp`;
          fs.writeFileSync(tmpFile, JSON.stringify(memoryState, null, 2), 'utf-8');
          fs.renameSync(tmpFile, STATE_FILE);
        } catch (writeErr) {
          console.warn('[server] Could not persist .sync-state.json:', writeErr);
        }

        // Mirror to external Supabase asynchronously if configured
        saveRemoteSupabaseIfConfigured(memoryState).catch(() => {});

        // Broadcast immediately to all other connected users/browsers!
        broadcastStateToClients(memoryState);

        res.status(200).json({
          success: true,
          provider: memoryState?.supabaseConfig?.url ? 'supabase' : 'central-server',
          savedToCloud: true,
          version: memoryState.version,
          lastUpdated: memoryState.lastUpdated,
          payload: memoryState,
        });
      })
      .catch(err => {
        console.error('[server] Error handling POST /api/sync:', err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: 'Lỗi xử lý đồng bộ trên máy chủ' });
        }
      });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Full-stack Inventory Sync Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
