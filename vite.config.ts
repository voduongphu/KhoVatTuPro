import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

function mergeServerStateAdditive(existing: any, incoming: any) {
  if (!existing) return incoming;
  if (!incoming) return existing;

  // Active incoming items / transactions / users must NEVER be blocked by stale deleted IDs
  const activeIncomingTrxKeys = new Set(
    (incoming.transactions || []).flatMap((t: any) => [
      (t.id || '').trim().toUpperCase(),
      (t.code || '').trim().toUpperCase(),
    ]).filter(Boolean)
  );
  const activeIncomingItemKeys = new Set(
    (incoming.items || []).flatMap((i: any) => [
      (i.id || '').trim().toUpperCase(),
      (i.code || '').trim().toUpperCase(),
    ]).filter(Boolean)
  );
  const activeIncomingUserKeys = new Set(
    (incoming.users || []).flatMap((u: any) => [
      (u.id || '').trim().toLowerCase(),
      (u.username || '').trim().toLowerCase(),
    ]).filter(Boolean)
  );

  const deletedUserIds = Array.from(
    new Set([
      ...(existing.deletedUserIds || []).map((s: string) => String(s).toLowerCase()),
      ...(incoming.deletedUserIds || []).map((s: string) => String(s).toLowerCase()),
    ])
  ).filter(id => !activeIncomingUserKeys.has(id) && id !== 'admin' && id !== 'usr-admin');

  const deletedTrxIds = Array.from(
    new Set([
      ...(existing.deletedTransactionIds || []).map((s: string) => String(s).toUpperCase()),
      ...(incoming.deletedTransactionIds || []).map((s: string) => String(s).toUpperCase()),
    ])
  ).filter(id => !activeIncomingTrxKeys.has(id));

  const deletedItemIds = Array.from(
    new Set([
      ...(existing.deletedItemIds || []).map((s: string) => String(s).toUpperCase()),
      ...(incoming.deletedItemIds || []).map((s: string) => String(s).toUpperCase()),
    ])
  ).filter(id => !activeIncomingItemKeys.has(id));

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

  const seenUserIds = new Set<string>();
  const sanitizedUsers = Array.from(userMap.values()).map((u: any) => {
    let uniqueId = u.id || `USR-${String(u.username).toUpperCase()}`;
    if (uniqueId === 'USR-ADMIN' && String(u.username).toLowerCase() !== 'admin') {
      uniqueId = `USR-${String(u.username).toUpperCase()}`;
    }
    if (seenUserIds.has(uniqueId)) {
      uniqueId = `USR-${String(u.username).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    }
    seenUserIds.add(uniqueId);
    return { ...u, id: uniqueId };
  });

  return {
    version: Math.max(Number(existing.version) || 0, Number(incoming.version) || 0) + 1,
    lastUpdated: new Date().toISOString(),
    users: sanitizedUsers,
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

function syncApiPlugin() {
  const STATE_FILE = path.resolve(__dirname, '.sync-state.json');
  let memoryState: any = null;

  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      memoryState = JSON.parse(raw);
    }
  } catch {
    memoryState = null;
  }

  return {
    name: 'vite-plugin-sync-api',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const url = req.url || '';
        if (url === '/api/sync' || url.startsWith('/api/sync?')) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }

          if (req.method === 'GET') {
            try {
              if (fs.existsSync(STATE_FILE)) {
                memoryState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
              }
            } catch {
              // keep existing memoryState
            }
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(
              JSON.stringify({
                success: true,
                provider: 'central-server',
                payload: memoryState,
              })
            );
            return;
          }

          if (req.method === 'POST') {
            let bodyStr = '';
            req.on('data', (chunk: any) => {
              bodyStr += chunk;
            });
            req.on('end', () => {
              try {
                const body = JSON.parse(bodyStr);
                if (body && body.payload) {
                  if (body.action === 'RESET_DATABASE' || body.cleanReset || body.payload?.cleanReset) {
                    memoryState = {
                      version: Math.max(Number(memoryState?.version) || 0, 1) + 1,
                      lastUpdated: new Date().toISOString(),
                      users:
                        body.payload?.users && body.payload.users.length > 0
                          ? body.payload.users
                          : [
                              {
                                id: 'USR-ADMIN',
                                username: 'admin',
                                password: 'admin123',
                                fullName: 'Quản Trị Viên',
                                role: 'ADMIN',
                                email: 'admin@khovattu.pro',
                                phone: '0901.156.220',
                                assignedWarehouseId: 'ALL',
                                status: 'ACTIVE',
                                createdAt: '2026-01-01 08:00',
                              },
                            ],
                      warehouses:
                        body.payload?.warehouses && body.payload.warehouses.length > 0
                          ? body.payload.warehouses
                          : [
                              {
                                id: 'WH-01',
                                code: 'KHO-01',
                                name: 'Kho Tổng Trung Tâm',
                                address: 'Trụ sở chính PTSC',
                                manager: 'Quản trị viên',
                                status: 'ACTIVE',
                              },
                            ],
                      items: [],
                      transactions: [],
                      deletedUserIds: [],
                      deletedTransactionIds: [],
                      deletedItemIds: [],
                      deletedWarehouseIds: [],
                      source: 'admin-clean-reset',
                    };
                  } else {
                    // Additive merge instead of overwriting existing state
                    memoryState = mergeServerStateAdditive(memoryState, body.payload);
                  }
                  try {
                    fs.writeFileSync(STATE_FILE, JSON.stringify(memoryState, null, 2), 'utf-8');
                  } catch (e) {
                    console.warn('[sync-api] Could not write .sync-state.json:', e);
                  }
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 200;
                  res.end(
                    JSON.stringify({
                      success: true,
                      provider: 'central-server',
                      savedToCloud: true,
                      version: memoryState.version,
                      lastUpdated: memoryState.lastUpdated,
                      payload: memoryState,
                    })
                  );
                  return;
                }
              } catch (parseErr) {
                console.error('[sync-api] JSON parse error:', parseErr);
              }

              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 400;
              res.end(JSON.stringify({ success: false, error: 'Dữ liệu không hợp lệ' }));
            });
            return;
          }

          res.statusCode = 405;
          res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [syncApiPlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

