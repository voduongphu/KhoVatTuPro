import React, { useState } from 'react';
import {
  Boxes,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  ArrowRight,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';

export const LoginView: React.FC = () => {
  const { login } = useInventory();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    setTimeout(() => {
      const res = login(username, password);
      setIsLoading(false);
      if (!res.success) {
        setError(res.error || 'Đăng nhập không thành công.');
      }
    }, 200);
  };

  const handleQuickFill = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError('');
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background aesthetic grid / ambient lights */}
      <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:24px_24px] opacity-25 pointer-events-none" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 text-white shadow-xl shadow-indigo-500/20 mb-4">
          <Boxes className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-white">
          KhoVatTu &bull; Pro
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Hệ thống Quản lý Nhập - Xuất - Tồn Vật tư &amp; Thiết bị Đa Điều Kiện
        </p>
      </div>

      {/* Login Card */}
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-slate-800/90 backdrop-blur-md py-8 px-6 shadow-2xl rounded-2xl border border-slate-700/80 sm:px-10">
          <form className="space-y-5" onSubmit={handleSubmit}>
            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Tên đăng nhập
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <UserIcon className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Nhập tên đăng nhập..."
                  className="block w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-900/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Mật khẩu truy cập
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu..."
                  className="block w-full pl-10 pr-10 py-2.5 text-sm bg-slate-900/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center items-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all shadow-lg shadow-indigo-600/30 disabled:opacity-50"
              >
                <span>{isLoading ? 'Đang xác thực...' : 'Đăng nhập vào hệ thống'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>

          {/* Quick Demo Switcher */}
          <div className="mt-6 pt-6 border-t border-slate-700/60">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 text-center">
              Chọn tài khoản thử nghiệm nhanh (Role Demo):
            </p>
            <div className="space-y-2">
              {/* Admin */}
              <button
                type="button"
                onClick={() => handleQuickFill('admin', 'admin123')}
                className={`w-full text-left p-2.5 rounded-xl border transition-all text-xs flex items-center justify-between ${
                  username === 'admin'
                    ? 'bg-indigo-950/60 border-indigo-500/60 text-white'
                    : 'bg-slate-900/60 border-slate-700/60 text-slate-300 hover:bg-slate-900'
                }`}
              >
                <div>
                  <div className="font-semibold text-indigo-300 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>admin (Quản trị viên)</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Toàn quyền: Thêm/Sửa/Xóa Phiếu Nhập Xuất, Quản lý User
                  </div>
                </div>
                <span className="font-mono text-[11px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                  admin123
                </span>
              </button>

              {/* Thủ kho */}
              <button
                type="button"
                onClick={() => handleQuickFill('thukho_hn', 'thukho123')}
                className={`w-full text-left p-2.5 rounded-xl border transition-all text-xs flex items-center justify-between ${
                  username === 'thukho_hn'
                    ? 'bg-emerald-950/60 border-emerald-500/60 text-white'
                    : 'bg-slate-900/60 border-slate-700/60 text-slate-300 hover:bg-slate-900'
                }`}
              >
                <div>
                  <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>thukho_hn (Thủ kho Hà Nội)</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Quyền lập/sửa phiếu, xem báo cáo kho (không xóa phiếu)
                  </div>
                </div>
                <span className="font-mono text-[11px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                  thukho123
                </span>
              </button>

              {/* Nhân viên kỹ thuật */}
              <button
                type="button"
                onClick={() => handleQuickFill('kythuat_vien', '123456')}
                className={`w-full text-left p-2.5 rounded-xl border transition-all text-xs flex items-center justify-between ${
                  username === 'kythuat_vien'
                    ? 'bg-blue-950/60 border-blue-500/60 text-white'
                    : 'bg-slate-900/60 border-slate-700/60 text-slate-300 hover:bg-slate-900'
                }`}
              >
                <div>
                  <div className="font-semibold text-blue-300 flex items-center gap-1.5">
                    <UserIcon className="w-3.5 h-3.5" />
                    <span>kythuat_vien (Kỹ thuật viên)</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Quyền xem tồn kho, xem thẻ kho (Chỉ đọc)
                  </div>
                </div>
                <span className="font-mono text-[11px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                  123456
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
