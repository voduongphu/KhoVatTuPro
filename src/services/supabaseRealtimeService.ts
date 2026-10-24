import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { CentralDataPayload } from './centralSyncService';
import { reconcileSyncPayloads } from '../utils/mergeSyncData';

export type RealtimeConnectionState = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR' | 'UNCONFIGURED';

const STORAGE_KEYS = {
  SUPABASE_URL: 'nxt_supabase_url',
  SUPABASE_KEY: 'nxt_supabase_anon_key',
};

class SupabaseRealtimeService {
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private currentState: RealtimeConnectionState = 'UNCONFIGURED';
  private listeners: ((state: RealtimeConnectionState) => void)[] = [];
  private onDataCallback: ((payload: CentralDataPayload) => void) | null = null;

  constructor() {
    this.initClient();
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
        console.error('Error in connection state listener:', err);
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
      console.error('Failed to initialize Supabase client:', err);
      this.setConnectionState('ERROR');
    }
  }

  public subscribe(onUpdate: (payload: CentralDataPayload) => void) {
    this.onDataCallback = onUpdate;
    if (this.client && !this.channel) {
      this.subscribeChannel();
    }
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
          if (newRow && newRow.data && this.onDataCallback) {
            this.onDataCallback(newRow.data as CentralDataPayload);
          }
        }
      )
      .on('broadcast', { event: 'inventory_broadcast' }, msg => {
        if (msg?.payload && this.onDataCallback) {
          this.onDataCallback(msg.payload as CentralDataPayload);
        }
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

  public async fetchLatest(): Promise<CentralDataPayload | null> {
    if (!this.client) return null;

    try {
      const { data, error } = await this.client
        .from('inventory_state')
        .select('*')
        .eq('id', 'default')
        .maybeSingle();

      if (error) {
        console.error('[Supabase Realtime] Fetch error:', error);
        return null;
      }

      if (data && data.data && Object.keys(data.data).length > 0) {
        return data.data as CentralDataPayload;
      }
      return null;
    } catch (err) {
      console.error('[Supabase Realtime] Exception fetching:', err);
      return null;
    }
  }

  /**
   * Fetch-and-merge trước khi Upsert lên Supabase để KHÔNG BAO GIỜ ghi đè làm mất
   * vật tư hoặc phiếu nhập/xuất của người dùng khác vừa tạo đồng thời!
   */
  public async pushState(payload: CentralDataPayload): Promise<CentralDataPayload | null> {
    if (!this.client) return null;

    try {
      const existingRemote = await this.fetchLatest();
      let finalPayload: CentralDataPayload = payload;

      if (existingRemote && !payload.cleanReset) {
        const reconciled = reconcileSyncPayloads(
          {
            users: existingRemote.users || [],
            warehouses: existingRemote.warehouses || [],
            transactions: existingRemote.transactions || [],
            items: existingRemote.items || [],
            deletedRegistry: existingRemote.deletedRegistry,
            deletedItemIds: existingRemote.deletedItemIds,
            deletedTransactionIds: existingRemote.deletedTransactionIds,
            deletedUserIds: existingRemote.deletedUserIds,
            deletedWarehouseIds: existingRemote.deletedWarehouseIds,
          },
          {
            users: payload.users || [],
            warehouses: payload.warehouses || [],
            transactions: payload.transactions || [],
            items: payload.items || [],
            deletedRegistry: payload.deletedRegistry,
            deletedItemIds: payload.deletedItemIds,
            deletedTransactionIds: payload.deletedTransactionIds,
            deletedUserIds: payload.deletedUserIds,
            deletedWarehouseIds: payload.deletedWarehouseIds,
          }
        );

        finalPayload = {
          ...existingRemote,
          ...payload,
          version: Math.max(Number(existingRemote.version) || 0, Number(payload.version) || 0) + 1,
          lastUpdated: new Date().toISOString(),
          users: reconciled.users,
          warehouses: reconciled.warehouses,
          transactions: reconciled.transactions,
          items: reconciled.items,
          deletedRegistry: reconciled.deletedRegistry,
          deletedItemIds: reconciled.deletedItemIds,
          deletedTransactionIds: reconciled.deletedTransactionIds,
          deletedUserIds: reconciled.deletedUserIds,
          deletedWarehouseIds: reconciled.deletedWarehouseIds,
        };
      }

      const { error } = await this.client.from('inventory_state').upsert(
        {
          id: 'default',
          data: finalPayload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );

      if (error) {
        console.error('[Supabase Realtime] Upsert error:', error);
        return null;
      }

      // Broadcast ngay qua WebSocket channel (phòng trường hợp bảng chưa bật REPLICA IDENTITY FULL)
      if (this.channel && this.currentState === 'CONNECTED') {
        this.channel
          .send({
            type: 'broadcast',
            event: 'inventory_broadcast',
            payload: finalPayload,
          })
          .catch(() => {});
      }

      return finalPayload;
    } catch (err) {
      console.error('[Supabase Realtime] Exception pushing state:', err);
      return null;
    }
  }

  public cleanup() {
    if (this.channel && this.client) {
      this.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.client = null;
    this.currentState = 'UNCONFIGURED';
  }
}

export const supabaseRealtimeService = new SupabaseRealtimeService();
