import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { 
  Boxes, 
  Lock, 
  User, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  Eye, 
  EyeOff, 
  ArrowRight,
  Warehouse,
  Layers
} from 'lucide-react';

export const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!username.trim()) {
      setErrorMessage('Vui lòng nhập tên người sử dụng.');
      return;
    }

    if (!password) {
      setErrorMessage('Vui lòng nhập mật khẩu đăng nhập.');
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      const res = login(username.trim(), password);
      setIsLoading(false);

      if (res.success) {
        setSuccessMessage('Đăng nhập thành công! Đang chuyển vào hệ thống...');
      } else {
        setErrorMessage(res.message);
      }
    }, 200);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 sm:p-6 lg:p-8 relative overflow-hidden font-sans">
      {/* Background architectural glow & grid effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(37,99,235,0.25),rgba(255,255,255,0))] pointer-events-none" />
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Container Card */}
      <div className="w-full max-w-5xl bg-slate-900 border border-slate-800/80 rounded-3xl shadow-2xl shadow-black/60 overflow-hidden grid grid-cols-1 lg:grid-cols-12 relative z-10 backdrop-blur-xl">
        
        {/* Left Side: Brand & Overview (5 cols on lg) */}
        <div className="lg:col-span-5 bg-gradient-to-br from-blue-950 via-slate-900 to-indigo-950 p-8 sm:p-10 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-800/80 text-white relative">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/30">
                <Boxes className="w-6 h-6 text-white" />
              </div>
              <div>
                <span className="font-extrabold text-base tracking-wider text-white block">
                  LOGISTICS & INVENTORY
                </span>
                <span className="text-[10px] uppercase font-bold tracking-widest text-blue-400">
                  EPC INDUSTRIAL SYSTEM
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white leading-tight">
                Hệ Thống Quản Lý Nhập Xuất Tồn Vật Tư
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                Giải pháp quản trị kho vật tư thiết bị dự án công trình chuyên sâu theo Packing List, Shipment, Bản vẽ, Kiện hàng, Nhà sản xuất & Nhà cung cấp.
              </p>
            </div>
          </div>

          {/* Highlights */}
          <div className="my-8 space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/10 text-xs">
              <div className="p-2 rounded-xl bg-blue-500/20 text-blue-300">
                <Warehouse className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-white block">Quản Lý Kho Bãi Đa Khu Vực</span>
                <span className="text-[11px] text-slate-400">Kho Cát Lái, Cảng Phú Mỹ, Bãi Đồng Nai</span>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/10 text-xs">
              <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-300">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-white block">Nhập Xuất & Import File Excel</span>
                <span className="text-[11px] text-slate-400">Bóc tách tự động khối lượng, số lượng, bản vẽ</span>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/10 text-xs">
              <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-300">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-white block">Phân Quyền & Quản Lý Người Dùng</span>
                <span className="text-[11px] text-slate-400">Admin cấp mật khẩu và phân quyền vận hành</span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400">
            <span>Phiên bản v2.6 Enterprise</span>
            <span>Bảo mật nội bộ 100%</span>
          </div>
        </div>

        {/* Right Side: Login Form (7 cols on lg) */}
        <div className="lg:col-span-7 p-8 sm:p-12 bg-slate-900 flex flex-col justify-center">
          <div className="max-w-md mx-auto w-full space-y-6">
            
            {/* Title */}
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-xs font-semibold mb-2 border border-blue-500/20">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Xác thực tài khoản người sử dụng</span>
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">
                Đăng Nhập Hệ Thống
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Vui lòng nhập tên người sử dụng và mật khẩu đăng nhập đã được cấp để truy cập hệ thống
              </p>
            </div>

            {/* Alert messages */}
            {errorMessage && (
              <div className="p-3.5 bg-rose-950/70 border border-rose-800 rounded-2xl text-rose-300 text-xs flex items-center gap-2.5 animate-in shake">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span className="font-medium">{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div className="p-3.5 bg-emerald-950/70 border border-emerald-800 rounded-2xl text-emerald-300 text-xs flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                <span className="font-medium">{successMessage}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Tên người sử dụng */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                  Tên người sử dụng (*)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Nhập tên người sử dụng..."
                    autoComplete="username"
                    className="w-full px-4 py-3 pl-11 text-sm bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:bg-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition outline-none"
                    required
                  />
                  <User className="w-4 h-4 text-slate-400 absolute left-4 top-3.5" />
                </div>
              </div>

              {/* Mật khẩu đăng nhập */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                  Mật khẩu đăng nhập (*)
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Nhập mật khẩu đăng nhập..."
                    autoComplete="current-password"
                    className="w-full px-4 py-3 pl-11 pr-11 text-sm bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:bg-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition outline-none"
                    required
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-4 top-3.5" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-3.5 text-slate-400 hover:text-white p-0.5 rounded transition"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Nút Đăng Nhập */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-blue-600/30 transition active:scale-[0.99] flex items-center justify-center gap-2 disabled:opacity-70 mt-2"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Đang kiểm tra thông tin...</span>
                  </span>
                ) : (
                  <>
                    <span>Đăng Nhập Vào Hệ Thống</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="pt-2 text-center text-xs text-slate-500">
              Cần cấp mới tài khoản hoặc quên mật khẩu? Vui lòng liên hệ <strong className="text-slate-300">Quản trị viên hệ thống</strong>.
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};
