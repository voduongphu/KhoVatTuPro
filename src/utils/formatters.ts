import {
  EquipmentCondition,
  InventoryItem,
  IssueSubtype,
  ItemType,
  ReceiptSubtype,
  StockStatus,
  TransactionSubtype,
  TransactionType,
  UserRole,
  Warehouse,
  Transaction,
} from '../types/inventory';

// Cached module-level Intl formatters to avoid expensive constructor instantiation across 5,000+ rows
const CURRENCY_FORMATTER = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

const NUMBER_FORMATTER = new Intl.NumberFormat('vi-VN');

const DATE_FORMATTER = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const DATETIME_FORMATTER = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatCurrency = (amount: number): string => {
  return CURRENCY_FORMATTER.format(Number(amount) || 0);
};

export const formatNumber = (num: number): string => {
  return NUMBER_FORMATTER.format(Number(num) || 0);
};

export const formatDate = (dateString?: string): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return DATE_FORMATTER.format(date);
  } catch {
    return dateString;
  }
};

export const formatDateTime = (dateString?: string): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return DATETIME_FORMATTER.format(date);
  } catch {
    return dateString;
  }
};

export const getItemTypeLabel = (type: ItemType): string => {
  switch (type) {
    case 'VAT_TU':
      return 'Vật tư tiêu hao';
    case 'THIET_BI':
      return 'Thiết bị máy móc';
    case 'CONG_CU':
      return 'Công cụ dụng cụ';
    case 'PHU_TUNG':
      return 'Phụ tùng thay thế';
    default:
      return type;
  }
};

export const getStockStatus = (item: Pick<InventoryItem, 'currentStock' | 'minStock' | 'maxStock'>): StockStatus => {
  if (item.currentStock <= 0) return 'HET_HANG';
  if (item.currentStock < item.minStock) return 'CANH_BAO_THAP';
  if (item.maxStock > 0 && item.currentStock > item.maxStock) return 'VUOT_DINH_MUC';
  return 'BINH_THUONG';
};

export const getStockStatusLabel = (status: StockStatus): string => {
  switch (status) {
    case 'HET_HANG':
      return 'Hết hàng';
    case 'CANH_BAO_THAP':
      return 'Dưới định mức min';
    case 'VUOT_DINH_MUC':
      return 'Vượt định mức max';
    case 'BINH_THUONG':
      return 'Đủ tồn kho';
    default:
      return status;
  }
};

export const getConditionLabel = (condition?: EquipmentCondition): string => {
  switch (condition) {
    case 'SAN_SANG':
      return 'Sẵn sàng sử dụng';
    case 'DANG_MUON':
      return 'Đang cấp công trường / mượn';
    case 'BAO_DUONG':
      return 'Bảo dưỡng / Kiểm định';
    case 'HONG_CHO_SUA':
      return 'Hỏng hóc / Chờ sửa';
    default:
      return 'Bình thường';
  }
};

export const getTransactionTypeLabel = (type: TransactionType): string => {
  return type === 'NHAP_KHO' ? 'Nhập kho' : 'Xuất kho';
};

const SUBTYPE_LABELS: Record<ReceiptSubtype | IssueSubtype, string> = {
  NHAP_MUA_MOI: 'Nhập mua mới',
  NHAP_THU_HOI_DU_AN: 'Thu hồi từ dự án',
  NHAP_TRA_SAU_MUON: 'Hoàn trả sau mượn',
  NHAP_CHUYEN_KHO: 'Nhập điều chuyển kho',
  NHAP_DIEU_CHINH: 'Nhập cân đối kiểm kê',
  XUAT_THI_CONG: 'Xuất thi công công trình',
  XUAT_PHONG_BAN: 'Cấp phát phòng ban',
  XUAT_CHO_MUON: 'Xuất mượn thi công',
  XUAT_BAO_DUONG: 'Xuất gửi bảo dưỡng/sửa chữa',
  XUAT_CHUYEN_KHO: 'Xuất điều chuyển kho',
  XUAT_THANH_LY: 'Xuất thanh lý / hủy',
};

export const getSubtypeLabel = (subtype: TransactionSubtype): string => {
  return SUBTYPE_LABELS[subtype as keyof typeof SUBTYPE_LABELS] || subtype;
};

export const getUserRoleLabel = (role: UserRole): string => {
  switch (role) {
    case 'ADMIN':
      return 'Quản trị viên (Toàn quyền)';
    case 'THU_KHO':
      return 'Thủ kho (Nhập / Xuất)';
    case 'NHAN_VIEN':
      return 'Nhân viên kỹ thuật (Chỉ xem)';
    default:
      return role;
  }
};

// Export to CSV with UTF-8 BOM for Excel
export const exportToCSV = (filename: string, headers: string[], rows: (string | number)[][]) => {
  const processCell = (cell: string | number) => {
    let str = cell === null || cell === undefined ? '' : String(cell);
    str = str.replace(/"/g, '""');
    if (str.search(/("|,|\n)/g) >= 0) {
      str = `"${str}"`;
    }
    return str;
  };

  const csvContent =
    '\uFEFF' + // UTF-8 BOM
    [headers.map(processCell).join(','), ...rows.map(row => row.map(processCell).join(','))].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

interface ItemMovementAccum {
  whNet: Record<string, number>;
  unassignedNet: number;
  totalNet: number;
  wasAutoCreatedByReceipt: boolean;
}

/**
 * Tính toán hàng loạt phân bổ tồn kho cho TOÀN BỘ danh sách vật tư chỉ trong 1 lượt duyệt O(N + T_lines).
 * Xử lý mượt mà 5.000 - 50.000+ vật tư & phiếu nhập/xuất trong vài mili-giây thay vì O(N * T).
 */
export const calculateAllItemsWarehouseStocks = (
  items: InventoryItem[],
  warehouses: Warehouse[],
  transactions: Transaction[]
): Record<string, number>[] => {
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

  const accums: ItemMovementAccum[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const item = items[i];
    accums[i] = {
      whNet: {},
      unassignedNet: 0,
      totalNet: 0,
      wasAutoCreatedByReceipt: false,
    };
    if (item.id) {
      addIndex(idToIndices, item.id, i);
    }
    const normCode = (item.code || '').trim().toUpperCase();
    if (normCode) {
      addIndex(codeToIndices, normCode, i);
    }
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

      const mById = line.itemId ? idToIndices.get(line.itemId) : undefined;
      const normLineCode = line.itemCode ? line.itemCode.trim().toUpperCase() : '';
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
      const keys = Object.keys(item.openingWarehouseStocks);
      for (let k = 0; k < keys.length; k++) allWhIds.add(keys[k]);
    }
    if (item.warehouseStocks) {
      const keys = Object.keys(item.warehouseStocks);
      for (let k = 0; k < keys.length; k++) allWhIds.add(keys[k]);
    }
    const movKeys = Object.keys(acc.whNet);
    for (let k = 0; k < movKeys.length; k++) allWhIds.add(movKeys[k]);

    const result: Record<string, number> = {};
    const hasExplicitOpeningMap =
      item.openingWarehouseStocks && Object.keys(item.openingWarehouseStocks).length > 0;

    if (hasExplicitOpeningMap) {
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
};

/**
 * Tính toán phân bổ số lượng tồn kho của một mặt hàng đơn lẻ theo từng kho lưu trữ cụ thể.
 */
export const calculateItemWarehouseStocks = (
  item: InventoryItem,
  warehouses: Warehouse[],
  transactions: Transaction[]
): Record<string, number> => {
  return calculateAllItemsWarehouseStocks([item], warehouses, transactions)[0] || {};
};

/**
 * Truy xuất nhanh phân bổ tồn kho đã được tính sẵn trên `item.warehouseStocks` trong O(W) cho giao diện bảng/biểu đồ,
 * tránh tính lại trên hàng nghìn phiếu nhập xuất mỗi lần render.
 */
export const getFastItemWarehouseStocks = (
  item: InventoryItem,
  warehouses: Warehouse[]
): Record<string, number> => {
  if (item.warehouseStocks && Object.keys(item.warehouseStocks).length > 0) {
    return item.warehouseStocks;
  }
  const primaryWhId = item.warehouseId || warehouses[0]?.id || 'WH-01';
  const fallback: Record<string, number> = {};
  for (let i = 0; i < warehouses.length; i++) {
    const whId = warehouses[i].id;
    fallback[whId] = whId === primaryWhId ? Math.max(0, Number(item.currentStock) || 0) : 0;
  }
  if (fallback[primaryWhId] === undefined) {
    fallback[primaryWhId] = Math.max(0, Number(item.currentStock) || 0);
  }
  return fallback;
};

export const getItemStockInWarehouse = (
  item: InventoryItem,
  warehouseId: string,
  warehouses: Warehouse[],
  transactions?: Transaction[]
): number => {
  if (item.warehouseStocks && item.warehouseStocks[warehouseId] !== undefined) {
    return Number(item.warehouseStocks[warehouseId]) || 0;
  }
  if (transactions) {
    const stocks = calculateItemWarehouseStocks(item, warehouses, transactions);
    return stocks[warehouseId] || 0;
  }
  const fastStocks = getFastItemWarehouseStocks(item, warehouses);
  return fastStocks[warehouseId] || 0;
};
