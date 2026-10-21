/**
 * Vercel Serverless Function: /api/sync
 * 
 * Supports:
 * 1. Vercel Edge Config (Global Config Store) - Ultra low-latency global KV store
 * 2. Vercel KV (Upstash Redis REST)
 * 3. Supabase (PostgreSQL REST with RLS)
 * 4. In-Memory fallback for development
 */

import { get as getEdgeConfig } from '@vercel/edge-config';

// In-memory fallback for local development or before cloud storage is linked
let localMemoryState: any = null;

const STATE_KEY = 'nxt_inventory_state_v1';

/**
 * 1. VERCEL EDGE CONFIG (Global Config Store)
 * Ultra-fast global read replication at the Edge (<15ms latency worldwide)
 */
async function fetchFromEdgeConfig(): Promise<any | null> {
  const edgeConfigUrl = process.env.EDGE_CONFIG;
  if (!edgeConfigUrl) {
    return null;
  }

  try {
    // Attempt using @vercel/edge-config SDK
    const data = await getEdgeConfig(STATE_KEY);
    if (data) {
      return typeof data === 'string' ? JSON.parse(data) : data;
    }
  } catch (sdkErr) {
    console.warn('Edge Config SDK get failed, trying direct REST read:', sdkErr);
  }

  try {
    // Direct REST fallback if SDK has connectivity issue or custom format
    const url = new URL(edgeConfigUrl);
    // Path: /<id>/item/<key>
    const cleanPath = url.pathname.replace(/\/items?$/, '');
    const itemEndpoint = `${url.origin}${cleanPath}/item/${STATE_KEY}${url.search}`;

    const res = await fetch(itemEndpoint, {
      cache: 'no-store',
    });

    if (res.ok) {
      const result = await res.json();
      return typeof result === 'string' ? JSON.parse(result) : result;
    }
    return null;
  } catch (err) {
    console.error('Error reading from Vercel Edge Config:', err);
    return null;
  }
}

async function saveToEdgeConfig(state: any): Promise<boolean> {
  const edgeConfigUrl = process.env.EDGE_CONFIG;
  const writeToken = process.env.VERCEL_API_TOKEN || process.env.EDGE_CONFIG_WRITE_TOKEN;

  if (!edgeConfigUrl || !writeToken) {
    return false;
  }

  // Extract Edge Config ID from connection string: https://edge-config.vercel.com/ecfg_xxxx?token=...
  let edgeConfigId = process.env.EDGE_CONFIG_ID;
  if (!edgeConfigId) {
    const match = edgeConfigUrl.match(/ecfg_[a-zA-Z0-9_-]+/);
    if (match) {
      edgeConfigId = match[0];
    }
  }

  if (!edgeConfigId) {
    console.error('Cannot extract Edge Config ID from EDGE_CONFIG');
    return false;
  }

  try {
    const res = await fetch(`https://api.vercel.com/v1/edge-config/${edgeConfigId}/items`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [
          {
            operation: 'upsert',
            key: STATE_KEY,
            value: state,
          },
        ],
      }),
    });

    return res.ok;
  } catch (err) {
    console.error('Error saving to Vercel Edge Config:', err);
    return false;
  }
}

/**
 * 2. VERCEL KV (Upstash Redis)
 */
async function fetchFromVercelKV(): Promise<any | null> {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return null;
  }

  try {
    const res = await fetch(`${kvUrl}/get/${STATE_KEY}`, {
      headers: {
        Authorization: `Bearer ${kvToken}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.result) {
      return typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
    }
    return null;
  } catch (err) {
    console.error('Error reading from Vercel KV:', err);
    return null;
  }
}

async function saveToVercelKV(state: any): Promise<boolean> {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return false;
  }

  try {
    const res = await fetch(`${kvUrl}/set/${STATE_KEY}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kvToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(typeof state === 'string' ? state : JSON.stringify(state)),
    });

    return res.ok;
  } catch (err) {
    console.error('Error saving to Vercel KV:', err);
    return false;
  }
}

/**
 * 3. SUPABASE (PostgreSQL REST with RLS)
 */
async function fetchFromSupabase(): Promise<any | null> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/inventory_state?id=eq.default&select=*`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) return null;
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0) {
      return rows[0].data;
    }
    return null;
  } catch (err) {
    console.error('Error reading from Supabase:', err);
    return null;
  }
}

async function saveToSupabase(state: any): Promise<boolean> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return false;
  }

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
  } catch (err) {
    console.error('Error saving to Supabase:', err);
    return false;
  }
}

export default async function handler(req: any, res: any) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const hasEdgeConfig = !!process.env.EDGE_CONFIG;
  const hasKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  const hasSupabase = !!(
    (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  );

  const provider = hasEdgeConfig
    ? 'vercel-edge-config'
    : hasKV
    ? 'vercel-kv'
    : hasSupabase
    ? 'supabase'
    : 'local-memory';

  // GET: Fetch central state
  if (req.method === 'GET') {
    let state = null;

    if (hasEdgeConfig) {
      state = await fetchFromEdgeConfig();
    } else if (hasKV) {
      state = await fetchFromVercelKV();
    } else if (hasSupabase) {
      state = await fetchFromSupabase();
    }

    if (!state) {
      state = localMemoryState;
    }

    return res.status(200).json({
      success: true,
      provider,
      payload: state,
    });
  }

function mergeStateAdditive(existing: any, incoming: any) {
  if (!existing) return incoming;
  if (!incoming) return existing;

  // Merge deleted IDs (Tombstones) so deletions by Admin or users are respected across devices
  const deletedUserIds = Array.from(
    new Set([
      ...(existing.deletedUserIds || []).map((s: string) => String(s).toLowerCase()),
      ...(incoming.deletedUserIds || []).map((s: string) => String(s).toLowerCase()),
    ])
  );
  const deletedTrxIds = Array.from(
    new Set([
      ...(existing.deletedTransactionIds || []).map((s: string) => String(s).toUpperCase()),
      ...(incoming.deletedTransactionIds || []).map((s: string) => String(s).toUpperCase()),
    ])
  );
  const deletedItemIds = Array.from(
    new Set([
      ...(existing.deletedItemIds || []).map((s: string) => String(s).toUpperCase()),
      ...(incoming.deletedItemIds || []).map((s: string) => String(s).toUpperCase()),
    ])
  );
  const deletedWarehouseIds = Array.from(
    new Set([
      ...(existing.deletedWarehouseIds || []).map((s: string) => String(s).toUpperCase()),
      ...(incoming.deletedWarehouseIds || []).map((s: string) => String(s).toUpperCase()),
    ])
  );

  const delUserSet = new Set(deletedUserIds);
  const delTrxSet = new Set(deletedTrxIds);
  const delItemSet = new Set(deletedItemIds);
  const delWhSet = new Set(deletedWarehouseIds);

  // 1. Users merge (respecting deletions & admin edits)
  const userMap = new Map<string, any>();
  (existing.users || []).forEach((u: any) => {
    const key = (u.username || u.id || '').trim().toLowerCase();
    const idKey = (u.id || '').trim().toLowerCase();
    if (key && !delUserSet.has(key) && !delUserSet.has(idKey)) {
      userMap.set(key, u);
    }
  });
  (incoming.users || []).forEach((u: any) => {
    const key = (u.username || u.id || '').trim().toLowerCase();
    const idKey = (u.id || '').trim().toLowerCase();
    if (!key || delUserSet.has(key) || delUserSet.has(idKey)) return;

    const prev = userMap.get(key);
    if (!prev) {
      userMap.set(key, u);
    } else {
      const prevTime = prev.updatedAt
        ? new Date(prev.updatedAt).getTime()
        : prev.lastActiveAt
        ? new Date(prev.lastActiveAt).getTime()
        : 0;
      const incTime = u.updatedAt
        ? new Date(u.updatedAt).getTime()
        : u.lastActiveAt
        ? new Date(u.lastActiveAt).getTime()
        : 0;
      const useInc = incTime >= prevTime;
      userMap.set(key, { ...(useInc ? prev : u), ...(useInc ? u : prev) });
    }
  });

  // 2. Transactions merge (respecting deletions & admin edits)
  const trxMap = new Map<string, any>();
  (existing.transactions || []).forEach((t: any) => {
    const key = (t.id || t.code || '').trim().toUpperCase();
    const codeKey = (t.code || '').trim().toUpperCase();
    if (key && !delTrxSet.has(key) && !delTrxSet.has(codeKey)) {
      trxMap.set(key, t);
    }
  });
  (incoming.transactions || []).forEach((t: any) => {
    const key = (t.id || t.code || '').trim().toUpperCase();
    const codeKey = (t.code || '').trim().toUpperCase();
    if (!key || delTrxSet.has(key) || delTrxSet.has(codeKey)) return;

    const prev = trxMap.get(key);
    if (!prev) {
      trxMap.set(key, t);
    } else {
      const prevTime = prev.updatedAt
        ? new Date(prev.updatedAt).getTime()
        : new Date(prev.date).getTime() || 0;
      const incTime = t.updatedAt
        ? new Date(t.updatedAt).getTime()
        : new Date(t.date).getTime() || 0;
      const useInc = incTime >= prevTime;
      trxMap.set(key, {
        ...(useInc ? prev : t),
        ...(useInc ? t : prev),
        items: useInc && t.items ? t.items : prev.items || t.items,
        totalAmount: useInc && t.totalAmount !== undefined ? t.totalAmount : prev.totalAmount ?? t.totalAmount,
      });
    }
  });

  // 3. Warehouses merge
  const whMap = new Map<string, any>();
  (existing.warehouses || []).forEach((w: any) => {
    const key = (w.id || w.code || '').trim().toUpperCase();
    if (key && !delWhSet.has(key)) whMap.set(key, w);
  });
  (incoming.warehouses || []).forEach((w: any) => {
    const key = (w.id || w.code || '').trim().toUpperCase();
    if (!key || delWhSet.has(key)) return;
    const prev = whMap.get(key);
    if (!prev) {
      whMap.set(key, w);
    } else {
      const prevTime = prev.updatedAt ? new Date(prev.updatedAt).getTime() : 0;
      const incTime = w.updatedAt ? new Date(w.updatedAt).getTime() : 0;
      const useInc = incTime >= prevTime;
      whMap.set(key, { ...(useInc ? prev : w), ...(useInc ? w : prev) });
    }
  });

  // 4. Items merge
  const itemMap = new Map<string, any>();
  (existing.items || []).forEach((i: any) => {
    const key = (i.code || i.id || '').trim().toUpperCase();
    const idKey = (i.id || '').trim().toUpperCase();
    if (key && !delItemSet.has(key) && !delItemSet.has(idKey)) {
      itemMap.set(key, i);
    }
  });
  (incoming.items || []).forEach((i: any) => {
    const key = (i.code || i.id || '').trim().toUpperCase();
    const idKey = (i.id || '').trim().toUpperCase();
    if (!key || delItemSet.has(key) || delItemSet.has(idKey)) return;

    const prev = itemMap.get(key);
    if (!prev) {
      itemMap.set(key, i);
    } else {
      const prevTime = prev.updatedAt ? new Date(prev.updatedAt).getTime() : 0;
      const incTime = i.updatedAt ? new Date(i.updatedAt).getTime() : 0;
      const useInc = incTime >= prevTime;
      const base = useInc ? prev : i;
      const newer = useInc ? i : prev;

      itemMap.set(key, {
        ...base,
        ...newer,
        warehouseStocks: { ...(base.warehouseStocks || {}), ...(newer.warehouseStocks || {}) },
        currentStock: newer.currentStock !== undefined ? newer.currentStock : base.currentStock,
      });
    }
  });

  return {
    version: Math.max(Number(existing.version) || 0, Number(incoming.version) || 0) + 1,
    lastUpdated: new Date().toISOString(),
    users: Array.from(userMap.values()),
    transactions: Array.from(trxMap.values()).sort(
      (a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()
    ),
    warehouses: Array.from(whMap.values()),
    items: Array.from(itemMap.values()),
    deletedUserIds,
    deletedTransactionIds: deletedTrxIds,
    deletedItemIds,
    deletedWarehouseIds,
    source: incoming.source || 'server-additive-merge',
  };
}

  // POST: Update central state
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const payload = body?.payload;

    if (!payload) {
      return res.status(400).json({ success: false, error: 'Thiếu dữ liệu payload' });
    }

    // 1. Fetch current existing state to perform additive merge
    let existingState = null;
    if (hasEdgeConfig) {
      existingState = await fetchFromEdgeConfig();
    } else if (hasKV) {
      existingState = await fetchFromVercelKV();
    } else if (hasSupabase) {
      existingState = await fetchFromSupabase();
    }
    if (!existingState) {
      existingState = localMemoryState;
    }

    // 2. Merge additively: never overwrite or erase existing items, transactions, or users
    const mergedPayload =
      body.cleanReset || payload.cleanReset
        ? payload
        : mergeStateAdditive(existingState, payload);
    localMemoryState = mergedPayload;

    let saved = false;
    if (hasEdgeConfig) {
      saved = await saveToEdgeConfig(mergedPayload);
      if (!saved && !process.env.VERCEL_API_TOKEN && !process.env.EDGE_CONFIG_WRITE_TOKEN) {
        console.warn('EDGE_CONFIG is active for reading, but VERCEL_API_TOKEN is needed for cloud write persistence.');
      }
    } else if (hasKV) {
      saved = await saveToVercelKV(mergedPayload);
    } else if (hasSupabase) {
      saved = await saveToSupabase(mergedPayload);
    } else {
      saved = true;
    }

    return res.status(200).json({
      success: true,
      provider,
      savedToCloud: saved,
      version: mergedPayload.version,
      lastUpdated: mergedPayload.lastUpdated,
      payload: mergedPayload,
    });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
