import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  Database,
  Flame,
  Check,
  X,
  ShieldCheck,
  Layers,
  ArrowUpCircle,
  ArrowDownCircle,
  AlertCircle,
  Boxes,
  ClipboardList,
  Building2,
  FolderTree,
  Users,
  ExternalLink,
  Download,
  AlertTriangle,
  Activity,
  Wrench,
  Copy,
  Clock,
  Radio,
  Server,
  FileCheck,
  CheckCircle,
  XCircle,
  Info,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';
import { DiagnosticStep, DiagnosticReport } from '../services/firestoreDiagnosticService';

export const SyncStatusModal: React.FC = () => {
  const {
    items,
    transactions,
    warehouses,
    materialCategories,
    users,
    syncStatus,
    lastSyncedAt,
    autoSyncEnabled,
    setAutoSyncEnabled,
    isSyncModalOpen,
    setIsSyncModalOpen,
    firestoreConnectionState,
    syncWithFirestore,
    pullFromFirestore,
    diagnosticReport,
    runFirestoreDiagnostics,
  } = useInventory();

  const [activeTab, setActiveTab] = useState<'sync' | 'diagnostics'>('sync');
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isRunningDiag, setIsRunningDiag] = useState(false);
  const [liveDiagSteps, setLiveDiagSteps] = useState<DiagnosticStep[]>([]);
  const [copiedReport, setCopiedReport] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: 'success' | 'error' | 'warning' | 'info';
    text: string;
    isQuota?: boolean;
  } | null>(null);

  if (!isSyncModalOpen) return null;

  const projectId = 'gen-lang-client-0950555318';
  const databaseId = 'ai-studio-qunlvttthitbchuy-b591ef3a-721a-48b8-8773-cd0769691e0d';
  const upgradeUrl = `https://console.firebase.google.com/project/${projectId}/firestore/databases/${databaseId}/data?openUpgradeDialog=true`;

  const handlePushToFirestore = async () => {
    setIsPushing(true);
    setFeedbackMessage(null);
    try {
      const res = await syncWithFirestore();
      if (res.success) {
        setFeedbackMessage({
          type: 'success',
          text: `Đã kết nối và đồng bộ thành công ${items.length.toLocaleString()} vật tư, ${transactions.length.toLocaleString()} phiếu, ${warehouses.length} kho và ${materialCategories.length} danh mục lên Firebase Firestore!`,
        });
      } else {
        setFeedbackMessage({
          type: res.isQuotaExceeded ? 'warning' : 'error',
          isQuota: res.isQuotaExceeded,
          text: res.error || 'Không thể kết nối hoặc lưu dữ liệu lên Firestore',
        });
      }
    } catch (e: any) {
      const errStr = e?.message || String(e);
      const isQuota =
        errStr.includes('RESOURCE_EXHAUSTED') ||
        errStr.includes('Quota exceeded') ||
        errStr.includes('quota metric') ||
        errStr.includes('Quota limit exceeded');
      setFeedbackMessage({
        type: isQuota ? 'warning' : 'error',
        isQuota,
        text: isQuota
          ? 'Hạn ngạch ghi miễn phí trong ngày của Firebase Firestore đã chạm mức giới hạn (RESOURCE_EXHAUSTED: Free daily write units per project). Dữ liệu trên thiết bị vẫn được bảo toàn 100%. Hạn ngạch miễn phí sẽ tự động được làm mới (reset) vào ngày mai theo giờ UTC.'
          : `Lỗi đồng bộ: ${errStr}`,
      });
    } finally {
      setIsPushing(false);
    }
  };

  const handlePullFromFirestore = async () => {
    setIsPulling(true);
    setFeedbackMessage(null);
    try {
      const res = await pullFromFirestore();
      if (res.success) {
        setFeedbackMessage({
          type: 'success',
          text: `Đã tải về và cập nhật thành công ${res.count ?? items.length} vật tư từ Firebase Firestore!`,
        });
      } else {
        setFeedbackMessage({
          type: 'error',
          text: res.error || 'Chưa thể tải dữ liệu từ Firestore',
        });
      }
    } catch (e: any) {
      setFeedbackMessage({
        type: 'error',
        text: `Lỗi tải dữ liệu: ${e?.message || String(e)}`,
      });
    } finally {
      setIsPulling(false);
    }
  };

  // Sao lưu khẩn cấp dữ liệu cục bộ ra tệp JSON
  const handleExportBackup = () => {
    try {
      const backupData = {
        exportedAt: new Date().toISOString(),
        items,
        transactions,
        warehouses,
        materialCategories,
        users,
      };
      const blob = new Blob([JSON.stringify(backupData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SaoLuu_KhoVatTu_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Backup failed', err);
    }
  };

  const handleRunDiagnostics = async () => {
    setIsRunningDiag(true);
    setCopiedReport(false);
    try {
      await runFirestoreDiagnostics((_updatedStep, allSteps) => {
        setLiveDiagSteps([...allSteps]);
      });
    } catch (err) {
      console.error('Lỗi khi chạy chẩn đoán Firestore:', err);
    } finally {
      setIsRunningDiag(false);
    }
  };

  const handleCopyReport = () => {
    const report = diagnosticReport;
    if (!report) return;
    const textReport = [
      `=== BÁO CÁO CHẨN ĐOÁN KẾT NỐI FIREBASE FIRESTORE ===`,
      `Thời gian kiểm tra: ${new Date(report.timestamp).toLocaleString('vi-VN')}`,
      `Trạng thái tổng thể: ${report.overallStatus}`,
      `Tổng kết: ${report.summary}`,
      ``,
      `--- Cấu hình SDK (firebase-applet-config.json) ---`,
      `Project ID: ${report.config.projectId}`,
      `Firestore Database ID: ${report.config.databaseId}`,
      `App ID: ${report.config.appId}`,
      `API Key: ${report.config.apiKeyMasked}`,
      `Khởi tạo App: ${report.config.isAppInitialized ? 'Đã khởi tạo' : 'Lỗi'}`,
      `Khởi tạo Database: ${report.config.isDbInitialized ? 'Đã kết nối' : 'Lỗi'}`,
      ``,
      `--- Chi tiết các bước kiểm tra ---`,
      ...report.steps.map(
        (s, idx) =>
          `[Bước ${idx + 1}] [${s.status}] ${s.name}\n` +
          `  Độ trễ phản hồi: ${s.latencyMs !== undefined ? `${s.latencyMs}ms` : 'N/A'}\n` +
          `  Thông báo: ${s.message}\n` +
          (s.recommendation ? `  Khuyến nghị: ${s.recommendation}\n` : '') +
          (s.details ? `  Chi tiết kỹ thuật: ${JSON.stringify(s.details)}\n` : '')
      ),
      report.manifestState
        ? `\n--- Trạng thái Manifest Đám Mây ---\n${JSON.stringify(report.manifestState, null, 2)}`
        : '',
    ].join('\n');

    navigator.clipboard.writeText(textReport).then(() => {
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 3000);
    });
  };

  const isQuotaExceeded =
    firestoreConnectionState === 'QUOTA_EXCEEDED' || Boolean(feedbackMessage?.isQuota);

  const displaySteps: DiagnosticStep[] =
    liveDiagSteps.length > 0 ? liveDiagSteps : diagnosticReport?.steps || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-linear-to-r from-amber-950 via-slate-900 to-indigo-950 text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-400">
              <Flame className="w-5 h-5 fill-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white">Trung Tâm Đồng Bộ Firebase Firestore</h3>
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/30 text-amber-300 flex items-center gap-1">
                  <Database className="w-2.5 h-2.5" />
                  0s Realtime
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Lưu trữ đám mây &amp; đồng bộ dữ liệu thời gian thực giữa các thiết bị người dùng
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsSyncModalOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-200 bg-slate-100/70 px-5 pt-2 shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('sync')}
            className={`flex items-center gap-2 py-2 px-4 font-semibold text-xs border-b-2 transition-all ${
              activeTab === 'sync'
                ? 'border-amber-600 text-amber-900 bg-white rounded-t-lg shadow-2xs font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-white/50 rounded-t-lg'
            }`}
          >
            <Database className="w-4 h-4 text-amber-600" />
            <span>Đồng bộ &amp; Dữ liệu</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('diagnostics');
              if (!diagnosticReport && !isRunningDiag) {
                handleRunDiagnostics();
              }
            }}
            className={`flex items-center gap-2 py-2 px-4 font-semibold text-xs border-b-2 transition-all ${
              activeTab === 'diagnostics'
                ? 'border-indigo-600 text-indigo-900 bg-white rounded-t-lg shadow-2xs font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-white/50 rounded-t-lg'
            }`}
          >
            <Activity className="w-4 h-4 text-indigo-600" />
            <span>Tiện Ích Chẩn Đoán</span>
            {diagnosticReport && (
              <span
                className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded-full ${
                  diagnosticReport.overallStatus === 'HEALTHY'
                    ? 'bg-emerald-100 text-emerald-800'
                    : diagnosticReport.overallStatus === 'WARNING'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-rose-100 text-rose-800'
                }`}
              >
                {diagnosticReport.overallStatus === 'HEALTHY' ? 'OK' : '!'}
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
          {/* Firestore Connection Live Status Banner */}
          <div
            className={`border rounded-xl p-4 transition-all ${
              firestoreConnectionState === 'CONNECTED'
                ? 'bg-amber-50/70 border-amber-200'
                : isQuotaExceeded
                ? 'bg-amber-50 border-amber-300'
                : firestoreConnectionState === 'CONNECTING'
                ? 'bg-blue-50/70 border-blue-200'
                : 'bg-rose-50/70 border-rose-200'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                        firestoreConnectionState === 'CONNECTED'
                          ? 'bg-amber-400'
                          : isQuotaExceeded
                          ? 'bg-amber-500'
                          : firestoreConnectionState === 'CONNECTING'
                          ? 'bg-blue-400'
                          : 'bg-rose-400'
                      }`}
                    />
                    <span
                      className={`relative inline-flex rounded-full h-3 w-3 ${
                        firestoreConnectionState === 'CONNECTED'
                          ? 'bg-amber-500'
                          : isQuotaExceeded
                          ? 'bg-amber-600'
                          : firestoreConnectionState === 'CONNECTING'
                          ? 'bg-blue-500'
                          : 'bg-rose-500'
                      }`}
                    />
                  </span>
                  <span className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <Flame className="w-4 h-4 text-amber-600 fill-amber-500" />
                    <span>
                      {firestoreConnectionState === 'CONNECTED'
                        ? 'Firebase Firestore: Đã kết nối trực tiếp (0s Realtime)'
                        : isQuotaExceeded
                        ? 'Firebase Firestore: Đạt Hạn Ngạch Ghi Miễn Phí Trong Ngày'
                        : firestoreConnectionState === 'CONNECTING'
                        ? 'Firebase Firestore: Đang thiết lập kết nối...'
                        : 'Firebase Firestore: Lỗi kết nối'}
                    </span>
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                      firestoreConnectionState === 'CONNECTED'
                        ? 'bg-amber-100 text-amber-800 border-amber-300'
                        : isQuotaExceeded
                        ? 'bg-amber-200 text-amber-900 border-amber-400'
                        : 'bg-slate-100 text-slate-700 border-slate-300'
                    }`}
                  >
                    {firestoreConnectionState === 'CONNECTED'
                      ? 'Hoạt động 24/7'
                      : isQuotaExceeded
                      ? 'Chờ Reset ngày mai'
                      : 'Đang kết nối'}
                  </span>
                </div>
                <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2 pt-0.5">
                  <span>
                    Lần đồng bộ gần nhất:{' '}
                    <strong className="text-slate-800">
                      {lastSyncedAt ? lastSyncedAt.toLocaleTimeString('vi-VN') : 'Vừa mở ứng dụng'}
                    </strong>
                  </span>
                  <span>•</span>
                  <span>
                    Chế độ: <strong className="text-amber-800">WebSocket onSnapshot 2 chiều</strong>
                  </span>
                </div>
              </div>

              {/* Auto Sync Toggle & Quick Diagnostic */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('diagnostics');
                    if (!diagnosticReport && !isRunningDiag) {
                      handleRunDiagnostics();
                    }
                  }}
                  className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-indigo-700 flex items-center gap-1 shadow-2xs transition-all"
                  title="Mở tiện ích chẩn đoán quyền đọc/ghi và kết nối Firestore"
                >
                  <Activity className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Chẩn đoán</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAutoSyncEnabled(!autoSyncEnabled)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                    autoSyncEnabled
                      ? 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200'
                      : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                  }`}
                  title="Bật/Tắt tự động đồng bộ khi có dữ liệu mới"
                >
                  {autoSyncEnabled ? 'Tự động đồng bộ: BẬT' : 'Tự động đồng bộ: TẮT'}
                </button>
              </div>
            </div>
          </div>

          {/* Feedback Message (Success or Error) with Diagnostic Link */}
          {feedbackMessage && !isQuotaExceeded && (
            <div
              className={`p-3 rounded-xl border flex items-start justify-between gap-2.5 text-xs animate-in fade-in duration-150 ${
                feedbackMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                  : feedbackMessage.type === 'error'
                  ? 'bg-rose-50 text-rose-900 border-rose-300'
                  : 'bg-amber-50 text-amber-900 border-amber-300'
              }`}
            >
              <div className="flex items-start gap-2.5">
                {feedbackMessage.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                )}
                <span className="font-medium">{feedbackMessage.text}</span>
              </div>
              {feedbackMessage.type === 'error' && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('diagnostics');
                    handleRunDiagnostics();
                  }}
                  className="shrink-0 font-bold text-rose-700 hover:text-rose-900 underline flex items-center gap-1"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Chẩn đoán lỗi</span>
                </button>
              )}
            </div>
          )}

          {/* TAB 1: ĐỒNG BỘ DỮ LIỆU */}
          {activeTab === 'sync' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Special Quota Exceeded Explanation Banner */}
              {isQuotaExceeded && (
                <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-2 text-xs text-amber-950 animate-in fade-in duration-200 shadow-xs">
                  <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Giải Thích: Hạn Ngạch Ghi Miễn Phí Trong Ngày Đã Chạm Mức Giới Hạn</span>
                  </div>
                  <p className="leading-relaxed text-slate-700">
                    Do kho dữ liệu hiện tại có tới <strong>{items.length.toLocaleString()} vật tư</strong> và quá trình đồng bộ trước đó đã sử dụng hết hạn mức ghi miễn phí trong ngày (20.000 lượt ghi/ngày trên gói Spark miễn phí của Firebase).
                  </p>
                  <div className="bg-white p-3 rounded-lg border border-amber-200 space-y-1.5 text-xs">
                    <div className="flex items-center gap-2 text-slate-800">
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span><strong>Toàn bộ dữ liệu an toàn 100%:</strong> {items.length.toLocaleString()} vật tư và {transactions.length} phiếu trên thiết bị này hoàn toàn nguyên vẹn, bạn vẫn sử dụng ứng dụng bình thường.</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-800">
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span><strong>Thời gian làm mới:</strong> Hạn mức miễn phí sẽ tự động được làm mới (reset) vào 00:00 UTC ngày mai.</span>
                    </div>
                  </div>
                  <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
                    <a
                      href={upgradeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-xs shadow-2xs transition-colors"
                    >
                      <span>Mở bảng điều khiển Firebase để nâng cấp / kiểm tra</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={handleExportBackup}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-lg font-semibold text-xs transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Tải tệp sao lưu (.JSON) về máy</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Local Device Data Inventory Grid */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-indigo-600" />
                    <span>Dữ Liệu Cục Bộ Trên Thiết Bị Sẵn Sàng Đồng Bộ:</span>
                  </h4>
                  <button
                    type="button"
                    onClick={handleExportBackup}
                    className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1"
                    title="Tải tệp JSON chứa toàn bộ dữ liệu hiện có"
                  >
                    <Download className="w-3 h-3" />
                    <span>Sao lưu tệp (.JSON)</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                  <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                    <Boxes className="w-4 h-4 text-indigo-600 mx-auto mb-1" />
                    <span className="text-base font-extrabold text-slate-900 block tabular-nums">
                      {items.length.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-slate-500 uppercase font-semibold">Vật tư</span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                    <ClipboardList className="w-4 h-4 text-emerald-600 mx-auto mb-1" />
                    <span className="text-base font-extrabold text-slate-900 block tabular-nums">
                      {transactions.length.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-slate-500 uppercase font-semibold">Phiếu X/N</span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                    <Building2 className="w-4 h-4 text-amber-600 mx-auto mb-1" />
                    <span className="text-base font-extrabold text-slate-900 block tabular-nums">
                      {warehouses.length}
                    </span>
                    <span className="text-[10px] text-slate-500 uppercase font-semibold">Kho hàng</span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                    <FolderTree className="w-4 h-4 text-blue-600 mx-auto mb-1" />
                    <span className="text-base font-extrabold text-slate-900 block tabular-nums">
                      {materialCategories.length}
                    </span>
                    <span className="text-[10px] text-slate-500 uppercase font-semibold">Danh mục</span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs col-span-2 sm:col-span-1">
                    <Users className="w-4 h-4 text-violet-600 mx-auto mb-1" />
                    <span className="text-base font-extrabold text-slate-900 block tabular-nums">
                      {users.length}
                    </span>
                    <span className="text-[10px] text-slate-500 uppercase font-semibold">Người dùng</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons: Explicit Push & Pull */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  disabled={isPushing}
                  onClick={handlePushToFirestore}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs shadow-xs transition-all disabled:opacity-60"
                >
                  {isPushing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Đang kết nối &amp; tải dữ liệu lên...</span>
                    </>
                  ) : (
                    <>
                      <ArrowUpCircle className="w-4 h-4" />
                      <span>Đồng bộ toàn bộ dữ liệu thiết bị lên Firestore</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={isPulling}
                  onClick={handlePullFromFirestore}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold text-xs shadow-xs transition-all disabled:opacity-60"
                >
                  {isPulling ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Đang tải dữ liệu từ Firestore về...</span>
                    </>
                  ) : (
                    <>
                      <ArrowDownCircle className="w-4 h-4" />
                      <span>Tải lại dữ liệu từ Firestore về thiết bị</span>
                    </>
                  )}
                </button>
              </div>

              {/* Firebase Configuration Specifications Card */}
              <div className="p-4 bg-amber-50/50 border border-amber-200 rounded-xl space-y-2.5 text-xs text-slate-600">
                <div className="flex items-center justify-between">
                  <h5 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Cấu hình Firebase Firestore Đang Hoạt Động:</span>
                  </h5>
                  <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                    Chỉ định độc quyền Firestore
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Firebase Project ID</span>
                    <span className="font-mono font-bold text-slate-800">{projectId}</span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Firestore Database ID</span>
                    <span className="font-mono font-bold text-slate-800 truncate block">
                      {databaseId}
                    </span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block flex items-center gap-1">
                      <Layers className="w-3 h-3 text-indigo-500" />
                      Kiến trúc Phân mảnh (Sharded Manifest)
                    </span>
                    <span className="font-semibold text-emerald-700 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      1.000 dòng/phân mảnh (tối ưu số lượt ghi &amp; dung lượng)
                    </span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-emerald-500" />
                      Security Rules
                    </span>
                    <span className="font-semibold text-emerald-700 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      Đã cấu hình &amp; triển khai bảo vệ bộ sưu tập
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: TIỆN ÍCH CHẨN ĐOÁN FIRESTORE */}
          {activeTab === 'diagnostics' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Diagnostics Action Bar */}
              <div className="p-4 bg-linear-to-r from-indigo-900 via-slate-900 to-slate-800 rounded-xl text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-indigo-400" />
                    <h4 className="font-bold text-sm text-white">Chẩn Đoán Toàn Diện Firestore</h4>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 font-semibold">
                      Live Testing
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Kiểm tra cấu hình đăng nhập, quyền Đọc/Ghi, độ trễ máy chủ và kênh onSnapshot 0s
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isRunningDiag}
                    onClick={handleRunDiagnostics}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors shadow-xs disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRunningDiag ? 'animate-spin' : ''}`} />
                    <span>{isRunningDiag ? 'Đang kiểm tra...' : 'Chạy chẩn đoán ngay'}</span>
                  </button>

                  {diagnosticReport && (
                    <button
                      type="button"
                      onClick={handleCopyReport}
                      className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-lg font-medium text-xs flex items-center gap-1.5 transition-colors"
                      title="Sao chép báo cáo chẩn đoán chi tiết ra clipboard"
                    >
                      {copiedReport ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-300 font-bold">Đã sao chép!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-slate-300" />
                          <span>Sao chép kết quả</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Overall Summary Card */}
              {diagnosticReport && (
                <div
                  className={`p-4 rounded-xl border transition-all ${
                    diagnosticReport.overallStatus === 'HEALTHY'
                      ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
                      : diagnosticReport.overallStatus === 'WARNING'
                      ? 'bg-amber-50/80 border-amber-300 text-amber-950'
                      : 'bg-rose-50/80 border-rose-300 text-rose-950'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      {diagnosticReport.overallStatus === 'HEALTHY' ? (
                        <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      ) : diagnosticReport.overallStatus === 'WARNING' ? (
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-sm">
                            {diagnosticReport.overallStatus === 'HEALTHY'
                              ? 'Hệ thống Firestore: Hoạt động bình thường (Healthy)'
                              : diagnosticReport.overallStatus === 'WARNING'
                              ? 'Hệ thống Firestore: Cảnh báo cần lưu ý (Warning)'
                              : 'Hệ thống Firestore: Phát hiện lỗi kết nối hoặc quyền (Error)'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                          {diagnosticReport.summary}
                        </p>
                      </div>
                    </div>

                    <span className="text-[10px] font-semibold text-slate-500 whitespace-nowrap bg-white/70 px-2 py-0.5 rounded border border-slate-200">
                      {new Date(diagnosticReport.timestamp).toLocaleTimeString('vi-VN')}
                    </span>
                  </div>
                </div>
              )}

              {/* Credentials & SDK Initialization Status Card */}
              {diagnosticReport && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h5 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>Xác Thực Thông Tin Đăng Nhập (firebase-applet-config.json):</span>
                    </h5>
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Đã nạp chính xác vào InventoryProvider
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Firebase Project ID</span>
                      <span className="font-mono font-bold text-slate-800 text-xs break-all">
                        {diagnosticReport.config.projectId}
                      </span>
                    </div>

                    <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Firestore Database ID</span>
                      <span className="font-mono font-bold text-slate-800 text-xs break-all">
                        {diagnosticReport.config.databaseId}
                      </span>
                    </div>

                    <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Firebase Web App ID</span>
                      <span className="font-mono text-slate-700 text-xs break-all">
                        {diagnosticReport.config.appId}
                      </span>
                    </div>

                    <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Khởi Tạo &amp; API Key</span>
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono text-slate-700 text-xs">{diagnosticReport.config.apiKeyMasked}</span>
                        <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                          SDK Sẵn Sàng
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step By Step Diagnostic Cards */}
              <div className="space-y-2.5">
                <h5 className="font-bold text-slate-800 text-xs flex items-center gap-1.5 px-0.5">
                  <Activity className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Chi Tiết 6 Bước Kiểm Tra Quyền &amp; Đường Truyền:</span>
                </h5>

                {displaySteps.length === 0 && !isRunningDiag && (
                  <div className="p-6 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center space-y-2">
                    <Wrench className="w-8 h-8 text-slate-400 mx-auto" />
                    <p className="text-xs font-semibold text-slate-700">Chưa thực hiện kiểm tra chẩn đoán nào</p>
                    <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                      Bấm vào nút bên dưới để kiểm tra khả năng kết nối mạng tới Google Firestore, quyền đọc, quyền ghi, kiểm tra hạn ngạch và kênh onSnapshot thời gian thực.
                    </p>
                    <button
                      type="button"
                      onClick={handleRunDiagnostics}
                      className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
                    >
                      Bắt đầu kiểm tra chẩn đoán
                    </button>
                  </div>
                )}

                {displaySteps.map((step, idx) => (
                  <div
                    key={step.id}
                    className={`p-3.5 rounded-xl border text-xs transition-all ${
                      step.status === 'RUNNING'
                        ? 'bg-blue-50/70 border-blue-300 ring-2 ring-blue-100'
                        : step.status === 'SUCCESS'
                        ? 'bg-white border-slate-200 hover:border-emerald-200 hover:bg-emerald-50/20'
                        : step.status === 'WARNING'
                        ? 'bg-amber-50/80 border-amber-300'
                        : step.status === 'ERROR'
                        ? 'bg-rose-50/80 border-rose-300'
                        : 'bg-slate-50/70 border-slate-200 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5 shrink-0">
                          {step.status === 'RUNNING' && (
                            <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
                          )}
                          {step.status === 'SUCCESS' && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          )}
                          {step.status === 'WARNING' && (
                            <AlertTriangle className="w-4 h-4 text-amber-600" />
                          )}
                          {step.status === 'ERROR' && (
                            <XCircle className="w-4 h-4 text-rose-600" />
                          )}
                          {step.status === 'PENDING' && (
                            <Clock className="w-4 h-4 text-slate-400" />
                          )}
                        </div>

                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-extrabold text-slate-900 text-xs">
                              Bước {idx + 1}: {step.name}
                            </span>
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                step.status === 'SUCCESS'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : step.status === 'RUNNING'
                                  ? 'bg-blue-100 text-blue-800'
                                  : step.status === 'WARNING'
                                  ? 'bg-amber-100 text-amber-800'
                                  : step.status === 'ERROR'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              {step.status === 'SUCCESS'
                                ? 'Thành công'
                                : step.status === 'RUNNING'
                                ? 'Đang kiểm tra...'
                                : step.status === 'WARNING'
                                ? 'Cảnh báo'
                                : step.status === 'ERROR'
                                ? 'Lỗi'
                                : 'Chờ xử lý'}
                            </span>
                          </div>

                          <p className="text-slate-700 leading-relaxed text-[11px]">
                            {step.message}
                          </p>

                          {step.recommendation && (
                            <div className="p-2 rounded-lg bg-amber-100/70 border border-amber-300 text-amber-950 font-medium text-[11px] mt-1 flex items-start gap-1.5">
                              <Info className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                              <span>{step.recommendation}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {step.latencyMs !== undefined && (
                        <span
                          className={`shrink-0 font-mono text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            step.latencyMs < 300
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : step.latencyMs < 1000
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}
                          title="Độ trễ khứ hồi tới máy chủ"
                        >
                          {step.latencyMs}ms
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Manifest Shards Cloud Summary */}
              {diagnosticReport?.manifestState && diagnosticReport.manifestState.exists && (
                <div className="p-4 bg-indigo-50/60 border border-indigo-200 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-indigo-950 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-indigo-600" />
                      Trạng Thái Dữ Liệu Đám Mây Hiện Tại (/sync/manifest):
                    </span>
                    <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">
                      Đã phân mảnh
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                    <div className="p-2 bg-white rounded-lg border border-indigo-100">
                      <span className="text-[10px] text-slate-500 block">Vật tư đám mây</span>
                      <strong className="text-sm text-slate-900">
                        {diagnosticReport.manifestState.totalItemsCount?.toLocaleString() || 0}
                      </strong>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-indigo-100">
                      <span className="text-[10px] text-slate-500 block">Số phân mảnh</span>
                      <strong className="text-sm text-slate-900">
                        {diagnosticReport.manifestState.itemShardCount || 0} mảnh
                      </strong>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-indigo-100">
                      <span className="text-[10px] text-slate-500 block">Phiếu nhập/xuất</span>
                      <strong className="text-sm text-slate-900">
                        {diagnosticReport.manifestState.totalTransactionsCount?.toLocaleString() || 0}
                      </strong>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-indigo-100">
                      <span className="text-[10px] text-slate-500 block">Người cập nhật</span>
                      <strong className="text-xs text-slate-900 truncate block">
                        {diagnosticReport.manifestState.lastUpdatedBy || 'Chưa có'}
                      </strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Dữ liệu luôn được lưu an toàn trên thiết bị và đồng bộ khi có kết nối mạng</span>
          </div>
          <button
            type="button"
            onClick={() => setIsSyncModalOpen(false)}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition-colors shadow-2xs"
          >
            Đóng cửa sổ
          </button>
        </div>
      </div>
    </div>
  );
};
