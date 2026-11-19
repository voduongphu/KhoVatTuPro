import React, { useState } from 'react';
import {
  Boxes,
  LayoutDashboard,
  PackagePlus,
  PackageMinus,
  AlertTriangle,
  Users,
  Plus,
  LogOut,
  ChevronDown,
  Building2,
  FolderTree,
  Zap,
  X,
  Menu,
  Laptop,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';

export type ActiveTabType =
  | 'dashboard'
  | 'inventory'
  | 'categories'
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
  onOpenImportExcel?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onOpenCreateItem,
  onOpenCreateTransaction,
}) => {
  const {
    items,
    materialCategories,
    currentUser,
    logout,
    syncStatus,
    lastSyncedAt,
    setIsSyncModalOpen,
    supabaseConnectionState,
    firestoreConnectionState,
    currentDeviceInfo,
  } = useInventory();

  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Count items needing attention
  const alertCount = items.filter(
    i => i.currentStock <= i.minStock || (i.inspectionDueDate && new Date(i.inspectionDueDate) <= new Date())
  ).length;

  const isAdmin = currentUser?.role === 'ADMIN';
  const canManage = currentUser?.role === 'ADMIN' || currentUser?.role === 'THU_KHO';

  const navItems: {
    id: ActiveTabType;
    label: string;
    icon: React.ReactNode;
    badge?: number | string;
    badgeColor?: string;
  }[] = [
    {
      id: 'dashboard',
      label: 'Tổng quan',
      icon: <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />,
    },
    {
      id: 'inventory',
      label: 'Vật tư',
      icon: <Boxes className="w-3.5 h-3.5 shrink-0" />,
    },
    {
      id: 'categories',
      label: 'Danh mục',
      icon: <FolderTree className="w-3.5 h-3.5 shrink-0" />,
      badge: materialCategories.length > 0 ? materialCategories.length : undefined,
      badgeColor: 'bg-slate-700 text-white',
    },
    {
      id: 'warehouses',
      label: 'Kho hàng',
      icon: <Building2 className="w-3.5 h-3.5 shrink-0" />,
    },
    {
      id: 'receipts',
      label: 'Phiếu Nhập',
      icon: <PackagePlus className="w-3.5 h-3.5 shrink-0" />,
    },
    {
      id: 'issues',
      label: 'Phiếu Xuất',
      icon: <PackageMinus className="w-3.5 h-3.5 shrink-0" />,
    },
    {
      id: 'alerts',
      label: 'Cảnh báo',
      icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" />,
      badge: alertCount > 0 ? (alertCount > 999 ? '999+' : alertCount) : undefined,
      badgeColor: 'bg-rose-500 text-white',
    },
    {
      id: 'users',
      label: 'Người dùng',
      icon: <Users className="w-3.5 h-3.5 shrink-0" />,
    },
  ];

  const isRealtimeConnected =
    supabaseConnectionState === 'CONNECTED' || firestoreConnectionState === 'CONNECTED';
  const isSyncing = syncStatus === 'syncing' || supabaseConnectionState === 'CONNECTING';

  const roleLabel =
    currentUser?.role === 'ADMIN'
      ? 'Quản trị viên'
      : currentUser?.role === 'THU_KHO'
      ? 'Thủ kho'
      : 'Nhân viên kỹ thuật';

  const shortUserLabel =
    currentUser?.username?.split('@')[0] || currentUser?.fullName || '';

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs w-full">
      {/* Compact Single-Row Main Header */}
      <div className="w-full px-3 sm:px-5 lg:px-6">
        <div className="flex items-center justify-between h-14 gap-2 sm:gap-3">
          {/* Left: Brand */}
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className="flex items-center gap-2 cursor-pointer shrink-0 text-left focus:outline-none"
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs shrink-0">
              <Boxes className="w-4 h-4" />
            </div>
            <span className="text-sm sm:text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
              KhoVatTu<span className="text-indigo-600">Pro</span>
            </span>
          </button>

          {/* Center: Bounded Scrollable Navigation (Never overlaps Brand or Right Actions) */}
          <nav
            aria-label="Điều hướng chính"
            className="hidden md:flex flex-1 min-w-0 overflow-x-auto scrollbar-none px-1"
          >
            <div className="flex items-center gap-0.5 xl:gap-1 mx-auto w-max">
              {navItems.map(item => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`flex items-center gap-1 px-2 xl:px-2.5 py-1.5 text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 text-white font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    {item.badge !== undefined && (
                      <span
                        className={`px-1.5 py-0.5 leading-none rounded-full text-[10px] font-bold tabular-nums ${
                          isActive && item.id === 'categories'
                            ? 'bg-white/20 text-white'
                            : item.badgeColor || 'bg-slate-700 text-white'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Right: Compact Sync + Create + Compact User Chip */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Live Real-Time Cloud Sync Button */}
            <button
              type="button"
              onClick={() => setIsSyncModalOpen(true)}
              className={`inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap shrink-0 shadow-2xs border cursor-pointer ${
                isRealtimeConnected
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                  : isSyncing
                  ? 'bg-blue-50 text-blue-900 border-blue-300 hover:bg-blue-100'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title={`Supabase Cloud Realtime${
                lastSyncedAt
                  ? ` • Đồng bộ lúc ${lastSyncedAt.toLocaleTimeString('vi-VN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : ''
              }. Bấm để quản lý.`}
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    isRealtimeConnected
                      ? 'bg-emerald-400'
                      : isSyncing
                      ? 'bg-blue-400'
                      : 'bg-amber-400'
                  }`}
                />
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    isRealtimeConnected
                      ? 'bg-emerald-500'
                      : isSyncing
                      ? 'bg-blue-500'
                      : 'bg-amber-500'
                  }`}
                />
              </span>
              <Zap className="w-3 h-3 text-emerald-600 fill-emerald-400 shrink-0" />
              <span className="hidden lg:inline font-medium">
                {syncStatus === 'syncing' ? 'Đồng bộ...' : 'Supabase'}
              </span>
            </button>

            {/* Quick Create Dropdown */}
            {canManage && (
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    setIsCreateMenuOpen(!isCreateMenuOpen);
                  }}
                  className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs whitespace-nowrap cursor-pointer"
                  title="Tạo phiếu hoặc vật tư mới"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden lg:inline">Tạo mới</span>
                  <ChevronDown className="w-3 h-3 opacity-80 shrink-0" />
                </button>

                {isCreateMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsCreateMenuOpen(false)}
                    />
                    <div className="absolute right-0 mt-1.5 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreateMenuOpen(false);
                          onOpenCreateTransaction('NHAP_KHO');
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-medium cursor-pointer"
                      >
                        <PackagePlus className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Lập Phiếu Nhập Kho</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreateMenuOpen(false);
                          onOpenCreateTransaction('XUAT_KHO');
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-medium cursor-pointer"
                      >
                        <PackageMinus className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>Lập Phiếu Xuất Kho</span>
                      </button>
                      <div className="border-t border-slate-100 my-1" />
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreateMenuOpen(false);
                          onOpenCreateItem();
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-medium cursor-pointer"
                      >
                        <Plus className="w-4 h-4 text-indigo-600 shrink-0" />
                        <span>Thêm Vật tư / Thiết bị</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreateMenuOpen(false);
                          setActiveTab('categories');
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-medium cursor-pointer"
                      >
                        <FolderTree className="w-4 h-4 text-indigo-600 shrink-0" />
                        <span>Quản lý danh mục vật tư</span>
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
                            className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-medium cursor-pointer"
                          >
                            <Building2 className="w-4 h-4 text-slate-600 shrink-0" />
                            <span>Quản lý kho hàng</span>
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Ultra-Compact User Menu Button */}
            {currentUser && (
              <div className="relative pl-1.5 border-l border-slate-200 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateMenuOpen(false);
                    setIsUserMenuOpen(!isUserMenuOpen);
                  }}
                  className="flex items-center gap-1.5 px-1.5 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs transition-colors cursor-pointer"
                  title={`${currentUser.fullName} (@${currentUser.username}) • ${roleLabel}`}
                >
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] text-white shrink-0 ${
                      currentUser.role === 'ADMIN'
                        ? 'bg-indigo-600'
                        : currentUser.role === 'THU_KHO'
                        ? 'bg-emerald-600'
                        : 'bg-blue-600'
                    }`}
                  >
                    {currentUser.fullName.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-semibold text-slate-800 max-w-[76px] truncate hidden sm:inline">
                    {shortUserLabel}
                  </span>
                  <ChevronDown className="w-3 h-3 text-slate-400 shrink-0 hidden sm:inline" />
                </button>

                {isUserMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsUserMenuOpen(false)}
                    />
                    <div className="absolute right-0 mt-1.5 w-60 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden text-xs">
                      <div className="p-3 bg-slate-50/80 border-b border-slate-100">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0 ${
                              currentUser.role === 'ADMIN'
                                ? 'bg-indigo-600'
                                : currentUser.role === 'THU_KHO'
                                ? 'bg-emerald-600'
                                : 'bg-blue-600'
                            }`}
                          >
                            {currentUser.fullName.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-900 truncate">
                              {currentUser.fullName}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono truncate">
                              @{currentUser.username}
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span
                            className={`inline-block text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                              currentUser.role === 'ADMIN'
                                ? 'bg-indigo-100 text-indigo-700'
                                : currentUser.role === 'THU_KHO'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {roleLabel}
                          </span>
                          <span
                            className="inline-flex items-center gap-1 text-[10px] text-slate-400 truncate"
                            title={currentDeviceInfo.name}
                          >
                            <Laptop className="w-3 h-3 shrink-0" />
                            <span className="truncate max-w-[110px]">{currentDeviceInfo.name}</span>
                          </span>
                        </div>
                      </div>

                      <div className="p-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            logout();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-rose-600 hover:bg-rose-50 rounded-lg font-semibold transition-colors cursor-pointer"
                        >
                          <LogOut className="w-4 h-4 shrink-0" />
                          <span>Đăng xuất</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Compact Mobile Menu Toggle (< 768px) */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg md:hidden shrink-0 border border-slate-200 cursor-pointer"
              title="Mở menu danh mục"
            >
              {isMobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer (< 768px) */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white shadow-xl p-3 space-y-1">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1">
            Menu Chức Năng Hệ Thống
          </div>
          {navItems.map(item => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setIsMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between p-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`p-1.5 rounded-lg ${
                      isActive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {item.icon}
                  </div>
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      item.badgeColor || 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
};
