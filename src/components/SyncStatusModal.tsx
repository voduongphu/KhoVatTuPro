import React, { useState } from 'react';
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
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';

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
  } = useInventory();

  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  if (!isSyncModalOpen) return null;

  const handlePushToFirestore = async () => {
    setIsPushing(true);
    setFeedbackMessage(null);
    try {
      const res = await syncWithFirestore();
      if (res.success) {
        setFeedbackMessage({
          type: 'success',
          text: `Đã kết nối và đồng bộ thành công ${items.length} vật tư, ${transactions.length} phiếu, ${warehouses.length} kho và ${materialCategories.length} danh mục lên Firebase Firestore!`,
        });
      } else {
        setFeedbackMessage({
          type: 'error',
          text: `Lỗi đồng bộ Firestore: ${res.error || 'Vui lòng kiểm tra kết nối mạng'}`,
        });
      }
    } catch (e: any) {
      setFeedbackMessage({
        type: 'error',
        text: `Ngoại lệ: ${e?.message || String(e)}`,
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

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
          {/* Firestore Connection Live Status Banner */}
          <div
            className={`border rounded-xl p-4 transition-all ${
              firestoreConnectionState === 'CONNECTED'
                ? 'bg-amber-50/70 border-amber-200'
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
                          : firestoreConnectionState === 'CONNECTING'
                          ? 'bg-blue-400'
                          : 'bg-rose-400'
                      }`}
                    />
                    <span
                      className={`relative inline-flex rounded-full h-3 w-3 ${
                        firestoreConnectionState === 'CONNECTED'
                          ? 'bg-amber-500'
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
                        : firestoreConnectionState === 'CONNECTING'
                        ? 'Firebase Firestore: Đang thiết lập kết nối...'
                        : 'Firebase Firestore: Lỗi kết nối'}
                    </span>
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                      firestoreConnectionState === 'CONNECTED'
                        ? 'bg-amber-100 text-amber-800 border-amber-300'
                        : 'bg-slate-100 text-slate-700 border-slate-300'
                    }`}
                  >
                    {firestoreConnectionState === 'CONNECTED' ? 'Hoạt động 24/7' : 'Đang kết nối'}
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

              {/* Auto Sync Toggle */}
              <div className="flex items-center gap-2 shrink-0">
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

          {/* Feedback Message (Success or Error) */}
          {feedbackMessage && (
            <div
              className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs animate-in fade-in duration-150 ${
                feedbackMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                  : feedbackMessage.type === 'error'
                  ? 'bg-rose-50 text-rose-900 border-rose-300'
                  : 'bg-blue-50 text-blue-900 border-blue-300'
              }`}
            >
              {feedbackMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <span className="font-medium">{feedbackMessage.text}</span>
            </div>
          )}

          {/* Local Device Data Inventory Grid */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                <Database className="w-4 h-4 text-indigo-600" />
                <span>Dữ Liệu Cục Bộ Trên Thiết Bị Sẵn Sàng Đồng Bộ:</span>
              </h4>
              <span className="text-[11px] text-slate-500 font-medium">
                Tự động lưu vào thiết bị &amp; đồng bộ đám mây
              </span>
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
                <span className="font-mono font-bold text-slate-800">gen-lang-client-0950555318</span>
              </div>
              <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Firestore Database ID</span>
                <span className="font-mono font-bold text-slate-800 truncate block">
                  ai-studio-qunlvttthitbchuy-b591ef3a-721a-48b8-8773-cd0769691e0d
                </span>
              </div>
              <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                <span className="text-[10px] text-slate-400 uppercase font-bold block flex items-center gap-1">
                  <Layers className="w-3 h-3 text-indigo-500" />
                  Kiến trúc Phân mảnh (Sharded Manifest)
                </span>
                <span className="font-semibold text-emerald-700 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  Tự động chia 250 dòng/phân mảnh, an toàn &gt;50.000 dòng
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

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Dữ liệu luôn được đồng bộ hai chiều tự động khi có kết nối mạng</span>
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
