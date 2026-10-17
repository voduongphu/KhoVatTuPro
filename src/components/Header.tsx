import React, { useState } from 'react';
import {
  Boxes,
  LayoutDashboard,
  PackagePlus,
  PackageMinus,
  AlertTriangle,
  Users,
  FileSpreadsheet,
  Plus,
  LogOut,
  RotateCcw,
  ChevronDown,
  Building2,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';

export type ActiveTabType =
  | 'dashboard'
  | 'inventory'
  | 'warehouses'
  | 'receipts'
  | 'issues'
  | 'alerts'
  | 'users';

interface HeaderProps {
  activeTab: ActiveTabType;
  setActiveTab: (tab: ActiveTabType) => void;
  onOpenCreateItem: () => void;
  onOpenCreateTransaction: (type: 'NHAP_KHO' | 'XUAT_KHO') => void;
  onOpenImportExcel: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onOpenCreateItem,
  onOpenCreateTransaction,
  onOpenImportExcel,
}) => {
  const { items, resetToDefaultData, currentUser, logout } = useInventory();
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);

  // Count items needing attention
  const alertCount = items.filter(
    i => i.currentStock <= i.minStock || (i.inspectionDueDate && new Date(i.inspectionDueDate) <= new Date())
  ).length;

  const isAdmin = currentUser?.role === 'ADMIN';
  const canManage = currentUser?.role === 'ADMIN' || currentUser?.role === 'THU_KHO';

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-xs">
      <div className="w-full px-3 sm:px-6 lg:px-8">
        {/* Strictly single-row navigation bar */}
        <div className="flex items-center justify-between h-14 sm:h-16 gap-2 sm:gap-4">
          {/* Brand - Compact 1-line */}
          <div
            onClick={() => setActiveTab('dashboard')}
            className="flex items-center gap-2.5 cursor-pointer shrink-0"
          >
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
              <Boxes className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
                KhoVatTu<span className="text-indigo-600">Pro</span>
              </span>
            </div>
          </div>

          {/* Navigation Links - Centered, Compact, Single-Row, No text overlap */}
          <nav className="flex-1 min-w-0 flex items-center justify-center gap-0.5 sm:gap-1 overflow-x-auto py-1 scrollbar-none text-xs font-medium px-1">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'dashboard'
                  ? 'bg-slate-900 text-white font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Bảng điều khiển tổng quan"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>Tổng quan</span>
            </button>

            <button
              onClick={() => setActiveTab('inventory')}
              className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'inventory'
                  ? 'bg-slate-900 text-white font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Danh mục vật tư và thiết bị"
            >
              <Boxes className="w-3.5 h-3.5" />
              <span>Vật tư</span>
            </button>

            <button
              onClick={() => setActiveTab('warehouses')}
              className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'warehouses'
                  ? 'bg-slate-900 text-white font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Danh mục hệ thống kho hàng"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Kho hàng</span>
            </button>

            <button
              onClick={() => setActiveTab('receipts')}
              className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'receipts'
                  ? 'bg-slate-900 text-white font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Quản lý phiếu nhập kho"
            >
              <PackagePlus className="w-3.5 h-3.5" />
              <span>Phiếu Nhập</span>
            </button>

            <button
              onClick={() => setActiveTab('issues')}
              className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'issues'
                  ? 'bg-slate-900 text-white font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Quản lý phiếu xuất kho"
            >
              <PackageMinus className="w-3.5 h-3.5" />
              <span>Phiếu Xuất</span>
            </button>

            <button
              onClick={() => setActiveTab('alerts')}
              className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'alerts'
                  ? 'bg-slate-900 text-white font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Cảnh báo tồn kho & hạn kiểm định"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span>Cảnh báo</span>
              {alertCount > 0 && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums ${
                    activeTab === 'alerts'
                      ? 'bg-rose-500 text-white'
                      : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  {alertCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('users')}
              className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'users'
                  ? 'bg-slate-900 text-white font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Quản lý người dùng & phân quyền"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Người dùng</span>
              {isAdmin && (
                <span
                  className={`text-[9px] px-1 py-0.2 rounded font-bold uppercase tracking-wider ${
                    activeTab === 'users'
                      ? 'bg-indigo-500 text-white'
                      : 'bg-indigo-100 text-indigo-700'
                  }`}
                >
                  Admin
                </span>
              )}
            </button>
          </nav>

          {/* Action & User Cluster - Right side */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {canManage && (
              <>
                {/* Excel Import button */}
                <button
                  type="button"
                  onClick={onOpenImportExcel}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shadow-2xs"
                  title="Import phiếu từ file Excel (.xlsx / .csv)"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="hidden sm:inline">Import Excel</span>
                </button>

                {/* Create Dropdown / Quick Create */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsCreateMenuOpen(!isCreateMenuOpen)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Tạo mới</span>
                    <ChevronDown className="w-3 h-3 opacity-80" />
                  </button>

                  {/* Dropdown Menu */}
                  {isCreateMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsCreateMenuOpen(false)}
                      />
                      <div className="absolute right-0 mt-1.5 w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setIsCreateMenuOpen(false);
                            onOpenCreateTransaction('NHAP_KHO');
                          }}
                          className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-medium"
                        >
                          <PackagePlus className="w-4 h-4 text-emerald-600" />
                          <span>Lập Phiếu Nhập Kho</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsCreateMenuOpen(false);
                            onOpenCreateTransaction('XUAT_KHO');
                          }}
                          className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-medium"
                        >
                          <PackageMinus className="w-4 h-4 text-amber-600" />
                          <span>Lập Phiếu Xuất Kho</span>
                        </button>
                        <div className="border-t border-slate-100 my-1" />
                        <button
                          type="button"
                          onClick={() => {
                            setIsCreateMenuOpen(false);
                            onOpenCreateItem();
                          }}
                          className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-medium"
                        >
                          <Plus className="w-4 h-4 text-indigo-600" />
                          <span>Thêm Vật tư / Thiết bị</span>
                        </button>
                        {isAdmin && (
                          <>
                            <div className="border-t border-slate-100 my-1" />
                            <button
                              type="button"
                              onClick={() => {
                                setIsCreateMenuOpen(false);
                                setActiveTab('warehouses');
                              }}
                              className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-medium"
                            >
                              <Building2 className="w-4 h-4 text-slate-600" />
                              <span>Quản lý kho hàng</span>
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {/* Current User Pill & Logout */}
            {currentUser && (
              <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
                <div
                  className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200/80 rounded-lg text-xs"
                  title={`Đang đăng nhập: ${currentUser.fullName} (@${currentUser.username})`}
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] text-white ${
                      currentUser.role === 'ADMIN'
                        ? 'bg-indigo-600'
                        : currentUser.role === 'THU_KHO'
                        ? 'bg-emerald-600'
                        : 'bg-blue-600'
                    }`}
                  >
                    {currentUser.fullName.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-semibold text-slate-800 max-w-[90px] sm:max-w-[120px] truncate hidden md:inline">
                    {currentUser.fullName}
                  </span>
                  <span
                    className={`text-[10px] px-1 py-0.2 rounded font-bold uppercase ${
                      currentUser.role === 'ADMIN'
                        ? 'bg-indigo-100 text-indigo-700'
                        : currentUser.role === 'THU_KHO'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {currentUser.role === 'ADMIN'
                      ? 'Admin'
                      : currentUser.role === 'THU_KHO'
                      ? 'Thủ kho'
                      : 'Kỹ thuật'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={logout}
                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  title="Đăng xuất"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Reset data */}
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Khôi phục lại toàn bộ dữ liệu mẫu ban đầu?')) {
                  resetToDefaultData();
                }
              }}
              title="Khôi phục dữ liệu mẫu ban đầu"
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors hidden sm:block"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
