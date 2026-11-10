import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  Database,
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
  Copy,
  Zap,
  Key,
  Globe,
  Code2,
  ChevronDown,
  ChevronUp,
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
    supabaseConnectionState,
    supabaseCredentials,
    setSupabaseConfig,
    syncWithSupabase,
    pullFromSupabase,
  } = useInventory();

  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [showSqlGuide, setShowSqlGuide] = useState(false);
  const [urlInput, setUrlInput] = useState(supabaseCredentials.url || '');
  const [keyInput, setKeyInput] = useState(supabaseCredentials.key || '');
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: 'success' | 'error' | 'warning' | 'info';
    text: string;
  } | null>(null);

  useEffect(() => {
    setUrlInput(supabaseCredentials.url || '');
    setKeyInput(supabaseCredentials.key || '');
  }, [supabaseCredentials]);

  if (!isSyncModalOpen) return null;

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setFeedbackMessage(null);
    try {
      const ok = setSupabaseConfig(urlInput.trim(), keyInput.trim());
      if (ok) {
        setFeedbackMessage({
          type: 'success',
          text: 'Đã lưu cấu hình kết nối Supabase thành công! Hệ thống đang kích hoạt luồng Realtime...',
        });
        setTimeout(() => {
          syncWithSupabase();
        }, 500);
      } else {
        setFeedbackMessage({
          type: 'info',
          text: 'Đã xóa cấu hình Supabase. Hệ thống chuyển sang lưu trữ cục bộ và máy chủ trung tâm.',
        });
      }
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: `Lỗi lưu cấu hình: ${err?.message || String(err)}`,
      });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handlePushToSupabase = async () => {
    setIsPushing(true);
    setFeedbackMessage(null);
    try {
      const res = await syncWithSupabase();
      if (res.success) {
        setFeedbackMessage({
          type: 'success',
          text: `Đã kết nối và đồng bộ thành công ${items.length.toLocaleString()} vật tư, ${transactions.length.toLocaleString()} phiếu, ${warehouses.length} kho và ${materialCategories.length} danh mục lên Supabase Cloud!`,
        });
      } else {
        setFeedbackMessage({
          type: 'error',
          text: res.error || 'Không thể kết nối hoặc lưu dữ liệu lên Supabase',
        });
      }
    } catch (e: any) {
      setFeedbackMessage({
        type: 'error',
        text: `Lỗi đồng bộ: ${e?.message || String(e)}`,
      });
    } finally {
      setIsPushing(false);
    }
  };

  const handlePullFromSupabase = async () => {
    setIsPulling(true);
    setFeedbackMessage(null);
    try {
      const res = await pullFromSupabase();
      if (res.success) {
        setFeedbackMessage({
          type: 'success',
          text: `Đã tải về và cập nhật thành công ${res.count ?? items.length} vật tư từ Supabase Cloud!`,
        });
      } else {
        setFeedbackMessage({
          type: 'error',
          text: res.error || 'Chưa thể tải dữ liệu từ Supabase',
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

  const sqlSetupScript = `-- Tạo bảng lưu trữ trạng thái vật tư (nếu chưa có)
CREATE TABLE IF NOT EXISTS public.inventory_state (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Kích hoạt phát sóng thời gian thực Realtime trên bảng inventory_state
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_state;

-- Kích hoạt phân quyền truy cập công khai cho ứng dụng (Anon Key)
ALTER TABLE public.inventory_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon all" ON public.inventory_state;
CREATE POLICY "Allow anon all" ON public.inventory_state
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);`;

  const handleCopySql = () => {
    navigator.clipboard.writeText(sqlSetupScript).then(() => {
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 3000);
    });
  };

  const isConnected = supabaseConnectionState === 'CONNECTED';
  const isConnecting = supabaseConnectionState === 'CONNECTING' || syncStatus === 'syncing';
  const isConfigured = Boolean(supabaseCredentials.url && supabaseCredentials.key);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-emerald-950 via-slate-900 to-teal-950 text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400 shadow-inner">
              <Database className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white">Trung Tâm Đồng Bộ Supabase Cloud Realtime</h3>
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5 fill-emerald-300" />
                  0s Realtime
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Lưu trữ PostgreSQL đám mây &amp; đồng bộ dữ liệu thời gian thực giữa các thiết bị người dùng
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsSyncModalOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
          {/* Supabase Connection Live Status Banner */}
          <div
            className={`border rounded-xl p-4 transition-all ${
              isConnected
                ? 'bg-emerald-50/80 border-emerald-300'
                : isConnecting
                ? 'bg-blue-50/80 border-blue-300'
                : isConfigured
                ? 'bg-amber-50/80 border-amber-300'
                : 'bg-slate-50 border-slate-300'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                        isConnected
                          ? 'bg-emerald-400'
                          : isConnecting
                          ? 'bg-blue-400'
                          : 'bg-amber-400'
                      }`}
                    />
                    <span
                      className={`relative inline-flex rounded-full h-3 w-3 ${
                        isConnected
                          ? 'bg-emerald-500'
                          : isConnecting
                          ? 'bg-blue-500'
                          : 'bg-amber-500'
                      }`}
                    />
                  </span>
                  <span className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-emerald-600 fill-emerald-500" />
                    <span>
                      {isConnected
                        ? 'Supabase Realtime: Đã kết nối trực tiếp (0s Realtime)'
                        : isConnecting
                        ? 'Supabase: Đang đồng bộ dữ liệu...'
                        : isConfigured
                        ? 'Supabase: Sẵn sàng kết nối'
                        : 'Supabase: Đồng bộ Máy chủ Trung tâm (/api/sync)'}
                    </span>
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                      isConnected
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        : isConnecting
                        ? 'bg-blue-100 text-blue-800 border-blue-300'
                        : 'bg-slate-100 text-slate-700 border-slate-300'
                    }`}
                  >
                    {isConnected
                      ? 'Hoạt động 24/7'
                      : isConnecting
                      ? 'Đang đồng bộ'
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
                    Chế độ: <strong className="text-emerald-800">WebSocket Postgres Changes &amp; Sharded V2</strong>
                  </span>
                </div>
              </div>

              {/* Auto Sync Toggle */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setAutoSyncEnabled(!autoSyncEnabled)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                    autoSyncEnabled
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-300 hover:bg-emerald-200'
                      : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                  }`}
                  title="Bật/Tắt tự động đồng bộ khi có dữ liệu mới"
                >
                  {autoSyncEnabled ? 'Tự động đồng bộ: BẬT' : 'Tự động đồng bộ: TẮT'}
                </button>
              </div>
            </div>
          </div>

          {/* Feedback Message */}
          {feedbackMessage && (
            <div
              className={`p-3 rounded-xl border flex items-center justify-between gap-2.5 text-xs animate-in fade-in duration-150 ${
                feedbackMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                  : feedbackMessage.type === 'error'
                  ? 'bg-rose-50 text-rose-900 border-rose-300'
                  : 'bg-amber-50 text-amber-900 border-amber-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {feedbackMessage.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span className="font-medium">{feedbackMessage.text}</span>
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
                className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 cursor-pointer"
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
              onClick={handlePushToSupabase}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-xs transition-all disabled:opacity-60 cursor-pointer"
            >
              {isPushing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Đang kết nối &amp; tải dữ liệu lên...</span>
                </>
              ) : (
                <>
                  <ArrowUpCircle className="w-4 h-4" />
                  <span>Đồng bộ toàn bộ dữ liệu thiết bị lên Supabase</span>
                </>
              )}
            </button>

            <button
              type="button"
              disabled={isPulling}
              onClick={handlePullFromSupabase}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold text-xs shadow-xs transition-all disabled:opacity-60 cursor-pointer"
            >
              {isPulling ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Đang tải dữ liệu từ Supabase về...</span>
                </>
              ) : (
                <>
                  <ArrowDownCircle className="w-4 h-4" />
                  <span>Tải lại dữ liệu từ Supabase về thiết bị</span>
                </>
              )}
            </button>
          </div>

          {/* Supabase Configuration Form Card */}
          <div className="p-4 bg-emerald-50/50 border border-emerald-200 rounded-xl space-y-3 text-xs text-slate-700">
            <div className="flex items-center justify-between">
              <h5 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-emerald-600" />
                <span>Cấu Hình Kết Nối Dự Án Supabase:</span>
              </h5>
              <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300">
                {isConfigured ? 'Đã thiết lập' : 'Tự do cấu hình'}
              </span>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Supabase Project URL
                </label>
                <input
                  type="url"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="https://xyzcompany.supabase.co"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Supabase Anon Public API Key
                </label>
                <input
                  type="password"
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className="text-[10px] text-slate-500">
                  Lấy thông tin trong <strong>Supabase Dashboard &gt; Project Settings &gt; API</strong>
                </p>
                <button
                  type="submit"
                  disabled={isSavingConfig}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition-colors shadow-2xs cursor-pointer flex items-center gap-1"
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>{isSavingConfig ? 'Đang lưu...' : 'Lưu & Kết Nối'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Collapsible Supabase SQL Setup Helper */}
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50 text-xs">
            <button
              type="button"
              onClick={() => setShowSqlGuide(!showSqlGuide)}
              className="w-full px-4 py-3 flex items-center justify-between text-left font-bold text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-emerald-600" />
                <span>Mã SQL khởi tạo bảng Supabase (Dành cho dự án Supabase mới)</span>
              </div>
              {showSqlGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showSqlGuide && (
              <div className="p-4 border-t border-slate-200 bg-slate-900 text-slate-200 space-y-3">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Dán mã này vào <strong>Supabase SQL Editor</strong> và bấm <strong>Run</strong>:</span>
                  <button
                    type="button"
                    onClick={handleCopySql}
                    className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-[11px] transition-colors cursor-pointer"
                  >
                    {copiedSql ? (
                      <>
                        <Check className="w-3 h-3 text-white" />
                        <span>Đã sao chép!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Sao chép mã SQL</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 bg-black/60 rounded-lg text-[11px] font-mono text-emerald-400 overflow-x-auto leading-relaxed border border-slate-800">
                  {sqlSetupScript}
                </pre>
                <div className="text-[11px] text-slate-400 space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-300">
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span><strong>Kiến trúc Phân mảnh Sharded V2:</strong> Dữ liệu được chia nhỏ thành các mảnh &lt; 50KB/bản ghi, không bao giờ bị lỗi timeout hay giới hạn tải.</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-300">
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span><strong>Đồng bộ hai chiều tức thì:</strong> Tự động đồng bộ và hợp nhất hai chiều (CRDT Monotonic) không bị ghi đè dữ liệu.</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Dữ liệu luôn được đồng bộ an toàn và tự động khi có kết nối mạng</span>
          </div>
          <button
            type="button"
            onClick={() => setIsSyncModalOpen(false)}
            className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-xs border border-slate-300 rounded-xl transition-colors cursor-pointer"
          >
            Đóng cửa sổ
          </button>
        </div>
      </div>
    </div>
  );
};
