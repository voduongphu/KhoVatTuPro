import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  Unsubscribe,
  serverTimestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { CentralDataPayload } from './centralSyncService';

export type FirestoreConnectionState = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR';

export type FirestoreSyncCallback = (payload: CentralDataPayload) => void;

class FirebaseFirestoreService {
  private syncDocPath = 'sync';
  private syncDocId = 'centralPayload';
  private unsubscribe: Unsubscribe | null = null;
  private connectionState: FirestoreConnectionState = 'CONNECTING';
  private listeners: Set<(state: FirestoreConnectionState) => void> = new Set();
  private lastWrittenTimestamp: string | null = null;
  private isPushing = false;

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
   * Đọc dữ liệu đồng bộ mới nhất từ Firestore
   */
  public async fetchPayload(): Promise<CentralDataPayload | null> {
    const docRef = doc(db, this.syncDocPath, this.syncDocId);
    try {
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        return null;
      }
      const data = snap.data();
      if (!data || !data.payload) {
        return null;
      }
      this.setConnectionState('CONNECTED');
      return data.payload as CentralDataPayload;
    } catch (error) {
      this.setConnectionState('ERROR');
      handleFirestoreError(error, OperationType.GET, `${this.syncDocPath}/${this.syncDocId}`);
      return null;
    }
  }

  /**
   * Đẩy dữ liệu đồng bộ lên Firestore theo thời gian thực
   */
  public async pushPayload(payload: CentralDataPayload, authorName?: string): Promise<boolean> {
    if (this.isPushing) return false;
    this.isPushing = true;
    const docRef = doc(db, this.syncDocPath, this.syncDocId);
    const docFullPath = `${this.syncDocPath}/${this.syncDocId}`;

    try {
      this.lastWrittenTimestamp = payload.lastUpdated;
      
      // Chuẩn bị payload an toàn cho Firestore
      const sanitizedPayload = {
        version: payload.version || 1,
        lastUpdated: payload.lastUpdated || new Date().toISOString(),
        items: payload.items || [],
        transactions: payload.transactions || [],
        warehouses: payload.warehouses || [],
        materialCategories: payload.materialCategories || [],
        users: payload.users || [],
        deletedRegistry: payload.deletedRegistry || {},
        deletedUserIds: payload.deletedUserIds || [],
        deletedTransactionIds: payload.deletedTransactionIds || [],
        deletedItemIds: payload.deletedItemIds || [],
        deletedWarehouseIds: payload.deletedWarehouseIds || [],
        deletedCategoryIds: payload.deletedCategoryIds || [],
        source: 'firebase-firestore',
        lastUpdatedBy: authorName || payload.lastUpdatedBy || 'Firebase Sync Client',
      };

      await setDoc(docRef, {
        payload: sanitizedPayload,
        serverTime: serverTimestamp(),
        lastUpdated: sanitizedPayload.lastUpdated,
      });

      this.setConnectionState('CONNECTED');
      return true;
    } catch (error) {
      console.error('[FirebaseFirestore] Error pushing payload:', error);
      this.setConnectionState('ERROR');
      handleFirestoreError(error, OperationType.WRITE, docFullPath);
      return false;
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

    const docRef = doc(db, this.syncDocPath, this.syncDocId);
    const docFullPath = `${this.syncDocPath}/${this.syncDocId}`;

    this.unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        this.setConnectionState('CONNECTED');
        if (!snapshot.exists()) {
          return;
        }

        const data = snapshot.data();
        if (!data || !data.payload) {
          return;
        }

        const remotePayload = data.payload as CentralDataPayload;
        // Bỏ qua nếu bản ghi chính là do thiết bị này vừa ghi
        if (
          this.lastWrittenTimestamp &&
          remotePayload.lastUpdated === this.lastWrittenTimestamp
        ) {
          return;
        }

        try {
          onRemoteUpdate(remotePayload);
        } catch (err) {
          console.error('[FirebaseFirestore] Error in onRemoteUpdate callback:', err);
        }
      },
      (error) => {
        console.error('[FirebaseFirestore] onSnapshot error:', error);
        this.setConnectionState('ERROR');
        handleFirestoreError(error, OperationType.GET, docFullPath);
      }
    );

    return () => {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
    };
  }
}

export const firebaseFirestoreService = new FirebaseFirestoreService();
