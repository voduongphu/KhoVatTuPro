import { InventoryItem, Transaction, User, Warehouse } from '../types/inventory';
import { calculateItemWarehouseStocks } from './formatters';

/**
 * Hợp nhất danh sách người dùng theo cơ chế thêm vào (Additive Merge).
 * Tôn trọng lệnh xóa từ Admin thông qua deletedIds, và ưu tiên phiên bản mới nhất khi Admin chỉnh sửa.
 */
export function mergeUsersAdditive(
  localUsers: User[],
  remoteUsers: User[],
  deletedIds: string[] = []
): User[] {
  const userMap = new Map<string, User>();
  const delSet = new Set(deletedIds.map(d => d.trim().toLowerCase()));

  const getKey = (u: User) => (u.username || u.id).trim().toLowerCase();

  // 1. Thêm toàn bộ người dùng local (bỏ qua những người dùng đã bị xóa)
  localUsers.forEach(u => {
    const key = getKey(u);
    if (!delSet.has(key) && !delSet.has((u.id || '').toLowerCase())) {
      userMap.set(key, u);
    }
  });

  // 2. Hợp nhất người dùng remote
  remoteUsers.forEach(remoteU => {
    const key = getKey(remoteU);
    if (delSet.has(key) || delSet.has((remoteU.id || '').toLowerCase())) {
      userMap.delete(key);
      return;
    }

    const existing = userMap.get(key);

    if (!existing) {
      // Người dùng mới được tạo từ thiết bị khác -> THÊM VÀO
      userMap.set(key, remoteU);
    } else {
      // Đã có trong danh sách -> So sánh thời gian cập nhật (Admin sửa thông tin có quyền ưu tiên)
      const remoteTime = remoteU.updatedAt
        ? new Date(remoteU.updatedAt).getTime()
        : remoteU.lastActiveAt
        ? new Date(remoteU.lastActiveAt).getTime()
        : 0;
      const localTime = existing.updatedAt
        ? new Date(existing.updatedAt).getTime()
        : existing.lastActiveAt
        ? new Date(existing.lastActiveAt).getTime()
        : 0;

      const useRemote = remoteTime >= localTime;
      const base = useRemote ? existing : remoteU;
      const overrides = useRemote ? remoteU : existing;

      userMap.set(key, {
        ...base,
        ...overrides,
        id: remoteU.id || existing.id,
      });
    }
  });

  return Array.from(userMap.values());
}

/**
 * Hợp nhất danh sách giao dịch (Phiếu nhập kho / xuất kho).
 * Tôn trọng lệnh xóa phiếu từ Admin (deletedIds) và đồng bộ nội dung chỉnh sửa từ Admin.
 */
export function mergeTransactionsAdditive(
  localTrx: Transaction[],
  remoteTrx: Transaction[],
  deletedIds: string[] = []
): Transaction[] {
  const trxMap = new Map<string, Transaction>();
  const delSet = new Set(deletedIds.map(d => d.trim().toUpperCase()));

  const getKey = (t: Transaction) => (t.id || t.code).trim().toUpperCase();

  // 1. Thêm tất cả phiếu local chưa bị xóa
  localTrx.forEach(t => {
    const key = getKey(t);
    const codeKey = (t.code || '').trim().toUpperCase();
    if (!delSet.has(key) && !delSet.has(codeKey)) {
      trxMap.set(key, t);
    }
  });

  // 2. Hợp nhất phiếu remote
  remoteTrx.forEach(remoteT => {
    const key = getKey(remoteT);
    const codeKey = (remoteT.code || '').trim().toUpperCase();
    if (delSet.has(key) || delSet.has(codeKey)) {
      trxMap.delete(key);
      return;
    }

    const existing = trxMap.get(key);

    if (!existing) {
      // Phiếu mới tạo từ thiết bị khác -> THÊM VÀO
      trxMap.set(key, remoteT);
    } else {
      // Đã tồn tại (Admin chỉnh sửa nội dung phiếu hoặc cập nhật trạng thái)
      const remoteTime = remoteT.updatedAt
        ? new Date(remoteT.updatedAt).getTime()
        : new Date(remoteT.date).getTime() || 0;
      const localTime = existing.updatedAt
        ? new Date(existing.updatedAt).getTime()
        : new Date(existing.date).getTime() || 0;

      const useRemote = remoteTime >= localTime;
      const base = useRemote ? existing : remoteT;
      const newer = useRemote ? remoteT : existing;

      trxMap.set(key, {
        ...base,
        ...newer,
        items: newer.items && newer.items.length > 0 ? newer.items : base.items,
        totalAmount: newer.totalAmount !== undefined ? newer.totalAmount : base.totalAmount,
      });
    }
  });

  // Sắp xếp theo ngày giảm dần (phiếu mới nhất lên đầu)
  return Array.from(trxMap.values()).sort((a, b) => {
    const timeA = new Date(a.date).getTime() || 0;
    const timeB = new Date(b.date).getTime() || 0;
    return timeB - timeA;
  });
}

/**
 * Hợp nhất danh mục kho lưu trữ.
 */
export function mergeWarehousesAdditive(
  localWh: Warehouse[],
  remoteWh: Warehouse[],
  deletedIds: string[] = []
): Warehouse[] {
  const whMap = new Map<string, Warehouse>();
  const delSet = new Set(deletedIds.map(d => d.trim().toUpperCase()));

  const getKey = (w: Warehouse) => (w.id || w.code).trim().toUpperCase();

  localWh.forEach(w => {
    const key = getKey(w);
    const codeKey = (w.code || '').trim().toUpperCase();
    if (!delSet.has(key) && !delSet.has(codeKey)) {
      whMap.set(key, w);
    }
  });

  remoteWh.forEach(remoteW => {
    const key = getKey(remoteW);
    const codeKey = (remoteW.code || '').trim().toUpperCase();
    if (delSet.has(key) || delSet.has(codeKey)) {
      whMap.delete(key);
      return;
    }

    const existing = whMap.get(key);
    if (!existing) {
      whMap.set(key, remoteW);
    } else {
      const remoteTime = remoteW.updatedAt ? new Date(remoteW.updatedAt).getTime() : 0;
      const localTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const useRemote = remoteTime >= localTime;
      whMap.set(key, {
        ...(useRemote ? existing : remoteW),
        ...(useRemote ? remoteW : existing),
      });
    }
  });

  return Array.from(whMap.values());
}

/**
 * Hợp nhất danh mục vật tư / thiết bị.
 * Tôn trọng lệnh xóa vật tư từ Admin và cập nhật phiên bản sửa đổi mới nhất.
 */
export function mergeItemsAdditive(
  localItems: InventoryItem[],
  remoteItems: InventoryItem[],
  warehouses: Warehouse[],
  mergedTransactions: Transaction[],
  deletedIds: string[] = []
): InventoryItem[] {
  const itemMap = new Map<string, InventoryItem>();
  const delSet = new Set(deletedIds.map(d => d.trim().toUpperCase()));

  const getItemKey = (item: InventoryItem) => {
    if (item.code && item.code.trim()) {
      return item.code.trim().toUpperCase();
    }
    return item.id.trim().toUpperCase();
  };

  // 1. Thêm tất cả mặt hàng local chưa bị xóa
  localItems.forEach(i => {
    const key = getItemKey(i);
    const idKey = (i.id || '').trim().toUpperCase();
    if (!delSet.has(key) && !delSet.has(idKey)) {
      itemMap.set(key, i);
    }
  });

  // 2. Hợp nhất mặt hàng remote
  remoteItems.forEach(remoteItem => {
    const key = getItemKey(remoteItem);
    const idKey = (remoteItem.id || '').trim().toUpperCase();
    if (delSet.has(key) || delSet.has(idKey)) {
      itemMap.delete(key);
      return;
    }

    const existing = itemMap.get(key);

    if (!existing) {
      // Mặt hàng mới khai báo từ thiết bị khác -> THÊM VÀO
      itemMap.set(key, remoteItem);
    } else {
      // Đã có -> Hợp nhất thông tin thuộc tính theo phiên bản mới nhất
      const remoteTime = remoteItem.updatedAt ? new Date(remoteItem.updatedAt).getTime() : 0;
      const localTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;

      const newer = remoteTime >= localTime ? remoteItem : existing;
      const older = remoteTime >= localTime ? existing : remoteItem;

      // Hợp nhất warehouseStocks
      const mergedWarehouseStocks = {
        ...(older.warehouseStocks || {}),
        ...(newer.warehouseStocks || {}),
      };

      itemMap.set(key, {
        ...older,
        ...newer,
        id: existing.id || remoteItem.id,
        code: (existing.code || remoteItem.code).trim().toUpperCase(),
        warehouseStocks:
          Object.keys(mergedWarehouseStocks).length > 0 ? mergedWarehouseStocks : undefined,
        currentStock: Math.max(newer.currentStock, older.currentStock),
      });
    }
  });

  const merged = Array.from(itemMap.values());

  // Tái tính toán tồn kho theo từng kho và tổng tồn kho dựa trên toàn bộ giao dịch đã hợp nhất
  return merged.map(item => {
    const stocks = calculateItemWarehouseStocks(item, warehouses, mergedTransactions);
    const totalStock = Object.values(stocks).reduce((a, b) => a + b, 0);
    return {
      ...item,
      warehouseStocks: stocks,
      currentStock: totalStock > 0 ? totalStock : item.currentStock,
    };
  });
}
