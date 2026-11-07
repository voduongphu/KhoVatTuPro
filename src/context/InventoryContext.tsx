import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  INITIAL_CATEGORIES,
  INITIAL_ITEMS,
  INITIAL_TRANSACTIONS,
  INITIAL_USERS,
  INITIAL_WAREHOUSES,
} from '../data/mockData';
import {
  InventoryItem,
  MaterialCategory,
  MultiFilterCriteria,
  StockLedgerEntry,
  StockStatus,
  Transaction,
  TransactionLineItem,
  TransactionType,
  User,
  Warehouse,
} from '../types/inventory';
import {
  calculateAllItemsWarehouseStocks,
  calculateItemWarehouseStocks,
  getStockStatus,
} from '../utils/formatters';
import { SyncStatus, CloudProvider, CentralDataPayload } from '../services/centralSyncService';
import { firebaseFirestoreService, FirestoreConnectionState } from '../services/firebaseFirestoreService';
import { DeviceInfo, getDeviceId, getDeviceInfo, getDeviceName } from '../utils/deviceHelper';
import { sessionBus } from '../services/sessionBus';
import {
  DeletedRegistry,
  generateCategoryCodeFromName,
  makeTombstoneKey,
  nextMonotonicIso,
  reconcileSyncPayloads,
  toCategoryAsciiSlug,
} from '../utils/mergeSyncData';

interface InventoryContextType {
  warehouses: Warehouse[];
  materialCategories: MaterialCategory[];
  items: InventoryItem[];
  transactions: Transaction[];
  categories: string[];
  suppliers: string[];

  // Auth & User Management (Single active session across devices)
  users: User[];
  currentUser: User | null;
  login: (
    username: string,
    password: string
  ) => Promise<{
    success: boolean;
    error?: string;
    code?: 'INVALID_CREDENTIALS' | 'ACCOUNT_LOCKED' | 'SESSION_ACTIVE_ON_ANOTHER_DEVICE';
    otherDevice?: {
      id?: string | null;
      name?: string | null;
      lastActiveAt?: string | null;
    };
  }>;
  forceLogoutOtherDeviceAndLogin: (
    username: string,
    password: string
  ) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  revokeUserSession: (userId: string) => { success: boolean; error?: string };
  sessionTerminatedReason: string | null;
  clearSessionTerminatedReason: () => void;
  currentDeviceInfo: DeviceInfo;
  regenerateDeviceIdForTesting: () => string;
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

  // Material Category Management (Danh mục vật tư)
  addMaterialCategory: (data: {
    code: string;
    name: string;
    description?: string;
  }) => {
    success: boolean;
    error?: string;
    category?: MaterialCategory;
  };
  updateMaterialCategory: (
    id: string,
    updates: { code?: string; name?: string; description?: string }
  ) => {
    success: boolean;
    error?: string;
    category?: MaterialCategory;
  };
  deleteMaterialCategory: (
    id: string,
    reassignToCategoryId?: string
  ) => { success: boolean; error?: string };
  linkItemsToCategoryBatch: (
    categoryId: string,
    selectedItemIds: string[]
  ) => { linkedCount: number; unlinkedCount: number };

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
  createTransaction: (data: Omit<Transaction, 'id' | 'code'> & { code?: string }) => {
    success: boolean;
    error?: string;
    transaction?: Transaction;
  };
  updateTransaction: (
    id: string,
    updates: Partial<Transaction>
  ) => { success: boolean; error?: string };
  deleteTransaction: (id: string) => { success: boolean; error?: string };
  importTransactionsBatch: (
    importedList: (Omit<Transaction, 'id' | 'code'> & { code?: string })[]
  ) => { success: boolean; importedCount: number; errors: string[] };

  getItemLedger: (itemId: string) => StockLedgerEntry[];
  resetToDefaultData: () => void;

  // Firebase Firestore Realtime Cloud Synchronization
  syncStatus: SyncStatus;
  lastSyncedAt: Date | null;
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (enabled: boolean) => void;
  syncProvider: CloudProvider;
  triggerManualSync: () => Promise<void>;
  isSyncModalOpen: boolean;
  setIsSyncModalOpen: (open: boolean) => void;

  // Firebase Firestore Realtime Storage & Synchronization
  firestoreConnectionState: FirestoreConnectionState;
  syncWithFirestore: () => Promise<{ success: boolean; error?: string; isQuotaExceeded?: boolean }>;
  pullFromFirestore: () => Promise<{ success: boolean; count?: number; error?: string }>;
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
  ITEMS: 'nxt_inventory_items_v3',
  TRANSACTIONS: 'nxt_inventory_transactions_v3',
  WAREHOUSES: 'nxt_inventory_warehouses_v3',
  CATEGORIES: 'nxt_inventory_categories_v3',
  USERS: 'nxt_inventory_users_v3',
  AUTH: 'nxt_inventory_current_user_v3',
  DELETED_REGISTRY: 'nxt_inventory_deleted_registry_v4',
  DELETED_ITEMS: 'nxt_inventory_deleted_items_v3',
  DELETED_TRANSACTIONS: 'nxt_inventory_deleted_transactions_v3',
  DELETED_USERS: 'nxt_inventory_deleted_users_v3',
  DELETED_WAREHOUSES: 'nxt_inventory_deleted_warehouses_v3',
  DELETED_CATEGORIES: 'nxt_inventory_deleted_categories_v3',
};

const RESET_EPOCH = '2026-10-21T10:00:00.000Z';

interface CategoryLookupCache {
  byId: Map<string, MaterialCategory>;
  byCode: Map<string, MaterialCategory>;
  byName: Map<string, MaterialCategory>;
  usedCodes: Set<string>;
}

function buildCategoryLookupCache(categories: MaterialCategory[]): CategoryLookupCache {
  const byId = new Map<string, MaterialCategory>();
  const byCode = new Map<string, MaterialCategory>();
  const byName = new Map<string, MaterialCategory>();
  const usedCodes = new Set<string>();

  for (let i = 0; i < categories.length; i++) {
    const c = categories[i];
    byId.set(c.id, c);
    byId.set(c.id.toUpperCase(), c);
    const codeUpper = c.code.trim().toUpperCase();
    if (codeUpper) {
      byCode.set(codeUpper, c);
      byName.set(codeUpper.toLowerCase(), c);
      usedCodes.add(codeUpper);
    }
    const nameLower = c.name.trim().toLowerCase();
    if (nameLower) {
      byName.set(nameLower, c);
    }
  }

  return { byId, byCode, byName, usedCodes };
}

function resolveOrEnsureCategoryLink(
  rawCategoryId: string | undefined,
  rawCategoryCode: string | undefined,
  rawCategoryName: string | undefined,
  workingCategories: MaterialCategory[],
  nextReg: DeletedRegistry,
  nowIso: string,
  cache?: CategoryLookupCache
): { categoryId?: string; categoryCode?: string; category: string } {
  if (
    rawCategoryId === '__UNCATEGORIZED__' ||
    (!rawCategoryId &&
      !rawCategoryCode &&
      (!rawCategoryName || rawCategoryName.trim().toLowerCase() === 'chưa phân loại'))
  ) {
    return { categoryId: undefined, categoryCode: undefined, category: 'Chưa phân loại' };
  }

  if (rawCategoryId) {
    const matchedById = cache
      ? cache.byId.get(rawCategoryId) || cache.byId.get(rawCategoryId.toUpperCase())
      : workingCategories.find(
          c => c.id === rawCategoryId || c.id.toUpperCase() === rawCategoryId.toUpperCase()
        );
    if (matchedById) {
      return {
        categoryId: matchedById.id,
        categoryCode: matchedById.code,
        category: matchedById.name,
      };
    }
  }

  if (rawCategoryCode && rawCategoryCode.trim()) {
    const cleanCode = rawCategoryCode.trim().toUpperCase();
    const matchedByCode = cache
      ? cache.byCode.get(cleanCode)
      : workingCategories.find(c => c.code.trim().toUpperCase() === cleanCode);
    if (matchedByCode) {
      return {
        categoryId: matchedByCode.id,
        categoryCode: matchedByCode.code,
        category: matchedByCode.name,
      };
    }
  }

  const cleanName = (rawCategoryName || '').trim();
  if (cleanName && cleanName.toLowerCase() !== 'chưa phân loại') {
    const lower = cleanName.toLowerCase();
    const matchedByName = cache
      ? cache.byName.get(lower)
      : workingCategories.find(
          c => c.name.trim().toLowerCase() === lower || c.code.trim().toLowerCase() === lower
        );
    if (matchedByName) {
      return {
        categoryId: matchedByName.id,
        categoryCode: matchedByName.code,
        category: matchedByName.name,
      };
    }

    const usedCodes = cache
      ? cache.usedCodes
      : new Set(workingCategories.map(c => c.code.trim().toUpperCase()));
    const desiredCode = rawCategoryCode?.trim().toUpperCase();
    const finalCode =
      desiredCode && !usedCodes.has(desiredCode)
        ? (usedCodes.add(desiredCode), desiredCode)
        : generateCategoryCodeFromName(cleanName, usedCodes);
    const slug = toCategoryAsciiSlug(cleanName) || finalCode;
    const newCatId = `CAT-AUTO-${slug}`;
    delete nextReg[makeTombstoneKey('CAT', newCatId)];
    delete nextReg[makeTombstoneKey('CAT', finalCode)];

    const createdCat: MaterialCategory = {
      id: newCatId,
      code: finalCode,
      name: cleanName,
      description: 'Danh mục tự động tạo và liên kết khi khai báo vật tư',
      createdAt: nowIso.replace('T', ' ').substring(0, 16),
      updatedAt: nowIso,
    };
    workingCategories.push(createdCat);
    if (cache) {
      cache.byId.set(createdCat.id, createdCat);
      cache.byId.set(createdCat.id.toUpperCase(), createdCat);
      cache.byCode.set(finalCode, createdCat);
      cache.byName.set(finalCode.toLowerCase(), createdCat);
      cache.byName.set(lower, createdCat);
      cache.usedCodes.add(finalCode);
    }

    return {
      categoryId: createdCat.id,
      categoryCode: createdCat.code,
      category: createdCat.name,
    };
  }

  return { categoryId: undefined, categoryCode: undefined, category: 'Chưa phân loại' };
}

function computeNetMovementsForItem(
  itemId: string,
  itemCode: string,
  transactions: Transaction[]
): { totalNet: number; byWarehouse: Record<string, number> } {
  const normCode = (itemCode || '').trim().toUpperCase();
  const byWarehouse: Record<string, number> = {};
  let totalNet = 0;

  for (let t = 0; t < transactions.length; t++) {
    const trx = transactions[t];
    if (!trx || trx.status === 'DA_HUY') continue;
    const whId = trx.warehouseId || 'WH-01';
    const lines = trx.items || [];
    for (let l = 0; l < lines.length; l++) {
      const line = lines[l];
      const match =
        (itemId && line.itemId === itemId) ||
        (normCode && line.itemCode && line.itemCode.trim().toUpperCase() === normCode);
      if (!match) continue;
      const qty = Number(line.quantity) || 0;
      const delta = trx.type === 'NHAP_KHO' ? qty : -qty;
      byWarehouse[whId] = (byWarehouse[whId] || 0) + delta;
      totalNet += delta;
    }
  }

  return { totalNet, byWarehouse };
}

function recalculateAllItemsStocks(
  itemsList: InventoryItem[],
  warehousesList: Warehouse[],
  transactionsList: Transaction[]
): InventoryItem[] {
  if (itemsList.length === 0) return [];
  const allStocks = calculateAllItemsWarehouseStocks(itemsList, warehousesList, transactionsList);
  const result = new Array<InventoryItem>(itemsList.length);
  for (let i = 0; i < itemsList.length; i++) {
    const it = itemsList[i];
    const stocks = allStocks[i] || {};
    let total = 0;
    const vals = Object.values(stocks);
    for (let v = 0; v < vals.length; v++) {
      total += Number(vals[v]) || 0;
    }
    result[i] = {
      ...it,
      warehouseStocks: stocks,
      currentStock: Math.max(0, total),
    };
  }
  return result;
}

function extractLegacyDeletedArrays(reg: DeletedRegistry) {
  const deletedItemIds: string[] = [];
  const deletedTransactionIds: string[] = [];
  const deletedUserIds: string[] = [];
  const deletedWarehouseIds: string[] = [];
  const deletedCategoryIds: string[] = [];

  Object.keys(reg).forEach(k => {
    if (k.startsWith('ITEM:')) deletedItemIds.push(k.slice(5));
    else if (k.startsWith('TRX:')) deletedTransactionIds.push(k.slice(4));
    else if (k.startsWith('USER:')) deletedUserIds.push(k.slice(5));
    else if (k.startsWith('WH:')) deletedWarehouseIds.push(k.slice(3));
    else if (k.startsWith('CAT:')) deletedCategoryIds.push(k.slice(4));
  });

  return {
    deletedItemIds,
    deletedTransactionIds,
    deletedUserIds,
    deletedWarehouseIds,
    deletedCategoryIds,
  };
}

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

  const [materialCategories, setMaterialCategories] = useState<MaterialCategory[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.CATEGORIES);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return INITIAL_CATEGORIES;
    } catch {
      return INITIAL_CATEGORIES;
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
      const parsed = stored ? JSON.parse(stored) : INITIAL_USERS;
      const seen = new Set<string>();
      return (Array.isArray(parsed) ? parsed : INITIAL_USERS).map((u: User) => {
        let uniqueId = u.id || `USR-${u.username.toUpperCase()}`;
        if (uniqueId === 'USR-ADMIN' && u.username.toLowerCase() !== 'admin') {
          uniqueId = `USR-${u.username.toUpperCase()}`;
        }
        if (seen.has(uniqueId)) {
          uniqueId = `USR-${u.username.toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        }
        seen.add(uniqueId);
        return { ...u, id: uniqueId };
      });
    } catch {
      return INITIAL_USERS;
    }
  });

  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      localStorage.removeItem(STORAGE_KEYS.AUTH);
    } catch {
      // ignore
    }
    return null;
  });

  const [deletedRegistry, setDeletedRegistry] = useState<DeletedRegistry>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.DELETED_REGISTRY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      // ignore
    }
    return {};
  });

  const [deletedItemIds, setDeletedItemIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.DELETED_ITEMS);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [deletedTransactionIds, setDeletedTransactionIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.DELETED_TRANSACTIONS);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [deletedUserIds, setDeletedUserIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.DELETED_USERS);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [deletedWarehouseIds, setDeletedWarehouseIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.DELETED_WAREHOUSES);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [deletedCategoryIds, setDeletedCategoryIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.DELETED_CATEGORIES);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Always-fresh synchronous snapshot ref so async SSE/polling/mutation callbacks never read stale closures
  const stateRef = useRef({
    warehouses,
    materialCategories,
    items,
    transactions,
    users,
    deletedRegistry,
    deletedItemIds,
    deletedTransactionIds,
    deletedUserIds,
    deletedWarehouseIds,
    deletedCategoryIds,
  });

  stateRef.current = {
    warehouses,
    materialCategories,
    items,
    transactions,
    users,
    deletedRegistry,
    deletedItemIds,
    deletedTransactionIds,
    deletedUserIds,
    deletedWarehouseIds,
    deletedCategoryIds,
  };

  const clientIdRef = useRef<string>(
    `CLIENT-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`
  );

  // Multi-device Single Session Tracking state
  const [sessionTerminatedReason, setSessionTerminatedReason] = useState<string | null>(null);
  const [currentDeviceInfo, setCurrentDeviceInfo] = useState<DeviceInfo>(() => getDeviceInfo());

  const clearSessionTerminatedReason = useCallback(() => {
    setSessionTerminatedReason(null);
  }, []);

  const regenerateDeviceIdForTesting = useCallback(() => {
    const randomHex = Math.random().toString(36).substring(2, 8).toUpperCase();
    const timeHex = Date.now().toString(36).toUpperCase();
    const newId = `DEV-${timeHex}-${randomHex}`;
    try {
      localStorage.setItem('nxt_inventory_device_id_v1', newId);
    } catch {
      // ignore
    }
    const fresh = getDeviceInfo();
    setCurrentDeviceInfo(fresh);
    return newId;
  }, []);

  const [filterCriteria, setFilterCriteria] = useState<MultiFilterCriteria>(defaultCriteria);

  // Central Cloud Synchronization state
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(new Date());
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(true);
  const [syncProvider, setSyncProvider] = useState<CloudProvider>('firestore');
  const [isSyncModalOpen, setIsSyncModalOpen] = useState<boolean>(false);
  const [lastServerTimestamp, setLastServerTimestamp] = useState<string>('');

  // Firebase Firestore Realtime Connection State
  const [firestoreConnectionState, setFirestoreConnectionState] = useState<FirestoreConnectionState>(() =>
    firebaseFirestoreService.getConnectionState()
  );

  const pendingSnapshotRef = useRef<{
    warehouses: Warehouse[];
    materialCategories: MaterialCategory[];
    items: InventoryItem[];
    transactions: Transaction[];
    users: User[];
    deletedRegistry: DeletedRegistry;
    deletedItemIds: string[];
    deletedTransactionIds: string[];
    deletedUserIds: string[];
    deletedWarehouseIds: string[];
    deletedCategoryIds: string[];
  } | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingLocalStorage = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const snapshot = pendingSnapshotRef.current;
    if (!snapshot) return;
    pendingSnapshotRef.current = null;
    try {
      localStorage.setItem(STORAGE_KEYS.WAREHOUSES, JSON.stringify(snapshot.warehouses));
      localStorage.setItem(
        STORAGE_KEYS.CATEGORIES,
        JSON.stringify(snapshot.materialCategories)
      );
      localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(snapshot.items));
      localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(snapshot.transactions));
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(snapshot.users));
      localStorage.setItem(
        STORAGE_KEYS.DELETED_REGISTRY,
        JSON.stringify(snapshot.deletedRegistry)
      );
      localStorage.setItem(STORAGE_KEYS.DELETED_ITEMS, JSON.stringify(snapshot.deletedItemIds));
      localStorage.setItem(
        STORAGE_KEYS.DELETED_TRANSACTIONS,
        JSON.stringify(snapshot.deletedTransactionIds)
      );
      localStorage.setItem(STORAGE_KEYS.DELETED_USERS, JSON.stringify(snapshot.deletedUserIds));
      localStorage.setItem(
        STORAGE_KEYS.DELETED_WAREHOUSES,
        JSON.stringify(snapshot.deletedWarehouseIds)
      );
      localStorage.setItem(
        STORAGE_KEYS.DELETED_CATEGORIES,
        JSON.stringify(snapshot.deletedCategoryIds)
      );
    } catch {
      // ignore quota errors
    }
  }, []);

  useEffect(() => {
    window.addEventListener('beforeunload', flushPendingLocalStorage);
    return () => {
      window.removeEventListener('beforeunload', flushPendingLocalStorage);
      flushPendingLocalStorage();
    };
  }, [flushPendingLocalStorage]);

  const persistSnapshotToLocalStorage = useCallback(
    (snapshot: {
      warehouses: Warehouse[];
      materialCategories: MaterialCategory[];
      items: InventoryItem[];
      transactions: Transaction[];
      users: User[];
      deletedRegistry: DeletedRegistry;
      deletedItemIds: string[];
      deletedTransactionIds: string[];
      deletedUserIds: string[];
      deletedWarehouseIds: string[];
      deletedCategoryIds: string[];
    }) => {
      pendingSnapshotRef.current = snapshot;
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
      persistTimerRef.current = setTimeout(() => {
        flushPendingLocalStorage();
      }, 350);
    },
    [flushPendingLocalStorage]
  );

  /**
   * Pure, deterministic remote payload reconciliation (no nested React state updaters,
   * handles empty arrays on full deletions, and propagates shared Supabase credentials).
   */
  const applyRemotePayloadAdditive = useCallback(
    (payload: CentralDataPayload) => {
      if (!payload) return;

      if (payload.cleanReset) {
        const cleanSnapshot = {
          warehouses:
            Array.isArray(payload.warehouses) && payload.warehouses.length > 0
              ? payload.warehouses
              : INITIAL_WAREHOUSES,
          materialCategories:
            Array.isArray(payload.materialCategories) && payload.materialCategories.length > 0
              ? payload.materialCategories
              : INITIAL_CATEGORIES,
          items: Array.isArray(payload.items) ? payload.items : [],
          transactions: Array.isArray(payload.transactions) ? payload.transactions : [],
          users:
            Array.isArray(payload.users) && payload.users.length > 0
              ? payload.users
              : INITIAL_USERS,
          deletedRegistry: {},
          deletedItemIds: [],
          deletedTransactionIds: [],
          deletedUserIds: [],
          deletedWarehouseIds: [],
          deletedCategoryIds: [],
        };
        stateRef.current = cleanSnapshot;
        setWarehouses(cleanSnapshot.warehouses);
        setMaterialCategories(cleanSnapshot.materialCategories);
        setItems(cleanSnapshot.items);
        setTransactions(cleanSnapshot.transactions);
        setUsers(cleanSnapshot.users);
        setDeletedRegistry(cleanSnapshot.deletedRegistry);
        setDeletedItemIds([]);
        setDeletedTransactionIds([]);
        setDeletedUserIds([]);
        setDeletedWarehouseIds([]);
        setDeletedCategoryIds([]);
        persistSnapshotToLocalStorage(cleanSnapshot);
        if (payload.lastUpdated) setLastServerTimestamp(payload.lastUpdated);
        setLastSyncedAt(new Date());
        setSyncStatus('synced');
        return;
      }

      const current = stateRef.current;
      const reconciled = reconcileSyncPayloads(
        {
          users: current.users,
          warehouses: current.warehouses,
          materialCategories: current.materialCategories,
          transactions: current.transactions,
          items: current.items,
          deletedRegistry: current.deletedRegistry,
          deletedItemIds: current.deletedItemIds,
          deletedTransactionIds: current.deletedTransactionIds,
          deletedUserIds: current.deletedUserIds,
          deletedWarehouseIds: current.deletedWarehouseIds,
          deletedCategoryIds: current.deletedCategoryIds,
        },
        {
          users: Array.isArray(payload.users) ? payload.users : [],
          warehouses: Array.isArray(payload.warehouses) ? payload.warehouses : [],
          materialCategories: Array.isArray(payload.materialCategories)
            ? payload.materialCategories
            : [],
          transactions: Array.isArray(payload.transactions) ? payload.transactions : [],
          items: Array.isArray(payload.items) ? payload.items : [],
          deletedRegistry: payload.deletedRegistry,
          deletedItemIds: payload.deletedItemIds,
          deletedTransactionIds: payload.deletedTransactionIds,
          deletedUserIds: payload.deletedUserIds,
          deletedWarehouseIds: payload.deletedWarehouseIds,
          deletedCategoryIds: payload.deletedCategoryIds,
        }
      );

      const nextSnapshot = {
        warehouses: reconciled.warehouses,
        materialCategories: reconciled.materialCategories,
        items: reconciled.items,
        transactions: reconciled.transactions,
        users: reconciled.users,
        deletedRegistry: reconciled.deletedRegistry,
        deletedItemIds: reconciled.deletedItemIds,
        deletedTransactionIds: reconciled.deletedTransactionIds,
        deletedUserIds: reconciled.deletedUserIds,
        deletedWarehouseIds: reconciled.deletedWarehouseIds,
        deletedCategoryIds: reconciled.deletedCategoryIds,
      };

      stateRef.current = nextSnapshot;
      setWarehouses(nextSnapshot.warehouses);
      setMaterialCategories(nextSnapshot.materialCategories);
      setUsers(nextSnapshot.users);
      setTransactions(nextSnapshot.transactions);
      setItems(nextSnapshot.items);
      setDeletedRegistry(nextSnapshot.deletedRegistry);
      setDeletedItemIds(nextSnapshot.deletedItemIds);
      setDeletedTransactionIds(nextSnapshot.deletedTransactionIds);
      setDeletedUserIds(nextSnapshot.deletedUserIds);
      setDeletedWarehouseIds(nextSnapshot.deletedWarehouseIds);
      setDeletedCategoryIds(nextSnapshot.deletedCategoryIds);
      persistSnapshotToLocalStorage(nextSnapshot);

      if (payload.lastUpdated) {
        setLastServerTimestamp(payload.lastUpdated);
      }
      setLastSyncedAt(new Date());
      setSyncStatus('synced');
    },
    [persistSnapshotToLocalStorage]
  );

  const isPushingRef = useRef(false);
  const isPollingRef = useRef(false);
  const v2MigrationTriggeredRef = useRef(false);

  /**
   * Đẩy dữ liệu lên Firebase Firestore thời gian thực và cập nhật đồng bộ snapshot cục bộ
   */
  const pushCloudSyncImmediately = useCallback(
    async (
      newItems: InventoryItem[],
      newTransactions: Transaction[],
      newWarehouses: Warehouse[],
      newUsers: User[],
      customDeletedRegistry?: DeletedRegistry,
      source = 'web-client',
      _unusedConfig?: any,
      customCategories?: MaterialCategory[]
    ) => {
      const regToPush = customDeletedRegistry || stateRef.current.deletedRegistry;
      const catsToPush = customCategories || stateRef.current.materialCategories;
      const legacyArrays = extractLegacyDeletedArrays(regToPush);

      // 1. Cập nhật ngay lập tức stateRef & localStorage để giao diện phản hồi 0ms
      const immediateSnapshot = {
        warehouses: newWarehouses,
        materialCategories: catsToPush,
        items: newItems,
        transactions: newTransactions,
        users: newUsers,
        deletedRegistry: regToPush,
        ...legacyArrays,
      };
      stateRef.current = immediateSnapshot;
      persistSnapshotToLocalStorage(immediateSnapshot);

      isPushingRef.current = true;
      setSyncStatus('syncing');

      const outboundPayload: CentralDataPayload = {
        version: Date.now(),
        lastUpdated: new Date().toISOString(),
        items: newItems,
        transactions: newTransactions,
        warehouses: newWarehouses,
        materialCategories: catsToPush,
        users: newUsers,
        deletedRegistry: regToPush,
        ...legacyArrays,
        clientId: clientIdRef.current,
        source,
        lastUpdatedBy: currentUser?.fullName || 'Người dùng',
      };

      try {
        const ok = await firebaseFirestoreService.pushPayload(
          outboundPayload,
          currentUser?.fullName || 'Người dùng'
        );
        if (ok) {
          setSyncStatus('synced');
          setLastSyncedAt(new Date());
          setSyncProvider('firestore');
        } else {
          setSyncStatus('error');
        }
      } catch (fErr) {
        console.warn('Firebase Firestore push failed:', fErr);
        setSyncStatus('error');
      } finally {
        isPushingRef.current = false;
      }
    },
    [currentUser, persistSnapshotToLocalStorage]
  );

  /**
   * Đồng bộ thủ công dữ liệu cục bộ trên thiết bị lên Firebase Firestore
   */
  const syncWithFirestore = useCallback(async (): Promise<{ success: boolean; error?: string; isQuotaExceeded?: boolean }> => {
    setSyncStatus('syncing');
    try {
      const snap = stateRef.current;
      const legacyArrays = extractLegacyDeletedArrays(snap.deletedRegistry);
      const payload: CentralDataPayload = {
        version: Date.now(),
        lastUpdated: new Date().toISOString(),
        items: snap.items,
        transactions: snap.transactions,
        warehouses: snap.warehouses,
        materialCategories: snap.materialCategories,
        users: snap.users,
        deletedRegistry: snap.deletedRegistry,
        ...legacyArrays,
        source: 'firebase-firestore-manual',
        lastUpdatedBy: currentUser?.fullName || 'Quản trị viên',
      };
      const res = await firebaseFirestoreService.pushPayload(payload, currentUser?.fullName);
      if (res.success) {
        setSyncStatus('synced');
        setLastSyncedAt(new Date());
        setSyncProvider('firestore');
        return { success: true };
      }
      setSyncStatus('error');
      return { success: false, error: res.error, isQuotaExceeded: res.isQuotaExceeded };
    } catch (e: any) {
      setSyncStatus('error');
      return { success: false, error: e?.message || String(e) };
    }
  }, [currentUser]);

  /**
   * Tải dữ liệu mới nhất từ Firebase Firestore về thiết bị
   */
  const pullFromFirestore = useCallback(async (): Promise<{ success: boolean; count?: number; error?: string }> => {
    setSyncStatus('syncing');
    try {
      const remotePayload = await firebaseFirestoreService.fetchPayload();
      if (remotePayload) {
        applyRemotePayloadAdditive(remotePayload);
        setSyncStatus('synced');
        setLastSyncedAt(new Date());
        return { success: true, count: remotePayload.items?.length || 0 };
      }
      setSyncStatus('synced');
      return { success: false, error: 'Chưa có bản ghi nào trên Firestore để tải về' };
    } catch (err: any) {
      setSyncStatus('error');
      return { success: false, error: err?.message || String(err) };
    }
  }, [applyRemotePayloadAdditive]);

  // Kết nối và đồng bộ thời gian thực với Firebase Firestore (onSnapshot WebSocket 0s delay)
  // Tự động tải dữ liệu cục bộ lên đám mây Firestore ngay khi ứng dụng khởi chạy nếu đám mây còn trống
  useEffect(() => {
    const unsubscribeFirestore = firebaseFirestoreService.subscribeToChanges(payload => {
      if (!payload) return;
      applyRemotePayloadAdditive(payload);
      setSyncProvider('firestore');
      setLastSyncedAt(new Date());
      setSyncStatus('synced');
    });

    const unsubscribeFirestoreStatus = firebaseFirestoreService.onConnectionStateChange(state => {
      setFirestoreConnectionState(state);
    });

    // Khi khởi động ứng dụng: đọc dữ liệu từ Firestore hoặc đồng bộ dữ liệu cục bộ lên
    firebaseFirestoreService.fetchPayload().then(async remotePayload => {
      const snap = stateRef.current;
      const localHasData = (snap.items && snap.items.length > 0) || (snap.warehouses && snap.warehouses.length > 0);
      const remoteHasData = remotePayload && ((remotePayload.items && remotePayload.items.length > 0) || (remotePayload.version && remotePayload.version > 0));

      if (remoteHasData && remotePayload) {
        // Có dữ liệu đám mây: hợp nhất dữ liệu hai chiều
        applyRemotePayloadAdditive(remotePayload);
        // Nếu thiết bị cục bộ có nhiều vật tư hơn dữ liệu đám mây (ví dụ mới nhập offline), đẩy bổ sung lên
        if (snap.items.length > (remotePayload.items?.length || 0)) {
          setTimeout(() => {
            syncWithFirestore();
          }, 800);
        }
      } else if (localHasData) {
        // Đám mây Firestore vừa khởi tạo (trống), trong khi thiết bị cục bộ đã có dữ liệu:
        // Tự động kết nối và đồng bộ toàn bộ dữ liệu cục bộ lên Firestore ngay lập tức!
        console.log('[Firestore] Tự động đồng bộ dữ liệu cục bộ trên thiết bị lên Firestore...');
        await syncWithFirestore();
      }
    }).catch(err => {
      console.warn('Khởi tạo Firestore ban đầu:', err);
    });

    return () => {
      unsubscribeFirestore();
      unsubscribeFirestoreStatus();
    };
  }, [applyRemotePayloadAdditive, syncWithFirestore]);

  // Active session monitor: Terminate session if another device logs in with this user account
  useEffect(() => {
    if (!currentUser) return;
    const currentDeviceId = getDeviceId();
    const freshUser = users.find(u => u.id === currentUser.id);
    if (!freshUser) {
      if (users.length > 0) {
        setCurrentUser(null);
        setSessionTerminatedReason('Tài khoản này đã bị xóa khỏi hệ thống bởi Quản trị viên.');
      }
      return;
    }

    if (freshUser.status === 'LOCKED') {
      setCurrentUser(null);
      setSessionTerminatedReason('Tài khoản của bạn đã bị khóa bởi Quản trị viên.');
      return;
    }

    if (freshUser.activeDeviceId && freshUser.activeDeviceId !== currentDeviceId) {
      setCurrentUser(null);
      setSessionTerminatedReason(
        `Tài khoản "${freshUser.fullName}" đã được đăng nhập trên một thiết bị khác (${freshUser.activeDeviceName || 'Thiết bị khác'}). Phiên làm việc trên thiết bị này đã được tự động kết thúc để bảo đảm an toàn dữ liệu.`
      );
    } else if (freshUser.activeDeviceId === null) {
      setCurrentUser(null);
      setSessionTerminatedReason(
        `Tài khoản "${freshUser.fullName}" đã được đăng xuất từ xa hoặc bởi Quản trị viên.`
      );
    }
  }, [users, currentUser]);

  // Cross-tab / Cross-window broadcast listener
  useEffect(() => {
    const unsubscribe = sessionBus.subscribe(msg => {
      if (!currentUser) return;
      if (msg.userId === currentUser.id) {
        const myDeviceId = getDeviceId();
        if (msg.type === 'TAKEOVER' && msg.deviceId && msg.deviceId !== myDeviceId) {
          setCurrentUser(null);
          setSessionTerminatedReason(
            `Tài khoản "${currentUser.fullName}" vừa được đăng nhập trên một thiết bị khác (${msg.deviceName || 'Thiết bị mới'}). Phiên làm việc trên thiết bị này đã được tự động kết thúc.`
          );
        } else if (msg.type === 'LOGOUT' && msg.deviceId !== myDeviceId) {
          setCurrentUser(null);
          setSessionTerminatedReason(
            msg.reason || `Tài khoản "${currentUser.fullName}" đã được đăng xuất từ xa.`
          );
        }
      }
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Kích hoạt đồng bộ thủ công với Firebase Firestore
  const triggerManualSync = useCallback(async () => {
    await syncWithFirestore();
  }, [syncWithFirestore]);

  // Auth Operations (Multi-Device Single Session Enforcement)
  const login = async (
    username: string,
    password: string
  ): Promise<{
    success: boolean;
    error?: string;
    code?: 'INVALID_CREDENTIALS' | 'ACCOUNT_LOCKED' | 'SESSION_ACTIVE_ON_ANOTHER_DEVICE';
    otherDevice?: {
      id?: string | null;
      name?: string | null;
      lastActiveAt?: string | null;
    };
  }> => {
    const trimmedUsername = username.trim().toLowerCase();

    // 1. Luôn làm mới trạng thái người dùng từ Firebase Firestore trước khi đăng nhập
    try {
      const remotePayload = await firebaseFirestoreService.fetchPayload();
      if (remotePayload) {
        applyRemotePayloadAdditive(remotePayload);
      }
    } catch (err) {
      console.warn('Could not refresh remote state from Firestore during login:', err);
    }

    const currentUsersList = stateRef.current.users;
    const user = currentUsersList.find(u => u.username.toLowerCase() === trimmedUsername);

    if (!user) {
      return {
        success: false,
        code: 'INVALID_CREDENTIALS',
        error: 'Tên đăng nhập không tồn tại trong hệ thống.',
      };
    }

    if (user.status === 'LOCKED') {
      return {
        success: false,
        code: 'ACCOUNT_LOCKED',
        error: 'Tài khoản này đang bị khóa. Vui lòng liên hệ Quản trị viên.',
      };
    }

    if (user.password !== password) {
      return {
        success: false,
        code: 'INVALID_CREDENTIALS',
        error: 'Mật khẩu không chính xác. Vui lòng thử lại.',
      };
    }

    const currentDeviceId = getDeviceId();
    const currentDeviceName = getDeviceName();

    if (user.activeDeviceId && user.activeDeviceId !== currentDeviceId) {
      return {
        success: false,
        code: 'SESSION_ACTIVE_ON_ANOTHER_DEVICE',
        error: `Tài khoản "${user.fullName}" hiện đang đăng nhập trên thiết bị: "${user.activeDeviceName || 'Thiết bị khác'}".`,
        otherDevice: {
          id: user.activeDeviceId,
          name: user.activeDeviceName || 'Thiết bị khác',
          lastActiveAt: user.lastActiveAt || user.lastLogin,
        },
      };
    }

    const nowIso = nextMonotonicIso(user.updatedAt, user.lastActiveAt);
    const updatedUser: User = {
      ...user,
      lastLogin: nowIso.replace('T', ' ').substring(0, 16),
      activeDeviceId: currentDeviceId,
      activeDeviceName: currentDeviceName,
      lastActiveAt: nowIso,
      updatedAt: nowIso,
    };

    const cur = stateRef.current;
    const updatedUsers = cur.users.map(u => (u.id === user.id ? updatedUser : u));
    setUsers(updatedUsers);
    try {
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(updatedUsers));
      localStorage.setItem(STORAGE_KEYS.AUTH, JSON.stringify(updatedUser));
    } catch {
      // ignore
    }

    setCurrentUser(updatedUser);
    setSessionTerminatedReason(null);

    pushCloudSyncImmediately(
      cur.items,
      cur.transactions,
      cur.warehouses,
      updatedUsers,
      cur.deletedRegistry,
      'user-login'
    );
    sessionBus.broadcast({
      type: 'LOGIN',
      userId: user.id,
      deviceId: currentDeviceId,
      deviceName: currentDeviceName,
    });

    return { success: true };
  };

  const forceLogoutOtherDeviceAndLogin = async (
    username: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> => {
    const trimmedUsername = username.trim().toLowerCase();

    try {
      const remotePayload = await firebaseFirestoreService.fetchPayload();
      if (remotePayload) {
        applyRemotePayloadAdditive(remotePayload);
      }
    } catch (err) {
      console.warn('Could not refresh remote users before takeover from Firestore:', err);
    }

    const cur = stateRef.current;
    const user = cur.users.find(u => u.username.toLowerCase() === trimmedUsername);
    if (!user) {
      return { success: false, error: 'Tên đăng nhập không tồn tại.' };
    }
    if (user.status === 'LOCKED') {
      return { success: false, error: 'Tài khoản này đang bị khóa.' };
    }
    if (user.password !== password) {
      return { success: false, error: 'Mật khẩu không chính xác.' };
    }

    const currentDeviceId = getDeviceId();
    const currentDeviceName = getDeviceName();
    const nowIso = nextMonotonicIso(user.updatedAt, user.lastActiveAt);

    const updatedUser: User = {
      ...user,
      lastLogin: nowIso.replace('T', ' ').substring(0, 16),
      activeDeviceId: currentDeviceId,
      activeDeviceName: currentDeviceName,
      lastActiveAt: nowIso,
      updatedAt: nowIso,
    };

    const updatedUsers = cur.users.map(u => (u.id === user.id ? updatedUser : u));
    setUsers(updatedUsers);
    try {
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(updatedUsers));
      localStorage.setItem(STORAGE_KEYS.AUTH, JSON.stringify(updatedUser));
    } catch {
      // ignore
    }

    setCurrentUser(updatedUser);
    setSessionTerminatedReason(null);

    pushCloudSyncImmediately(
      cur.items,
      cur.transactions,
      cur.warehouses,
      updatedUsers,
      cur.deletedRegistry,
      'session-takeover'
    );
    sessionBus.broadcast({
      type: 'TAKEOVER',
      userId: user.id,
      deviceId: currentDeviceId,
      deviceName: currentDeviceName,
    });

    return { success: true };
  };

  const logout = useCallback(() => {
    if (currentUser) {
      const cur = stateRef.current;
      const currentDeviceId = getDeviceId();
      const targetSelf = cur.users.find(u => u.id === currentUser.id);
      const nowIso = nextMonotonicIso(
        currentUser.updatedAt,
        targetSelf?.updatedAt,
        targetSelf?.lastActiveAt
      );
      const updatedUsers = cur.users.map(u => {
        if (u.id === currentUser.id) {
          return {
            ...u,
            activeDeviceId: null,
            activeDeviceName: null,
            lastActiveAt: null,
            updatedAt: nowIso,
          };
        }
        return u;
      });

      setUsers(updatedUsers);
      try {
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(updatedUsers));
        localStorage.removeItem(STORAGE_KEYS.AUTH);
      } catch {
        // ignore
      }

      pushCloudSyncImmediately(
        cur.items,
        cur.transactions,
        cur.warehouses,
        updatedUsers,
        cur.deletedRegistry,
        'user-logout'
      );
      sessionBus.broadcast({
        type: 'LOGOUT',
        userId: currentUser.id,
        deviceId: currentDeviceId,
      });
    }
    setCurrentUser(null);
  }, [currentUser, pushCloudSyncImmediately]);

  const revokeUserSession = useCallback(
    (userId: string): { success: boolean; error?: string } => {
      if (!currentUser || currentUser.role !== 'ADMIN') {
        return { success: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền đăng xuất phiên người dùng.' };
      }

      const cur = stateRef.current;
      const targetUser = cur.users.find(u => u.id === userId);
      if (!targetUser) {
        return { success: false, error: 'Không tìm thấy người dùng.' };
      }

      const nowIso = nextMonotonicIso(targetUser.updatedAt, targetUser.lastActiveAt);
      const updatedUsers = cur.users.map(u => {
        if (u.id === userId) {
          return {
            ...u,
            activeDeviceId: null,
            activeDeviceName: null,
            lastActiveAt: null,
            updatedAt: nowIso,
          };
        }
        return u;
      });

      setUsers(updatedUsers);
      pushCloudSyncImmediately(
        cur.items,
        cur.transactions,
        cur.warehouses,
        updatedUsers,
        cur.deletedRegistry,
        'admin-revoke-session'
      );
      sessionBus.broadcast({
        type: 'LOGOUT',
        userId: userId,
        deviceId: 'admin-action',
        reason: 'Quản trị viên đã đăng xuất tài khoản này từ xa.',
      });

      return { success: true };
    },
    [currentUser, pushCloudSyncImmediately]
  );

  // User Management
  const addUser = (userData: Omit<User, 'id' | 'createdAt'>): { success: boolean; error?: string } => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền thêm người sử dụng.' };
    }

    const cur = stateRef.current;
    const trimmedUsername = userData.username.trim().toLowerCase();
    if (cur.users.some(u => u.username.toLowerCase() === trimmedUsername)) {
      return { success: false, error: `Tên đăng nhập "${userData.username}" đã tồn tại.` };
    }

    const nowIso = nextMonotonicIso(
      cur.deletedRegistry[makeTombstoneKey('USER', trimmedUsername)],
      cur.deletedRegistry[makeTombstoneKey('USER', 'usr-admin')],
      Object.values(cur.deletedRegistry)
    );
    const newUser: User = {
      ...userData,
      id: `USR-${Date.now()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`,
      username: trimmedUsername,
      createdAt: nowIso.replace('T', ' ').substring(0, 16),
      updatedAt: nowIso,
    };

    const updatedUsers = [...cur.users, newUser];
    const nextReg = { ...cur.deletedRegistry };
    delete nextReg[makeTombstoneKey('USER', newUser.id)];
    delete nextReg[makeTombstoneKey('USER', trimmedUsername)];
    if (trimmedUsername === 'admin') {
      delete nextReg[makeTombstoneKey('USER', 'usr-admin')];
    }
    const legacy = extractLegacyDeletedArrays(nextReg);

    setUsers(updatedUsers);
    setDeletedRegistry(nextReg);
    setDeletedUserIds(legacy.deletedUserIds);

    pushCloudSyncImmediately(
      cur.items,
      cur.transactions,
      cur.warehouses,
      updatedUsers,
      nextReg,
      'add-user'
    );
    return { success: true };
  };

  const updateUser = (id: string, updates: Partial<User>): { success: boolean; error?: string } => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền chỉnh sửa người dùng.' };
    }

    const cur = stateRef.current;
    if (updates.username) {
      const trimmed = updates.username.trim().toLowerCase();
      if (cur.users.some(u => u.id !== id && u.username.toLowerCase() === trimmed)) {
        return { success: false, error: `Tên đăng nhập "${updates.username}" đã bị trùng lặp.` };
      }
    }

    const existingUser = cur.users.find(u => u.id === id);
    if (!existingUser) {
      return { success: false, error: 'Không tìm thấy tài khoản người dùng.' };
    }

    const simulatedNextUser = { ...existingUser, ...updates };
    const wouldLoseAdminStatus =
      existingUser.role === 'ADMIN' &&
      existingUser.status === 'ACTIVE' &&
      (simulatedNextUser.role !== 'ADMIN' || simulatedNextUser.status !== 'ACTIVE');

    if (wouldLoseAdminStatus) {
      const otherActiveAdmins = cur.users.filter(
        u => u.id !== id && u.role === 'ADMIN' && u.status === 'ACTIVE'
      );
      if (otherActiveAdmins.length === 0) {
        return {
          success: false,
          error:
            'Hệ thống phải có ít nhất 1 tài khoản Quản trị viên (Admin) đang hoạt động. Không thể khóa hoặc hạ quyền Quản trị viên duy nhất!',
        };
      }
    }

    const nowIso = nextMonotonicIso(existingUser.updatedAt, existingUser.lastActiveAt);
    const updatedUsers = cur.users.map(u => {
      if (u.id === id) {
        const updated = { ...u, ...updates, updatedAt: nowIso };
        if (currentUser.id === id) {
          setCurrentUser(updated);
        }
        return updated;
      }
      return u;
    });

    setUsers(updatedUsers);
    pushCloudSyncImmediately(
      cur.items,
      cur.transactions,
      cur.warehouses,
      updatedUsers,
      cur.deletedRegistry,
      'update-user'
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

    const cur = stateRef.current;
    const targetUser = cur.users.find(u => u.id === id);
    if (!targetUser) {
      return { success: false, error: 'Không tìm thấy tài khoản cần xóa.' };
    }

    const targetNormUsername = targetUser.username?.trim().toLowerCase();
    const updatedUsers = cur.users.filter(
      u => u.id !== id && (!targetNormUsername || u.username.trim().toLowerCase() !== targetNormUsername)
    );

    const remainingActiveAdmins = updatedUsers.filter(
      u => u.role === 'ADMIN' && u.status === 'ACTIVE'
    );
    if (remainingActiveAdmins.length === 0) {
      return {
        success: false,
        error:
          'Hệ thống phải có ít nhất 1 tài khoản Quản trị viên (Admin) đang hoạt động. Không thể xóa Quản trị viên duy nhất!',
      };
    }

    const nowIso = nextMonotonicIso(
      targetUser.updatedAt,
      targetUser.lastActiveAt,
      cur.users.map(u => u.updatedAt),
      cur.users.map(u => u.lastActiveAt),
      Object.values(cur.deletedRegistry)
    );
    const nextReg = { ...cur.deletedRegistry };
    nextReg[makeTombstoneKey('USER', id)] = nowIso;
    if (targetUser.id) {
      nextReg[makeTombstoneKey('USER', targetUser.id)] = nowIso;
    }
    if (targetNormUsername) {
      nextReg[makeTombstoneKey('USER', targetNormUsername)] = nowIso;
      if (targetNormUsername === 'admin') {
        nextReg[makeTombstoneKey('USER', 'usr-admin')] = nowIso;
        nextReg[makeTombstoneKey('USER', 'admin')] = nowIso;
      }
    }
    const legacy = extractLegacyDeletedArrays(nextReg);

    setUsers(updatedUsers);
    setDeletedRegistry(nextReg);
    setDeletedUserIds(legacy.deletedUserIds);

    sessionBus.broadcast({
      type: 'LOGOUT',
      userId: id,
      deviceId: 'admin-action',
      reason: 'Tài khoản này đã bị xóa khỏi hệ thống bởi Quản trị viên.',
    });

    pushCloudSyncImmediately(
      cur.items,
      cur.transactions,
      cur.warehouses,
      updatedUsers,
      nextReg,
      'delete-user'
    );
    return { success: true };
  };

  // Warehouse Management
  const addWarehouse = (
    data: Omit<Warehouse, 'id'>
  ): { success: boolean; error?: string; warehouse?: Warehouse } => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền thêm kho hàng mới.' };
    }

    const cur = stateRef.current;
    const trimmedCode = data.code.trim().toUpperCase();
    const trimmedName = data.name.trim();

    if (!trimmedCode) {
      return { success: false, error: 'Vui lòng nhập mã ký hiệu kho.' };
    }
    if (!trimmedName) {
      return { success: false, error: 'Vui lòng nhập tên kho lưu trữ.' };
    }
    if (cur.warehouses.some(w => w.code.toUpperCase() === trimmedCode)) {
      return { success: false, error: `Mã kho "${trimmedCode}" đã tồn tại trong hệ thống.` };
    }

    const nowIso = nextMonotonicIso(cur.deletedRegistry[makeTombstoneKey('WH', trimmedCode)]);
    const newWarehouse: Warehouse = {
      ...data,
      id: `WH-${Date.now()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`,
      code: trimmedCode,
      name: trimmedName,
      status: data.status || 'ACTIVE',
      createdAt: nowIso.replace('T', ' ').substring(0, 16),
      updatedAt: nowIso,
    };

    const updatedWh = [...cur.warehouses, newWarehouse];
    const nextReg = { ...cur.deletedRegistry };
    delete nextReg[makeTombstoneKey('WH', newWarehouse.id)];
    delete nextReg[makeTombstoneKey('WH', trimmedCode)];
    const legacy = extractLegacyDeletedArrays(nextReg);

    const recalculatedItems = recalculateAllItemsStocks(cur.items, updatedWh, cur.transactions);

    setWarehouses(updatedWh);
    setItems(recalculatedItems);
    setDeletedRegistry(nextReg);
    setDeletedWarehouseIds(legacy.deletedWarehouseIds);

    pushCloudSyncImmediately(
      recalculatedItems,
      cur.transactions,
      updatedWh,
      cur.users,
      nextReg,
      'add-warehouse'
    );

    return { success: true, warehouse: newWarehouse };
  };

  const updateWarehouse = (
    id: string,
    updates: Partial<Warehouse>
  ): { success: boolean; error?: string } => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền chỉnh sửa thông tin kho.' };
    }

    const cur = stateRef.current;
    if (updates.code) {
      const trimmedCode = updates.code.trim().toUpperCase();
      if (cur.warehouses.some(w => w.id !== id && w.code.toUpperCase() === trimmedCode)) {
        return { success: false, error: `Mã kho "${trimmedCode}" đã bị trùng lặp.` };
      }
    }

    const existingWh = cur.warehouses.find(w => w.id === id);
    const nowIso = nextMonotonicIso(existingWh?.updatedAt);
    const updatedWh = cur.warehouses.map(w =>
      w.id === id ? { ...w, ...updates, updatedAt: nowIso } : w
    );

    setWarehouses(updatedWh);
    pushCloudSyncImmediately(
      cur.items,
      cur.transactions,
      updatedWh,
      cur.users,
      cur.deletedRegistry,
      'update-warehouse'
    );
    return { success: true };
  };

  const deleteWarehouse = (id: string): { success: boolean; error?: string } => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền xóa kho hàng.' };
    }

    const cur = stateRef.current;
    if (cur.warehouses.length <= 1) {
      return { success: false, error: 'Hệ thống cần duy trì ít nhất 1 kho hàng hoạt động.' };
    }

    const itemsCount = cur.items.filter(
      i => i.warehouseId === id || (i.warehouseStocks?.[id] || 0) > 0
    ).length;
    if (itemsCount > 0) {
      return {
        success: false,
        error: `Không thể xóa kho này vì đang có ${itemsCount} mặt hàng tồn kho lưu trữ tại đây. Vui lòng điều chuyển các mặt hàng sang kho khác trước khi xóa.`,
      };
    }

    const trxCount = cur.transactions.filter(t => t.warehouseId === id).length;
    if (trxCount > 0) {
      return {
        success: false,
        error: `Không thể xóa kho này vì có ${trxCount} chứng từ nhập/xuất kho đã lưu vết lịch sử tại kho này.`,
      };
    }

    const targetWh = cur.warehouses.find(w => w.id === id);
    const updatedWh = cur.warehouses.filter(w => w.id !== id);
    const nowIso = nextMonotonicIso(targetWh?.updatedAt);
    const nextReg = { ...cur.deletedRegistry };
    nextReg[makeTombstoneKey('WH', id)] = nowIso;
    if (targetWh?.code) {
      nextReg[makeTombstoneKey('WH', targetWh.code)] = nowIso;
    }
    const legacy = extractLegacyDeletedArrays(nextReg);

    setWarehouses(updatedWh);
    setDeletedRegistry(nextReg);
    setDeletedWarehouseIds(legacy.deletedWarehouseIds);

    pushCloudSyncImmediately(
      cur.items,
      cur.transactions,
      updatedWh,
      cur.users,
      nextReg,
      'delete-warehouse'
    );
    return { success: true };
  };

  // Material Category Management (Danh mục vật tư)
  const addMaterialCategory = (data: {
    code: string;
    name: string;
    description?: string;
  }): { success: boolean; error?: string; category?: MaterialCategory } => {
    if (!currentUser) {
      return { success: false, error: 'Vui lòng đăng nhập để thêm danh mục vật tư.' };
    }

    const cur = stateRef.current;
    const trimmedCode = (data.code || '').trim().toUpperCase();
    const trimmedName = (data.name || '').trim();
    const trimmedDesc = (data.description || '').trim();

    if (!trimmedCode) {
      return { success: false, error: 'Vui lòng nhập Mã danh mục vật tư (VD: DM-CD).' };
    }
    if (!trimmedName) {
      return { success: false, error: 'Vui lòng nhập Tên danh mục vật tư.' };
    }
    if (cur.materialCategories.some(c => c.code.trim().toUpperCase() === trimmedCode)) {
      return {
        success: false,
        error: `Mã danh mục "${trimmedCode}" đã tồn tại. Vui lòng chọn mã danh mục khác.`,
      };
    }
    if (cur.materialCategories.some(c => c.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
      return {
        success: false,
        error: `Tên danh mục "${trimmedName}" đã tồn tại trong hệ thống.`,
      };
    }

    const autoSlug = toCategoryAsciiSlug(trimmedName);
    const nowIso = nextMonotonicIso(
      cur.deletedRegistry[makeTombstoneKey('CAT', trimmedCode)],
      autoSlug ? cur.deletedRegistry[makeTombstoneKey('CAT', `CAT-AUTO-${autoSlug}`)] : undefined,
      cur.materialCategories.map(c => c.updatedAt)
    );

    const newCategory: MaterialCategory = {
      id: `CAT-${Date.now()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`,
      code: trimmedCode,
      name: trimmedName,
      description: trimmedDesc || undefined,
      createdAt: nowIso.replace('T', ' ').substring(0, 16),
      updatedAt: nowIso,
    };

    const nextReg = { ...cur.deletedRegistry };
    delete nextReg[makeTombstoneKey('CAT', newCategory.id)];
    delete nextReg[makeTombstoneKey('CAT', trimmedCode)];
    if (autoSlug) {
      delete nextReg[makeTombstoneKey('CAT', `CAT-AUTO-${autoSlug}`)];
    }
    const legacy = extractLegacyDeletedArrays(nextReg);

    // Tự động liên kết các mặt hàng trùng tên danh mục hoặc mã danh mục nếu có
    const updatedItems = cur.items.map(it => {
      if (
        (it.category || '').trim().toLowerCase() === trimmedName.toLowerCase() ||
        (it.categoryCode && it.categoryCode.trim().toUpperCase() === trimmedCode)
      ) {
        return {
          ...it,
          categoryId: newCategory.id,
          categoryCode: newCategory.code,
          category: newCategory.name,
          metadataUpdatedAt: nowIso,
          updatedAt: nowIso,
        };
      }
      return it;
    });

    const updatedCategories = [...cur.materialCategories, newCategory].sort((a, b) =>
      a.code.localeCompare(b.code, 'vi')
    );

    setMaterialCategories(updatedCategories);
    setItems(updatedItems);
    setDeletedRegistry(nextReg);
    setDeletedCategoryIds(legacy.deletedCategoryIds);

    pushCloudSyncImmediately(
      updatedItems,
      cur.transactions,
      cur.warehouses,
      cur.users,
      nextReg,
      'add-category',
      undefined,
      updatedCategories
    );

    return { success: true, category: newCategory };
  };

  const updateMaterialCategory = (
    id: string,
    updates: { code?: string; name?: string; description?: string }
  ): { success: boolean; error?: string; category?: MaterialCategory } => {
    if (!currentUser) {
      return { success: false, error: 'Vui lòng đăng nhập để chỉnh sửa danh mục vật tư.' };
    }

    const cur = stateRef.current;
    const targetCat = cur.materialCategories.find(c => c.id === id);
    if (!targetCat) {
      return { success: false, error: 'Không tìm thấy danh mục vật tư cần chỉnh sửa.' };
    }

    const nextCode = updates.code !== undefined ? updates.code.trim().toUpperCase() : targetCat.code;
    const nextName = updates.name !== undefined ? updates.name.trim() : targetCat.name;
    const nextDesc =
      updates.description !== undefined ? updates.description.trim() : targetCat.description || '';

    if (!nextCode) {
      return { success: false, error: 'Mã danh mục không được để trống.' };
    }
    if (!nextName) {
      return { success: false, error: 'Tên danh mục không được để trống.' };
    }
    if (cur.materialCategories.some(c => c.id !== id && c.code.trim().toUpperCase() === nextCode)) {
      return {
        success: false,
        error: `Mã danh mục "${nextCode}" đã được sử dụng cho một danh mục khác.`,
      };
    }
    if (
      cur.materialCategories.some(
        c => c.id !== id && c.name.trim().toLowerCase() === nextName.toLowerCase()
      )
    ) {
      return {
        success: false,
        error: `Tên danh mục "${nextName}" đã tồn tại trong hệ thống.`,
      };
    }

    const nowIso = nextMonotonicIso(
      targetCat.updatedAt,
      cur.items.map(i => i.updatedAt),
      cur.items.map(i => i.metadataUpdatedAt),
      Object.values(cur.deletedRegistry)
    );

    const updatedCategory: MaterialCategory = {
      ...targetCat,
      code: nextCode,
      name: nextName,
      description: nextDesc || undefined,
      updatedAt: nowIso,
    };

    const nextReg = { ...cur.deletedRegistry };
    delete nextReg[makeTombstoneKey('CAT', id)];
    delete nextReg[makeTombstoneKey('CAT', nextCode)];
    const legacy = extractLegacyDeletedArrays(nextReg);

    const updatedCategories = cur.materialCategories
      .map(c => (c.id === id ? updatedCategory : c))
      .sort((a, b) => a.code.localeCompare(b.code, 'vi'));

    // Cập nhật đồng loạt mã danh mục và tên danh mục cho toàn bộ vật tư đang liên kết
    const oldNameLower = targetCat.name.trim().toLowerCase();
    const oldCodeUpper = targetCat.code.trim().toUpperCase();
    const updatedItems = cur.items.map(it => {
      const isLinked =
        it.categoryId === id ||
        (!it.categoryId && it.categoryCode && it.categoryCode.trim().toUpperCase() === oldCodeUpper) ||
        (!it.categoryId && (it.category || '').trim().toLowerCase() === oldNameLower);
      if (isLinked) {
        return {
          ...it,
          categoryId: id,
          categoryCode: nextCode,
          category: nextName,
          metadataUpdatedAt: nowIso,
          updatedAt: nowIso,
        };
      }
      return it;
    });

    if (targetCat.name !== nextName) {
      setFilterCriteria(prev => ({
        ...prev,
        categories: prev.categories.map(c => (c === targetCat.name ? nextName : c)),
      }));
    }

    setMaterialCategories(updatedCategories);
    setItems(updatedItems);
    setDeletedRegistry(nextReg);
    setDeletedCategoryIds(legacy.deletedCategoryIds);

    pushCloudSyncImmediately(
      updatedItems,
      cur.transactions,
      cur.warehouses,
      cur.users,
      nextReg,
      'update-category',
      undefined,
      updatedCategories
    );

    return { success: true, category: updatedCategory };
  };

  const deleteMaterialCategory = (
    id: string,
    reassignToCategoryId?: string
  ): { success: boolean; error?: string } => {
    if (!currentUser) {
      return { success: false, error: 'Vui lòng đăng nhập để xóa danh mục vật tư.' };
    }

    const cur = stateRef.current;
    const targetCat = cur.materialCategories.find(c => c.id === id);
    if (!targetCat) {
      return { success: false, error: 'Danh mục vật tư không tồn tại hoặc đã bị xóa.' };
    }

    const reassignCat = reassignToCategoryId
      ? cur.materialCategories.find(c => c.id === reassignToCategoryId && c.id !== id)
      : undefined;

    const nowIso = nextMonotonicIso(
      targetCat.updatedAt,
      cur.items.map(i => i.updatedAt),
      cur.items.map(i => i.metadataUpdatedAt),
      Object.values(cur.deletedRegistry)
    );

    const nextReg = { ...cur.deletedRegistry };
    nextReg[makeTombstoneKey('CAT', id)] = nowIso;
    if (targetCat.code) {
      nextReg[makeTombstoneKey('CAT', targetCat.code)] = nowIso;
    }
    const autoSlug = toCategoryAsciiSlug(targetCat.name);
    if (autoSlug) {
      nextReg[makeTombstoneKey('CAT', `CAT-AUTO-${autoSlug}`)] = nowIso;
    }
    const legacy = extractLegacyDeletedArrays(nextReg);

    const updatedCategories = cur.materialCategories.filter(c => c.id !== id);
    const oldNameLower = targetCat.name.trim().toLowerCase();
    const oldCodeUpper = targetCat.code.trim().toUpperCase();

    const updatedItems = cur.items.map(it => {
      const isLinked =
        it.categoryId === id ||
        (it.categoryCode && it.categoryCode.trim().toUpperCase() === oldCodeUpper) ||
        (it.category || '').trim().toLowerCase() === oldNameLower;

      if (isLinked) {
        if (reassignCat) {
          return {
            ...it,
            categoryId: reassignCat.id,
            categoryCode: reassignCat.code,
            category: reassignCat.name,
            metadataUpdatedAt: nowIso,
            updatedAt: nowIso,
          };
        }
        return {
          ...it,
          categoryId: undefined,
          categoryCode: undefined,
          category: 'Chưa phân loại',
          metadataUpdatedAt: nowIso,
          updatedAt: nowIso,
        };
      }
      return it;
    });

    setFilterCriteria(prev => ({
      ...prev,
      categories: prev.categories
        .filter(c => c !== targetCat.name)
        .concat(
          prev.categories.includes(targetCat.name) && reassignCat && !prev.categories.includes(reassignCat.name)
            ? [reassignCat.name]
            : []
        ),
    }));

    setMaterialCategories(updatedCategories);
    setItems(updatedItems);
    setDeletedRegistry(nextReg);
    setDeletedCategoryIds(legacy.deletedCategoryIds);

    pushCloudSyncImmediately(
      updatedItems,
      cur.transactions,
      cur.warehouses,
      cur.users,
      nextReg,
      'delete-category',
      undefined,
      updatedCategories
    );

    return { success: true };
  };

  const linkItemsToCategoryBatch = (
    categoryId: string,
    selectedItemIds: string[]
  ): { linkedCount: number; unlinkedCount: number } => {
    const cur = stateRef.current;
    const targetCat = cur.materialCategories.find(c => c.id === categoryId);
    if (!targetCat) {
      return { linkedCount: 0, unlinkedCount: 0 };
    }

    const selectedSet = new Set(selectedItemIds);
    const catCodeUpper = targetCat.code.trim().toUpperCase();
    const catNameLower = targetCat.name.trim().toLowerCase();
    const nowIso = nextMonotonicIso(
      targetCat.updatedAt,
      cur.items.map(i => i.updatedAt),
      cur.items.map(i => i.metadataUpdatedAt),
      Object.values(cur.deletedRegistry)
    );

    let linkedCount = 0;
    let unlinkedCount = 0;

    const updatedItems = cur.items.map(item => {
      const wasLinked =
        item.categoryId === targetCat.id ||
        (!item.categoryId &&
          item.categoryCode &&
          item.categoryCode.trim().toUpperCase() === catCodeUpper) ||
        (!item.categoryId && (item.category || '').trim().toLowerCase() === catNameLower);
      const shouldBeLinked = selectedSet.has(item.id);

      if (!wasLinked && shouldBeLinked) {
        linkedCount += 1;
        return {
          ...item,
          categoryId: targetCat.id,
          categoryCode: targetCat.code,
          category: targetCat.name,
          metadataUpdatedAt: nowIso,
          updatedAt: nowIso,
        };
      }
      if (wasLinked && !shouldBeLinked) {
        unlinkedCount += 1;
        return {
          ...item,
          categoryId: undefined,
          categoryCode: undefined,
          category: 'Chưa phân loại',
          metadataUpdatedAt: nowIso,
          updatedAt: nowIso,
        };
      }
      return item;
    });

    if (linkedCount > 0 || unlinkedCount > 0) {
      setItems(updatedItems);
      pushCloudSyncImmediately(
        updatedItems,
        cur.transactions,
        cur.warehouses,
        cur.users,
        cur.deletedRegistry,
        'link-category-items-batch',
        undefined,
        cur.materialCategories
      );
    }

    return { linkedCount, unlinkedCount };
  };

  // Derived lists
  const categories = useMemo(() => {
    const set = new Set<string>();
    materialCategories.forEach(c => {
      if (c.name) set.add(c.name);
    });
    items.forEach(i => {
      if (i.category) set.add(i.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [materialCategories, items]);

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

  const filteredItems = useMemo(() => {
    const today = new Date();
    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(today.getDate() + 30);

    return items.filter(item => {
      if (filterCriteria.searchQuery.trim()) {
        const q = filterCriteria.searchQuery.toLowerCase().trim();
        const matchCode = item.code.toLowerCase().includes(q);
        const matchName = item.name.toLowerCase().includes(q);
        const matchSerial = (item.serialOrLot || '').toLowerCase().includes(q);
        const matchSpec = (item.spec || '').toLowerCase().includes(q);
        const matchSupplier = (item.supplierDefault || '').toLowerCase().includes(q);
        const matchCatCode = (item.categoryCode || '').toLowerCase().includes(q);
        const matchCatName = (item.category || '').toLowerCase().includes(q);
        if (
          !matchCode &&
          !matchName &&
          !matchSerial &&
          !matchSpec &&
          !matchSupplier &&
          !matchCatCode &&
          !matchCatName
        ) {
          return false;
        }
      }

      if (filterCriteria.warehouses.length > 0) {
        const itemWh = item.warehouseId || '';
        const inPrimary = Boolean(itemWh && filterCriteria.warehouses.includes(itemWh));
        const inStocks = item.warehouseStocks
          ? filterCriteria.warehouses.some(wId => (item.warehouseStocks?.[wId] || 0) > 0)
          : false;
        if (!inPrimary && !inStocks) {
          return false;
        }
      }

      if (filterCriteria.itemTypes.length > 0 && !filterCriteria.itemTypes.includes(item.type)) {
        return false;
      }

      if (
        filterCriteria.categories.length > 0 &&
        !filterCriteria.categories.includes(item.category || 'Chưa phân loại')
      ) {
        return false;
      }

      if (filterCriteria.stockStatuses.length > 0) {
        const status: StockStatus = getStockStatus(item);
        if (!filterCriteria.stockStatuses.includes(status)) {
          return false;
        }
      }

      if (filterCriteria.equipmentConditions.length > 0) {
        if (!item.condition || !filterCriteria.equipmentConditions.includes(item.condition)) {
          return false;
        }
      }

      if (filterCriteria.minStockQty !== undefined && item.currentStock < filterCriteria.minStockQty) {
        return false;
      }
      if (filterCriteria.maxStockQty !== undefined && item.currentStock > filterCriteria.maxStockQty) {
        return false;
      }

      const totalVal = item.currentStock * item.unitPrice;
      if (filterCriteria.minValue !== undefined && totalVal < filterCriteria.minValue) {
        return false;
      }
      if (filterCriteria.maxValue !== undefined && totalVal > filterCriteria.maxValue) {
        return false;
      }

      if (filterCriteria.supplier && item.supplierDefault !== filterCriteria.supplier) {
        return false;
      }

      if (filterCriteria.needsInspection) {
        if (!item.inspectionDueDate) return false;
        const due = new Date(item.inspectionDueDate);
        if (due > thirtyDaysLater) return false;
      }

      return true;
    });
  }, [items, filterCriteria]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
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

      if (filterCriteria.warehouses.length > 0 && !filterCriteria.warehouses.includes(t.warehouseId)) {
        return false;
      }

      if (filterCriteria.supplier && t.partnerName !== filterCriteria.supplier) {
        return false;
      }

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
    const cur = stateRef.current;
    const cleanCode = itemData.code.trim().toUpperCase();
    const existingIdx = cur.items.findIndex(it => it.code.trim().toUpperCase() === cleanCode);
    const existingMatch = existingIdx !== -1 ? cur.items[existingIdx] : undefined;
    const nowIso = nextMonotonicIso(
      existingMatch?.updatedAt,
      existingMatch?.metadataUpdatedAt,
      cur.deletedRegistry[makeTombstoneKey('ITEM', cleanCode)]
    );
    const targetWhId = itemData.warehouseId || cur.warehouses[0]?.id || 'WH-01';
    const newId = `ITEM-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const workingCategories = [...cur.materialCategories];
    const nextReg = { ...cur.deletedRegistry };
    const catLink = resolveOrEnsureCategoryLink(
      itemData.categoryId,
      itemData.categoryCode,
      itemData.category,
      workingCategories,
      nextReg,
      nowIso
    );

    const net = computeNetMovementsForItem(newId, cleanCode, cur.transactions);
    const desiredStock = Math.max(0, Number(itemData.currentStock) || 0);
    const openingForWh = desiredStock - (net.byWarehouse[targetWhId] || 0);

    let rawItems: InventoryItem[];

    if (existingIdx !== -1) {
      const existing = cur.items[existingIdx];
      const nextOpeningWh = {
        ...(existing.openingWarehouseStocks || {}),
        [targetWhId]: openingForWh,
      };
      rawItems = cur.items.map((it, idx) =>
        idx === existingIdx
          ? {
              ...existing,
              ...itemData,
              ...catLink,
              code: cleanCode,
              warehouseId: targetWhId,
              openingStock: Object.values(nextOpeningWh).reduce((s, v) => s + v, 0),
              openingWarehouseStocks: nextOpeningWh,
              updatedAt: nowIso,
              metadataUpdatedAt: nowIso,
            }
          : it
      );
    } else {
      const newItem: InventoryItem = {
        ...itemData,
        ...catLink,
        id: newId,
        code: cleanCode,
        warehouseId: targetWhId,
        openingStock: openingForWh,
        openingWarehouseStocks: { [targetWhId]: openingForWh },
        currentStock: desiredStock,
        updatedAt: nowIso,
        metadataUpdatedAt: nowIso,
      };
      rawItems = [newItem, ...cur.items];
    }

    const newItems = recalculateAllItemsStocks(rawItems, cur.warehouses, cur.transactions);

    delete nextReg[makeTombstoneKey('ITEM', newId)];
    delete nextReg[makeTombstoneKey('ITEM', cleanCode)];
    const legacy = extractLegacyDeletedArrays(nextReg);

    setMaterialCategories(workingCategories);
    setItems(newItems);
    setDeletedRegistry(nextReg);
    setDeletedItemIds(legacy.deletedItemIds);
    setDeletedCategoryIds(legacy.deletedCategoryIds);

    pushCloudSyncImmediately(
      newItems,
      cur.transactions,
      cur.warehouses,
      cur.users,
      nextReg,
      'add-item',
      undefined,
      workingCategories
    );
  };

  const updateItem = (id: string, updates: Partial<InventoryItem>) => {
    const cur = stateRef.current;
    let originalCode = '';
    const targetExisting = cur.items.find(i => i.id === id);
    const nowIso = nextMonotonicIso(
      targetExisting?.updatedAt,
      targetExisting?.metadataUpdatedAt,
      cur.transactions.map(t => t.updatedAt)
    );

    const workingCategories = [...cur.materialCategories];
    const nextReg = { ...cur.deletedRegistry };

    const rawUpdatedItems = cur.items.map(item => {
      if (item.id === id) {
        originalCode = item.code;
        const cleanCode = (updates.code || item.code).trim().toUpperCase();
        const targetWhId = updates.warehouseId || item.warehouseId || cur.warehouses[0]?.id || 'WH-01';

        const hasCategoryChange =
          'categoryId' in updates || 'categoryCode' in updates || 'category' in updates;
        const catLink = hasCategoryChange
          ? resolveOrEnsureCategoryLink(
              updates.categoryId,
              updates.categoryCode,
              updates.category ?? item.category,
              workingCategories,
              nextReg,
              nowIso
            )
          : {
              categoryId: item.categoryId,
              categoryCode: item.categoryCode,
              category: item.category,
            };

        let nextOpeningWh = item.openingWarehouseStocks
          ? { ...item.openingWarehouseStocks }
          : undefined;
        let nextOpeningStock = item.openingStock;

        // Chỉ hiệu chỉnh lại tồn đầu kỳ nếu người dùng thực sự thay đổi ô "Số lượng tồn hiện tại"
        if (updates.currentStock !== undefined && updates.currentStock !== item.currentStock) {
          const currentWhStocks = calculateItemWarehouseStocks(item, cur.warehouses, cur.transactions);
          const otherWhTotal = Object.entries(currentWhStocks).reduce(
            (sum, [wId, q]) => (wId === targetWhId ? sum : sum + (Number(q) || 0)),
            0
          );
          const desiredInTargetWh = Math.max(0, Number(updates.currentStock) - otherWhTotal);
          const net = computeNetMovementsForItem(id, cleanCode, cur.transactions);

          nextOpeningWh = {};
          cur.warehouses.forEach(w => {
            if (w.id === targetWhId) {
              nextOpeningWh![w.id] = desiredInTargetWh - (net.byWarehouse[w.id] || 0);
            } else if (item.openingWarehouseStocks && item.openingWarehouseStocks[w.id] !== undefined) {
              nextOpeningWh![w.id] = item.openingWarehouseStocks[w.id];
            } else {
              nextOpeningWh![w.id] = (currentWhStocks[w.id] || 0) - (net.byWarehouse[w.id] || 0);
            }
          });
          nextOpeningStock = Object.values(nextOpeningWh).reduce((s, v) => s + v, 0);
        }

        return {
          ...item,
          ...updates,
          ...catLink,
          code: cleanCode,
          warehouseId: targetWhId,
          openingStock: nextOpeningStock,
          openingWarehouseStocks: nextOpeningWh,
          updatedAt: nowIso,
          metadataUpdatedAt: nowIso,
        };
      }
      return item;
    });

    // Đồng bộ tên vật tư / mã SKU / ĐVT vào toàn bộ các phiếu Nhập & Xuất liên quan
    let updatedTransactions = cur.transactions;
    if (updates.name || updates.code || updates.unit) {
      const cleanNewCode = updates.code ? updates.code.trim().toUpperCase() : undefined;
      updatedTransactions = cur.transactions.map(trx => {
        let hasModified = false;
        const updatedLineItems = trx.items.map(line => {
          const isTarget =
            line.itemId === id ||
            (originalCode && line.itemCode.trim().toLowerCase() === originalCode.trim().toLowerCase()) ||
            (cleanNewCode && line.itemCode.trim().toLowerCase() === cleanNewCode.toLowerCase());

          if (isTarget) {
            hasModified = true;
            return {
              ...line,
              ...(updates.name ? { itemName: updates.name } : {}),
              ...(cleanNewCode ? { itemCode: cleanNewCode } : {}),
              ...(updates.unit ? { unit: updates.unit } : {}),
            };
          }
          return line;
        });

        return hasModified ? { ...trx, items: updatedLineItems, updatedAt: nowIso } : trx;
      });
      setTransactions(updatedTransactions);
    }

    const updatedItems = recalculateAllItemsStocks(
      rawUpdatedItems,
      cur.warehouses,
      updatedTransactions
    );
    const legacy = extractLegacyDeletedArrays(nextReg);

    setMaterialCategories(workingCategories);
    setItems(updatedItems);
    setDeletedRegistry(nextReg);
    setDeletedCategoryIds(legacy.deletedCategoryIds);

    pushCloudSyncImmediately(
      updatedItems,
      updatedTransactions,
      cur.warehouses,
      cur.users,
      nextReg,
      'update-item',
      undefined,
      workingCategories
    );
  };

  const deleteItem = (id: string) => {
    const cur = stateRef.current;
    const targetItem = cur.items.find(i => i.id === id);
    const newItems = cur.items.filter(i => i.id !== id);
    const nowIso = nextMonotonicIso(
      targetItem?.updatedAt,
      targetItem?.metadataUpdatedAt,
      cur.transactions.map(t => t.updatedAt)
    );

    const nextReg = { ...cur.deletedRegistry };
    nextReg[makeTombstoneKey('ITEM', id)] = nowIso;
    if (targetItem?.code) {
      nextReg[makeTombstoneKey('ITEM', targetItem.code)] = nowIso;
    }
    const legacy = extractLegacyDeletedArrays(nextReg);

    setItems(newItems);
    setDeletedRegistry(nextReg);
    setDeletedItemIds(legacy.deletedItemIds);

    pushCloudSyncImmediately(
      newItems,
      cur.transactions,
      cur.warehouses,
      cur.users,
      nextReg,
      'delete-item'
    );
  };

  const deleteItemsBatch = (ids: string[]) => {
    const cur = stateRef.current;
    const idSet = new Set(ids);
    const targetItems = cur.items.filter(i => idSet.has(i.id));
    const newItems = cur.items.filter(i => !idSet.has(i.id));
    const nowIso = nextMonotonicIso(
      targetItems.map(i => i.updatedAt),
      targetItems.map(i => i.metadataUpdatedAt),
      cur.transactions.map(t => t.updatedAt)
    );

    const nextReg = { ...cur.deletedRegistry };
    ids.forEach(id => {
      nextReg[makeTombstoneKey('ITEM', id)] = nowIso;
    });
    targetItems.forEach(it => {
      if (it.code) {
        nextReg[makeTombstoneKey('ITEM', it.code)] = nowIso;
      }
    });
    const legacy = extractLegacyDeletedArrays(nextReg);

    setItems(newItems);
    setDeletedRegistry(nextReg);
    setDeletedItemIds(legacy.deletedItemIds);

    pushCloudSyncImmediately(
      newItems,
      cur.transactions,
      cur.warehouses,
      cur.users,
      nextReg,
      'delete-items-batch'
    );
    return { success: true, count: ids.length };
  };

  // Batch Import Items / Materials Catalog — O(N + M + T_lines) indexed implementation for 5,000-50,000+ rows
  const importItemsBatch = (
    itemsList: Omit<InventoryItem, 'id' | 'updatedAt'>[],
    updateExisting: boolean = true
  ): { success: boolean; addedCount: number; updatedCount: number; errors: string[] } => {
    const cur = stateRef.current;
    let addedCount = 0;
    let updatedCount = 0;
    const errors: string[] = [];

    const workingCategories = [...cur.materialCategories];
    const catCache = buildCategoryLookupCache(workingCategories);
    const workingItems = [...cur.items];
    let workingTransactions = cur.transactions;
    const nextReg = { ...cur.deletedRegistry };
    const nowIso = nextMonotonicIso(
      cur.items.map(i => i.updatedAt),
      cur.items.map(i => i.metadataUpdatedAt),
      cur.transactions.map(t => t.updatedAt),
      Object.values(cur.deletedRegistry)
    );

    // Pre-compute warehouse stocks for all existing items in ONE O(N + T_lines) pass
    const precomputedWhStocks = calculateAllItemsWarehouseStocks(
      workingItems,
      cur.warehouses,
      workingTransactions
    );

    // Pre-compute net movements by itemId and uppercase itemCode in ONE O(T_lines) pass
    const netByItemId = new Map<string, Record<string, number>>();
    const netByItemCode = new Map<string, Record<string, number>>();
    for (let t = 0; t < workingTransactions.length; t++) {
      const trx = workingTransactions[t];
      if (!trx || trx.status === 'DA_HUY') continue;
      const whId = trx.warehouseId || 'WH-01';
      const isReceipt = trx.type === 'NHAP_KHO';
      const lines = trx.items || [];
      for (let l = 0; l < lines.length; l++) {
        const line = lines[l];
        if (!line) continue;
        const qty = Number(line.quantity) || 0;
        const delta = isReceipt ? qty : -qty;
        if (line.itemId) {
          let mapObj = netByItemId.get(line.itemId);
          if (!mapObj) {
            mapObj = {};
            netByItemId.set(line.itemId, mapObj);
          }
          mapObj[whId] = (mapObj[whId] || 0) + delta;
        }
        const normLineCode = line.itemCode ? line.itemCode.trim().toUpperCase() : '';
        if (normLineCode) {
          let mapObj = netByItemCode.get(normLineCode);
          if (!mapObj) {
            mapObj = {};
            netByItemCode.set(normLineCode, mapObj);
          }
          mapObj[whId] = (mapObj[whId] || 0) + delta;
        }
      }
    }

    // Index existing items by uppercase SKU code in O(N)
    const existingCodeToIdx = new Map<string, number>();
    for (let i = 0; i < workingItems.length; i++) {
      const c = workingItems[i].code.trim().toUpperCase();
      if (c && !existingCodeToIdx.has(c)) {
        existingCodeToIdx.set(c, i);
      }
    }

    const addedItems: InventoryItem[] = [];
    const addedCodeToIdx = new Map<string, number>();
    const renamedById = new Map<string, { name?: string; unit?: string }>();
    const renamedByCode = new Map<string, { name?: string; unit?: string }>();
    const batchTs = Date.now();

    for (let i = 0; i < itemsList.length; i++) {
      const row = itemsList[i];
      if (!row.code || !row.name) {
        errors.push(`Dòng ${i + 1}: Thiếu mã SKU hoặc tên vật tư.`);
        continue;
      }

      const cleanCode = row.code.trim().toUpperCase();
      const targetWhId = row.warehouseId || cur.warehouses[0]?.id || 'WH-01';
      const existingIdx = existingCodeToIdx.get(cleanCode);

      delete nextReg[makeTombstoneKey('ITEM', cleanCode)];

      const catLink = resolveOrEnsureCategoryLink(
        row.categoryId,
        row.categoryCode,
        row.category,
        workingCategories,
        nextReg,
        nowIso,
        catCache
      );

      if (existingIdx !== undefined) {
        if (updateExisting) {
          const oldItem = workingItems[existingIdx];
          delete nextReg[makeTombstoneKey('ITEM', oldItem.id)];

          let nextOpeningWh = oldItem.openingWarehouseStocks
            ? { ...oldItem.openingWarehouseStocks }
            : undefined;
          let nextOpeningStock = oldItem.openingStock;

          if (row.currentStock !== undefined && row.currentStock !== oldItem.currentStock) {
            const currentWhStocks = precomputedWhStocks[existingIdx] || {};
            let otherWhTotal = 0;
            const entries = Object.entries(currentWhStocks);
            for (let e = 0; e < entries.length; e++) {
              const [wId, q] = entries[e];
              if (wId !== targetWhId) otherWhTotal += Number(q) || 0;
            }
            const desiredInTargetWh = Math.max(0, Number(row.currentStock) - otherWhTotal);
            const netByWh = netByItemId.get(oldItem.id) || netByItemCode.get(cleanCode) || {};

            nextOpeningWh = {};
            for (let w = 0; w < cur.warehouses.length; w++) {
              const whId = cur.warehouses[w].id;
              if (whId === targetWhId) {
                nextOpeningWh[whId] = desiredInTargetWh - (netByWh[whId] || 0);
              } else if (
                oldItem.openingWarehouseStocks &&
                oldItem.openingWarehouseStocks[whId] !== undefined
              ) {
                nextOpeningWh[whId] = oldItem.openingWarehouseStocks[whId];
              } else {
                nextOpeningWh[whId] = (currentWhStocks[whId] || 0) - (netByWh[whId] || 0);
              }
            }
            nextOpeningStock = Object.values(nextOpeningWh).reduce((s, v) => s + v, 0);
          }

          workingItems[existingIdx] = {
            ...oldItem,
            ...row,
            ...catLink,
            code: cleanCode,
            warehouseId: targetWhId,
            openingStock: nextOpeningStock,
            openingWarehouseStocks: nextOpeningWh,
            updatedAt: nowIso,
            metadataUpdatedAt: nowIso,
          };
          updatedCount++;

          if (
            (row.name && row.name !== oldItem.name) ||
            (row.unit && row.unit !== oldItem.unit)
          ) {
            const metaPatch = {
              ...(row.name ? { itemName: row.name } : {}),
              ...(row.unit ? { unit: row.unit } : {}),
            };
            renamedById.set(oldItem.id, { name: metaPatch.itemName, unit: metaPatch.unit });
            renamedByCode.set(cleanCode, { name: metaPatch.itemName, unit: metaPatch.unit });
          }
        }
      } else {
        const dupAddedIdx = addedCodeToIdx.get(cleanCode);
        const netByWh = netByItemCode.get(cleanCode) || {};
        const desiredStock = Math.max(0, Number(row.currentStock) || 0);
        const openingForWh = desiredStock - (netByWh[targetWhId] || 0);

        if (dupAddedIdx !== undefined) {
          if (updateExisting) {
            const prevAdded = addedItems[dupAddedIdx];
            addedItems[dupAddedIdx] = {
              ...prevAdded,
              ...row,
              ...catLink,
              code: cleanCode,
              warehouseId: targetWhId,
              openingStock: openingForWh,
              openingWarehouseStocks: { [targetWhId]: openingForWh },
              currentStock: desiredStock,
              updatedAt: nowIso,
              metadataUpdatedAt: nowIso,
            };
          }
        } else {
          const newId = `ITEM-${batchTs}-${i}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
          delete nextReg[makeTombstoneKey('ITEM', newId)];

          const newItem: InventoryItem = {
            ...row,
            ...catLink,
            id: newId,
            code: cleanCode,
            warehouseId: targetWhId,
            openingStock: openingForWh,
            openingWarehouseStocks: { [targetWhId]: openingForWh },
            currentStock: desiredStock,
            updatedAt: nowIso,
            metadataUpdatedAt: nowIso,
          };
          addedCodeToIdx.set(cleanCode, addedItems.length);
          addedItems.push(newItem);
          addedCount++;
        }
      }
    }

    if (addedCount > 0 || updatedCount > 0) {
      // Single O(T_lines) pass to sync renamed itemName / unit into transaction lines if any changed
      if (renamedById.size > 0 || renamedByCode.size > 0) {
        workingTransactions = workingTransactions.map(trx => {
          let hasMod = false;
          const updatedLines = trx.items.map(line => {
            const patch =
              (line.itemId ? renamedById.get(line.itemId) : undefined) ||
              (line.itemCode ? renamedByCode.get(line.itemCode.trim().toUpperCase()) : undefined);
            if (patch) {
              hasMod = true;
              return {
                ...line,
                ...(patch.name ? { itemName: patch.name } : {}),
                ...(patch.unit ? { unit: patch.unit } : {}),
              };
            }
            return line;
          });
          return hasMod ? { ...trx, items: updatedLines, updatedAt: nowIso } : trx;
        });
      }

      const combinedItems =
        addedItems.length > 0 ? [...addedItems, ...workingItems] : workingItems;
      const finalItems = recalculateAllItemsStocks(
        combinedItems,
        cur.warehouses,
        workingTransactions
      );
      const legacy = extractLegacyDeletedArrays(nextReg);

      setMaterialCategories(workingCategories);
      setItems(finalItems);
      if (workingTransactions !== cur.transactions) {
        setTransactions(workingTransactions);
      }
      setDeletedRegistry(nextReg);
      setDeletedItemIds(legacy.deletedItemIds);
      setDeletedCategoryIds(legacy.deletedCategoryIds);

      pushCloudSyncImmediately(
        finalItems,
        workingTransactions,
        cur.warehouses,
        cur.users,
        nextReg,
        'import-items-batch',
        undefined,
        workingCategories
      );
    }

    return {
      success: addedCount > 0 || updatedCount > 0,
      addedCount,
      updatedCount,
      errors,
    };
  };

  const generateUniqueTransactionCode = (
    type: TransactionType,
    currentTrx: Transaction[]
  ): string => {
    const prefix = type === 'NHAP_KHO' ? 'PN' : 'PX';
    const year = new Date().getFullYear();
    const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`, 'i');

    let maxNum = 0;
    currentTrx.forEach(t => {
      const m = (t.code || '').trim().match(pattern);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });

    return `${prefix}-${year}-${String(maxNum + 1).padStart(4, '0')}`;
  };

  // Create Transaction (NHAP / XUAT)
  const createTransaction = (data: Omit<Transaction, 'id' | 'code'> & { code?: string }) => {
    const cur = stateRef.current;

    if (data.type === 'XUAT_KHO') {
      for (const line of data.items) {
        const currentItem = cur.items.find(
          i =>
            (line.itemId && i.id === line.itemId) ||
            (line.itemCode && i.code && i.code.trim().toUpperCase() === line.itemCode.trim().toUpperCase())
        );
        if (!currentItem) {
          return {
            success: false,
            error: `Không tìm thấy vật tư mã "${line.itemCode || line.itemName}".`,
          };
        }
        if (currentItem.currentStock < line.quantity) {
          return {
            success: false,
            error: `Số lượng xuất của "${currentItem.name}" (${line.quantity} ${currentItem.unit}) vượt quá số lượng tồn kho khả dụng (${currentItem.currentStock} ${currentItem.unit})!`,
          };
        }
      }
    }

    let code = data.code && data.code.trim() ? data.code.trim().toUpperCase() : '';
    if (!code) {
      code = generateUniqueTransactionCode(data.type, cur.transactions);
    }

    const nowIso = nextMonotonicIso(
      cur.items.map(i => i.updatedAt),
      cur.items.map(i => i.metadataUpdatedAt),
      cur.transactions.map(t => t.updatedAt),
      Object.values(cur.deletedRegistry)
    );
    const workingCategories = [...cur.materialCategories];
    let workingItems = [...cur.items];
    const nextReg = { ...cur.deletedRegistry };
    const resolvedLines: TransactionLineItem[] = [];

    for (const line of data.items) {
      const lineCopy: TransactionLineItem = { ...line };
      const idx = workingItems.findIndex(
        i =>
          (lineCopy.itemId && i.id === lineCopy.itemId) ||
          (lineCopy.itemCode && i.code && i.code.trim().toUpperCase() === lineCopy.itemCode.trim().toUpperCase())
      );

      if (idx !== -1) {
        const item = workingItems[idx];
        let condition = item.condition;
        if (item.type === 'THIET_BI' || item.type === 'CONG_CU') {
          if (data.type === 'XUAT_KHO' && data.subtype === 'XUAT_CHO_MUON') {
            condition = 'DANG_MUON';
          } else if (data.type === 'NHAP_KHO' && data.subtype === 'NHAP_TRA_SAU_MUON') {
            condition = 'SAN_SANG';
          }
        }

        const unitPrice =
          data.type === 'NHAP_KHO' && lineCopy.unitPrice > 0 ? lineCopy.unitPrice : item.unitPrice;

        workingItems[idx] = {
          ...item,
          unitPrice,
          condition,
          supplierDefault:
            item.supplierDefault ||
            (data.type === 'NHAP_KHO' && data.partnerName ? data.partnerName : item.supplierDefault),
          updatedAt: nowIso,
        };
        lineCopy.itemId = item.id;
        lineCopy.itemCode = item.code;
        lineCopy.itemName = item.name;
        lineCopy.unit = item.unit;
        lineCopy.categoryId = item.categoryId;
        lineCopy.categoryCode = item.categoryCode;
        lineCopy.category = item.category;
      } else if (data.type === 'NHAP_KHO') {
        const newItemId = `ITEM-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const cleanCode = (lineCopy.itemCode || `VT-${Date.now().toString().slice(-4)}`)
          .trim()
          .toUpperCase();

        delete nextReg[makeTombstoneKey('ITEM', newItemId)];
        delete nextReg[makeTombstoneKey('ITEM', cleanCode)];

        const catLink = resolveOrEnsureCategoryLink(
          lineCopy.categoryId,
          lineCopy.categoryCode,
          lineCopy.category || 'Vật tư nhập mới',
          workingCategories,
          nextReg,
          nowIso
        );

        const newItem: InventoryItem = {
          id: newItemId,
          code: cleanCode,
          name: (lineCopy.itemName || 'Vật tư nhập mới').trim(),
          type: lineCopy.type || 'VAT_TU',
          ...catLink,
          unit: (lineCopy.unit || 'Cái').trim(),
          warehouseId: data.warehouseId,
          openingStock: 0,
          openingWarehouseStocks: { [data.warehouseId]: 0 },
          warehouseStocks: { [data.warehouseId]: Math.max(0, lineCopy.quantity) },
          location: (lineCopy.location || 'Khu vực tiếp nhận').trim(),
          minStock: lineCopy.minStock !== undefined && lineCopy.minStock >= 0 ? lineCopy.minStock : 5,
          maxStock: lineCopy.maxStock !== undefined && lineCopy.maxStock > 0 ? lineCopy.maxStock : 200,
          currentStock: Math.max(0, lineCopy.quantity),
          unitPrice: Math.max(0, lineCopy.unitPrice || 0),
          serialOrLot: (lineCopy.serialNumber || '').trim(),
          condition: lineCopy.condition || 'SAN_SANG',
          supplierDefault: data.partnerName.trim(),
          spec: (lineCopy.spec || '').trim(),
          updatedAt: nowIso,
          metadataUpdatedAt: nowIso,
        };
        workingItems = [newItem, ...workingItems];
        lineCopy.itemId = newItemId;
        lineCopy.itemCode = cleanCode;
        lineCopy.categoryId = catLink.categoryId;
        lineCopy.categoryCode = catLink.categoryCode;
        lineCopy.category = catLink.category;
        lineCopy.isNewItem = true;
      }
      resolvedLines.push(lineCopy);
    }

    const newTransaction: Transaction = {
      ...data,
      id: `TRX-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      code,
      items: resolvedLines,
      updatedAt: nowIso,
    };

    delete nextReg[makeTombstoneKey('TRX', newTransaction.id)];
    delete nextReg[makeTombstoneKey('TRX', newTransaction.code)];
    const legacy = extractLegacyDeletedArrays(nextReg);

    const newTransactionsList = [newTransaction, ...cur.transactions];
    const finalItems = recalculateAllItemsStocks(workingItems, cur.warehouses, newTransactionsList);

    setMaterialCategories(workingCategories);
    setItems(finalItems);
    setTransactions(newTransactionsList);
    setDeletedRegistry(nextReg);
    setDeletedItemIds(legacy.deletedItemIds);
    setDeletedTransactionIds(legacy.deletedTransactionIds);
    setDeletedCategoryIds(legacy.deletedCategoryIds);

    pushCloudSyncImmediately(
      finalItems,
      newTransactionsList,
      cur.warehouses,
      cur.users,
      nextReg,
      'create-transaction',
      undefined,
      workingCategories
    );

    return { success: true, transaction: newTransaction };
  };

  // Update Transaction
  const updateTransaction = (
    id: string,
    updates: Partial<Transaction>
  ): { success: boolean; error?: string } => {
    if (!currentUser || (currentUser.role !== 'ADMIN' && currentUser.role !== 'THU_KHO')) {
      return { success: false, error: 'Bạn không có quyền chỉnh sửa phiếu này.' };
    }

    const cur = stateRef.current;
    const existing = cur.transactions.find(t => t.id === id);
    if (!existing) {
      return { success: false, error: 'Không tìm thấy phiếu giao dịch.' };
    }

    const nowIso = nextMonotonicIso(
      existing.updatedAt,
      cur.items.map(i => i.updatedAt),
      cur.items.map(i => i.metadataUpdatedAt),
      Object.values(cur.deletedRegistry)
    );
    const targetWarehouseId = updates.warehouseId || existing.warehouseId;
    const targetType = updates.type || existing.type;
    const nextReg = { ...cur.deletedRegistry };

    const workingCategories = [...cur.materialCategories];
    let workingItems = [...cur.items];
    const resolvedLines: TransactionLineItem[] = (updates.items || existing.items).map(l => ({ ...l }));

    // Nếu là phiếu xuất đang hoạt động, kiểm tra tồn khả dụng (sau khi đã hoàn tác lượng xuất cũ của chính phiếu này)
    const targetStatus = updates.status || existing.status;
    if (targetType === 'XUAT_KHO' && targetStatus !== 'DA_HUY' && updates.items) {
      const trxWithoutExisting = cur.transactions.filter(t => t.id !== id);
      const tempItemsWithoutExisting = recalculateAllItemsStocks(
        workingItems,
        cur.warehouses,
        trxWithoutExisting
      );

      for (const line of resolvedLines) {
        const availableItem = tempItemsWithoutExisting.find(
          i =>
            (line.itemId && i.id === line.itemId) ||
            (line.itemCode && i.code.trim().toUpperCase() === line.itemCode.trim().toUpperCase())
        );
        if (!availableItem) {
          return {
            success: false,
            error: `Không tìm thấy vật tư mã "${line.itemCode || line.itemName}".`,
          };
        }
        if (availableItem.currentStock < line.quantity) {
          return {
            success: false,
            error: `Số lượng xuất của "${availableItem.name}" (${line.quantity} ${availableItem.unit}) vượt quá tồn kho khả dụng (${availableItem.currentStock} ${availableItem.unit})!`,
          };
        }
      }
    }

    for (const line of resolvedLines) {
      const idx = workingItems.findIndex(
        i =>
          (line.itemId && i.id === line.itemId) ||
          (line.itemCode && i.code.trim().toUpperCase() === line.itemCode.trim().toUpperCase())
      );

      if (idx !== -1) {
        const item = workingItems[idx];
        const newUnitPrice =
          targetType === 'NHAP_KHO' && line.unitPrice > 0 ? line.unitPrice : item.unitPrice;
        workingItems[idx] = {
          ...item,
          unitPrice: newUnitPrice,
          updatedAt: nowIso,
        };
        line.itemId = item.id;
        line.itemCode = item.code;
        line.itemName = item.name;
        line.unit = item.unit;
        line.categoryId = item.categoryId;
        line.categoryCode = item.categoryCode;
        line.category = item.category;
      } else if (targetType === 'NHAP_KHO') {
        const newItemId =
          line.itemId || `ITEM-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const cleanCode = (line.itemCode || `VT-${Date.now().toString().slice(-4)}`)
          .trim()
          .toUpperCase();

        delete nextReg[makeTombstoneKey('ITEM', newItemId)];
        delete nextReg[makeTombstoneKey('ITEM', cleanCode)];

        const catLink = resolveOrEnsureCategoryLink(
          line.categoryId,
          line.categoryCode,
          line.category || 'Vật tư dự án',
          workingCategories,
          nextReg,
          nowIso
        );

        const newItem: InventoryItem = {
          id: newItemId,
          code: cleanCode,
          name: (line.itemName || 'Vật tư nhập mới').trim(),
          type: line.type || 'VAT_TU',
          ...catLink,
          unit: (line.unit || 'Cái').trim(),
          warehouseId: targetWarehouseId,
          openingStock: 0,
          openingWarehouseStocks: { [targetWarehouseId]: 0 },
          warehouseStocks: { [targetWarehouseId]: Math.max(0, line.quantity) },
          location: (line.location || 'Khu vực tiếp nhận').trim(),
          minStock: line.minStock ?? 5,
          maxStock: line.maxStock ?? 200,
          currentStock: Math.max(0, line.quantity),
          unitPrice: Math.max(0, line.unitPrice || 0),
          serialOrLot: (line.serialNumber || '').trim(),
          condition: line.condition || 'SAN_SANG',
          supplierDefault: (updates.partnerName || existing.partnerName).trim(),
          spec: (line.spec || '').trim(),
          updatedAt: nowIso,
          metadataUpdatedAt: nowIso,
        };
        workingItems.unshift(newItem);
        line.itemId = newItemId;
        line.itemCode = cleanCode;
        line.categoryId = catLink.categoryId;
        line.categoryCode = catLink.categoryCode;
        line.category = catLink.category;
        line.isNewItem = true;
      }
    }

    const computedTotalAmount =
      updates.totalAmount !== undefined
        ? updates.totalAmount
        : resolvedLines.reduce((acc, it) => acc + (it.amount || it.quantity * it.unitPrice), 0);

    const updatedTrx: Transaction = {
      ...existing,
      ...updates,
      warehouseId: targetWarehouseId,
      type: targetType,
      items: resolvedLines,
      totalAmount: computedTotalAmount,
      updatedAt: nowIso,
    };

    delete nextReg[makeTombstoneKey('TRX', id)];
    delete nextReg[makeTombstoneKey('TRX', updatedTrx.code)];
    const legacy = extractLegacyDeletedArrays(nextReg);

    const newTransactionsList = cur.transactions.map(t => (t.id === id ? updatedTrx : t));
    const finalItems = recalculateAllItemsStocks(workingItems, cur.warehouses, newTransactionsList);

    setMaterialCategories(workingCategories);
    setItems(finalItems);
    setTransactions(newTransactionsList);
    setDeletedRegistry(nextReg);
    setDeletedItemIds(legacy.deletedItemIds);
    setDeletedTransactionIds(legacy.deletedTransactionIds);
    setDeletedCategoryIds(legacy.deletedCategoryIds);

    pushCloudSyncImmediately(
      finalItems,
      newTransactionsList,
      cur.warehouses,
      cur.users,
      nextReg,
      'update-transaction',
      undefined,
      workingCategories
    );
    return { success: true };
  };

  // Delete Transaction
  const deleteTransaction = (id: string): { success: boolean; error?: string } => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return {
        success: false,
        error: 'Chỉ Quản trị viên (Admin) mới có quyền xóa phiếu nhập/xuất kho.',
      };
    }

    const cur = stateRef.current;
    const targetTrx = cur.transactions.find(t => t.id === id);
    if (!targetTrx) {
      return { success: false, error: 'Phiếu không tồn tại hoặc đã bị xóa.' };
    }

    const nowIso = nextMonotonicIso(
      targetTrx.updatedAt,
      cur.items.map(i => i.updatedAt),
      cur.items.map(i => i.metadataUpdatedAt)
    );
    const newTransactionsList = cur.transactions.filter(t => t.id !== id);

    // Stamp timestamped tombstone so all other users' browsers delete this voucher immediately
    const nextReg = { ...cur.deletedRegistry };
    nextReg[makeTombstoneKey('TRX', id)] = nowIso;
    if (targetTrx.code) {
      nextReg[makeTombstoneKey('TRX', targetTrx.code)] = nowIso;
    }
    const legacy = extractLegacyDeletedArrays(nextReg);

    // Recalculate exact warehouseStocks & currentStock across all items
    const affectedCodes = new Set(
      (targetTrx.items || []).map(l => (l.itemCode || '').trim().toUpperCase()).filter(Boolean)
    );
    const affectedIds = new Set((targetTrx.items || []).map(l => l.itemId).filter(Boolean));
    const stampedItems = cur.items.map(it =>
      affectedIds.has(it.id) || affectedCodes.has(it.code.trim().toUpperCase())
        ? { ...it, updatedAt: nowIso }
        : it
    );
    const finalItems = recalculateAllItemsStocks(stampedItems, cur.warehouses, newTransactionsList);

    setItems(finalItems);
    setTransactions(newTransactionsList);
    setDeletedRegistry(nextReg);
    setDeletedTransactionIds(legacy.deletedTransactionIds);

    pushCloudSyncImmediately(
      finalItems,
      newTransactionsList,
      cur.warehouses,
      cur.users,
      nextReg,
      'delete-transaction'
    );
    return { success: true };
  };

  // Batch Import Transactions — O(N + M + T_lines) indexed implementation for 5,000+ vouchers/rows
  const importTransactionsBatch = (
    importedList: (Omit<Transaction, 'id' | 'code'> & { code?: string })[]
  ): { success: boolean; importedCount: number; errors: string[] } => {
    const cur = stateRef.current;
    const errors: string[] = [];
    const workingCategories = [...cur.materialCategories];
    const catCache = buildCategoryLookupCache(workingCategories);

    // Compute baseline stocks ONCE before processing the batch
    const baseItems = recalculateAllItemsStocks([...cur.items], cur.warehouses, cur.transactions);
    const originalLen = baseItems.length;
    const workingItems: InventoryItem[] = [...baseItems];
    const liveStockByIdx: number[] = workingItems.map(it => Number(it.currentStock) || 0);

    const idToIdx = new Map<string, number>();
    const codeToIdx = new Map<string, number>();
    for (let i = 0; i < workingItems.length; i++) {
      const it = workingItems[i];
      if (it.id) idToIdx.set(it.id, i);
      const normCode = (it.code || '').trim().toUpperCase();
      if (normCode && !codeToIdx.has(normCode)) {
        codeToIdx.set(normCode, i);
      }
    }

    const findItemIdx = (itemId?: string, itemCode?: string): number => {
      if (itemId) {
        const byId = idToIdx.get(itemId);
        if (byId !== undefined) return byId;
      }
      if (itemCode) {
        const byCode = codeToIdx.get(itemCode.trim().toUpperCase());
        if (byCode !== undefined) return byCode;
      }
      return -1;
    };

    // O(1) sequence counters for PN / PX codes
    const year = new Date().getFullYear();
    const pnPattern = new RegExp(`^PN-${year}-(\\d+)$`, 'i');
    const pxPattern = new RegExp(`^PX-${year}-(\\d+)$`, 'i');
    let nextPnSeq = 0;
    let nextPxSeq = 0;
    const usedCodes = new Set<string>();
    for (let t = 0; t < cur.transactions.length; t++) {
      const c = (cur.transactions[t].code || '').trim().toUpperCase();
      if (!c) continue;
      usedCodes.add(c);
      const mPn = c.match(pnPattern);
      if (mPn) {
        const n = parseInt(mPn[1], 10);
        if (n > nextPnSeq) nextPnSeq = n;
      } else {
        const mPx = c.match(pxPattern);
        if (mPx) {
          const n = parseInt(mPx[1], 10);
          if (n > nextPxSeq) nextPxSeq = n;
        }
      }
    }

    const newTransactionsToAdd: Transaction[] = [];
    const nextReg = { ...cur.deletedRegistry };
    const nowIso = nextMonotonicIso(
      cur.transactions.map(t => t.updatedAt),
      cur.items.map(i => i.updatedAt),
      cur.items.map(i => i.metadataUpdatedAt),
      Object.values(cur.deletedRegistry)
    );
    const batchTs = Date.now();

    for (let i = 0; i < importedList.length; i++) {
      const data = importedList[i];

      if (data.type === 'XUAT_KHO') {
        let stockError = '';
        // Track cumulative demand across lines within this single voucher too
        const voucherDemandByIdx = new Map<number, number>();
        for (let l = 0; l < data.items.length; l++) {
          const line = data.items[l];
          const idx = findItemIdx(line.itemId, line.itemCode);
          if (idx === -1) {
            stockError = `Phiếu ${i + 1} (${data.partnerName}): Không tìm thấy vật tư mã "${line.itemCode || line.itemName}".`;
            break;
          }
          const currentItem = workingItems[idx];
          const avail = liveStockByIdx[idx];
          const demanded = (voucherDemandByIdx.get(idx) || 0) + (Number(line.quantity) || 0);
          if (avail < demanded) {
            stockError = `Phiếu ${i + 1} (${data.partnerName}): Số lượng xuất của "${currentItem.name}" (${demanded} ${currentItem.unit}) vượt quá tồn kho khả dụng (${avail} ${currentItem.unit})!`;
            break;
          }
          voucherDemandByIdx.set(idx, demanded);
        }
        if (stockError) {
          errors.push(stockError);
          continue;
        }
      }

      let finalCode = data.code && data.code.trim() ? data.code.trim().toUpperCase() : '';
      if (!finalCode) {
        if (data.type === 'NHAP_KHO') {
          do {
            nextPnSeq += 1;
            finalCode = `PN-${year}-${String(nextPnSeq).padStart(4, '0')}`;
          } while (usedCodes.has(finalCode));
        } else {
          do {
            nextPxSeq += 1;
            finalCode = `PX-${year}-${String(nextPxSeq).padStart(4, '0')}`;
          } while (usedCodes.has(finalCode));
        }
      }
      usedCodes.add(finalCode);

      const resolvedLines: TransactionLineItem[] = [];
      for (let l = 0; l < data.items.length; l++) {
        const lineCopy: TransactionLineItem = { ...data.items[l] };
        const qty = Number(lineCopy.quantity) || 0;
        const idx = findItemIdx(lineCopy.itemId, lineCopy.itemCode);

        if (idx !== -1) {
          const item = workingItems[idx];
          const unitPrice =
            data.type === 'NHAP_KHO' && lineCopy.unitPrice > 0 ? lineCopy.unitPrice : item.unitPrice;

          workingItems[idx] = {
            ...item,
            unitPrice,
            supplierDefault:
              item.supplierDefault ||
              (data.type === 'NHAP_KHO' && data.partnerName ? data.partnerName : item.supplierDefault),
            updatedAt: nowIso,
          };
          liveStockByIdx[idx] =
            data.type === 'NHAP_KHO'
              ? liveStockByIdx[idx] + qty
              : Math.max(0, liveStockByIdx[idx] - qty);

          lineCopy.itemId = item.id;
          lineCopy.itemCode = item.code;
          lineCopy.itemName = item.name;
          lineCopy.unit = item.unit;
          lineCopy.categoryId = item.categoryId;
          lineCopy.categoryCode = item.categoryCode;
          lineCopy.category = item.category;
        } else if (data.type === 'NHAP_KHO') {
          const newItemId = `ITEM-${batchTs}-${i}-${l}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
          const cleanCode = (lineCopy.itemCode || `VT-${batchTs.toString().slice(-4)}-${i}`)
            .trim()
            .toUpperCase();

          delete nextReg[makeTombstoneKey('ITEM', newItemId)];
          delete nextReg[makeTombstoneKey('ITEM', cleanCode)];

          const catLink = resolveOrEnsureCategoryLink(
            lineCopy.categoryId,
            lineCopy.categoryCode,
            lineCopy.category || 'Vật tư nhập mới',
            workingCategories,
            nextReg,
            nowIso,
            catCache
          );

          const newItem: InventoryItem = {
            id: newItemId,
            code: cleanCode,
            name: (lineCopy.itemName || 'Vật tư nhập mới').trim(),
            type: lineCopy.type || 'VAT_TU',
            ...catLink,
            unit: (lineCopy.unit || 'Cái').trim(),
            warehouseId: data.warehouseId,
            openingStock: 0,
            openingWarehouseStocks: { [data.warehouseId]: 0 },
            warehouseStocks: { [data.warehouseId]: Math.max(0, qty) },
            location: (lineCopy.location || 'Khu vực tiếp nhận').trim(),
            minStock: lineCopy.minStock !== undefined && lineCopy.minStock >= 0 ? lineCopy.minStock : 5,
            maxStock: lineCopy.maxStock !== undefined && lineCopy.maxStock > 0 ? lineCopy.maxStock : 200,
            currentStock: Math.max(0, qty),
            unitPrice: Math.max(0, lineCopy.unitPrice || 0),
            serialOrLot: (lineCopy.serialNumber || '').trim(),
            condition: lineCopy.condition || 'SAN_SANG',
            supplierDefault: data.partnerName.trim(),
            spec: (lineCopy.spec || '').trim(),
            updatedAt: nowIso,
            metadataUpdatedAt: nowIso,
          };

          const newIdx = workingItems.length;
          workingItems.push(newItem);
          liveStockByIdx.push(Math.max(0, qty));
          idToIdx.set(newItemId, newIdx);
          codeToIdx.set(cleanCode, newIdx);

          lineCopy.itemId = newItemId;
          lineCopy.itemCode = cleanCode;
          lineCopy.categoryId = catLink.categoryId;
          lineCopy.categoryCode = catLink.categoryCode;
          lineCopy.category = catLink.category;
          lineCopy.isNewItem = true;
        }
        resolvedLines.push(lineCopy);
      }

      const newTrx: Transaction = {
        ...data,
        id: `TRX-${batchTs}-${i}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
        code: finalCode,
        items: resolvedLines,
        updatedAt: nowIso,
      };

      delete nextReg[makeTombstoneKey('TRX', newTrx.id)];
      delete nextReg[makeTombstoneKey('TRX', finalCode)];
      newTransactionsToAdd.push(newTrx);
    }

    if (newTransactionsToAdd.length === 0) {
      return { success: false, importedCount: 0, errors };
    }

    // Place newly auto-created items at the top of catalog (matching previous UX order)
    const orderedItems =
      workingItems.length > originalLen
        ? [...workingItems.slice(originalLen).reverse(), ...workingItems.slice(0, originalLen)]
        : workingItems;

    const newTransactionsList = [...newTransactionsToAdd, ...cur.transactions];
    const finalItems = recalculateAllItemsStocks(orderedItems, cur.warehouses, newTransactionsList);
    const legacy = extractLegacyDeletedArrays(nextReg);

    setMaterialCategories(workingCategories);
    setItems(finalItems);
    setTransactions(newTransactionsList);
    setDeletedRegistry(nextReg);
    setDeletedItemIds(legacy.deletedItemIds);
    setDeletedTransactionIds(legacy.deletedTransactionIds);
    setDeletedCategoryIds(legacy.deletedCategoryIds);

    pushCloudSyncImmediately(
      finalItems,
      newTransactionsList,
      cur.warehouses,
      cur.users,
      nextReg,
      'import-transactions-batch',
      undefined,
      workingCategories
    );

    return {
      success: true,
      importedCount: newTransactionsToAdd.length,
      errors,
    };
  };

  // Generate Chronological Stock Ledger for an Item across all warehouses
  const getItemLedger = (itemId: string): StockLedgerEntry[] => {
    const targetItem = items.find(i => i.id === itemId);
    const sorted = [...transactions]
      .filter(t => t.status !== 'DA_HUY')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Start running balance from opening stock so final balance matches currentStock
    let runningBalance = 0;
    if (targetItem) {
      if (
        targetItem.openingWarehouseStocks &&
        Object.keys(targetItem.openingWarehouseStocks).length > 0
      ) {
        runningBalance = Object.values(targetItem.openingWarehouseStocks).reduce(
          (sum, v) => sum + (Number(v) || 0),
          0
        );
      } else if (targetItem.openingStock !== undefined) {
        runningBalance = Number(targetItem.openingStock) || 0;
      } else {
        const net = computeNetMovementsForItem(targetItem.id, targetItem.code, transactions);
        runningBalance = Math.max(0, (Number(targetItem.currentStock) || 0) - net.totalNet);
      }
    }

    const entries: StockLedgerEntry[] = [];

    for (const trx of sorted) {
      const matchingLines = trx.items.filter(
        i =>
          i.itemId === itemId ||
          (targetItem &&
            i.itemCode &&
            i.itemCode.trim().toUpperCase() === targetItem.code.trim().toUpperCase())
      );

      for (const line of matchingLines) {
        const inQty = trx.type === 'NHAP_KHO' ? line.quantity : 0;
        const outQty = trx.type === 'XUAT_KHO' ? line.quantity : 0;
        runningBalance = Math.max(0, runningBalance + inQty - outQty);

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
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    pendingSnapshotRef.current = null;
    const cleanSnapshot = {
      warehouses: INITIAL_WAREHOUSES,
      materialCategories: INITIAL_CATEGORIES,
      items: INITIAL_ITEMS,
      transactions: INITIAL_TRANSACTIONS,
      users: INITIAL_USERS,
      deletedRegistry: {},
      deletedItemIds: [],
      deletedTransactionIds: [],
      deletedUserIds: [],
      deletedWarehouseIds: [],
      deletedCategoryIds: [],
    };
    stateRef.current = cleanSnapshot;
    setWarehouses(INITIAL_WAREHOUSES);
    setMaterialCategories(INITIAL_CATEGORIES);
    setItems(INITIAL_ITEMS);
    setTransactions(INITIAL_TRANSACTIONS);
    setUsers(INITIAL_USERS);
    setDeletedRegistry({});
    setDeletedItemIds([]);
    setDeletedTransactionIds([]);
    setDeletedUserIds([]);
    setDeletedWarehouseIds([]);
    setDeletedCategoryIds([]);
    localStorage.removeItem(STORAGE_KEYS.WAREHOUSES);
    localStorage.removeItem(STORAGE_KEYS.CATEGORIES);
    localStorage.removeItem(STORAGE_KEYS.ITEMS);
    localStorage.removeItem(STORAGE_KEYS.TRANSACTIONS);
    localStorage.removeItem(STORAGE_KEYS.USERS);
    localStorage.removeItem(STORAGE_KEYS.AUTH);
    localStorage.removeItem(STORAGE_KEYS.DELETED_REGISTRY);
    localStorage.removeItem(STORAGE_KEYS.DELETED_ITEMS);
    localStorage.removeItem(STORAGE_KEYS.DELETED_TRANSACTIONS);
    localStorage.removeItem(STORAGE_KEYS.DELETED_USERS);
    localStorage.removeItem(STORAGE_KEYS.DELETED_WAREHOUSES);
    localStorage.removeItem(STORAGE_KEYS.DELETED_CATEGORIES);

    const cleanResetPayload: CentralDataPayload = {
      cleanReset: true,
      resetEpoch: RESET_EPOCH,
      version: Date.now(),
      lastUpdated: new Date().toISOString(),
      users: INITIAL_USERS,
      warehouses: INITIAL_WAREHOUSES,
      materialCategories: INITIAL_CATEGORIES,
      items: INITIAL_ITEMS,
      transactions: INITIAL_TRANSACTIONS,
      deletedRegistry: {},
      source: 'admin-clean-reset',
      lastUpdatedBy: currentUser?.fullName || 'Quản trị viên',
    };

    firebaseFirestoreService.pushPayload(cleanResetPayload, currentUser?.fullName || 'Quản trị viên').catch(() => {});
  };

  return (
    <InventoryContext.Provider
      value={{
        warehouses,
        materialCategories,
        items,
        transactions,
        categories,
        suppliers,
        users,
        currentUser,
        login,
        forceLogoutOtherDeviceAndLogin,
        logout,
        revokeUserSession,
        sessionTerminatedReason,
        clearSessionTerminatedReason,
        currentDeviceInfo,
        regenerateDeviceIdForTesting,
        addUser,
        updateUser,
        deleteUser,
        addWarehouse,
        updateWarehouse,
        deleteWarehouse,
        addMaterialCategory,
        updateMaterialCategory,
        deleteMaterialCategory,
        linkItemsToCategoryBatch,
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
        syncStatus,
        lastSyncedAt,
        autoSyncEnabled,
        setAutoSyncEnabled,
        syncProvider,
        triggerManualSync,
        isSyncModalOpen,
        setIsSyncModalOpen,
        firestoreConnectionState,
        syncWithFirestore,
        pullFromFirestore,
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
