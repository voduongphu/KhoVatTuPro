import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  Unsubscribe,
  collection,
  getDocs,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { CentralDataPayload } from './centralSyncService';
import { UserRegistrationRequest, UserRole } from '../types/inventory';

export type FirestoreConnectionState = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR' | 'QUOTA_EXCEEDED';

export interface FirestorePushResult {
  success: boolean;
  error?: string;
  isQuotaExceeded?: boolean;
}

export type FirestoreSyncCallback = (payload: CentralDataPayload) => void;

const ITEMS_CHUNK_SIZE = 1000;
const TRX_CHUNK_SIZE = 1000;

function sanitizeForFirestore<T>(val: T): T {
  if (val === undefined) return null as any;
  if (val === null || typeof val !== 'object') return val;
  if (val instanceof Date) return val.toISOString() as any;
  if (Array.isArray(val)) {
    return val.map(item => (item === undefined ? null : sanitizeForFirestore(item))) as any;
  }
  const result: any = {};
  for (const [k, v] of Object.entries(val)) {
    if (v !== undefined) {
      result[k] = sanitizeForFirestore(v);
    }
  }
  return result;
}

class FirebaseFirestoreService {
  private syncCollection = 'sync';
  private manifestDocId = 'manifest';
  private unsubscribe: Unsubscribe | null = null;
  private connectionState: FirestoreConnectionState = 'CONNECTING';
  private listeners: Set<(state: FirestoreConnectionState) => void> = new Set();
  private lastWrittenTimestamp: string | null = null;
  private isPushing = false;
  private isPulling = false;

  constructor() {
    this.connectionState = 'CONNECTING';
  }

  public getConnectionState(): FirestoreConnectionState {
    return this.connectionState;
  }

  public onConnectionStateChange(listener: (state: FirestoreConnectionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.connectionState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setConnectionState(newState: FirestoreConnectionState) {
    if (this.connectionState !== newState) {
      this.connectionState = newState;
      this.listeners.forEach(fn => {
        try {
          fn(newState);
        } catch (e) {
          console.error('[FirebaseFirestore] Listener callback error:', e);
        }
      });
    }
  }

  /**
   * Đọc dữ liệu đồng bộ mới nhất từ Firestore (hỗ trợ đọc phân mảnh Shards an toàn cho >5.000 dòng)
   */
  public async fetchPayload(): Promise<CentralDataPayload | null> {
    if (this.isPulling) return null;
    this.isPulling = true;
    const manifestRef = doc(db, this.syncCollection, this.manifestDocId);

    try {
      const snap = await getDoc(manifestRef);
      if (!snap.exists()) {
        // Kiểm tra tài liệu cũ nếu có
        const legacyRef = doc(db, this.syncCollection, 'centralPayload');
        const legacySnap = await getDoc(legacyRef);
        if (legacySnap.exists()) {
          const data = legacySnap.data();
          if (data && data.payload) {
            this.setConnectionState('CONNECTED');
            return data.payload as CentralDataPayload;
          }
        }
        this.setConnectionState('CONNECTED');
        return null;
      }

      const manifestData = snap.data();
      if (!manifestData) {
        this.setConnectionState('CONNECTED');
        return null;
      }

      const itemShardCount: number = manifestData.itemShardCount || 0;
      const trxShardCount: number = manifestData.trxShardCount || 0;

      // Đọc song song tất cả các phân mảnh items và transactions
      const itemShardPromises: Promise<any>[] = [];
      for (let i = 0; i < itemShardCount; i++) {
        const shardRef = doc(db, this.syncCollection, this.manifestDocId, 'shards', `items_${i}`);
        itemShardPromises.push(
          getDoc(shardRef).catch(err => {
            console.warn(`[FirebaseFirestore] Shard read items_${i} warning:`, err);
            return null;
          })
        );
      }

      const trxShardPromises: Promise<any>[] = [];
      for (let i = 0; i < trxShardCount; i++) {
        const shardRef = doc(db, this.syncCollection, this.manifestDocId, 'shards', `trx_${i}`);
        trxShardPromises.push(
          getDoc(shardRef).catch(err => {
            console.warn(`[FirebaseFirestore] Shard read trx_${i} warning:`, err);
            return null;
          })
        );
      }

      const [itemShardSnaps, trxShardSnaps] = await Promise.all([
        Promise.all(itemShardPromises),
        Promise.all(trxShardPromises),
      ]);

      const allItems: any[] = [];
      for (const s of itemShardSnaps) {
        if (s && s.exists && s.exists()) {
          const d = s.data();
          if (Array.isArray(d?.items)) {
            allItems.push(...d.items);
          }
        }
      }

      const allTrx: any[] = [];
      for (const s of trxShardSnaps) {
        if (s && s.exists && s.exists()) {
          const d = s.data();
          if (Array.isArray(d?.transactions)) {
            allTrx.push(...d.transactions);
          }
        }
      }

      // Hợp nhất dữ liệu hoàn chỉnh
      const payload: CentralDataPayload = {
        version: manifestData.version || Date.now(),
        lastUpdated: manifestData.lastUpdated || new Date().toISOString(),
        items: allItems.length > 0 ? allItems : (manifestData.items || []),
        transactions: allTrx.length > 0 ? allTrx : (manifestData.transactions || []),
        warehouses: manifestData.warehouses || [],
        materialCategories: manifestData.materialCategories || [],
        users: manifestData.users || [],
        userRegistrations: manifestData.userRegistrations || [],
        deletedRegistry: manifestData.deletedRegistry || {},
        deletedUserIds: manifestData.deletedUserIds || [],
        deletedTransactionIds: manifestData.deletedTransactionIds || [],
        deletedItemIds: manifestData.deletedItemIds || [],
        deletedWarehouseIds: manifestData.deletedWarehouseIds || [],
        deletedCategoryIds: manifestData.deletedCategoryIds || [],
        source: 'firebase-firestore',
        lastUpdatedBy: manifestData.lastUpdatedBy || 'Firestore Sync',
      };

      this.setConnectionState('CONNECTED');
      return payload;
    } catch (error) {
      console.warn('[FirebaseFirestore] fetchPayload notice:', error);
      this.setConnectionState('ERROR');
      return null;
    } finally {
      this.isPulling = false;
    }
  }

  /**
   * Đẩy dữ liệu đồng bộ lên Firestore theo thời gian thực (tự động phân mảnh nếu >250 dòng tránh vượt 1MB,
   * triệt tiêu toàn bộ thuộc tính undefined để Firestore setDoc không bao giờ bị từ chối).
   */
  public async pushPayload(payload: CentralDataPayload, authorName?: string): Promise<FirestorePushResult> {
    if (this.isPushing) return { success: false, error: 'Đang có tiến trình đồng bộ khác chạy' };
    this.isPushing = true;
    const manifestRef = doc(db, this.syncCollection, this.manifestDocId);

    try {
      this.lastWrittenTimestamp = payload.lastUpdated;

      // Khử toàn bộ các giá trị undefined trong toàn bộ dữ liệu trước khi đẩy lên Firestore
      const cleanInput = sanitizeForFirestore(payload);
      const items = Array.isArray(cleanInput.items) ? cleanInput.items : [];
      const transactions = Array.isArray(cleanInput.transactions) ? cleanInput.transactions : [];
      const itemShardCount = Math.ceil(items.length / ITEMS_CHUNK_SIZE);
      const trxShardCount = Math.ceil(transactions.length / TRX_CHUNK_SIZE);

      // 1. Ghi tuần tự hoặc theo nhóm phân mảnh items (1.000 mục/phân mảnh ~150KB - 200KB, tối ưu hạn ngạch ghi Firestore)
      const shardWritePromises: Promise<any>[] = [];
      for (let i = 0; i < itemShardCount; i++) {
        const slice = items.slice(i * ITEMS_CHUNK_SIZE, (i + 1) * ITEMS_CHUNK_SIZE);
        const shardRef = doc(db, this.syncCollection, this.manifestDocId, 'shards', `items_${i}`);
        shardWritePromises.push(
          setDoc(shardRef, sanitizeForFirestore({
            index: i,
            type: 'items',
            items: slice,
            count: slice.length,
            updatedAt: cleanInput.lastUpdated,
          }))
        );
      }

      // 2. Ghi các phân mảnh transactions
      for (let i = 0; i < trxShardCount; i++) {
        const slice = transactions.slice(i * TRX_CHUNK_SIZE, (i + 1) * TRX_CHUNK_SIZE);
        const shardRef = doc(db, this.syncCollection, this.manifestDocId, 'shards', `trx_${i}`);
        shardWritePromises.push(
          setDoc(shardRef, sanitizeForFirestore({
            index: i,
            type: 'transactions',
            transactions: slice,
            count: slice.length,
            updatedAt: cleanInput.lastUpdated,
          }))
        );
      }

      await Promise.all(shardWritePromises);

      // 3. Ghi tài liệu Manifest chính kích hoạt onSnapshot
      const manifestPayload = sanitizeForFirestore({
        version: cleanInput.version || Date.now(),
        lastUpdated: cleanInput.lastUpdated || new Date().toISOString(),
        totalItemsCount: items.length,
        totalTransactionsCount: transactions.length,
        itemShardCount,
        trxShardCount,
        // Đối với tập dữ liệu nhỏ <= 150 mục, lưu trực tiếp cả trong manifest để tối ưu tốc độ đọc
        items: items.length <= 150 ? items : [],
        transactions: transactions.length <= 150 ? transactions : [],
        warehouses: cleanInput.warehouses || [],
        materialCategories: cleanInput.materialCategories || [],
        users: cleanInput.users || [],
        userRegistrations: cleanInput.userRegistrations || [],
        deletedRegistry: cleanInput.deletedRegistry || {},
        deletedUserIds: cleanInput.deletedUserIds || [],
        deletedTransactionIds: cleanInput.deletedTransactionIds || [],
        deletedItemIds: cleanInput.deletedItemIds || [],
        deletedWarehouseIds: cleanInput.deletedWarehouseIds || [],
        deletedCategoryIds: cleanInput.deletedCategoryIds || [],
        source: 'firebase-firestore',
        lastUpdatedBy: authorName || cleanInput.lastUpdatedBy || 'Firebase Sync Client',
      });

      await setDoc(manifestRef, manifestPayload);

      // Ghi bản sao tương thích ngược nếu ít hơn 250 mục
      if (items.length <= 250) {
        const legacyRef = doc(db, this.syncCollection, 'centralPayload');
        setDoc(legacyRef, sanitizeForFirestore({
          payload: {
            ...cleanInput,
            lastUpdatedBy: authorName || cleanInput.lastUpdatedBy,
          },
          lastUpdated: cleanInput.lastUpdated,
        })).catch(() => {});
      }

      this.setConnectionState('CONNECTED');
      return { success: true };
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      const isQuota =
        errMsg.includes('RESOURCE_EXHAUSTED') ||
        errMsg.includes('Quota exceeded') ||
        errMsg.includes('quota metric') ||
        errMsg.includes('Quota limit exceeded');

      console.error('[FirebaseFirestore] Error pushing payload:', error);
      this.setConnectionState(isQuota ? 'QUOTA_EXCEEDED' : 'ERROR');

      return {
        success: false,
        isQuotaExceeded: isQuota,
        error: isQuota
          ? 'Hạn ngạch ghi miễn phí trong ngày của Firebase Firestore đã chạm mức giới hạn (RESOURCE_EXHAUSTED: Free daily write units per project). Dữ liệu trên thiết bị vẫn được bảo toàn 100%. Hạn ngạch miễn phí sẽ tự động được làm mới (reset) vào ngày mai theo giờ UTC.'
          : `Lỗi kết nối Firestore: ${errMsg}`,
      };
    } finally {
      this.isPushing = false;
    }
  }

  /**
   * Đăng ký lắng nghe thay đổi thời gian thực qua WebSocket onSnapshot
   */
  public subscribeToChanges(onRemoteUpdate: FirestoreSyncCallback): () => void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    const manifestRef = doc(db, this.syncCollection, this.manifestDocId);

    this.unsubscribe = onSnapshot(
      manifestRef,
      async (snapshot) => {
        this.setConnectionState('CONNECTED');
        if (!snapshot.exists()) {
          return;
        }

        const data = snapshot.data();
        if (!data) return;

        // Bỏ qua nếu bản ghi do chính client này vừa ghi
        if (this.lastWrittenTimestamp && data.lastUpdated === this.lastWrittenTimestamp) {
          return;
        }

        // Tải toàn bộ các phân mảnh về
        try {
          const fullPayload = await this.fetchPayload();
          if (fullPayload) {
            onRemoteUpdate(fullPayload);
          }
        } catch (err) {
          console.error('[FirebaseFirestore] Error in assembling remote update:', err);
        }
      },
      (error) => {
        const errMsg = error?.message || String(error);
        const isQuota =
          errMsg.includes('RESOURCE_EXHAUSTED') ||
          errMsg.includes('Quota exceeded') ||
          errMsg.includes('quota metric') ||
          errMsg.includes('Quota limit exceeded');

        console.warn('[FirebaseFirestore] onSnapshot notice:', errMsg);
        this.setConnectionState(isQuota ? 'QUOTA_EXCEEDED' : 'ERROR');
      }
    );

    return () => {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
    };
  }

  /**
   * Lưu hoặc cập nhật một yêu cầu đăng ký tài khoản vào Firestore (/user_registrations/{id})
   */
  public async saveRegistrationRequest(request: UserRegistrationRequest): Promise<boolean> {
    try {
      const regRef = doc(db, 'user_registrations', request.id);
      await setDoc(
        regRef,
        sanitizeForFirestore({
          ...request,
          updatedAt: new Date().toISOString(),
        }),
        { merge: true }
      );
      return true;
    } catch (e) {
      console.warn('[FirebaseFirestore] saveRegistrationRequest error:', e);
      return false;
    }
  }

  /**
   * Lắng nghe thời gian thực danh sách yêu cầu đăng ký người dùng từ Firestore (/user_registrations)
   */
  public subscribeToRegistrations(onUpdate: (requests: UserRegistrationRequest[]) => void): () => void {
    const colRef = collection(db, 'user_registrations');
    return onSnapshot(
      colRef,
      (snapshot) => {
        const list: UserRegistrationRequest[] = [];
        snapshot.forEach((d) => {
          if (d.exists()) {
            list.push(d.data() as UserRegistrationRequest);
          }
        });
        list.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
        onUpdate(list);
      },
      (error) => {
        console.warn('[FirebaseFirestore] subscribeToRegistrations notice:', error);
      }
    );
  }
}

export const firebaseFirestoreService = new FirebaseFirestoreService();
