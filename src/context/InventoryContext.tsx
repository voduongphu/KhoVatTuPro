import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
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
  TransactionLineItem,
  TransactionType,
  User,
  Warehouse,
} from '../types/inventory';
import { calculateItemWarehouseStocks, getStockStatus } from '../utils/formatters';
import { SyncStatus, CloudProvider, CentralDataPayload, centralSyncService } from '../services/centralSyncService';
import { supabaseRealtimeService, RealtimeConnectionState } from '../services/supabaseRealtimeService';
import { DeviceInfo, getDeviceId, getDeviceInfo, getDeviceName } from '../utils/deviceHelper';
import { sessionBus } from '../services/sessionBus';
import {
  DeletedRegistry,
  makeTombstoneKey,
  nextMonotonicIso,
  reconcileSyncPayloads,
} from '../utils/mergeSyncData';

interface InventoryContextType {
  warehouses: Warehouse[];
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

  // Central Cloud Synchronization (Server SSE / Vercel KV / Supabase)
  syncStatus: SyncStatus;
  lastSyncedAt: Date | null;
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (enabled: boolean) => void;
  syncProvider: CloudProvider;
  triggerManualSync: () => Promise<void>;
  isSyncModalOpen: boolean;
  setIsSyncModalOpen: (open: boolean) => void;

  // Supabase Realtime WebSocket Connection & Google AI Sync
  realtimeConnectionState: RealtimeConnectionState;
  lastRealtimeUpdateMessage: string | null;
  clearRealtimeMessage: () => void;
  simulateGoogleAIUpdate: () => Promise<{ success: boolean; message: string }>;
  saveSupabaseCredentials: (url: string, key: string) => boolean;
  supabaseCredentials: { url: string; key: string };
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
  USERS: 'nxt_inventory_users_v3',
  AUTH: 'nxt_inventory_current_user_v3',
  DELETED_REGISTRY: 'nxt_inventory_deleted_registry_v4',
  DELETED_ITEMS: 'nxt_inventory_deleted_items_v3',
  DELETED_TRANSACTIONS: 'nxt_inventory_deleted_transactions_v3',
  DELETED_USERS: 'nxt_inventory_deleted_users_v3',
  DELETED_WAREHOUSES: 'nxt_inventory_deleted_warehouses_v3',
};

const RESET_EPOCH = '2026-10-21T10:00:00.000Z';

function computeNetMovementsForItem(
  itemId: string,
  itemCode: string,
  transactions: Transaction[]
): { totalNet: number; byWarehouse: Record<string, number> } {
  const normCode = (itemCode || '').trim().toUpperCase();
  const byWarehouse: Record<string, number> = {};
  let totalNet = 0;

  transactions.forEach(trx => {
    if (!trx || trx.status === 'DA_HUY') return;
    const whId = trx.warehouseId || 'WH-01';
    (trx.items || []).forEach(line => {
      const match =
        (itemId && line.itemId === itemId) ||
        (normCode && line.itemCode && line.itemCode.trim().toUpperCase() === normCode);
      if (!match) return;
      const qty = Number(line.quantity) || 0;
      const delta = trx.type === 'NHAP_KHO' ? qty : -qty;
      byWarehouse[whId] = (byWarehouse[whId] || 0) + delta;
      totalNet += delta;
    });
  });

  return { totalNet, byWarehouse };
}

function recalculateAllItemsStocks(
  itemsList: InventoryItem[],
  warehousesList: Warehouse[],
  transactionsList: Transaction[]
): InventoryItem[] {
  return itemsList.map(it => {
    const stocks = calculateItemWarehouseStocks(it, warehousesList, transactionsList);
    const total = Object.values(stocks).reduce((sum, q) => sum + (Number(q) || 0), 0);
    return {
      ...it,
      warehouseStocks: stocks,
      currentStock: Math.max(0, total),
    };
  });
}

function extractLegacyDeletedArrays(reg: DeletedRegistry) {
  const deletedItemIds: string[] = [];
  const deletedTransactionIds: string[] = [];
  const deletedUserIds: string[] = [];
  const deletedWarehouseIds: string[] = [];

  Object.keys(reg).forEach(k => {
    if (k.startsWith('ITEM:')) deletedItemIds.push(k.slice(5));
    else if (k.startsWith('TRX:')) deletedTransactionIds.push(k.slice(4));
    else if (k.startsWith('USER:')) deletedUserIds.push(k.slice(5));
    else if (k.startsWith('WH:')) deletedWarehouseIds.push(k.slice(3));
  });

  return { deletedItemIds, deletedTransactionIds, deletedUserIds, deletedWarehouseIds };
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

  // Always-fresh synchronous snapshot ref so async SSE/polling/mutation callbacks never read stale closures
  const stateRef = useRef({
    warehouses,
    items,
    transactions,
    users,
    deletedRegistry,
    deletedItemIds,
    deletedTransactionIds,
    deletedUserIds,
    deletedWarehouseIds,
  });

  stateRef.current = {
    warehouses,
    items,
    transactions,
    users,
    deletedRegistry,
    deletedItemIds,
    deletedTransactionIds,
    deletedUserIds,
    deletedWarehouseIds,
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
  const [syncProvider, setSyncProvider] = useState<CloudProvider>(() => {
    if (supabaseRealtimeService.isConfigured()) return 'supabase';
    return centralSyncService.getProvider();
  });
  const [isSyncModalOpen, setIsSyncModalOpen] = useState<boolean>(false);
  const [lastServerTimestamp, setLastServerTimestamp] = useState<string>('');

  // Supabase Realtime state
  const [realtimeConnectionState, setRealtimeConnectionState] = useState<RealtimeConnectionState>(() =>
    supabaseRealtimeService.getConnectionState()
  );
  const [lastRealtimeUpdateMessage, setLastRealtimeUpdateMessage] = useState<string | null>(null);
  const [supabaseCredentials, setSupabaseCredentials] = useState<{ url: string; key: string }>(() =>
    supabaseRealtimeService.getCredentials()
  );

  const clearRealtimeMessage = useCallback(() => setLastRealtimeUpdateMessage(null), []);

  const persistSnapshotToLocalStorage = useCallback(
    (snapshot: {
      warehouses: Warehouse[];
      items: InventoryItem[];
      transactions: Transaction[];
      users: User[];
      deletedRegistry: DeletedRegistry;
      deletedItemIds: string[];
      deletedTransactionIds: string[];
      deletedUserIds: string[];
      deletedWarehouseIds: string[];
    }) => {
      try {
        localStorage.setItem(STORAGE_KEYS.WAREHOUSES, JSON.stringify(snapshot.warehouses));
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
      } catch {
        // ignore quota errors
      }
    },
    []
  );

  /**
   * Pure, deterministic remote payload reconciliation (no nested React state updaters,
   * handles empty arrays on full deletions, and propagates shared Supabase credentials).
   */
  const applyRemotePayloadAdditive = useCallback(
    (payload: CentralDataPayload) => {
      if (!payload) return;

      // Auto-propagate shared Supabase credentials across users/browsers if configured by Admin
      if (payload.supabaseConfig?.url && payload.supabaseConfig?.key) {
        const currentCreds = supabaseRealtimeService.getCredentials();
        if (
          currentCreds.url !== payload.supabaseConfig.url ||
          currentCreds.key !== payload.supabaseConfig.key
        ) {
          supabaseRealtimeService.setCredentials(
            payload.supabaseConfig.url,
            payload.supabaseConfig.key
          );
          setSupabaseCredentials({
            url: payload.supabaseConfig.url,
            key: payload.supabaseConfig.key,
          });
          setSyncProvider('supabase');
        }
      }

      if (payload.cleanReset) {
        const cleanSnapshot = {
          warehouses:
            Array.isArray(payload.warehouses) && payload.warehouses.length > 0
              ? payload.warehouses
              : INITIAL_WAREHOUSES,
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
        };
        stateRef.current = cleanSnapshot;
        setWarehouses(cleanSnapshot.warehouses);
        setItems(cleanSnapshot.items);
        setTransactions(cleanSnapshot.transactions);
        setUsers(cleanSnapshot.users);
        setDeletedRegistry(cleanSnapshot.deletedRegistry);
        setDeletedItemIds([]);
        setDeletedTransactionIds([]);
        setDeletedUserIds([]);
        setDeletedWarehouseIds([]);
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
          transactions: current.transactions,
          items: current.items,
          deletedRegistry: current.deletedRegistry,
          deletedItemIds: current.deletedItemIds,
          deletedTransactionIds: current.deletedTransactionIds,
          deletedUserIds: current.deletedUserIds,
          deletedWarehouseIds: current.deletedWarehouseIds,
        },
        {
          users: Array.isArray(payload.users) ? payload.users : [],
          warehouses: Array.isArray(payload.warehouses) ? payload.warehouses : [],
          transactions: Array.isArray(payload.transactions) ? payload.transactions : [],
          items: Array.isArray(payload.items) ? payload.items : [],
          deletedRegistry: payload.deletedRegistry,
          deletedItemIds: payload.deletedItemIds,
          deletedTransactionIds: payload.deletedTransactionIds,
          deletedUserIds: payload.deletedUserIds,
          deletedWarehouseIds: payload.deletedWarehouseIds,
        }
      );

      const nextSnapshot = {
        warehouses: reconciled.warehouses,
        items: reconciled.items,
        transactions: reconciled.transactions,
        users: reconciled.users,
        deletedRegistry: reconciled.deletedRegistry,
        deletedItemIds: reconciled.deletedItemIds,
        deletedTransactionIds: reconciled.deletedTransactionIds,
        deletedUserIds: reconciled.deletedUserIds,
        deletedWarehouseIds: reconciled.deletedWarehouseIds,
      };

      stateRef.current = nextSnapshot;
      setWarehouses(nextSnapshot.warehouses);
      setUsers(nextSnapshot.users);
      setTransactions(nextSnapshot.transactions);
      setItems(nextSnapshot.items);
      setDeletedRegistry(nextSnapshot.deletedRegistry);
      setDeletedItemIds(nextSnapshot.deletedItemIds);
      setDeletedTransactionIds(nextSnapshot.deletedTransactionIds);
      setDeletedUserIds(nextSnapshot.deletedUserIds);
      setDeletedWarehouseIds(nextSnapshot.deletedWarehouseIds);
      persistSnapshotToLocalStorage(nextSnapshot);

      if (payload.lastUpdated) {
        setLastServerTimestamp(payload.lastUpdated);
      }
      setLastSyncedAt(new Date());
      setSyncStatus('synced');
    },
    [persistSnapshotToLocalStorage]
  );

  /**
   * Direct push helper for instant authoritative multi-user broadcast + immediate response reconciliation
   */
  const pushCloudSyncImmediately = useCallback(
    async (
      newItems: InventoryItem[],
      newTransactions: Transaction[],
      newWarehouses: Warehouse[],
      newUsers: User[],
      customDeletedRegistry?: DeletedRegistry,
      source = 'web-client',
      extraSupabaseConfig?: { url: string; key: string }
    ) => {
      const regToPush = customDeletedRegistry || stateRef.current.deletedRegistry;
      const legacyArrays = extractLegacyDeletedArrays(regToPush);
      const activeCreds = extraSupabaseConfig || supabaseRealtimeService.getCredentials();
      const supabaseConfig =
        activeCreds.url && activeCreds.key
          ? { url: activeCreds.url, key: activeCreds.key }
          : undefined;

      // Update stateRef & localStorage synchronously first so local UI and concurrent reads see new state immediately
      const immediateSnapshot = {
        warehouses: newWarehouses,
        items: newItems,
        transactions: newTransactions,
        users: newUsers,
        deletedRegistry: regToPush,
        ...legacyArrays,
      };
      stateRef.current = immediateSnapshot;
      persistSnapshotToLocalStorage(immediateSnapshot);

      setSyncStatus('syncing');

      const outboundPayload: CentralDataPayload = {
        version: Date.now(),
        lastUpdated: new Date().toISOString(),
        items: newItems,
        transactions: newTransactions,
        warehouses: newWarehouses,
        users: newUsers,
        deletedRegistry: regToPush,
        ...legacyArrays,
        supabaseConfig,
        clientId: clientIdRef.current,
        source,
      };

      let mergedFromServer: CentralDataPayload | null = null;

      try {
        const res = await centralSyncService.pushUpdate({
          items: newItems,
          transactions: newTransactions,
          warehouses: newWarehouses,
          users: newUsers,
          deletedRegistry: regToPush,
          ...legacyArrays,
          supabaseConfig,
          clientId: clientIdRef.current,
          source,
        });
        if (res.success && res.payload) {
          mergedFromServer = res.payload;
          setSyncProvider(res.provider);
        }
      } catch (err) {
        console.warn('Immediate centralSync push failed:', err);
      }

      try {
        if (supabaseRealtimeService.isConfigured()) {
          const supaMerged = await supabaseRealtimeService.pushState(
            mergedFromServer || outboundPayload
          );
          if (supaMerged) {
            mergedFromServer = supaMerged;
            setSyncProvider('supabase');
          }
        }
      } catch (err) {
        console.warn('Immediate supabase push failed:', err);
      }

      if (mergedFromServer) {
        applyRemotePayloadAdditive(mergedFromServer);
      } else {
        setSyncStatus('synced');
        setLastSyncedAt(new Date());
      }
    },
    [applyRemotePayloadAdditive, persistSnapshotToLocalStorage]
  );

  const saveSupabaseCredentials = useCallback(
    (url: string, key: string) => {
      const configured = supabaseRealtimeService.setCredentials(url, key);
      setSupabaseCredentials({ url, key });
      if (configured) {
        setSyncProvider('supabase');
        supabaseRealtimeService.fetchLatest().then(remoteData => {
          if (remoteData) {
            applyRemotePayloadAdditive(remoteData);
          }
          // Share Supabase credentials to central server so all other users connect to the same store
          const cur = stateRef.current;
          pushCloudSyncImmediately(
            cur.items,
            cur.transactions,
            cur.warehouses,
            cur.users,
            cur.deletedRegistry,
            'supabase-config-share',
            { url: url.trim(), key: key.trim() }
          );
        });
      }
      return configured;
    },
    [applyRemotePayloadAdditive, pushCloudSyncImmediately]
  );

  // 1. Subscribe to Central Server SSE Real-Time Stream (/api/sync/stream) for <50ms multi-user updates
  useEffect(() => {
    const unsubscribeStream = centralSyncService.subscribeToStream(payload => {
      if (!payload) return;
      applyRemotePayloadAdditive(payload);
    });
    return () => {
      unsubscribeStream();
    };
  }, [applyRemotePayloadAdditive]);

  // 2. Listen to Supabase Realtime WebSocket events (when configured)
  useEffect(() => {
    supabaseRealtimeService.subscribe(payload => {
      if (!payload) return;
      applyRemotePayloadAdditive(payload);

      const isAI = payload.source === 'google-ai';
      const msg = isAI
        ? `⚡ Số liệu mới từ Google AI vừa được cập nhật tức thì (Supabase Realtime)!`
        : `⚡ Dữ liệu vừa được hợp nhất tự động qua Supabase Realtime WebSocket!`;
      setLastRealtimeUpdateMessage(msg);

      setTimeout(() => {
        setLastRealtimeUpdateMessage(prev => (prev === msg ? null : prev));
      }, 6000);
    });

    const unsubscribeStatus = supabaseRealtimeService.onConnectionStateChange(state => {
      setRealtimeConnectionState(state);
      if (state === 'CONNECTED') {
        setSyncProvider('supabase');
      }
    });

    return () => {
      unsubscribeStatus();
    };
  }, [applyRemotePayloadAdditive]);

  // Active session monitor: Terminate session if another device logs in with this user account
  useEffect(() => {
    if (!currentUser) return;
    const currentDeviceId = getDeviceId();
    const freshUser = users.find(u => u.id === currentUser.id);
    if (!freshUser) return;

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

  // Trigger manual or background fetch from BOTH central server AND Supabase (bridging stores)
  const triggerManualSync = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      let anySuccess = false;

      const centralRes = await centralSyncService.fetchLatestData(lastServerTimestamp);
      if (centralRes.success) {
        anySuccess = true;
        setSyncProvider(centralRes.provider);
        if (centralRes.payload) {
          applyRemotePayloadAdditive(centralRes.payload);
        }
      }

      if (supabaseRealtimeService.isConfigured()) {
        const directPayload = await supabaseRealtimeService.fetchLatest();
        if (directPayload) {
          anySuccess = true;
          applyRemotePayloadAdditive(directPayload);
          setSyncProvider('supabase');
        }
      }

      if (anySuccess) {
        setSyncStatus('synced');
        setLastSyncedAt(new Date());
      } else {
        setSyncStatus(centralRes.error ? 'error' : 'offline');
      }
    } catch {
      setSyncStatus('offline');
    }
  }, [lastServerTimestamp, applyRemotePayloadAdditive]);

  // Automatic 3-second polling as resilient fallback alongside SSE + WebSocket
  useEffect(() => {
    if (!autoSyncEnabled) return;

    triggerManualSync();

    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      triggerManualSync();
    }, 3000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerManualSync();
      }
    };
    const handleWindowFocus = () => {
      triggerManualSync();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [autoSyncEnabled, triggerManualSync]);

  // Persist local state to localStorage ONLY (never blind-push stale state on mount!)
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

  // Simulate Google AI generating new inventory numbers & broadcast instantly
  const simulateGoogleAIUpdate = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    const cur = stateRef.current;
    if (cur.items.length === 0) {
      return { success: false, message: 'Chưa có danh mục vật tư để tạo số liệu AI' };
    }

    const targetIdx = Math.floor(Math.random() * cur.items.length);
    const targetItem = cur.items[targetIdx];
    const targetWarehouse = cur.warehouses[0] || INITIAL_WAREHOUSES[0];

    const adjustmentQty = Math.floor(Math.random() * 25) + 5;
    const nowIso = new Date().toISOString();

    const aiCode = `AI-NHAP-${Date.now().toString().slice(-4)}`;
    const lineAmount = adjustmentQty * (targetItem.unitPrice || 150000);
    const newTx: Transaction = {
      id: `TRX-AI-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      code: aiCode,
      type: 'NHAP_KHO',
      subtype: 'NHAP_DIEU_CHINH',
      date: nowIso.replace('T', ' ').substring(0, 16),
      warehouseId: targetItem.warehouseId || targetWarehouse.id,
      partnerName: 'Google AI Optimization Engine',
      departmentOrProject: 'Bộ Phận Dự Đoán Tự Động',
      creatorName: 'Google AI Gemini',
      notes: `[Google AI Auto-Analysis] Bổ sung +${adjustmentQty} ${targetItem.unit} cho vật tư "${targetItem.name}"`,
      status: 'HOAN_THANH',
      updatedAt: nowIso,
      items: [
        {
          itemId: targetItem.id,
          itemCode: targetItem.code,
          itemName: targetItem.name,
          unit: targetItem.unit,
          quantity: adjustmentQty,
          unitPrice: targetItem.unitPrice || 150000,
          amount: lineAmount,
          note: 'Google AI tự động tính toán và bổ sung lượng tồn kho tối ưu',
        },
      ],
      totalAmount: lineAmount,
    };

    const newTransactions = [newTx, ...cur.transactions];
    const rawItems = cur.items.map((it, idx) =>
      idx === targetIdx ? { ...it, updatedAt: nowIso } : it
    );
    const newItems = recalculateAllItemsStocks(rawItems, cur.warehouses, newTransactions);

    setTransactions(newTransactions);
    setItems(newItems);

    await pushCloudSyncImmediately(
      newItems,
      newTransactions,
      cur.warehouses,
      cur.users,
      cur.deletedRegistry,
      'google-ai'
    );

    const resultMessage = supabaseRealtimeService.isConfigured()
      ? `⚡ Google AI vừa cập nhật +${adjustmentQty} ${targetItem.unit} cho "${targetItem.name}". Đã phát sóng Realtime đến toàn bộ người dùng ngay lập tức!`
      : `Google AI vừa cập nhật +${adjustmentQty} ${targetItem.unit} cho "${targetItem.name}". Đã đồng bộ tức thì lên máy chủ trung tâm!`;

    setLastRealtimeUpdateMessage(resultMessage);
    return { success: true, message: resultMessage };
  }, [pushCloudSyncImmediately]);

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

    // 1. Always refresh full state from cloud immediately before login so user has latest catalog, vouchers & sessions
    try {
      const syncRes = await centralSyncService.fetchLatestData();
      if (syncRes.success && syncRes.payload) {
        applyRemotePayloadAdditive(syncRes.payload);
      }
      if (supabaseRealtimeService.isConfigured()) {
        const remoteSupa = await supabaseRealtimeService.fetchLatest();
        if (remoteSupa) {
          applyRemotePayloadAdditive(remoteSupa);
        }
      }
    } catch (err) {
      console.warn('Could not refresh remote state during login:', err);
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
      const syncRes = await centralSyncService.fetchLatestData();
      if (syncRes.success && syncRes.payload) {
        applyRemotePayloadAdditive(syncRes.payload);
      }
      if (supabaseRealtimeService.isConfigured()) {
        const remoteSupa = await supabaseRealtimeService.fetchLatest();
        if (remoteSupa) {
          applyRemotePayloadAdditive(remoteSupa);
        }
      }
    } catch (err) {
      console.warn('Could not refresh remote users before takeover:', err);
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
      cur.deletedRegistry[makeTombstoneKey('USER', trimmedUsername)]
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
    const nowIso = nextMonotonicIso(existingUser?.updatedAt, existingUser?.lastActiveAt);
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
    const updatedUsers = cur.users.filter(u => u.id !== id);
    const nowIso = nextMonotonicIso(targetUser?.updatedAt, targetUser?.lastActiveAt);
    const nextReg = { ...cur.deletedRegistry };
    nextReg[makeTombstoneKey('USER', id)] = nowIso;
    if (targetUser?.username) {
      nextReg[makeTombstoneKey('USER', targetUser.username)] = nowIso;
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

  // Derived lists
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => {
      if (i.category) set.add(i.category);
    });
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
        if (!matchCode && !matchName && !matchSerial && !matchSpec && !matchSupplier) {
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

      if (filterCriteria.categories.length > 0 && !filterCriteria.categories.includes(item.category)) {
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

    const nextReg = { ...cur.deletedRegistry };
    delete nextReg[makeTombstoneKey('ITEM', newId)];
    delete nextReg[makeTombstoneKey('ITEM', cleanCode)];
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
      'add-item'
    );
  };

  const updateItem = (id: string, updates: Partial<InventoryItem>) => {
    const cur = stateRef.current;
    let originalCode = '';
    const targetExisting = cur.items.find(i => i.id === id);
    const nowIso = nextMonotonicIso(
      targetExisting?.updatedAt,
      targetExisting?.metadataUpdatedAt,
      ...cur.transactions.map(t => t.updatedAt)
    );

    const rawUpdatedItems = cur.items.map(item => {
      if (item.id === id) {
        originalCode = item.code;
        const cleanCode = (updates.code || item.code).trim().toUpperCase();
        const targetWhId = updates.warehouseId || item.warehouseId || cur.warehouses[0]?.id || 'WH-01';

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
    setItems(updatedItems);

    pushCloudSyncImmediately(
      updatedItems,
      updatedTransactions,
      cur.warehouses,
      cur.users,
      cur.deletedRegistry,
      'update-item'
    );
  };

  const deleteItem = (id: string) => {
    const cur = stateRef.current;
    const targetItem = cur.items.find(i => i.id === id);
    const newItems = cur.items.filter(i => i.id !== id);
    const nowIso = nextMonotonicIso(
      targetItem?.updatedAt,
      targetItem?.metadataUpdatedAt,
      ...cur.transactions.map(t => t.updatedAt)
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
      ...targetItems.flatMap(i => [i.updatedAt, i.metadataUpdatedAt]),
      ...cur.transactions.map(t => t.updatedAt)
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

  // Batch Import Items / Materials Catalog (Fixed pure state computation + immediate cloud broadcast!)
  const importItemsBatch = (
    itemsList: Omit<InventoryItem, 'id' | 'updatedAt'>[],
    updateExisting: boolean = true
  ): { success: boolean; addedCount: number; updatedCount: number; errors: string[] } => {
    const cur = stateRef.current;
    let addedCount = 0;
    let updatedCount = 0;
    const errors: string[] = [];

    const workingItems = [...cur.items];
    let workingTransactions = [...cur.transactions];
    const nextReg = { ...cur.deletedRegistry };
    const nowIso = nextMonotonicIso(
      ...cur.items.flatMap(i => [i.updatedAt, i.metadataUpdatedAt]),
      ...cur.transactions.map(t => t.updatedAt),
      ...Object.values(cur.deletedRegistry)
    );

    for (let i = 0; i < itemsList.length; i++) {
      const row = itemsList[i];
      if (!row.code || !row.name) {
        errors.push(`Dòng ${i + 1}: Thiếu mã SKU hoặc tên vật tư.`);
        continue;
      }

      const cleanCode = row.code.trim().toUpperCase();
      const targetWhId = row.warehouseId || cur.warehouses[0]?.id || 'WH-01';
      const existingIdx = workingItems.findIndex(
        it => it.code.trim().toUpperCase() === cleanCode
      );

      // Clear any previous deletion tombstones for this SKU so imported items always appear across all users
      delete nextReg[makeTombstoneKey('ITEM', cleanCode)];

      if (existingIdx !== -1) {
        if (updateExisting) {
          const oldItem = workingItems[existingIdx];
          delete nextReg[makeTombstoneKey('ITEM', oldItem.id)];

          let nextOpeningWh = oldItem.openingWarehouseStocks
            ? { ...oldItem.openingWarehouseStocks }
            : undefined;
          let nextOpeningStock = oldItem.openingStock;

          if (row.currentStock !== undefined && row.currentStock !== oldItem.currentStock) {
            const currentWhStocks = calculateItemWarehouseStocks(
              oldItem,
              cur.warehouses,
              workingTransactions
            );
            const otherWhTotal = Object.entries(currentWhStocks).reduce(
              (sum, [wId, q]) => (wId === targetWhId ? sum : sum + (Number(q) || 0)),
              0
            );
            const desiredInTargetWh = Math.max(0, Number(row.currentStock) - otherWhTotal);
            const net = computeNetMovementsForItem(oldItem.id, cleanCode, workingTransactions);

            nextOpeningWh = {};
            cur.warehouses.forEach(w => {
              if (w.id === targetWhId) {
                nextOpeningWh![w.id] = desiredInTargetWh - (net.byWarehouse[w.id] || 0);
              } else if (
                oldItem.openingWarehouseStocks &&
                oldItem.openingWarehouseStocks[w.id] !== undefined
              ) {
                nextOpeningWh![w.id] = oldItem.openingWarehouseStocks[w.id];
              } else {
                nextOpeningWh![w.id] = (currentWhStocks[w.id] || 0) - (net.byWarehouse[w.id] || 0);
              }
            });
            nextOpeningStock = Object.values(nextOpeningWh).reduce((s, v) => s + v, 0);
          }

          workingItems[existingIdx] = {
            ...oldItem,
            ...row,
            code: cleanCode,
            warehouseId: targetWhId,
            openingStock: nextOpeningStock,
            openingWarehouseStocks: nextOpeningWh,
            updatedAt: nowIso,
            metadataUpdatedAt: nowIso,
          };
          updatedCount++;

          if (row.name || row.unit) {
            workingTransactions = workingTransactions.map(trx => {
              let hasMod = false;
              const updatedLines = trx.items.map(line => {
                const isMatch =
                  line.itemId === oldItem.id ||
                  line.itemCode.trim().toUpperCase() === cleanCode;
                if (isMatch) {
                  hasMod = true;
                  return {
                    ...line,
                    ...(row.name ? { itemName: row.name } : {}),
                    ...(row.unit ? { unit: row.unit } : {}),
                  };
                }
                return line;
              });
              return hasMod ? { ...trx, items: updatedLines, updatedAt: nowIso } : trx;
            });
          }
        }
      } else {
        const newId = `ITEM-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
        delete nextReg[makeTombstoneKey('ITEM', newId)];
        const net = computeNetMovementsForItem(newId, cleanCode, workingTransactions);
        const desiredStock = Math.max(0, Number(row.currentStock) || 0);
        const openingForWh = desiredStock - (net.byWarehouse[targetWhId] || 0);

        const newItem: InventoryItem = {
          ...row,
          id: newId,
          code: cleanCode,
          warehouseId: targetWhId,
          openingStock: openingForWh,
          openingWarehouseStocks: { [targetWhId]: openingForWh },
          currentStock: desiredStock,
          updatedAt: nowIso,
          metadataUpdatedAt: nowIso,
        };
        workingItems.unshift(newItem);
        addedCount++;
      }
    }

    if (addedCount > 0 || updatedCount > 0) {
      const finalItems = recalculateAllItemsStocks(
        workingItems,
        cur.warehouses,
        workingTransactions
      );
      const legacy = extractLegacyDeletedArrays(nextReg);

      setItems(finalItems);
      setTransactions(workingTransactions);
      setDeletedRegistry(nextReg);
      setDeletedItemIds(legacy.deletedItemIds);

      pushCloudSyncImmediately(
        finalItems,
        workingTransactions,
        cur.warehouses,
        cur.users,
        nextReg,
        'import-items-batch'
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
      ...cur.items.flatMap(i => [i.updatedAt, i.metadataUpdatedAt]),
      ...cur.transactions.map(t => t.updatedAt),
      ...Object.values(cur.deletedRegistry)
    );
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
      } else if (data.type === 'NHAP_KHO') {
        const newItemId = `ITEM-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const cleanCode = (lineCopy.itemCode || `VT-${Date.now().toString().slice(-4)}`)
          .trim()
          .toUpperCase();

        delete nextReg[makeTombstoneKey('ITEM', newItemId)];
        delete nextReg[makeTombstoneKey('ITEM', cleanCode)];

        const newItem: InventoryItem = {
          id: newItemId,
          code: cleanCode,
          name: (lineCopy.itemName || 'Vật tư nhập mới').trim(),
          type: lineCopy.type || 'VAT_TU',
          category: (lineCopy.category || 'Vật tư nhập mới').trim(),
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

    setItems(finalItems);
    setTransactions(newTransactionsList);
    setDeletedRegistry(nextReg);
    setDeletedItemIds(legacy.deletedItemIds);
    setDeletedTransactionIds(legacy.deletedTransactionIds);

    pushCloudSyncImmediately(
      finalItems,
      newTransactionsList,
      cur.warehouses,
      cur.users,
      nextReg,
      'create-transaction'
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
      ...cur.items.flatMap(i => [i.updatedAt, i.metadataUpdatedAt]),
      ...Object.values(cur.deletedRegistry)
    );
    const targetWarehouseId = updates.warehouseId || existing.warehouseId;
    const targetType = updates.type || existing.type;
    const nextReg = { ...cur.deletedRegistry };

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
      } else if (targetType === 'NHAP_KHO') {
        const newItemId =
          line.itemId || `ITEM-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const cleanCode = (line.itemCode || `VT-${Date.now().toString().slice(-4)}`)
          .trim()
          .toUpperCase();

        delete nextReg[makeTombstoneKey('ITEM', newItemId)];
        delete nextReg[makeTombstoneKey('ITEM', cleanCode)];

        const newItem: InventoryItem = {
          id: newItemId,
          code: cleanCode,
          name: (line.itemName || 'Vật tư nhập mới').trim(),
          type: line.type || 'VAT_TU',
          category: (line.category || 'Vật tư dự án').trim(),
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

    setItems(finalItems);
    setTransactions(newTransactionsList);
    setDeletedRegistry(nextReg);
    setDeletedItemIds(legacy.deletedItemIds);
    setDeletedTransactionIds(legacy.deletedTransactionIds);

    pushCloudSyncImmediately(
      finalItems,
      newTransactionsList,
      cur.warehouses,
      cur.users,
      nextReg,
      'update-transaction'
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
      ...cur.items.flatMap(i => [i.updatedAt, i.metadataUpdatedAt])
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

  // Batch Import Transactions
  const importTransactionsBatch = (
    importedList: (Omit<Transaction, 'id' | 'code'> & { code?: string })[]
  ): { success: boolean; importedCount: number; errors: string[] } => {
    const cur = stateRef.current;
    const errors: string[] = [];
    let workingItems = [...cur.items];
    const newTransactionsToAdd: Transaction[] = [];
    const nextReg = { ...cur.deletedRegistry };
    const nowIso = nextMonotonicIso(
      ...cur.transactions.map(t => t.updatedAt),
      ...cur.items.flatMap(i => [i.updatedAt, i.metadataUpdatedAt]),
      ...Object.values(cur.deletedRegistry)
    );

    for (let i = 0; i < importedList.length; i++) {
      const data = importedList[i];
      const currentCombinedTrx = [...newTransactionsToAdd, ...cur.transactions];
      workingItems = recalculateAllItemsStocks(workingItems, cur.warehouses, currentCombinedTrx);

      if (data.type === 'XUAT_KHO') {
        let stockError = '';
        for (const line of data.items) {
          const currentItem = workingItems.find(
            it =>
              (line.itemId && it.id === line.itemId) ||
              (line.itemCode && it.code && it.code.trim().toUpperCase() === line.itemCode.trim().toUpperCase())
          );
          if (!currentItem) {
            stockError = `Phiếu ${i + 1} (${data.partnerName}): Không tìm thấy vật tư mã "${line.itemCode || line.itemName}".`;
            break;
          }
          if (currentItem.currentStock < line.quantity) {
            stockError = `Phiếu ${i + 1} (${data.partnerName}): Số lượng xuất của "${currentItem.name}" (${line.quantity} ${currentItem.unit}) vượt quá tồn kho khả dụng (${currentItem.currentStock} ${currentItem.unit})!`;
            break;
          }
        }
        if (stockError) {
          errors.push(stockError);
          continue;
        }
      }

      let finalCode = data.code && data.code.trim() ? data.code.trim().toUpperCase() : '';
      if (!finalCode) {
        finalCode = generateUniqueTransactionCode(data.type, currentCombinedTrx);
      }

      const resolvedLines: TransactionLineItem[] = [];
      for (const line of data.items) {
        const lineCopy: TransactionLineItem = { ...line };
        const idx = workingItems.findIndex(
          it =>
            (lineCopy.itemId && it.id === lineCopy.itemId) ||
            (lineCopy.itemCode && it.code && it.code.trim().toUpperCase() === lineCopy.itemCode.trim().toUpperCase())
        );

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
          lineCopy.itemId = item.id;
          lineCopy.itemCode = item.code;
          lineCopy.itemName = item.name;
          lineCopy.unit = item.unit;
        } else if (data.type === 'NHAP_KHO') {
          const newItemId = `ITEM-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
          const cleanCode = (lineCopy.itemCode || `VT-${Date.now().toString().slice(-4)}`)
            .trim()
            .toUpperCase();

          delete nextReg[makeTombstoneKey('ITEM', newItemId)];
          delete nextReg[makeTombstoneKey('ITEM', cleanCode)];

          const newItem: InventoryItem = {
            id: newItemId,
            code: cleanCode,
            name: (lineCopy.itemName || 'Vật tư nhập mới').trim(),
            type: lineCopy.type || 'VAT_TU',
            category: (lineCopy.category || 'Vật tư nhập mới').trim(),
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
          lineCopy.isNewItem = true;
        }
        resolvedLines.push(lineCopy);
      }

      const newTrx: Transaction = {
        ...data,
        id: `TRX-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
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

    const newTransactionsList = [...newTransactionsToAdd, ...cur.transactions];
    const finalItems = recalculateAllItemsStocks(workingItems, cur.warehouses, newTransactionsList);
    const legacy = extractLegacyDeletedArrays(nextReg);

    setItems(finalItems);
    setTransactions(newTransactionsList);
    setDeletedRegistry(nextReg);
    setDeletedItemIds(legacy.deletedItemIds);
    setDeletedTransactionIds(legacy.deletedTransactionIds);

    pushCloudSyncImmediately(
      finalItems,
      newTransactionsList,
      cur.warehouses,
      cur.users,
      nextReg,
      'import-transactions-batch'
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
    const cleanSnapshot = {
      warehouses: INITIAL_WAREHOUSES,
      items: INITIAL_ITEMS,
      transactions: INITIAL_TRANSACTIONS,
      users: INITIAL_USERS,
      deletedRegistry: {},
      deletedItemIds: [],
      deletedTransactionIds: [],
      deletedUserIds: [],
      deletedWarehouseIds: [],
    };
    stateRef.current = cleanSnapshot;
    setWarehouses(INITIAL_WAREHOUSES);
    setItems(INITIAL_ITEMS);
    setTransactions(INITIAL_TRANSACTIONS);
    setUsers(INITIAL_USERS);
    setDeletedRegistry({});
    setDeletedItemIds([]);
    setDeletedTransactionIds([]);
    setDeletedUserIds([]);
    setDeletedWarehouseIds([]);
    localStorage.removeItem(STORAGE_KEYS.WAREHOUSES);
    localStorage.removeItem(STORAGE_KEYS.ITEMS);
    localStorage.removeItem(STORAGE_KEYS.TRANSACTIONS);
    localStorage.removeItem(STORAGE_KEYS.USERS);
    localStorage.removeItem(STORAGE_KEYS.AUTH);
    localStorage.removeItem(STORAGE_KEYS.DELETED_REGISTRY);
    localStorage.removeItem(STORAGE_KEYS.DELETED_ITEMS);
    localStorage.removeItem(STORAGE_KEYS.DELETED_TRANSACTIONS);
    localStorage.removeItem(STORAGE_KEYS.DELETED_USERS);
    localStorage.removeItem(STORAGE_KEYS.DELETED_WAREHOUSES);

    fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cleanReset: true,
        payload: {
          cleanReset: true,
          resetEpoch: RESET_EPOCH,
          version: 1,
          lastUpdated: new Date().toISOString(),
          users: INITIAL_USERS,
          warehouses: INITIAL_WAREHOUSES,
          items: INITIAL_ITEMS,
          transactions: INITIAL_TRANSACTIONS,
          deletedRegistry: {},
          source: 'admin-clean-reset',
        },
      }),
    }).catch(() => {});
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
        realtimeConnectionState,
        lastRealtimeUpdateMessage,
        clearRealtimeMessage,
        simulateGoogleAIUpdate,
        saveSupabaseCredentials,
        supabaseCredentials,
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
