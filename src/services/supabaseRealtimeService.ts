import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { CentralDataPayload } from './centralSyncService';
import { DeletedRegistry, reconcileSyncPayloads } from '../utils/mergeSyncData';
import { calculateAllItemsWarehouseStocks } from '../utils/formatters';
import { InventoryItem, MaterialCategory, Transaction, User, Warehouse } from '../types/inventory';

export type RealtimeConnectionState = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR' | 'UNCONFIGURED';

const STORAGE_KEYS = {
  SUPABASE_URL: 'nxt_supabase_url',
  SUPABASE_KEY: 'nxt_supabase_anon_key',
};

const MANIFEST_ROW_ID = 'manifest_v2';
const LEGACY_ROW_ID = 'default';

const INLINE_ITEMS_THRESHOLD = 120;
const INLINE_TX_THRESHOLD = 80;
const INLINE_DEL_THRESHOLD = 400;

const TARGET_ITEMS_PER_SHARD = 250;
const TARGET_TX_PER_SHARD = 160;
const TARGET_DEL_PER_SHARD = 1200;

const UPSERT_BATCH_SIZE = 3;
const UPSERT_CONCURRENCY = 2;
const SELECT_BATCH_SIZE = 5;
const SELECT_CONCURRENCY = 2;

interface ShardDescriptor {
  id: string;
  hash: string;
  count: number;
}

interface SupabaseManifestV2 {
  __shardedV2: true;
  version: number;
  lastUpdated: string;
  lastUpdatedBy?: string;
  clientId?: string;
  source?: string;
  resetEpoch?: string;
  cleanReset?: boolean;
  supabaseConfig?: {
    url: string;
    key: string;
  };
  users: User[];
  warehouses: Warehouse[];
  materialCategories: MaterialCategory[];
  inlineItems?: Record<string, any>[];
  itemShards?: ShardDescriptor[];
  inlineTransactions?: Record<string, any>[];
  txShards?: ShardDescriptor[];
  inlineDeletedRegistry?: DeletedRegistry;
  delShards?: ShardDescriptor[];
}

interface CachedShardPayload {
  hash: string;
  records?: any[];
  entries?: DeletedRegistry;
}

function fnv1a32(str: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function computeContentHash(jsonStr: string): string {
  const h1 = fnv1a32(jsonStr, 0x811c9dc5).toString(36);
  const h2 = fnv1a32(jsonStr, 0x9e3779b9).toString(36);
  return `${h1}-${h2}-${jsonStr.length.toString(36)}`;
}

function pickBucketCount(total: number, targetPerShard: number): number {
  const raw = Math.max(2, Math.ceil(total / targetPerShard));
  let p = 2;
  while (p < raw && p < 256) {
    p <<= 1;
  }
  return p;
}

function extractLegacyDeletedArrays(reg: DeletedRegistry) {
  const deletedItemIds: string[] = [];
  const deletedTransactionIds: string[] = [];
  const deletedUserIds: string[] = [];
  const deletedWarehouseIds: string[] = [];
  const deletedCategoryIds: string[] = [];

  const keys = Object.keys(reg);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k.startsWith('ITEM:')) deletedItemIds.push(k.slice(5));
    else if (k.startsWith('TRX:')) deletedTransactionIds.push(k.slice(4));
    else if (k.startsWith('USER:')) deletedUserIds.push(k.slice(5));
    else if (k.startsWith('WH:')) deletedWarehouseIds.push(k.slice(3));
    else if (k.startsWith('CAT:')) deletedCategoryIds.push(k.slice(4));
  }

  return {
    deletedItemIds,
    deletedTransactionIds,
    deletedUserIds,
    deletedWarehouseIds,
    deletedCategoryIds,
  };
}

function slimItemForShard(item: InventoryItem): Record<string, any> {
  const out: Record<string, any> = {
    id: item.id,
    code: item.code,
    name: item.name,
    type: item.type,
    category: item.category,
    unit: item.unit,
    location: item.location,
    minStock: item.minStock,
    maxStock: item.maxStock,
    currentStock: item.currentStock,
    unitPrice: item.unitPrice,
    updatedAt: item.updatedAt,
  };

  if (item.categoryId) out.categoryId = item.categoryId;
  if (item.categoryCode) out.categoryCode = item.categoryCode;
  if (item.warehouseId) out.warehouseId = item.warehouseId;
  if (item.openingStock !== undefined) out.openingStock = item.openingStock;

  if (item.openingWarehouseStocks && Object.keys(item.openingWarehouseStocks).length > 0) {
    out.openingWarehouseStocks = item.openingWarehouseStocks;
  } else if (item.warehouseStocks && Object.keys(item.warehouseStocks).length > 0) {
    const nonZero: Record<string, number> = {};
    const entries = Object.entries(item.warehouseStocks);
    for (let i = 0; i < entries.length; i++) {
      const [k, v] = entries[i];
      if (v !== 0) nonZero[k] = v;
    }
    if (Object.keys(nonZero).length > 0) out.warehouseStocks = nonZero;
  }

  if (item.serialOrLot) out.serialOrLot = item.serialOrLot;
  if (item.condition && item.condition !== 'SAN_SANG') {
    out.condition = item.condition;
  } else if (item.condition === 'SAN_SANG' && (item.type === 'THIET_BI' || item.type === 'CONG_CU')) {
    out.condition = 'SAN_SANG';
  }
  if (item.supplierDefault) out.supplierDefault = item.supplierDefault;
  if (item.inspectionDueDate) out.inspectionDueDate = item.inspectionDueDate;
  if (item.spec) out.spec = item.spec;
  if (item.metadataUpdatedAt && item.metadataUpdatedAt !== item.updatedAt) {
    out.metadataUpdatedAt = item.metadataUpdatedAt;
  }

  return out;
}

function hydrateItemFromShard(raw: any): InventoryItem {
  return {
    ...raw,
    category: raw.category || 'Chưa phân loại',
    unit: raw.unit || 'Cái',
    location: raw.location || '',
    minStock: Number(raw.minStock) || 0,
    maxStock: Number(raw.maxStock) || 0,
    currentStock: Number(raw.currentStock) || 0,
    unitPrice: Number(raw.unitPrice) || 0,
    condition: raw.condition || 'SAN_SANG',
    updatedAt: raw.updatedAt || '2026-01-01T00:00:00.000Z',
    metadataUpdatedAt: raw.metadataUpdatedAt || raw.updatedAt || '2026-01-01T00:00:00.000Z',
  };
}

function slimTransactionForShard(trx: Transaction): Record<string, any> {
  const slimLines = (trx.items || []).map(line => {
    const l: Record<string, any> = {
      itemId: line.itemId,
      itemCode: line.itemCode,
      itemName: line.itemName,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
    };
    if (line.serialNumber) l.serialNumber = line.serialNumber;
    if (line.note) l.note = line.note;
    if (line.isNewItem) l.isNewItem = true;
    if (line.type) l.type = line.type;
    if (line.categoryId) l.categoryId = line.categoryId;
    if (line.categoryCode) l.categoryCode = line.categoryCode;
    if (line.category) l.category = line.category;
    if (line.location) l.location = line.location;
    if (line.minStock !== undefined) l.minStock = line.minStock;
    if (line.maxStock !== undefined) l.maxStock = line.maxStock;
    if (line.condition) l.condition = line.condition;
    if (line.spec) l.spec = line.spec;
    return l;
  });

  const out: Record<string, any> = {
    id: trx.id,
    code: trx.code,
    type: trx.type,
    subtype: trx.subtype,
    date: trx.date,
    warehouseId: trx.warehouseId,
    partnerName: trx.partnerName || '',
    departmentOrProject: trx.departmentOrProject || '',
    creatorName: trx.creatorName || '',
    notes: trx.notes || '',
    items: slimLines,
    totalAmount: trx.totalAmount,
    status: trx.status,
  };
  if (trx.approverName) out.approverName = trx.approverName;
  if (trx.updatedAt) out.updatedAt = trx.updatedAt;
  return out;
}

function hydrateTransactionFromShard(raw: any): Transaction {
  return {
    ...raw,
    partnerName: raw.partnerName || '',
    departmentOrProject: raw.departmentOrProject || '',
    creatorName: raw.creatorName || '',
    notes: raw.notes || '',
    items: Array.isArray(raw.items) ? raw.items : [],
    totalAmount: Number(raw.totalAmount) || 0,
    status: raw.status || 'HOAN_THANH',
  };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  if (tasks.length === 0) return [];
  const results = new Array<T>(tasks.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const idx = cursor++;
      results[idx] = await tasks[idx]();
    }
  });

  await Promise.all(workers);
  return results;
}

class SupabaseRealtimeService {
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private currentState: RealtimeConnectionState = 'UNCONFIGURED';
  private listeners: ((state: RealtimeConnectionState) => void)[] = [];
  private onDataCallback: ((payload: CentralDataPayload) => void) | null = null;

  // Sharded V2 in-memory cache & state tracking
  private shardCache = new Map<string, CachedShardPayload>();
  private remoteWrittenHashes = new Map<string, string>();
  private lastHydratedVersion = 0;
  private lastHydratedUpdated = '';
  private lastHydratedPayload: CentralDataPayload | null = null;
  private manifestV2ExistsOnRemote: boolean | null = null;
  private legacyDefaultChecked = false;
  private lastPollCheckMs = 0;

  // Single-flight queues to prevent overlapping queries & Postgres row-lock contention
  private activePushPromise: Promise<CentralDataPayload | null> | null = null;
  private queuedPushPayload: CentralDataPayload | null = null;
  private activeFetchPromise: Promise<CentralDataPayload | null> | null = null;
  private realtimeHydrateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.initClient();
  }

  private resetInternalCaches() {
    this.shardCache.clear();
    this.remoteWrittenHashes.clear();
    this.lastHydratedVersion = 0;
    this.lastHydratedUpdated = '';
    this.lastHydratedPayload = null;
    this.manifestV2ExistsOnRemote = null;
    this.legacyDefaultChecked = false;
    this.lastPollCheckMs = 0;
    this.queuedPushPayload = null;
    if (this.realtimeHydrateTimer) {
      clearTimeout(this.realtimeHydrateTimer);
      this.realtimeHydrateTimer = null;
    }
  }

  public getCredentials(): { url: string; key: string } {
    let url = '';
    let key = '';

    if (typeof window !== 'undefined') {
      url = localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || '';
      key = localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || '';
    }

    if (!url && typeof import.meta !== 'undefined' && import.meta.env) {
      url = import.meta.env.VITE_SUPABASE_URL || '';
    }
    if (!key && typeof import.meta !== 'undefined' && import.meta.env) {
      key = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
    }

    return { url, key };
  }

  public setCredentials(url: string, key: string): boolean {
    if (typeof window !== 'undefined') {
      if (url && key) {
        localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, url.trim());
        localStorage.setItem(STORAGE_KEYS.SUPABASE_KEY, key.trim());
      } else {
        localStorage.removeItem(STORAGE_KEYS.SUPABASE_URL);
        localStorage.removeItem(STORAGE_KEYS.SUPABASE_KEY);
      }
    }
    this.cleanup();
    this.initClient();
    return this.isConfigured();
  }

  public isConfigured(): boolean {
    const { url, key } = this.getCredentials();
    return Boolean(url && key);
  }

  public needsV2Migration(): boolean {
    return this.isConfigured() && this.manifestV2ExistsOnRemote === false && this.activePushPromise === null;
  }

  public getConnectionState(): RealtimeConnectionState {
    return this.currentState;
  }

  public onConnectionStateChange(listener: (state: RealtimeConnectionState) => void): () => void {
    this.listeners.push(listener);
    listener(this.currentState);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private setConnectionState(state: RealtimeConnectionState) {
    this.currentState = state;
    this.listeners.forEach(listener => {
      try {
        listener(state);
      } catch (err) {
        console.warn('Error in connection state listener:', err);
      }
    });
  }

  public initClient() {
    const { url, key } = this.getCredentials();

    if (!url || !key) {
      this.setConnectionState('UNCONFIGURED');
      return;
    }

    try {
      this.setConnectionState('CONNECTING');
      this.client = createClient(url, key, {
        realtime: {
          params: {
            eventsPerSecond: 20,
          },
        },
      });

      this.subscribeChannel();
    } catch (err) {
      console.warn('Failed to initialize Supabase client:', err);
      this.setConnectionState('ERROR');
    }
  }

  public subscribe(onUpdate: (payload: CentralDataPayload) => void) {
    this.onDataCallback = onUpdate;
    if (this.client && !this.channel) {
      this.subscribeChannel();
    }
  }

  private scheduleRealtimeFetchFromRemote(manifestHint?: SupabaseManifestV2) {
    if (this.realtimeHydrateTimer) {
      clearTimeout(this.realtimeHydrateTimer);
    }
    this.realtimeHydrateTimer = setTimeout(async () => {
      this.realtimeHydrateTimer = null;
      if (!this.onDataCallback) return;
      try {
        let hydrated: CentralDataPayload | null = null;
        if (manifestHint && manifestHint.__shardedV2) {
          if (
            manifestHint.version === this.lastHydratedVersion &&
            manifestHint.lastUpdated === this.lastHydratedUpdated
          ) {
            return;
          }
          hydrated = await this.hydrateFromManifestV2(manifestHint);
        } else {
          hydrated = await this.fetchLatest({ onlyIfChanged: true, skipLegacyFallback: true });
        }
        if (hydrated && this.onDataCallback) {
          this.onDataCallback(hydrated);
        }
      } catch {
        // ignore transient realtime fetch glitch
      }
    }, 60);
  }

  private subscribeChannel() {
    if (!this.client) return;

    if (this.channel) {
      this.client.removeChannel(this.channel);
      this.channel = null;
    }

    this.channel = this.client
      .channel('supabase_realtime_inventory', {
        config: {
          broadcast: { self: false },
        },
      })
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inventory_state',
        },
        payload => {
          const newRow = payload.new as any;
          if (!newRow) return;

          if (newRow.id === MANIFEST_ROW_ID) {
            this.manifestV2ExistsOnRemote = true;
            if (newRow.data && newRow.data.__shardedV2) {
              this.scheduleRealtimeFetchFromRemote(newRow.data as SupabaseManifestV2);
            } else {
              this.scheduleRealtimeFetchFromRemote();
            }
            return;
          }

          if (typeof newRow.id === 'string' && newRow.id.startsWith('s2:')) {
            // Opportunistically warm local shard cache from WebSocket event; wait for manifest_v2 commit
            if (newRow.data && typeof newRow.data.hash === 'string') {
              this.shardCache.set(newRow.id, newRow.data as CachedShardPayload);
              this.remoteWrittenHashes.set(newRow.id, newRow.data.hash);
            }
            return;
          }

          if (
            newRow.id === LEGACY_ROW_ID &&
            !this.manifestV2ExistsOnRemote &&
            newRow.data &&
            !newRow.data.__shardedV2 &&
            Object.keys(newRow.data).length > 0 &&
            this.onDataCallback
          ) {
            this.onDataCallback(newRow.data as CentralDataPayload);
          }
        }
      )
      .on('broadcast', { event: 'inventory_broadcast' }, msg => {
        const incoming = msg?.payload;
        if (!incoming || !this.onDataCallback) return;

        if (incoming.__manifestPingV2) {
          if (
            incoming.version === this.lastHydratedVersion &&
            incoming.lastUpdated === this.lastHydratedUpdated
          ) {
            return;
          }
          this.scheduleRealtimeFetchFromRemote();
          return;
        }

        this.onDataCallback(incoming as CentralDataPayload);
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          this.setConnectionState('CONNECTED');
        } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
          this.setConnectionState('ERROR');
        } else if (status === 'CLOSED') {
          this.setConnectionState('DISCONNECTED');
        }
      });
  }

  private async fetchShardRowsByIds(ids: string[]): Promise<Map<string, CachedShardPayload>> {
    const fetched = new Map<string, CachedShardPayload>();
    if (!this.client || ids.length === 0) return fetched;

    const client = this.client;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += SELECT_BATCH_SIZE) {
      chunks.push(ids.slice(i, i + SELECT_BATCH_SIZE));
    }

    const tasks = chunks.map(chunkIds => async () => {
      const { data, error } = await client
        .from('inventory_state')
        .select('id, data')
        .in('id', chunkIds);

      if (!error && Array.isArray(data)) {
        for (let r = 0; r < data.length; r++) {
          const row = data[r] as any;
          if (row?.id && row?.data) {
            fetched.set(row.id, row.data as CachedShardPayload);
          }
        }
        return;
      }

      // Adaptive fallback: fetch 1 shard at a time if batch query hit statement timeout
      for (let s = 0; s < chunkIds.length; s++) {
        const singleId = chunkIds[s];
        await sleepMs(80);
        const { data: singleRow, error: singleErr } = await client
          .from('inventory_state')
          .select('id, data')
          .eq('id', singleId)
          .maybeSingle();

        if (!singleErr && singleRow?.data) {
          fetched.set(singleId, singleRow.data as CachedShardPayload);
        } else if (singleErr) {
          console.warn(`[Supabase Sync] Bỏ qua mảnh dữ liệu tạm thời (${singleId}):`, singleErr.message);
        }
      }
    });

    await runWithConcurrency(tasks, SELECT_CONCURRENCY);
    return fetched;
  }

  private async hydrateFromManifestV2(manifest: SupabaseManifestV2): Promise<CentralDataPayload> {
    const itemDescs = manifest.itemShards || [];
    const txDescs = manifest.txShards || [];
    const delDescs = manifest.delShards || [];

    const missingIds: string[] = [];
    const checkDescs = (descs: ShardDescriptor[]) => {
      for (let i = 0; i < descs.length; i++) {
        const d = descs[i];
        const cached = this.shardCache.get(d.id);
        if (!cached || cached.hash !== d.hash) {
          missingIds.push(d.id);
        }
      }
    };

    checkDescs(itemDescs);
    checkDescs(txDescs);
    checkDescs(delDescs);

    if (missingIds.length > 0) {
      const newlyFetched = await this.fetchShardRowsByIds(missingIds);
      newlyFetched.forEach((val, id) => {
        this.shardCache.set(id, val);
        if (val.hash) {
          this.remoteWrittenHashes.set(id, val.hash);
        }
      });
    }

    // Record all manifest hashes as known on remote
    for (let i = 0; i < itemDescs.length; i++) {
      if (this.shardCache.has(itemDescs[i].id)) {
        this.remoteWrittenHashes.set(itemDescs[i].id, itemDescs[i].hash);
      }
    }
    for (let i = 0; i < txDescs.length; i++) {
      if (this.shardCache.has(txDescs[i].id)) {
        this.remoteWrittenHashes.set(txDescs[i].id, txDescs[i].hash);
      }
    }
    for (let i = 0; i < delDescs.length; i++) {
      if (this.shardCache.has(delDescs[i].id)) {
        this.remoteWrittenHashes.set(delDescs[i].id, delDescs[i].hash);
      }
    }

    // Reconstruct deletedRegistry
    let deletedRegistry: DeletedRegistry = {};
    if (manifest.inlineDeletedRegistry) {
      deletedRegistry = { ...manifest.inlineDeletedRegistry };
    } else if (delDescs.length > 0) {
      for (let i = 0; i < delDescs.length; i++) {
        const shard = this.shardCache.get(delDescs[i].id);
        if (shard?.entries && typeof shard.entries === 'object') {
          Object.assign(deletedRegistry, shard.entries);
        }
      }
    }

    // Reconstruct transactions
    const transactions: Transaction[] = [];
    if (Array.isArray(manifest.inlineTransactions)) {
      for (let i = 0; i < manifest.inlineTransactions.length; i++) {
        transactions.push(hydrateTransactionFromShard(manifest.inlineTransactions[i]));
      }
    } else if (txDescs.length > 0) {
      for (let i = 0; i < txDescs.length; i++) {
        const shard = this.shardCache.get(txDescs[i].id);
        if (Array.isArray(shard?.records)) {
          for (let r = 0; r < shard!.records!.length; r++) {
            transactions.push(hydrateTransactionFromShard(shard!.records![r]));
          }
        }
      }
      transactions.sort((a, b) => {
        const ta = Date.parse(a.date || '') || Date.parse(a.updatedAt || '') || 0;
        const tb = Date.parse(b.date || '') || Date.parse(b.updatedAt || '') || 0;
        return tb - ta;
      });
    }

    // Reconstruct items + warehouseStocks in O(N + T)
    const rawItems: InventoryItem[] = [];
    if (Array.isArray(manifest.inlineItems)) {
      for (let i = 0; i < manifest.inlineItems.length; i++) {
        rawItems.push(hydrateItemFromShard(manifest.inlineItems[i]));
      }
    } else if (itemDescs.length > 0) {
      for (let i = 0; i < itemDescs.length; i++) {
        const shard = this.shardCache.get(itemDescs[i].id);
        if (Array.isArray(shard?.records)) {
          for (let r = 0; r < shard!.records!.length; r++) {
            rawItems.push(hydrateItemFromShard(shard!.records![r]));
          }
        }
      }
      rawItems.sort((a, b) => a.code.localeCompare(b.code, 'vi'));
    }

    const warehouses = Array.isArray(manifest.warehouses) ? manifest.warehouses : [];
    const computedStocks = calculateAllItemsWarehouseStocks(rawItems, warehouses, transactions);
    const hydratedItems: InventoryItem[] = new Array(rawItems.length);
    for (let i = 0; i < rawItems.length; i++) {
      const stocks = computedStocks[i] || {};
      let total = 0;
      const vals = Object.values(stocks);
      for (let v = 0; v < vals.length; v++) total += Number(vals[v]) || 0;
      hydratedItems[i] = {
        ...rawItems[i],
        warehouseStocks: stocks,
        currentStock: Math.max(0, total),
      };
    }

    const legacyDeleted = extractLegacyDeletedArrays(deletedRegistry);

    const fullPayload: CentralDataPayload = {
      version: Number(manifest.version) || 1,
      lastUpdated: manifest.lastUpdated || new Date().toISOString(),
      lastUpdatedBy: manifest.lastUpdatedBy,
      clientId: manifest.clientId,
      source: manifest.source,
      resetEpoch: manifest.resetEpoch,
      cleanReset: manifest.cleanReset,
      supabaseConfig: manifest.supabaseConfig,
      users: Array.isArray(manifest.users) ? manifest.users : [],
      warehouses,
      materialCategories: Array.isArray(manifest.materialCategories)
        ? manifest.materialCategories
        : [],
      transactions,
      items: hydratedItems,
      deletedRegistry,
      ...legacyDeleted,
    };

    this.lastHydratedVersion = fullPayload.version;
    this.lastHydratedUpdated = fullPayload.lastUpdated;
    this.lastHydratedPayload = fullPayload;
    return fullPayload;
  }

  /**
   * Lightweight poll helper: checks ONLY the small `manifest_v2` row (< 20KB) and skips
   * downloading shards when remote `(version, lastUpdated)` has not changed.
   */
  public async fetchLatestIfChanged(options?: {
    skipLegacyFallback?: boolean;
    forceCheck?: boolean;
  }): Promise<CentralDataPayload | null> {
    if (!this.client) return null;
    if (this.activePushPromise) return null;

    const now = Date.now();
    const minIntervalMs = this.currentState === 'CONNECTED' ? 8000 : 4000;
    if (!options?.forceCheck && now - this.lastPollCheckMs < minIntervalMs) {
      return null;
    }
    this.lastPollCheckMs = now;

    return this.fetchLatest({
      onlyIfChanged: true,
      skipLegacyFallback: options?.skipLegacyFallback,
    });
  }

  public async fetchLatest(options?: {
    onlyIfChanged?: boolean;
    skipLegacyFallback?: boolean;
  }): Promise<CentralDataPayload | null> {
    if (!this.client) return null;

    if (this.activeFetchPromise) {
      return this.activeFetchPromise;
    }

    this.activeFetchPromise = this.executeFetchLatestInternal(options).finally(() => {
      this.activeFetchPromise = null;
    });

    return this.activeFetchPromise;
  }

  private async executeFetchLatestInternal(options?: {
    onlyIfChanged?: boolean;
    skipLegacyFallback?: boolean;
  }): Promise<CentralDataPayload | null> {
    if (!this.client) return null;

    try {
      // 1. Always query lightweight Sharded V2 manifest row first (~5-15KB, < 20ms)
      const { data: v2Row, error: v2Err } = await this.client
        .from('inventory_state')
        .select('data')
        .eq('id', MANIFEST_ROW_ID)
        .maybeSingle();

      if (v2Err) {
        console.warn('[Supabase Sync] Tạm hoãn kiểm tra manifest:', v2Err.message);
        return null;
      }

      if (v2Row && v2Row.data && v2Row.data.__shardedV2) {
        this.manifestV2ExistsOnRemote = true;
        const manifest = v2Row.data as SupabaseManifestV2;

        if (
          options?.onlyIfChanged &&
          this.lastHydratedPayload &&
          manifest.version === this.lastHydratedVersion &&
          manifest.lastUpdated === this.lastHydratedUpdated
        ) {
          return null;
        }

        if (
          !options?.onlyIfChanged &&
          this.lastHydratedPayload &&
          manifest.version === this.lastHydratedVersion &&
          manifest.lastUpdated === this.lastHydratedUpdated
        ) {
          return this.lastHydratedPayload;
        }

        return await this.hydrateFromManifestV2(manifest);
      }

      // manifest_v2 does not exist yet on this Supabase project
      this.manifestV2ExistsOnRemote = false;

      if (options?.skipLegacyFallback || this.legacyDefaultChecked) {
        return null;
      }

      // 2. One-time safe fallback read of legacy `default` row with strict 2.8s abort guard
      this.legacyDefaultChecked = true;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2800);

      try {
        const { data: legacyRow, error: legacyErr } = await this.client
          .from('inventory_state')
          .select('data')
          .eq('id', LEGACY_ROW_ID)
          .abortSignal(controller.signal)
          .maybeSingle();

        clearTimeout(timeoutId);

        if (legacyErr) {
          console.warn(
            '[Supabase Sync] Bản ghi legacy quá lớn hoặc hết thời gian chờ, tự động chuyển sang Sharded V2:',
            legacyErr.message
          );
          return null;
        }

        if (legacyRow && legacyRow.data && Object.keys(legacyRow.data).length > 0) {
          const legacyPayload = legacyRow.data as CentralDataPayload;
          this.lastHydratedVersion = Number(legacyPayload.version) || 1;
          this.lastHydratedUpdated = legacyPayload.lastUpdated || '';
          this.lastHydratedPayload = legacyPayload;
          return legacyPayload;
        }
      } catch {
        clearTimeout(timeoutId);
      }

      return null;
    } catch (err: any) {
      console.warn('[Supabase Sync] Kết nối tạm gián đoạn khi đọc dữ liệu:', err?.message || err);
      return null;
    }
  }

  private buildShardsAndManifest(payload: CentralDataPayload): {
    manifest: SupabaseManifestV2;
    shardRows: { id: string; hash: string; data: CachedShardPayload }[];
  } {
    const shardRows: { id: string; hash: string; data: CachedShardPayload }[] = [];
    const items = payload.items || [];
    const transactions = payload.transactions || [];
    const deletedRegistry = payload.deletedRegistry || {};

    let inlineItems: Record<string, any>[] | undefined;
    let itemShards: ShardDescriptor[] | undefined;

    if (items.length <= INLINE_ITEMS_THRESHOLD) {
      inlineItems = items.map(slimItemForShard);
    } else {
      const numBuckets = pickBucketCount(items.length, TARGET_ITEMS_PER_SHARD);
      const buckets: Record<string, any>[][] = Array.from({ length: numBuckets }, () => []);

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const key = (it.code || it.id || '').trim().toUpperCase();
        const b = fnv1a32(key) & (numBuckets - 1);
        buckets[b].push(slimItemForShard(it));
      }

      itemShards = [];
      for (let b = 0; b < numBuckets; b++) {
        const bucketRecords = buckets[b];
        if (bucketRecords.length === 0) continue;
        bucketRecords.sort((x, y) => String(x.code || '').localeCompare(String(y.code || '')));
        const jsonStr = JSON.stringify(bucketRecords);
        const hash = computeContentHash(jsonStr);
        const shardId = `s2:i:${numBuckets}:${b}`;
        itemShards.push({ id: shardId, hash, count: bucketRecords.length });
        shardRows.push({
          id: shardId,
          hash,
          data: { hash, records: bucketRecords },
        });
      }
    }

    let inlineTransactions: Record<string, any>[] | undefined;
    let txShards: ShardDescriptor[] | undefined;

    if (transactions.length <= INLINE_TX_THRESHOLD) {
      inlineTransactions = transactions.map(slimTransactionForShard);
    } else {
      const numBuckets = pickBucketCount(transactions.length, TARGET_TX_PER_SHARD);
      const buckets: Record<string, any>[][] = Array.from({ length: numBuckets }, () => []);

      for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i];
        const key = (tx.id || tx.code || '').trim().toUpperCase();
        const b = fnv1a32(key) & (numBuckets - 1);
        buckets[b].push(slimTransactionForShard(tx));
      }

      txShards = [];
      for (let b = 0; b < numBuckets; b++) {
        const bucketRecords = buckets[b];
        if (bucketRecords.length === 0) continue;
        bucketRecords.sort((x, y) => String(x.id || '').localeCompare(String(y.id || '')));
        const jsonStr = JSON.stringify(bucketRecords);
        const hash = computeContentHash(jsonStr);
        const shardId = `s2:t:${numBuckets}:${b}`;
        txShards.push({ id: shardId, hash, count: bucketRecords.length });
        shardRows.push({
          id: shardId,
          hash,
          data: { hash, records: bucketRecords },
        });
      }
    }

    const delKeys = Object.keys(deletedRegistry);
    let inlineDeletedRegistry: DeletedRegistry | undefined;
    let delShards: ShardDescriptor[] | undefined;

    if (delKeys.length <= INLINE_DEL_THRESHOLD) {
      inlineDeletedRegistry = deletedRegistry;
    } else {
      const numBuckets = pickBucketCount(delKeys.length, TARGET_DEL_PER_SHARD);
      const bucketEntries: DeletedRegistry[] = Array.from({ length: numBuckets }, () => ({}));
      const bucketCounts = new Array<number>(numBuckets).fill(0);

      delKeys.sort();
      for (let i = 0; i < delKeys.length; i++) {
        const k = delKeys[i];
        const b = fnv1a32(k) & (numBuckets - 1);
        bucketEntries[b][k] = deletedRegistry[k];
        bucketCounts[b]++;
      }

      delShards = [];
      for (let b = 0; b < numBuckets; b++) {
        if (bucketCounts[b] === 0) continue;
        const entriesObj = bucketEntries[b];
        const jsonStr = JSON.stringify(entriesObj);
        const hash = computeContentHash(jsonStr);
        const shardId = `s2:d:${numBuckets}:${b}`;
        delShards.push({ id: shardId, hash, count: bucketCounts[b] });
        shardRows.push({
          id: shardId,
          hash,
          data: { hash, entries: entriesObj },
        });
      }
    }

    const manifest: SupabaseManifestV2 = {
      __shardedV2: true,
      version: payload.version,
      lastUpdated: payload.lastUpdated,
      lastUpdatedBy: payload.lastUpdatedBy,
      clientId: payload.clientId,
      source: payload.source,
      resetEpoch: payload.resetEpoch,
      cleanReset: payload.cleanReset,
      supabaseConfig: payload.supabaseConfig,
      users: payload.users || [],
      warehouses: payload.warehouses || [],
      materialCategories: payload.materialCategories || [],
      ...(inlineItems !== undefined ? { inlineItems } : { itemShards }),
      ...(inlineTransactions !== undefined ? { inlineTransactions } : { txShards }),
      ...(inlineDeletedRegistry !== undefined ? { inlineDeletedRegistry } : { delShards }),
    };

    return { manifest, shardRows };
  }

  private async upsertShardsAndManifest(
    manifest: SupabaseManifestV2,
    shardRows: { id: string; hash: string; data: CachedShardPayload }[],
    forceAllShards: boolean
  ): Promise<boolean> {
    if (!this.client) return false;
    const client = this.client;
    const nowIso = new Date().toISOString();

    // Only upload shards whose content hash changed since last known remote state
    const dirtyShards = forceAllShards
      ? shardRows
      : shardRows.filter(s => this.remoteWrittenHashes.get(s.id) !== s.hash);

    if (dirtyShards.length > 0) {
      const batches: { id: string; hash: string; data: CachedShardPayload }[][] = [];
      for (let i = 0; i < dirtyShards.length; i += UPSERT_BATCH_SIZE) {
        batches.push(dirtyShards.slice(i, i + UPSERT_BATCH_SIZE));
      }

      let allShardsOk = true;

      const tasks = batches.map(batch => async () => {
        const dbRows = batch.map(s => ({
          id: s.id,
          data: s.data,
          updated_at: nowIso,
        }));

        const { error } = await client
          .from('inventory_state')
          .upsert(dbRows, { onConflict: 'id' });

        if (!error) {
          for (let i = 0; i < batch.length; i++) {
            this.shardCache.set(batch[i].id, batch[i].data);
            this.remoteWrittenHashes.set(batch[i].id, batch[i].hash);
          }
          return;
        }

        // Adaptive 1-by-1 retry if a multi-shard batch timed out or hit transient contention
        for (let i = 0; i < batch.length; i++) {
          const single = batch[i];
          await sleepMs(120);
          const { error: singleErr } = await client.from('inventory_state').upsert(
            {
              id: single.id,
              data: single.data,
              updated_at: nowIso,
            },
            { onConflict: 'id' }
          );

          if (!singleErr) {
            this.shardCache.set(single.id, single.data);
            this.remoteWrittenHashes.set(single.id, single.hash);
          } else {
            allShardsOk = false;
            console.warn(
              `[Supabase Sync] Tạm hoãn ghi mảnh dữ liệu (${single.id}):`,
              singleErr.message
            );
          }
        }
      });

      await runWithConcurrency(tasks, UPSERT_CONCURRENCY);
      if (!allShardsOk) {
        return false;
      }
    } else {
      // Ensure local cache still tracks all clean shards
      for (let i = 0; i < shardRows.length; i++) {
        this.shardCache.set(shardRows[i].id, shardRows[i].data);
      }
    }

    // Commit manifest_v2 LAST (~5-20KB) so readers always see consistent committed shards
    let manifestSaved = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleepMs(180);
      const { error: manifestErr } = await client.from('inventory_state').upsert(
        {
          id: MANIFEST_ROW_ID,
          data: manifest,
          updated_at: nowIso,
        },
        { onConflict: 'id' }
      );
      if (!manifestErr) {
        manifestSaved = true;
        this.manifestV2ExistsOnRemote = true;
        break;
      }
      if (attempt === 1) {
        console.warn('[Supabase Sync] Tạm hoãn ghi manifest_v2:', manifestErr.message);
      }
    }

    return manifestSaved;
  }

  /**
   * Single-flight coalescing pushState:
   * - Serializes concurrent push calls so multiple mutations never lock the same Postgres rows.
   * - Fetches & reconciles only unseen remote shards before writing.
   * - Writes small hash-bucketed shards (< 50KB/row) to completely eliminate PostgreSQL 57014 timeouts.
   */
  public async pushState(payload: CentralDataPayload): Promise<CentralDataPayload | null> {
    if (!this.client) return null;

    if (this.activePushPromise) {
      if (payload.cleanReset || !this.queuedPushPayload) {
        this.queuedPushPayload = payload;
      } else {
        const mergedQueue = reconcileSyncPayloads(
          {
            users: this.queuedPushPayload.users || [],
            warehouses: this.queuedPushPayload.warehouses || [],
            materialCategories: this.queuedPushPayload.materialCategories || [],
            transactions: this.queuedPushPayload.transactions || [],
            items: this.queuedPushPayload.items || [],
            deletedRegistry: this.queuedPushPayload.deletedRegistry,
          },
          {
            users: payload.users || [],
            warehouses: payload.warehouses || [],
            materialCategories: payload.materialCategories || [],
            transactions: payload.transactions || [],
            items: payload.items || [],
            deletedRegistry: payload.deletedRegistry,
          }
        );
        this.queuedPushPayload = {
          ...this.queuedPushPayload,
          ...payload,
          ...mergedQueue,
          version: Math.max(Number(this.queuedPushPayload.version) || 0, Number(payload.version) || 0) + 1,
          lastUpdated: new Date().toISOString(),
        };
      }
      return this.activePushPromise;
    }

    this.activePushPromise = (async () => {
      let currentToPush: CentralDataPayload | null = payload;
      let latestResult: CentralDataPayload | null = null;

      while (currentToPush) {
        const nextBatch = currentToPush;
        currentToPush = null;
        const res = await this.executePushStateInternal(nextBatch);
        if (res) latestResult = res;

        if (this.queuedPushPayload) {
          currentToPush = this.queuedPushPayload;
          this.queuedPushPayload = null;
        }
      }

      return latestResult;
    })().finally(() => {
      this.activePushPromise = null;
    });

    return this.activePushPromise;
  }

  private async executePushStateInternal(
    payload: CentralDataPayload
  ): Promise<CentralDataPayload | null> {
    if (!this.client) return null;

    try {
      let existingRemote: CentralDataPayload | null = null;

      if (!payload.cleanReset) {
        // Fast remote check: skips downloading shards already cached in memory
        existingRemote = await this.fetchLatest({
          onlyIfChanged: false,
          skipLegacyFallback: (payload.items?.length || 0) > INLINE_ITEMS_THRESHOLD,
        });
      }

      let finalPayload: CentralDataPayload = payload;

      if (existingRemote && !payload.cleanReset) {
        const reconciled = reconcileSyncPayloads(
          {
            users: existingRemote.users || [],
            warehouses: existingRemote.warehouses || [],
            materialCategories: existingRemote.materialCategories || [],
            transactions: existingRemote.transactions || [],
            items: existingRemote.items || [],
            deletedRegistry: existingRemote.deletedRegistry,
            deletedItemIds: existingRemote.deletedItemIds,
            deletedTransactionIds: existingRemote.deletedTransactionIds,
            deletedUserIds: existingRemote.deletedUserIds,
            deletedWarehouseIds: existingRemote.deletedWarehouseIds,
            deletedCategoryIds: existingRemote.deletedCategoryIds,
          },
          {
            users: payload.users || [],
            warehouses: payload.warehouses || [],
            materialCategories: payload.materialCategories || [],
            transactions: payload.transactions || [],
            items: payload.items || [],
            deletedRegistry: payload.deletedRegistry,
            deletedItemIds: payload.deletedItemIds,
            deletedTransactionIds: payload.deletedTransactionIds,
            deletedUserIds: payload.deletedUserIds,
            deletedWarehouseIds: payload.deletedWarehouseIds,
            deletedCategoryIds: payload.deletedCategoryIds,
          }
        );

        finalPayload = {
          ...existingRemote,
          ...payload,
          version:
            Math.max(Number(existingRemote.version) || 0, Number(payload.version) || 0) + 1,
          lastUpdated: new Date().toISOString(),
          users: reconciled.users,
          warehouses: reconciled.warehouses,
          materialCategories: reconciled.materialCategories,
          transactions: reconciled.transactions,
          items: reconciled.items,
          deletedRegistry: reconciled.deletedRegistry,
          deletedItemIds: reconciled.deletedItemIds,
          deletedTransactionIds: reconciled.deletedTransactionIds,
          deletedUserIds: reconciled.deletedUserIds,
          deletedWarehouseIds: reconciled.deletedWarehouseIds,
          deletedCategoryIds: reconciled.deletedCategoryIds,
        };
      }

      const { manifest, shardRows } = this.buildShardsAndManifest(finalPayload);

      // Pre-mark hydrated version before committing manifest so our own Realtime echo is ignored
      const prevVersion = this.lastHydratedVersion;
      const prevUpdated = this.lastHydratedUpdated;
      const prevPayload = this.lastHydratedPayload;

      this.lastHydratedVersion = finalPayload.version;
      this.lastHydratedUpdated = finalPayload.lastUpdated;
      this.lastHydratedPayload = finalPayload;

      const saved = await this.upsertShardsAndManifest(
        manifest,
        shardRows,
        Boolean(payload.cleanReset)
      );

      if (!saved) {
        this.lastHydratedVersion = prevVersion;
        this.lastHydratedUpdated = prevUpdated;
        this.lastHydratedPayload = prevPayload;
        return null;
      }

      // Broadcast over WebSocket: inline for small datasets, lightweight ping for large datasets (>120 items)
      if (this.channel && this.currentState === 'CONNECTED') {
        const isSmallPayload =
          (finalPayload.items?.length || 0) <= INLINE_ITEMS_THRESHOLD &&
          (finalPayload.transactions?.length || 0) <= INLINE_TX_THRESHOLD;

        const wsPayload = isSmallPayload
          ? finalPayload
          : {
              __manifestPingV2: true,
              version: finalPayload.version,
              lastUpdated: finalPayload.lastUpdated,
              source: finalPayload.source,
            };

        this.channel
          .send({
            type: 'broadcast',
            event: 'inventory_broadcast',
            payload: wsPayload,
          })
          .catch(() => {});
      }

      return finalPayload;
    } catch (err: any) {
      console.warn('[Supabase Sync] Tạm hoãn đồng bộ đám mây:', err?.message || err);
      return null;
    }
  }

  public cleanup() {
    this.resetInternalCaches();
    if (this.channel && this.client) {
      this.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.client = null;
    this.currentState = 'UNCONFIGURED';
  }
}

export const supabaseRealtimeService = new SupabaseRealtimeService();
