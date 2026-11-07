import { InventoryItem, MaterialCategory, Transaction, User, Warehouse } from '../types/inventory';
import { DeletedRegistry } from '../utils/mergeSyncData';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';
export type CloudProvider = 'firestore' | 'local';

export interface CentralDataPayload {
  version: number;
  lastUpdated: string;
  items: InventoryItem[];
  transactions: Transaction[];
  warehouses: Warehouse[];
  materialCategories?: MaterialCategory[];
  users?: User[];
  deletedRegistry?: DeletedRegistry;
  deletedUserIds?: string[];
  deletedTransactionIds?: string[];
  deletedItemIds?: string[];
  deletedWarehouseIds?: string[];
  deletedCategoryIds?: string[];
  supabaseConfig?: {
    url: string;
    key: string;
  };
  clientId?: string;
  lastUpdatedBy?: string;
  source?: string;
  resetEpoch?: string;
  cleanReset?: boolean;
}

export interface SyncResult {
  success: boolean;
  payload?: CentralDataPayload;
  provider: CloudProvider;
  error?: string;
  isNewer?: boolean;
  notModified?: boolean;
}

class CentralSyncService {
  private lastFetchedTimestamp: string | null = null;
  private currentVersion: number = 0;
  private provider: CloudProvider = 'firestore';
  private eventSource: EventSource | null = null;
  private reconnectTimer: any = null;

  constructor() {
    this.detectProvider();
  }

  public detectProvider(): CloudProvider {
    this.provider = 'firestore';
    return 'firestore';
  }

  public getProvider(): CloudProvider {
    return this.provider;
  }

  public getCurrentVersion(): number {
    return this.currentVersion;
  }

  /**
   * Lắng nghe luồng đồng bộ thời gian thực (SSE) từ máy chủ trung tâm (/api/sync/stream)
   */
  public subscribeToStream(
    onPayload: (payload: CentralDataPayload) => void,
    onStatusChange?: (connected: boolean) => void
  ): () => void {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return () => {};
    }

    let isDisposed = false;

    const connect = () => {
      if (isDisposed) return;
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }

      try {
        const es = new EventSource('/api/sync/stream');
        this.eventSource = es;

        es.onopen = () => {
          if (isDisposed) return;
          onStatusChange?.(true);
        };

        es.onmessage = event => {
          if (isDisposed || !event.data) return;
          try {
            const parsed = JSON.parse(event.data);
            if (parsed && parsed.type === 'SYNC_STATE' && parsed.payload) {
              const payload = parsed.payload as CentralDataPayload;
              this.lastFetchedTimestamp = payload.lastUpdated;
              this.currentVersion = Math.max(this.currentVersion, Number(payload.version) || 0);
              onPayload(payload);
            }
          } catch {
            // ignore malformed frame
          }
        };

        es.onerror = () => {
          onStatusChange?.(false);
          es.close();
          if (this.eventSource === es) {
            this.eventSource = null;
          }
          if (!isDisposed) {
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(connect, 2500);
          }
        };
      } catch {
        onStatusChange?.(false);
        if (!isDisposed) {
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(connect, 3000);
        }
      }
    };

    connect();

    return () => {
      isDisposed = true;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
    };
  }

  /**
   * Fetch central state from /api/sync.
   * Uses `sinceVersion` when `forceFull` is false so 3-second polling doesn't re-download or re-merge 5,000+ rows when unchanged.
   */
  public async fetchLatestData(
    currentLastUpdated?: string,
    forceFull: boolean = false
  ): Promise<SyncResult> {
    try {
      const versionParam =
        !forceFull && this.currentVersion > 0 ? `&sinceVersion=${this.currentVersion}` : '';
      const response = await fetch(`/api/sync?t=${Date.now()}${versionParam}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.notModified) {
          this.provider = data.provider || 'central-server';
          return {
            success: true,
            provider: this.provider,
            isNewer: false,
            notModified: true,
          };
        }

        if (data && data.success && data.payload) {
          const payload = data.payload as CentralDataPayload;
          const remoteTime = new Date(payload.lastUpdated).getTime();
          const localTime = currentLastUpdated ? new Date(currentLastUpdated).getTime() : 0;
          const isNewer =
            isNaN(remoteTime) ||
            remoteTime > localTime ||
            (Number(payload.version) || 0) > this.currentVersion;

          this.lastFetchedTimestamp = payload.lastUpdated;
          this.currentVersion = Math.max(this.currentVersion, Number(payload.version) || 0);
          this.provider = data.provider || 'central-server';

          return {
            success: true,
            payload,
            provider: this.provider,
            isNewer,
          };
        }
      }

      return {
        success: true,
        provider: 'local',
        isNewer: false,
      };
    } catch (err: any) {
      return {
        success: false,
        provider: this.provider,
        error: err?.message || 'Không thể kết nối đến máy chủ đồng bộ',
      };
    }
  }

  /**
   * Push current state to central server (/api/sync) and return the authoritative merged state!
   */
  public async pushUpdate(
    payload: Omit<CentralDataPayload, 'version' | 'lastUpdated'>,
    options?: { skipRemoteCloudSave?: boolean }
  ): Promise<SyncResult> {
    const fullPayload: CentralDataPayload = {
      ...payload,
      version: Math.max(1, this.currentVersion) + 1,
      lastUpdated: new Date().toISOString(),
      source: payload.source || 'web-client',
    };

    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payload: fullPayload,
          skipRemoteCloudSave: Boolean(options?.skipRemoteCloudSave),
        }),
      });

      if (response.ok) {
        const resData = await response.json();
        const serverMergedPayload = (resData?.payload as CentralDataPayload) || fullPayload;
        this.currentVersion = Math.max(
          this.currentVersion,
          Number(serverMergedPayload.version) || fullPayload.version
        );
        this.lastFetchedTimestamp = serverMergedPayload.lastUpdated || fullPayload.lastUpdated;
        this.provider = resData?.provider || 'central-server';

        return {
          success: true,
          payload: serverMergedPayload,
          provider: this.provider,
        };
      }

      return {
        success: false,
        payload: fullPayload,
        provider: 'local',
        error: `Máy chủ trả về mã lỗi ${response.status}`,
      };
    } catch (err: any) {
      return {
        success: false,
        provider: this.provider,
        error: err?.message || 'Lỗi khi gửi dữ liệu lên máy chủ',
      };
    }
  }
}

export const centralSyncService = new CentralSyncService();
