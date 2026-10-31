import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { StorageService } from '../../services/storage';
import { 
  Boxes, 
  User as UserIcon, 
  KeyRound, 
  LogOut, 
  RotateCcw, 
  ShieldCheck, 
  LogIn, 
  ChevronDown,
  Building,
  Bell
} from 'lucide-react';
import { LoginModal } from '../auth/LoginModal';
import { ChangePasswordModal } from '../auth/ChangePasswordModal';
import { ConfirmDeleteModal } from '../common/ConfirmDeleteModal';

export const Navbar: React.FC = () => {
  const { currentUser, logout, isAdmin } = useAuth();
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isChangePassModalOpen, setIsChangePassModalOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  const confirmResetData = async () => {
    await StorageService.resetToDefault();
    window.location.reload();
  };

  return (
    <>
      <header className="bg-slate-900 border-b border-slate-800 text-white sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-md shadow-blue-500/20 text-white">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm md:text-base tracking-tight text-white">
                  LOGISTICS & INVENTORY
                </span>
                <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30">
                  EPC PRO
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Quản Lý Nhập - Xuất - Tồn Vật Tư Thiết Bị Công Trình Dự Án
              </p>
            </div>
          </div>

          {/* User Action Right */}
          <div className="flex items-center gap-3">
            {/* Reset sample data */}
            <button
              onClick={() => setIsResetConfirmOpen(true)}
              title="Khôi phục dữ liệu mẫu ban đầu"
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Dữ Liệu Mẫu</span>
            </button>

            {currentUser ? (
              <div className="relative">
                <button
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="flex items-center gap-2.5 p-1.5 sm:px-3 sm:py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700/80 border border-slate-700 transition text-left"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
                    isAdmin ? 'bg-rose-600 text-white' : 'bg-blue-600 text-white'
                  }`}>
                    {currentUser.username.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="hidden md:block">
                    <div className="text-xs font-semibold text-white flex items-center gap-1">
                      <span>{currentUser.fullName}</span>
                      {isAdmin && (
                        <ShieldCheck className="w-3.5 h-3.5 text-rose-400" />
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {isAdmin ? 'Quản trị viên (Admin)' : 'Nhân viên kho'}
                    </div>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden sm:block" />
                </button>

                {/* Dropdown Menu */}
                {isUserMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-200 py-1.5 text-slate-700 text-xs z-50 animate-in fade-in zoom-in-95">
                    <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
                      <div className="font-bold text-slate-900">{currentUser.fullName}</div>
                      <div className="text-[11px] text-slate-500 font-mono">@{currentUser.username}</div>
                    </div>

                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        setIsChangePassModalOpen(true);
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-slate-50 flex items-center gap-2"
                    >
                      <KeyRound className="w-4 h-4 text-slate-500" />
                      <span>Đổi mật khẩu cá nhân</span>
                    </button>

                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        logout();
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-blue-700"
                    >
                      <LogIn className="w-4 h-4" />
                      <span>Đăng nhập tài khoản khác</span>
                    </button>

                    <div className="border-t border-slate-100 mt-1 pt-1">
                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          logout();
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-rose-50 text-rose-600 flex items-center gap-2 font-medium"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Đăng xuất</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setIsLoginModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-md transition"
              >
                <LogIn className="w-4 h-4" />
                <span>Đăng Nhập</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Modals */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
      />

      <ChangePasswordModal
        isOpen={isChangePassModalOpen}
        onClose={() => setIsChangePassModalOpen(false)}
      />

      {/* Modal Khôi Phục Dữ Liệu Mẫu */}
      <ConfirmDeleteModal
        isOpen={isResetConfirmOpen}
        onClose={() => setIsResetConfirmOpen(false)}
        onConfirm={confirmResetData}
        title="Khôi Phục Dữ Liệu Mẫu Ban Đầu"
        itemName="Toàn bộ danh mục vật tư, kho bãi, phiếu nhập xuất và tài khoản Admin"
        itemType="dữ liệu"
        warningText="Hệ thống sẽ nạp lại toàn bộ dữ liệu mẫu ban đầu về trạng thái chuẩn. Bạn có chắc chắn muốn tiếp tục?"
      />
    </>
  );
};
