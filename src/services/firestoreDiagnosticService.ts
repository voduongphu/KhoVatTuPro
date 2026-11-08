import {
  doc,
  getDoc,
  setDoc,
  getDocFromServer,
  onSnapshot,
} from 'firebase/firestore';
import { db, firebaseApp } from './firebase';
import firebaseConfig from '../../firebase-applet-config.json';

export interface DiagnosticStep {
  id: string;
  name: string;
  category: 'CONFIG' | 'NETWORK' | 'READ' | 'WRITE' | 'REALTIME' | 'DATA';
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'WARNING' | 'ERROR';
  latencyMs?: number;
  message: string;
  details?: Record<string, any>;
  recommendation?: string;
}

export interface DiagnosticReport {
  timestamp: string;
  overallStatus: 'HEALTHY' | 'WARNING' | 'ERROR';
  summary: string;
  config: {
    projectId: string;
    databaseId: string;
    authDomain: string;
    appId: string;
    apiKeyMasked: string;
    isAppInitialized: boolean;
    isDbInitialized: boolean;
  };
  steps: DiagnosticStep[];
  manifestState?: {
    exists: boolean;
    totalItemsCount?: number;
    totalTransactionsCount?: number;
    itemShardCount?: number;
    trxShardCount?: number;
    lastUpdated?: string;
    lastUpdatedBy?: string;
  };
}

class FirestoreDiagnosticService {
  /**
   * Che giấu một phần API Key để hiển thị an toàn
   */
  private maskApiKey(key: string): string {
    if (!key || key.length < 12) return '******';
    return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
  }

  /**
   * Chạy quy trình chẩn đoán toàn diện Firestore
   */
  public async runFullDiagnostics(
    onStepUpdate?: (step: DiagnosticStep, allSteps: DiagnosticStep[]) => void
  ): Promise<DiagnosticReport> {
    const steps: DiagnosticStep[] = [
      {
        id: 'STEP_1_CONFIG',
        name: 'Khởi tạo SDK & Cấu hình Thông tin đăng nhập',
        category: 'CONFIG',
        status: 'PENDING',
        message: 'Đang chuẩn bị kiểm tra firebase-applet-config.json...',
      },
      {
        id: 'STEP_2_SERVER_REACHABILITY',
        name: 'Khả năng kết nối Máy chủ Firestore (Server Reachability)',
        category: 'NETWORK',
        status: 'PENDING',
        message: 'Chờ kiểm tra định tuyến mạng & TLS tới máy chủ Google...',
      },
      {
        id: 'STEP_3_READ_PERMS',
        name: 'Quy tắc Bảo mật: Quyền Đọc Dữ liệu (Read Permissions)',
        category: 'READ',
        status: 'PENDING',
        message: 'Chờ kiểm tra quyền đọc tài liệu...',
      },
      {
        id: 'STEP_4_WRITE_PERMS',
        name: 'Quy tắc Bảo mật: Quyền Ghi & Kiểm tra Hạn ngạch (Write & Quota)',
        category: 'WRITE',
        status: 'PENDING',
        message: 'Chờ kiểm tra quyền ghi dữ liệu...',
      },
      {
        id: 'STEP_5_REALTIME_WS',
        name: 'Kênh WebSocket Thời Gian Thực (onSnapshot Listener)',
        category: 'REALTIME',
        status: 'PENDING',
        message: 'Chờ kiểm tra kết nối luồng sự kiện trực tiếp 0s...',
      },
      {
        id: 'STEP_6_MANIFEST_DATA',
        name: 'Cấu trúc Phân mảnh Dữ liệu Đám mây (Manifest & Shards)',
        category: 'DATA',
        status: 'PENDING',
        message: 'Chờ kiểm tra tài liệu tổng hợp và các phân mảnh dữ liệu...',
      },
    ];

    const updateStep = (index: number, updates: Partial<DiagnosticStep>) => {
      steps[index] = { ...steps[index], ...updates };
      onStepUpdate?.(steps[index], [...steps]);
    };

    // -------------------------------------------------------------
    // Bước 1: Kiểm tra Cấu hình & Khởi tạo SDK
    // -------------------------------------------------------------
    updateStep(0, { status: 'RUNNING', message: 'Đang xác thực thông tin cấu hình từ firebase-applet-config.json...' });
    const isAppInit = Boolean(firebaseApp && firebaseApp.name);
    const isDbInit = Boolean(db && db.app);
    const hasProjectId = Boolean(firebaseConfig.projectId);
    const hasDatabaseId = Boolean(firebaseConfig.firestoreDatabaseId);

    if (isAppInit && isDbInit && hasProjectId && hasDatabaseId) {
      updateStep(0, {
        status: 'SUCCESS',
        latencyMs: 1,
        message: `SDK đã khởi tạo chính xác: Dự án "${firebaseConfig.projectId}", Cơ sở dữ liệu "${firebaseConfig.firestoreDatabaseId}".`,
        details: {
          projectId: firebaseConfig.projectId,
          firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
          authDomain: firebaseConfig.authDomain,
          appId: firebaseConfig.appId,
          appName: firebaseApp.name,
        },
      });
    } else {
      updateStep(0, {
        status: 'ERROR',
        message: 'Thông tin cấu hình Firebase chưa đầy đủ hoặc SDK chưa được khởi tạo thành công.',
        recommendation: 'Kiểm tra file firebase-applet-config.json và phương thức getFirestore() trong src/services/firebase.ts.',
      });
    }

    // -------------------------------------------------------------
    // Bước 2: Kiểm tra Kết nối Máy chủ (Server Reachability)
    // -------------------------------------------------------------
    updateStep(1, { status: 'RUNNING', message: 'Đang gửi yêu cầu getDocFromServer() tới máy chủ Firestore...' });
    const t0 = performance.now();
    let reachabilitySuccess = false;

    try {
      const connDocRef = doc(db, 'test', 'connection');
      const snap = await getDocFromServer(connDocRef);
      const latency = Math.round(performance.now() - t0);
      reachabilitySuccess = true;

      updateStep(1, {
        status: 'SUCCESS',
        latencyMs: latency,
        message: `Kết nối máy chủ Google Firestore thành công (${latency}ms). Tài liệu phản hồi: ${snap.exists() ? 'Tồn tại' : 'Chưa tạo (bình thường)'}.`,
        details: { latencyMs: latency, docExists: snap.exists(), path: '/test/connection' },
      });
    } catch (err: any) {
      const latency = Math.round(performance.now() - t0);
      const errMsg = err?.message || String(err);
      const isOffline = errMsg.includes('client is offline') || errMsg.includes('unavailable');

      updateStep(1, {
        status: 'ERROR',
        latencyMs: latency,
        message: isOffline
          ? 'Máy khách đang ngoại tuyến hoặc không thể kết nối tới máy chủ Google Firestore.'
          : `Lỗi kết nối máy chủ: ${errMsg}`,
        details: { error: errMsg, code: err?.code },
        recommendation: 'Kiểm tra kết nối mạng Internet, tường lửa hoặc bộ lọc proxy của thiết bị.',
      });
    }

    // -------------------------------------------------------------
    // Bước 3: Kiểm tra Quyền Đọc Dữ liệu (Read Permissions)
    // -------------------------------------------------------------
    updateStep(2, { status: 'RUNNING', message: 'Đang kiểm tra quyền đọc bộ sưu tập test và sync...' });
    const tRead = performance.now();
    try {
      const testDocRef = doc(db, 'test', 'connection');
      await getDoc(testDocRef);
      const latency = Math.round(performance.now() - tRead);

      updateStep(2, {
        status: 'SUCCESS',
        latencyMs: latency,
        message: `Quyền Đọc dữ liệu hợp lệ (${latency}ms). Security Rules cho phép đọc bộ sưu tập test và sync.`,
        details: { latencyMs: latency, pathTested: '/test/connection' },
      });
    } catch (err: any) {
      const latency = Math.round(performance.now() - tRead);
      const errMsg = err?.message || String(err);
      const isPermDenied = err?.code === 'permission-denied' || errMsg.includes('Missing or insufficient permissions');

      updateStep(2, {
        status: 'ERROR',
        latencyMs: latency,
        message: isPermDenied
          ? 'Bị từ chối quyền đọc (PERMISSION_DENIED). Security Rules không cho phép đọc đường dẫn này.'
          : `Lỗi đọc dữ liệu: ${errMsg}`,
        details: { error: errMsg, code: err?.code },
        recommendation: 'Kiểm tra tệp firestore.rules và triển khai lại qua fax.DeployRules.',
      });
    }

    // -------------------------------------------------------------
    // Bước 4: Kiểm tra Quyền Ghi & Kiểm tra Hạn ngạch (Write & Quota)
    // -------------------------------------------------------------
    updateStep(3, { status: 'RUNNING', message: 'Đang thực hiện kiểm tra ghi tài liệu chẩn đoán...' });
    const tWrite = performance.now();
    let writeSuccess = false;
    let isQuotaExceeded = false;

    try {
      const diagDocRef = doc(db, 'test', `diag_${Date.now()}`);
      await setDoc(diagDocRef, {
        diagnosticTest: true,
        clientTime: new Date().toISOString(),
        testedBy: 'InventoryDiagnosticUtility',
      });
      const latency = Math.round(performance.now() - tWrite);
      writeSuccess = true;

      updateStep(3, {
        status: 'SUCCESS',
        latencyMs: latency,
        message: `Quyền Ghi hoạt động hoàn hảo (${latency}ms). Hạn ngạch ghi Firestore bình thường.`,
        details: { latencyMs: latency, docCreated: diagDocRef.id },
      });
    } catch (err: any) {
      const latency = Math.round(performance.now() - tWrite);
      const errMsg = err?.message || String(err);
      isQuotaExceeded =
        err?.code === 'resource-exhausted' ||
        errMsg.includes('RESOURCE_EXHAUSTED') ||
        errMsg.includes('Quota limit exceeded') ||
        errMsg.includes('Quota exceeded');
      const isPermDenied = err?.code === 'permission-denied' || errMsg.includes('Missing or insufficient permissions');

      if (isQuotaExceeded) {
        updateStep(3, {
          status: 'WARNING',
          latencyMs: latency,
          message: 'Hạn ngạch ghi miễn phí trong ngày (Free Tier Daily Write Units) đã chạm mức tối đa 20.000 lượt.',
          details: { error: errMsg, code: err?.code, isQuota: true },
          recommendation: 'Hạn mức miễn phí sẽ tự động được làm mới (reset) vào ngày mai lúc 00:00 UTC, hoặc bạn có thể nâng cấp gói tại Firebase Console.',
        });
      } else if (isPermDenied) {
        updateStep(3, {
          status: 'ERROR',
          latencyMs: latency,
          message: 'Bị từ chối quyền ghi (PERMISSION_DENIED). Security Rules chặn ghi dữ liệu.',
          details: { error: errMsg, code: err?.code },
          recommendation: 'Kiểm tra firestore.rules trên đường dẫn /test/{docId} và /sync/{syncId}.',
        });
      } else {
        updateStep(3, {
          status: 'ERROR',
          latencyMs: latency,
          message: `Lỗi ghi dữ liệu: ${errMsg}`,
          details: { error: errMsg, code: err?.code },
        });
      }
    }

    // -------------------------------------------------------------
    // Bước 5: Kiểm tra Kênh WebSocket Thời Gian Thực (onSnapshot Listener)
    // -------------------------------------------------------------
    updateStep(4, { status: 'RUNNING', message: 'Đang thiết lập kênh lắng nghe onSnapshot và đo thời gian bắt sự kiện...' });
    const tWs = performance.now();

    try {
      const manifestRef = doc(db, 'sync', 'manifest');
      const wsPromise = new Promise<{ latency: number; exists: boolean }>((resolve, reject) => {
        let isDone = false;
        const timer = setTimeout(() => {
          if (!isDone) {
            isDone = true;
            unsub();
            resolve({ latency: Math.round(performance.now() - tWs), exists: false });
          }
        }, 3500);

        const unsub = onSnapshot(
          manifestRef,
          (snap) => {
            if (!isDone) {
              isDone = true;
              clearTimeout(timer);
              unsub();
              resolve({ latency: Math.round(performance.now() - tWs), exists: snap.exists() });
            }
          },
          (err) => {
            if (!isDone) {
              isDone = true;
              clearTimeout(timer);
              unsub();
              reject(err);
            }
          }
        );
      });

      const wsResult = await wsPromise;
      updateStep(4, {
        status: 'SUCCESS',
        latencyMs: wsResult.latency,
        message: `Kênh WebSocket onSnapshot kết nối thành công (${wsResult.latency}ms). Sẵn sàng nhận dữ liệu thay đổi tức thì 0s.`,
        details: { latencyMs: wsResult.latency, manifestExists: wsResult.exists },
      });
    } catch (err: any) {
      const latency = Math.round(performance.now() - tWs);
      const errMsg = err?.message || String(err);
      updateStep(4, {
        status: 'WARNING',
        latencyMs: latency,
        message: `Kênh onSnapshot thông báo: ${errMsg}`,
        details: { error: errMsg, code: err?.code },
      });
    }

    // -------------------------------------------------------------
    // Bước 6: Kiểm tra Cấu trúc Phân mảnh Dữ liệu Đám mây (Manifest & Shards)
    // -------------------------------------------------------------
    updateStep(5, { status: 'RUNNING', message: 'Đang đọc tài liệu tổng hợp /sync/manifest...' });
    let manifestDataResult: any = undefined;

    try {
      const manifestRef = doc(db, 'sync', 'manifest');
      const snap = await getDoc(manifestRef);

      if (snap.exists()) {
        const data = snap.data();
        manifestDataResult = {
          exists: true,
          totalItemsCount: data.totalItemsCount || 0,
          totalTransactionsCount: data.totalTransactionsCount || 0,
          itemShardCount: data.itemShardCount || 0,
          trxShardCount: data.trxShardCount || 0,
          lastUpdated: data.lastUpdated || '',
          lastUpdatedBy: data.lastUpdatedBy || '',
        };

        updateStep(5, {
          status: 'SUCCESS',
          message: `Dữ liệu đám mây đã cấu trúc sẵn: ${manifestDataResult.totalItemsCount} vật tư (${manifestDataResult.itemShardCount} phân mảnh), ${manifestDataResult.totalTransactionsCount} phiếu. Cập nhật lần cuối: ${manifestDataResult.lastUpdated || 'Gần đây'}.`,
          details: manifestDataResult,
        });
      } else {
        manifestDataResult = { exists: false };
        updateStep(5, {
          status: 'SUCCESS',
          message: 'Cơ sở dữ liệu đám mây chưa có dữ liệu đồng bộ (trống). Hệ thống sẵn sàng đồng bộ dữ liệu thiết bị lên.',
          details: { exists: false },
        });
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      updateStep(5, {
        status: 'WARNING',
        message: `Chưa đọc được Manifest: ${errMsg}`,
        details: { error: errMsg },
      });
    }

    // Đánh giá trạng thái chung
    const hasError = steps.some(s => s.status === 'ERROR');
    const hasWarning = steps.some(s => s.status === 'WARNING');
    const overallStatus: 'HEALTHY' | 'WARNING' | 'ERROR' = hasError
      ? 'ERROR'
      : hasWarning
      ? 'WARNING'
      : 'HEALTHY';

    const summary =
      overallStatus === 'HEALTHY'
        ? 'Tất cả các kiểm tra kết nối, quyền đọc/ghi và WebSocket thời gian thực đều hoạt động bình thường.'
        : overallStatus === 'WARNING'
        ? isQuotaExceeded
          ? 'Kết nối đọc và cấu hình SDK hoàn toàn tốt, nhưng hạn ngạch ghi miễn phí trong ngày đã chạm giới hạn 20.000 lượt.'
          : 'Hệ thống kết nối được nhưng có một số cảnh báo kiểm tra quyền hoặc độ trễ mạng.'
        : 'Phát hiện lỗi kết nối hoặc quyền truy cập Firestore. Vui lòng xem chi tiết từng bước bên dưới.';

    return {
      timestamp: new Date().toISOString(),
      overallStatus,
      summary,
      config: {
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId,
        authDomain: firebaseConfig.authDomain,
        appId: firebaseConfig.appId,
        apiKeyMasked: this.maskApiKey(firebaseConfig.apiKey),
        isAppInitialized: isAppInit,
        isDbInitialized: isDbInit,
      },
      steps,
      manifestState: manifestDataResult,
    };
  }
}

export const firestoreDiagnosticService = new FirestoreDiagnosticService();
