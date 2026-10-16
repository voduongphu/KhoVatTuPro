import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  INITIAL_ITEMS,
  INITIAL_TRANSACTIONS,
  INITIAL_USERS,
  INITIAL_WAREHOUSES,
} from '../data/mockData';
import {
  InventoryItem,
  MultiFilterCriteria,
  StockLedgerEntry,
  StockStatus,
  Transaction,
  User,
  Warehouse,
} from '../types/inventory';
import { getStockStatus } from '../utils/formatters';

interface InventoryContextType {
  warehouses: Warehouse[];
  items: InventoryItem[];
  transactions: Transaction[];
  categories: string[];
  suppliers: string[];

  // Auth & User Management
  users: User[];
  currentUser: User | null;
  login: (username: string, password: string) => { success: boolean; error?: string };
  logout: () => void;
  addUser: (userData: Omit<User, 'id' | 'createdAt'>) => { success: boolean; error?: string };
  updateUser: (id: string, updates: Partial<User>) => { success: boolean; error?: string };
  deleteUser: (id: string) => { success: boolean; error?: string };

  // Warehouse Management
  addWarehouse: (data: Omit<Warehouse, 'id'>) => {
    success: boolean;
    error?: string;
    warehouse?: Warehouse;
  };
  updateWarehouse: (
    id: string,
    updates: Partial<Warehouse>
  ) => { success: boolean; error?: string };
  deleteWarehouse: (id: string) => { success: boolean; error?: string };

  // Filter state
  filterCriteria: MultiFilterCriteria;
  setFilterCriteria: React.Dispatch<React.SetStateAction<MultiFilterCriteria>>;
  updateFilter: <K extends keyof MultiFilterCriteria>(key: K, value: MultiFilterCriteria[K]) => void;
  resetFilterCriteria: () => void;
  applyPresetFilter: (presetName: string) => void;
  activeFilterCount: number;

  // Filtered results
  filteredItems: InventoryItem[];
  filteredTransactions: Transaction[];

  // CRUD Items
  addItem: (item: Omit<InventoryItem, 'id' | 'updatedAt'>) => void;
  updateItem: (id: string, updates: Partial<InventoryItem>) => void;
  deleteItem: (id: string) => void;
  deleteItemsBatch: (ids: string[]) => { success: boolean; count: number };
  importItemsBatch: (
    itemsList: Omit<InventoryItem, 'id' | 'updatedAt'>[],
    updateExisting?: boolean
  ) => { success: boolean; addedCount: number; updatedCount: number; errors: string[] };

  // CRUD Transactions
  createTransaction: (data: Omit<Transaction, 'id' | 'code'>) => {
    success: boolean;
    error?: string;
    transaction?: Transaction;
  };
  updateTransaction: (
    id: string,
    updates: Partial<Omit<Transaction, 'id' | 'code' | 'type'>>
  ) => { success: boolean; error?: string };
  deleteTransaction: (id: string) => { success: boolean; error?: string };
  importTransactionsBatch: (
    importedList: Omit<Transaction, 'id' | 'code'>[]
  ) => { success: boolean; importedCount: number; errors: string[] };

  getItemLedger: (itemId: string) => StockLedgerEntry[];
  resetToDefaultData: () => void;
}

const defaultCriteria: MultiFilterCriteria = {
  searchQuery: '',
  warehouses: [],
  itemTypes: [],
  categories: [],
  stockStatuses: [],
  equipmentConditions: [],
  minStockQty: undefined,
  maxStockQty: undefined,
  minValue: undefined,
  maxValue: undefined,
  supplier: '',
  needsInspection: false,
  dateRangePreset: 'ALL',
};

const STORAGE_KEYS = {
  ITEMS: 'nxt_inventory_items_v1',
  TRANSACTIONS: 'nxt_inventory_transactions_v1',
  WAREHOUSES: 'nxt_inventory_warehouses_v1',
  USERS: 'nxt_inventory_users_v1',
  AUTH: 'nxt_inventory_current_user_v1',
};

const InventoryContext = createContext<InventoryContextType | null>(null);

export const InventoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [warehouses, setWarehouses] = useState<Warehouse[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.WAREHOUSES);
      return stored ? JSON.parse(stored) : INITIAL_WAREHOUSES;
    } catch {
      return INITIAL_WAREHOUSES;
    }
  });

  const [items, setItems] = useState<InventoryItem[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.ITEMS);
      return stored ? JSON.parse(stored) : INITIAL_ITEMS;
    } catch {
      return INITIAL_ITEMS;
    }
  });

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
      return stored ? JSON.parse(stored) : INITIAL_TRANSACTIONS;
    } catch {
      return INITIAL_TRANSACTIONS;
    }
  });

  const [users, setUsers] = useState<User[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.USERS);
      return stored ? JSON.parse(stored) : INITIAL_USERS;
    } catch {
      return INITIAL_USERS;
    }
  });

  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    // Luôn đưa về màn hình đăng nhập khi mở lại hoặc tải lại ứng dụng
    try {
      localStorage.removeItem(STORAGE_KEYS.AUTH);
    } catch {
      // ignore
    }
    return null;
  });

  const [filterCriteria, setFilterCriteria] = useState<MultiFilterCriteria>(defaultCriteria);

  // Sync to local storage (Chỉ lưu danh mục vật tư, giao dịch và tài khoản người dùng)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(items));
    } catch {
      // ignore
    }
  }, [items]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
    } catch {
      // ignore
    }
  }, [transactions]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
    } catch {
      // ignore
    }
  }, [users]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.WAREHOUSES, JSON.stringify(warehouses));
    } catch {
      // ignore
    }
  }, [warehouses]);

  // Auth Operations
  const login = (username: string, password: string): { success: boolean; error?: string } => {
    const trimmedUsername = username.trim().toLowerCase();
    const user = users.find(u => u.username.toLowerCase() === trimmedUsername);

    if (!user) {
      return { success: false, error: 'Tên đăng nhập không tồn tại trong hệ thống.' };
    }

    if (user.status === 'LOCKED') {
      return { success: false, error: 'Tài khoản này đang bị khóa. Vui lòng liên hệ Quản trị viên.' };
    }

    if (user.password !== password) {
      return { success: false, error: 'Mật khẩu không chính xác. Vui lòng thử lại.' };
    }

    const updatedUser = {
      ...user,
      lastLogin: new Date().toISOString().replace('T', ' ').substring(0, 16),
    };

    setUsers(prev => prev.map(u => (u.id === user.id ? updatedUser : u)));
    setCurrentUser(updatedUser);
    return { success: true };
  };

  const logout = () => {
    setCurrentUser(null);
  };

  // User Management
  const addUser = (userData: Omit<User, 'id' | 'createdAt'>): { success: boolean; error?: string } => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền thêm người sử dụng.' };
    }

    const trimmedUsername = userData.username.trim().toLowerCase();
    if (users.some(u => u.username.toLowerCase() === trimmedUsername)) {
      return { success: false, error: `Tên đăng nhập "${userData.username}" đã tồn tại.` };
    }

    const newUser: User = {
      ...userData,
      id: `USR-${Date.now()}`,
      username: trimmedUsername,
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
    };

    setUsers(prev => [...prev, newUser]);
    return { success: true };
  };

  const updateUser = (id: string, updates: Partial<User>): { success: boolean; error?: string } => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền chỉnh sửa người dùng.' };
    }

    if (updates.username) {
      const trimmed = updates.username.trim().toLowerCase();
      if (users.some(u => u.id !== id && u.username.toLowerCase() === trimmed)) {
        return { success: false, error: `Tên đăng nhập "${updates.username}" đã bị trùng lặp.` };
      }
    }

    setUsers(prev =>
      prev.map(u => {
        if (u.id === id) {
          const updated = { ...u, ...updates };
          // If updating self, sync currentUser
          if (currentUser.id === id) {
            setCurrentUser(updated);
          }
          return updated;
        }
        return u;
      })
    );

    return { success: true };
  };

  const deleteUser = (id: string): { success: boolean; error?: string } => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền xóa người dùng.' };
    }

    if (currentUser.id === id) {
      return { success: false, error: 'Không thể xóa chính tài khoản bạn đang đăng nhập!' };
    }

    setUsers(prev => prev.filter(u => u.id !== id));
    return { success: true };
  };

  // Warehouse Management (Admin permissions)
  const addWarehouse = (data: Omit<Warehouse, 'id'>): { success: boolean; error?: string; warehouse?: Warehouse } => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền thêm kho hàng mới.' };
    }

    const trimmedCode = data.code.trim().toUpperCase();
    const trimmedName = data.name.trim();

    if (!trimmedCode) {
      return { success: false, error: 'Vui lòng nhập mã ký hiệu kho.' };
    }
    if (!trimmedName) {
      return { success: false, error: 'Vui lòng nhập tên kho lưu trữ.' };
    }

    if (warehouses.some(w => w.code.toUpperCase() === trimmedCode)) {
      return { success: false, error: `Mã kho "${trimmedCode}" đã tồn tại trong hệ thống.` };
    }

    const newWarehouse: Warehouse = {
      ...data,
      id: `WH-${Date.now()}`,
      code: trimmedCode,
      name: trimmedName,
      status: data.status || 'ACTIVE',
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
    };

    setWarehouses(prev => [...prev, newWarehouse]);
    return { success: true, warehouse: newWarehouse };
  };

  const updateWarehouse = (id: string, updates: Partial<Warehouse>): { success: boolean; error?: string } => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền chỉnh sửa thông tin kho.' };
    }

    if (updates.code) {
      const trimmedCode = updates.code.trim().toUpperCase();
      if (warehouses.some(w => w.id !== id && w.code.toUpperCase() === trimmedCode)) {
        return { success: false, error: `Mã kho "${trimmedCode}" đã bị trùng lặp.` };
      }
    }

    setWarehouses(prev =>
      prev.map(w => (w.id === id ? { ...w, ...updates } : w))
    );

    return { success: true };
  };

  const deleteWarehouse = (id: string): { success: boolean; error?: string } => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền xóa kho hàng.' };
    }

    if (warehouses.length <= 1) {
      return { success: false, error: 'Hệ thống cần duy trì ít nhất 1 kho hàng hoạt động.' };
    }

    const itemsCount = items.filter(i => i.warehouseId === id).length;
    if (itemsCount > 0) {
      return {
        success: false,
        error: `Không thể xóa kho này vì đang có ${itemsCount} mặt hàng tồn kho lưu trữ tại đây. Vui lòng điều chuyển các mặt hàng sang kho khác trước khi xóa.`,
      };
    }

    const trxCount = transactions.filter(t => t.warehouseId === id).length;
    if (trxCount > 0) {
      return {
        success: false,
        error: `Không thể xóa kho này vì có ${trxCount} chứng từ nhập/xuất kho đã lưu vết lịch sử tại kho này.`,
      };
    }

    setWarehouses(prev => prev.filter(w => w.id !== id));
    return { success: true };
  };

  // Derived lists
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => set.add(i.category));
    return Array.from(set).sort();
  }, [items]);

  const suppliers = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => {
      if (i.supplierDefault) set.add(i.supplierDefault);
    });
    transactions.forEach(t => {
      if (t.type === 'NHAP_KHO' && t.partnerName) set.add(t.partnerName);
    });
    return Array.from(set).sort();
  }, [items, transactions]);

  // Filter Updater
  const updateFilter = <K extends keyof MultiFilterCriteria>(key: K, value: MultiFilterCriteria[K]) => {
    setFilterCriteria(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const resetFilterCriteria = () => {
    setFilterCriteria(defaultCriteria);
  };

  // Presets
  const applyPresetFilter = (presetName: string) => {
    switch (presetName) {
      case 'LOW_STOCK':
        setFilterCriteria({
          ...defaultCriteria,
          stockStatuses: ['CANH_BAO_THAP', 'HET_HANG'],
        });
        break;
      case 'EQUIPMENT_ACTIVE':
        setFilterCriteria({
          ...defaultCriteria,
          itemTypes: ['THIET_BI', 'CONG_CU'],
          equipmentConditions: ['DANG_MUON'],
        });
        break;
      case 'NEED_MAINTENANCE':
        setFilterCriteria({
          ...defaultCriteria,
          itemTypes: ['THIET_BI'],
          needsInspection: true,
        });
        break;
      case 'HIGH_VALUE':
        setFilterCriteria({
          ...defaultCriteria,
          minValue: 20000000,
        });
        break;
      default:
        resetFilterCriteria();
    }
  };

  // Compute active filters count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterCriteria.searchQuery.trim()) count++;
    if (filterCriteria.warehouses.length > 0) count++;
    if (filterCriteria.itemTypes.length > 0) count++;
    if (filterCriteria.categories.length > 0) count++;
    if (filterCriteria.stockStatuses.length > 0) count++;
    if (filterCriteria.equipmentConditions.length > 0) count++;
    if (filterCriteria.minStockQty !== undefined) count++;
    if (filterCriteria.maxStockQty !== undefined) count++;
    if (filterCriteria.minValue !== undefined) count++;
    if (filterCriteria.maxValue !== undefined) count++;
    if (filterCriteria.supplier) count++;
    if (filterCriteria.needsInspection) count++;
    if (filterCriteria.dateRangePreset && filterCriteria.dateRangePreset !== 'ALL') count++;
    return count;
  }, [filterCriteria]);

  // Filtered Items logic
  const filteredItems = useMemo(() => {
    const today = new Date();
    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(today.getDate() + 30);

    return items.filter(item => {
      // 1. Text Search (SKU, name, serial, spec)
      if (filterCriteria.searchQuery.trim()) {
        const q = filterCriteria.searchQuery.toLowerCase().trim();
        const matchCode = item.code.toLowerCase().includes(q);
        const matchName = item.name.toLowerCase().includes(q);
        const matchSerial = (item.serialOrLot || '').toLowerCase().includes(q);
        const matchSpec = (item.spec || '').toLowerCase().includes(q);
        const matchSupplier = (item.supplierDefault || '').toLowerCase().includes(q);
        if (!matchCode && !matchName && !matchSerial && !matchSpec && !matchSupplier) {
          return false;
        }
      }

      // 2. Warehouses
      if (filterCriteria.warehouses.length > 0 && !filterCriteria.warehouses.includes(item.warehouseId)) {
        return false;
      }

      // 3. Item Types
      if (filterCriteria.itemTypes.length > 0 && !filterCriteria.itemTypes.includes(item.type)) {
        return false;
      }

      // 4. Categories
      if (filterCriteria.categories.length > 0 && !filterCriteria.categories.includes(item.category)) {
        return false;
      }

      // 5. Stock Status
      if (filterCriteria.stockStatuses.length > 0) {
        const status: StockStatus = getStockStatus(item);
        if (!filterCriteria.stockStatuses.includes(status)) {
          return false;
        }
      }

      // 6. Equipment Condition
      if (filterCriteria.equipmentConditions.length > 0) {
        if (!item.condition || !filterCriteria.equipmentConditions.includes(item.condition)) {
          return false;
        }
      }

      // 7. Stock Qty Range
      if (filterCriteria.minStockQty !== undefined && item.currentStock < filterCriteria.minStockQty) {
        return false;
      }
      if (filterCriteria.maxStockQty !== undefined && item.currentStock > filterCriteria.maxStockQty) {
        return false;
      }

      // 8. Total Value Range
      const totalVal = item.currentStock * item.unitPrice;
      if (filterCriteria.minValue !== undefined && totalVal < filterCriteria.minValue) {
        return false;
      }
      if (filterCriteria.maxValue !== undefined && totalVal > filterCriteria.maxValue) {
        return false;
      }

      // 9. Supplier
      if (filterCriteria.supplier && item.supplierDefault !== filterCriteria.supplier) {
        return false;
      }

      // 10. Inspection / Maintenance Due Check
      if (filterCriteria.needsInspection) {
        if (!item.inspectionDueDate) return false;
        const due = new Date(item.inspectionDueDate);
        if (due > thirtyDaysLater) return false;
      }

      return true;
    });
  }, [items, filterCriteria]);

  // Filtered Transactions logic
  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      // Search
      if (filterCriteria.searchQuery.trim()) {
        const q = filterCriteria.searchQuery.toLowerCase().trim();
        const matchCode = t.code.toLowerCase().includes(q);
        const matchPartner = t.partnerName.toLowerCase().includes(q);
        const matchProject = t.departmentOrProject.toLowerCase().includes(q);
        const matchNotes = t.notes.toLowerCase().includes(q);
        const matchItems = t.items.some(
          i => i.itemCode.toLowerCase().includes(q) || i.itemName.toLowerCase().includes(q)
        );
        if (!matchCode && !matchPartner && !matchProject && !matchNotes && !matchItems) {
          return false;
        }
      }

      // Warehouse
      if (filterCriteria.warehouses.length > 0 && !filterCriteria.warehouses.includes(t.warehouseId)) {
        return false;
      }

      // Supplier / Partner
      if (filterCriteria.supplier && t.partnerName !== filterCriteria.supplier) {
        return false;
      }

      // Date Range Preset
      if (filterCriteria.dateRangePreset && filterCriteria.dateRangePreset !== 'ALL') {
        const tDate = new Date(t.date);
        const now = new Date();
        if (filterCriteria.dateRangePreset === 'TODAY') {
          if (tDate.toDateString() !== now.toDateString()) return false;
        } else if (filterCriteria.dateRangePreset === 'LAST_7_DAYS') {
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(now.getDate() - 7);
          if (tDate < sevenDaysAgo) return false;
        } else if (filterCriteria.dateRangePreset === 'THIS_MONTH') {
          if (tDate.getMonth() !== now.getMonth() || tDate.getFullYear() !== now.getFullYear()) {
            return false;
          }
        }
      }

      return true;
    });
  }, [transactions, filterCriteria]);

  // CRUD Items
  const addItem = (itemData: Omit<InventoryItem, 'id' | 'updatedAt'>) => {
    const newItem: InventoryItem = {
      ...itemData,
      id: `ITEM-${Date.now()}`,
      updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
    };
    setItems(prev => [newItem, ...prev]);
  };

  const updateItem = (id: string, updates: Partial<InventoryItem>) => {
    setItems(prev =>
      prev.map(item =>
        item.id === id
          ? {
              ...item,
              ...updates,
              updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
            }
          : item
      )
    );
  };

  const deleteItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const deleteItemsBatch = (ids: string[]) => {
    const idSet = new Set(ids);
    setItems(prev => prev.filter(i => !idSet.has(i.id)));
    return { success: true, count: ids.length };
  };

  // Create Transaction (NHAP / XUAT)
  const createTransaction = (data: Omit<Transaction, 'id' | 'code'>) => {
    if (data.type === 'XUAT_KHO') {
      for (const line of data.items) {
        const currentItem = items.find(i => i.id === line.itemId);
        if (!currentItem) {
          return { success: false, error: `Không tìm thấy vật tư mã "${line.itemCode}".` };
        }
        if (currentItem.currentStock < line.quantity) {
          return {
            success: false,
            error: `Số lượng xuất của "${currentItem.name}" (${line.quantity} ${currentItem.unit}) vượt quá số lượng tồn kho khả dụng (${currentItem.currentStock} ${currentItem.unit})!`,
          };
        }
      }
    }

    const prefix = data.type === 'NHAP_KHO' ? 'PN' : 'PX';
    const year = new Date().getFullYear();
    const count = transactions.filter(t => t.type === data.type).length + 1;
    const code = `${prefix}-${year}-${String(1000 + count).padStart(4, '0')}`;

    const newTransaction: Transaction = {
      ...data,
      id: `TRX-${Date.now()}`,
      code,
    };

    setItems(prev => {
      const updated = [...prev];
      for (const line of data.items) {
        // Find existing item by id or SKU code (case-insensitive)
        let idx = updated.findIndex(
          i =>
            (line.itemId && i.id === line.itemId) ||
            (line.itemCode && i.code.trim().toLowerCase() === line.itemCode.trim().toLowerCase())
        );

        if (idx !== -1) {
          const item = updated[idx];
          const qtyDelta = data.type === 'NHAP_KHO' ? line.quantity : -line.quantity;
          const newStock = Math.max(0, item.currentStock + qtyDelta);

          let condition = item.condition;
          if (item.type === 'THIET_BI' || item.type === 'CONG_CU') {
            if (data.type === 'XUAT_KHO' && data.subtype === 'XUAT_CHO_MUON') {
              condition = 'DANG_MUON';
            } else if (data.type === 'NHAP_KHO' && data.subtype === 'NHAP_TRA_SAU_MUON') {
              condition = 'SAN_SANG';
            }
          }

          const unitPrice =
            data.type === 'NHAP_KHO' && line.unitPrice > 0 ? line.unitPrice : item.unitPrice;

          updated[idx] = {
            ...item,
            currentStock: newStock,
            unitPrice,
            condition,
            supplierDefault:
              item.supplierDefault || (data.type === 'NHAP_KHO' && data.partnerName ? data.partnerName : item.supplierDefault),
            updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
          };
          line.itemId = item.id;
        } else if (data.type === 'NHAP_KHO') {
          // Tự động thêm vật tư mới vào danh mục vật tư khi lập phiếu nhập kho
          const newItemId = `ITEM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          line.itemId = newItemId;
          const cleanCode = (line.itemCode || `VT-${Date.now().toString().slice(-4)}`).trim().toUpperCase();
          const newItem: InventoryItem = {
            id: newItemId,
            code: cleanCode,
            name: (line.itemName || 'Vật tư nhập mới').trim(),
            type: line.type || 'VAT_TU',
            category: (line.category || 'Vật tư nhập mới').trim(),
            unit: (line.unit || 'Cái').trim(),
            warehouseId: data.warehouseId,
            location: (line.location || 'Khu vực tiếp nhận').trim(),
            minStock: line.minStock !== undefined && line.minStock >= 0 ? line.minStock : 5,
            maxStock: line.maxStock !== undefined && line.maxStock > 0 ? line.maxStock : 200,
            currentStock: Math.max(0, line.quantity),
            unitPrice: Math.max(0, line.unitPrice || 0),
            serialOrLot: (line.serialNumber || '').trim(),
            condition: line.condition || 'SAN_SANG',
            supplierDefault: data.partnerName.trim(),
            spec: (line.spec || '').trim(),
            updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
          };
          updated.unshift(newItem);
        }
      }
      return updated;
    });

    setTransactions(prev => [newTransaction, ...prev]);
    return { success: true, transaction: newTransaction };
  };

  // Update Transaction
  const updateTransaction = (
    id: string,
    updates: Partial<Omit<Transaction, 'id' | 'code' | 'type'>>
  ): { success: boolean; error?: string } => {
    if (!currentUser || (currentUser.role !== 'ADMIN' && currentUser.role !== 'THU_KHO')) {
      return { success: false, error: 'Bạn không có quyền chỉnh sửa phiếu này.' };
    }

    const existing = transactions.find(t => t.id === id);
    if (!existing) {
      return { success: false, error: 'Không tìm thấy phiếu giao dịch.' };
    }

    setTransactions(prev =>
      prev.map(t => (t.id === id ? { ...t, ...updates } : t))
    );

    return { success: true };
  };

  // Delete Transaction (Admin only, reverses stock impact!)
  const deleteTransaction = (id: string): { success: boolean; error?: string } => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return {
        success: false,
        error: 'Chỉ Quản trị viên (Admin) mới có quyền xóa phiếu nhập/xuất kho.',
      };
    }

    const targetTrx = transactions.find(t => t.id === id);
    if (!targetTrx) {
      return { success: false, error: 'Phiếu không tồn tại hoặc đã bị xóa.' };
    }

    // Revert inventory balances:
    // If deleted transaction was NHAP_KHO: we must deduct the quantities that were added!
    // If deleted transaction was XUAT_KHO: we must add back the quantities that were issued!
    setItems(prev => {
      const updated = [...prev];
      for (const line of targetTrx.items) {
        const idx = updated.findIndex(i => i.id === line.itemId);
        if (idx !== -1) {
          const item = updated[idx];
          const qtyDelta = targetTrx.type === 'NHAP_KHO' ? -line.quantity : line.quantity;
          const newStock = Math.max(0, item.currentStock + qtyDelta);

          updated[idx] = {
            ...item,
            currentStock: newStock,
            updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
          };
        }
      }
      return updated;
    });

    setTransactions(prev => prev.filter(t => t.id !== id));
    return { success: true };
  };

  // Batch Import Transactions
  const importTransactionsBatch = (
    importedList: Omit<Transaction, 'id' | 'code'>[]
  ): { success: boolean; importedCount: number; errors: string[] } => {
    const errors: string[] = [];
    let importedCount = 0;

    for (let i = 0; i < importedList.length; i++) {
      const item = importedList[i];
      const res = createTransaction(item);
      if (res.success) {
        importedCount++;
      } else {
        errors.push(`Dòng ${i + 1} (${item.partnerName}): ${res.error}`);
      }
    }

    return {
      success: importedCount > 0,
      importedCount,
      errors,
    };
  };

  // Batch Import Items / Materials Catalog
  const importItemsBatch = (
    itemsList: Omit<InventoryItem, 'id' | 'updatedAt'>[],
    updateExisting: boolean = true
  ): { success: boolean; addedCount: number; updatedCount: number; errors: string[] } => {
    let addedCount = 0;
    let updatedCount = 0;
    const errors: string[] = [];

    setItems(prev => {
      const updated = [...prev];
      const now = new Date().toISOString().replace('T', ' ').substring(0, 16);

      for (let i = 0; i < itemsList.length; i++) {
        const row = itemsList[i];
        if (!row.code || !row.name) {
          errors.push(`Dòng ${i + 1}: Thiếu mã SKU hoặc tên vật tư.`);
          continue;
        }

        const cleanCode = row.code.trim().toUpperCase();
        const existingIdx = updated.findIndex(
          it => it.code.trim().toUpperCase() === cleanCode
        );

        if (existingIdx !== -1) {
          if (updateExisting) {
            updated[existingIdx] = {
              ...updated[existingIdx],
              ...row,
              code: cleanCode,
              updatedAt: now,
            };
            updatedCount++;
          }
        } else {
          const newItem: InventoryItem = {
            ...row,
            code: cleanCode,
            id: `ITEM-${Date.now()}-${i}`,
            updatedAt: now,
          };
          updated.unshift(newItem);
          addedCount++;
        }
      }

      return updated;
    });

    return {
      success: addedCount > 0 || updatedCount > 0,
      addedCount,
      updatedCount,
      errors,
    };
  };

  // Generate Chronological Stock Ledger for an Item
  const getItemLedger = (itemId: string): StockLedgerEntry[] => {
    const sorted = [...transactions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    let runningBalance = 0;
    const entries: StockLedgerEntry[] = [];

    for (const trx of sorted) {
      const line = trx.items.find(i => i.itemId === itemId);
      if (line) {
        const inQty = trx.type === 'NHAP_KHO' ? line.quantity : 0;
        const outQty = trx.type === 'XUAT_KHO' ? line.quantity : 0;
        runningBalance = runningBalance + inQty - outQty;

        entries.push({
          transactionId: trx.id,
          transactionCode: trx.code,
          date: trx.date,
          type: trx.type,
          subtype: trx.subtype,
          partner: trx.partnerName,
          departmentOrProject: trx.departmentOrProject,
          inQty,
          outQty,
          unitPrice: line.unitPrice,
          balanceQty: runningBalance,
          notes: line.note || trx.notes,
        });
      }
    }

    return entries.reverse();
  };

  const resetToDefaultData = () => {
    setWarehouses(INITIAL_WAREHOUSES);
    setItems(INITIAL_ITEMS);
    setTransactions(INITIAL_TRANSACTIONS);
    setUsers(INITIAL_USERS);
    localStorage.removeItem(STORAGE_KEYS.WAREHOUSES);
    localStorage.removeItem(STORAGE_KEYS.ITEMS);
    localStorage.removeItem(STORAGE_KEYS.TRANSACTIONS);
    localStorage.removeItem(STORAGE_KEYS.USERS);
  };

  return (
    <InventoryContext.Provider
      value={{
        warehouses,
        items,
        transactions,
        categories,
        suppliers,
        users,
        currentUser,
        login,
        logout,
        addUser,
        updateUser,
        deleteUser,
        addWarehouse,
        updateWarehouse,
        deleteWarehouse,
        filterCriteria,
        setFilterCriteria,
        updateFilter,
        resetFilterCriteria,
        applyPresetFilter,
        activeFilterCount,
        filteredItems,
        filteredTransactions,
        addItem,
        updateItem,
        deleteItem,
        deleteItemsBatch,
        importItemsBatch,
        createTransaction,
        updateTransaction,
        deleteTransaction,
        importTransactionsBatch,
        getItemLedger,
        resetToDefaultData,
      }}
    >
      {children}
    </InventoryContext.Provider>
  );
};

export const useInventory = () => {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error('useInventory must be used within an InventoryProvider');
  }
  return context;
};
