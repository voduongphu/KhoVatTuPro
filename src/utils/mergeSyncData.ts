import { InventoryItem, Transaction, User, Warehouse } from '../types/inventory';
import { calculateItemWarehouseStocks } from './formatters';

export type DeletedRegistry = Record<string, string>;

const LEGACY_TOMBSTONE_ISO = '1970-01-01T00:00:01.000Z';

/**
 * Chuẩn hóa chuỗi thời gian về epoch ms UTC an toàn, tránh lệch múi giờ 7 tiếng (UTC+7)
 * đối với các bản ghi cũ bị cắt ngắn định dạng "YYYY-MM-DD HH:mm".
 */
export function parseSafeUtcTime(ts?: string | null): number {
  if (!ts) return 0;
  const trimmed = String(ts).trim();
  if (!trimmed) return 0;

  // Các chuỗi dạng "2026-10-23 07:01" hoặc "2026-10-23 07:01:44" trước đây sinh ra từ toISOString().replace('T', ' ')
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)) {
    const iso = trimmed.replace(' ', 'T') + (trimmed.length === 16 ? ':00.000Z' : 'Z');
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Sinh chuỗi ISO UTC đơn điệu tăng dần (Monotonic Timestamp), đảm bảo thao tác Sửa / Xóa / Import mới
 * luôn thắng phiên bản cũ hoặc tombstone cũ ngay cả khi đồng hồ giữa các máy trạm lệch nhau.
 */
export function nextMonotonicIso(...refs: (string | undefined | null)[]): string {
  let candidate = Date.now();
  for (const r of refs) {
    const ms = parseSafeUtcTime(r);
    if (ms >= candidate) {
      candidate = ms + 1;
    }
  }
  return new Date(candidate).toISOString();
}

export function makeTombstoneKey(
  prefix: 'ITEM' | 'TRX' | 'USER' | 'WH',
  rawId?: string | null
): string {
  if (!rawId) return '';
  const cleaned = String(rawId).trim();
  if (!cleaned) return '';
  return `${prefix}:${prefix === 'USER' ? cleaned.toLowerCase() : cleaned.toUpperCase()}`;
}

/**
 * Hợp nhất sổ cái xóa có gắn nhãn thời gian (Timestamped Tombstones)
 * và tương thích ngược với các mảng deleted*Ids cũ.
 */
export function buildMergedDeletedRegistry(
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

  // Tương thích ngược với các mảng ID xóa cũ không có timestamp:
  // Chỉ gán mốc 1970-01-01T00:00:01Z để chặn dữ liệu mẫu mặc định (updatedAt = 0),
  // KHÔNG BAO GIỜ chặn vật tư/phiếu thật được tạo mới hoặc import trong năm 2026+.
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

export interface SyncStateSnapshot {
  users: User[];
  warehouses: Warehouse[];
  transactions: Transaction[];
  items: InventoryItem[];
  deletedRegistry?: DeletedRegistry;
  deletedUserIds?: string[];
  deletedWarehouseIds?: string[];
  deletedTransactionIds?: string[];
  deletedItemIds?: string[];
}

export interface ReconciledSyncState {
  users: User[];
  warehouses: Warehouse[];
  transactions: Transaction[];
  items: InventoryItem[];
  deletedRegistry: DeletedRegistry;
  deletedUserIds: string[];
  deletedWarehouseIds: string[];
  deletedTransactionIds: string[];
  deletedItemIds: string[];
}

/**
 * Bộ hợp nhất trạng thái đa người dùng chuẩn xác (Deterministic CRDT-style State Reconciliation).
 * Đảm bảo mọi thao tác Thêm / Sửa / Xóa / Import Danh mục vật tư, Phiếu nhập, Phiếu xuất, Kho, Người dùng
 * từ nhiều tài khoản khác nhau đều hội tụ 100% không mất mát hay ghi đè lẫn nhau.
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
    }
  );

  // 1. HỢP NHẤT NGƯỜI DÙNG (USERS)
  const userMap = new Map<string, User>();
  const processUser = (u: User, isIncoming: boolean) => {
    if (!u || (!u.username && !u.id)) return;
    const unameKey = (u.username || u.id).trim().toLowerCase();
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

    const existing = userMap.get(unameKey);
    if (!existing) {
      userMap.set(unameKey, u);
    } else {
      const exTime =
        parseSafeUtcTime(existing.updatedAt) || parseSafeUtcTime(existing.lastActiveAt) || 0;
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

  // 3. HỢP NHẤT PHIẾU NHẬP / PHIẾU XUẤT (TRANSACTIONS) THEO ID + CHỐNG ĐỤNG ĐỘ MÃ PHIẾU ĐỒNG THỜI
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

  // Kiểm tra chống đụng độ số phiếu (VD: 2 thủ kho cùng lập phiếu tạo ra mã PN-2026-0004 với 2 ID khác nhau)
  const rawTrxAsc = Array.from(trxMap.values()).sort((a, b) => {
    const ta = parseSafeUtcTime(a.updatedAt) || parseSafeUtcTime(a.date);
    const tb = parseSafeUtcTime(b.updatedAt) || parseSafeUtcTime(b.date);
    return ta - tb;
  });

  const usedCodes = new Set<string>();
  const nextCodeForType = (type: Transaction['type']): string => {
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

  const decollidedTransactions = rawTrxAsc.map(t => {
    const normCode = (t.code || '').trim().toUpperCase();
    if (!normCode || usedCodes.has(normCode)) {
      const reassigned = nextCodeForType(t.type);
      usedCodes.add(reassigned);
      return { ...t, code: reassigned };
    }
    usedCodes.add(normCode);
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

      // Bảo toàn tồn đầu kỳ (openingWarehouseStocks / openingStock) từ phiên bản danh mục mới nhất có khai báo
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

  // Tự động khôi phục/khởi tạo mặt hàng nếu có trong Phiếu Nhập Kho hợp lệ nhưng chưa có trong danh mục
  // (Trừ trường hợp Admin chủ động xóa mặt hàng đó SAU thời điểm lập phiếu)
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

  // Tính toán lại chính xác tồn từng kho & tổng tồn hiện tại dựa trên tồn đầu kỳ + toàn bộ phiếu Nhập/Xuất
  const mergedItems = Array.from(itemMap.values()).map(item => {
    const stocks = calculateItemWarehouseStocks(item, mergedWarehouses, mergedTransactions);
    const totalStock = Object.values(stocks).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
    return {
      ...item,
      warehouseStocks: stocks,
      currentStock: Math.max(0, totalStock),
    };
  });

  // Trích xuất lại các mảng deleted*Ids tương thích ngược từ registry hiện hành
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
    users: mergedUsers,
    warehouses: mergedWarehouses,
    transactions: mergedTransactions,
    items: mergedItems,
    deletedRegistry: registry,
    deletedItemIds,
    deletedTransactionIds,
    deletedUserIds,
    deletedWarehouseIds,
  };
}

// Các hàm tiện ích giữ tương thích chữ ký cũ
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
