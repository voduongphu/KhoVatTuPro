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
    realtimeConnectionState,
    firestoreConnectionState,
    currentDeviceInfo,
  } = useInventory();

  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isManageMenuOpen, setIsManageMenuOpen] = useState(false);

  // Count items needing attention
  const alertCount = items.filter(
    i => i.currentStock <= i.minStock || (i.inspectionDueDate && new Date(i.inspectionDueDate) <= new Date())
  ).length;

  const isAdmin = currentUser?.role === 'ADMIN';
  const canManage = currentUser?.role === 'ADMIN' || currentUser?.role === 'THU_KHO';

  // Primary operational tabs (Directly visible on laptops and desktops)
  const primaryNavItems: {
    id: ActiveTabType;
    label: string;
    icon: React.ReactNode;
    badge?: number | string;
    badgeColor?: string;
  }[] = [
    {
      id: 'dashboard',
      label: 'Tổng quan',
      icon: <LayoutDashboard className="w-3.5 h-3.5" />,
    },
    {
      id: 'inventory',
      label: 'Vật tư',
      icon: <Boxes className="w-3.5 h-3.5" />,
    },
    {
      id: 'receipts',
      label: 'Phiếu Nhập',
      icon: <PackagePlus className="w-3.5 h-3.5" />,
    },
    {
      id: 'issues',
      label: 'Phiếu Xuất',
      icon: <PackageMinus className="w-3.5 h-3.5" />,
    },
    {
      id: 'alerts',
      label: 'Cảnh báo',
      icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />,
      badge: alertCount > 0 ? alertCount : undefined,
      badgeColor: 'bg-rose-500 text-white',
    },
  ];

  // Secondary management tabs (Directly inline on wide screens >=1400px, grouped in "Quản lý ▾" on laptop screens)
  const secondaryNavItems: {
    id: ActiveTabType;
    label: string;
    icon: React.ReactNode;
    badge?: number | string;
    badgeColor?: string;
  }[] = [
    {
      id: 'categories',
      label: 'Danh mục',
      icon: <FolderTree className="w-3.5 h-3.5" />,
      badge: materialCategories.length > 0 ? materialCategories.length : undefined,
      badgeColor: 'bg-slate-700 text-white',
    },
    {
      id: 'warehouses',
      label: 'Kho hàng',
      icon: <Building2 className="w-3.5 h-3.5" />,
    },
    {
      id: 'users',
      label: 'Người dùng',
      icon: <Users className="w-3.5 h-3.5" />,
      badge: isAdmin ? 'Admin' : undefined,
      badgeColor: 'bg-indigo-500 text-white',
    },
  ];

  // All nav items combined (for mobile drawer & sub-bar)
  const navItems = [...primaryNavItems.slice(0, 2), secondaryNavItems[0], secondaryNavItems[1], ...primaryNavItems.slice(2), secondaryNavItems[2]];

  const isSecondaryActive = secondaryNavItems.some(i => i.id === activeTab);
  const activeSecondaryItem = secondaryNavItems.find(i => i.id === activeTab);

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs w-full max-w-full overflow-x-clip">
      {/* Main Single-row Navigation Auto-fitting container */}
      <div className="w-full max-w-[1600px] mx-auto px-2 sm:px-4 lg:px-5">
        <div className="flex items-center justify-between h-14 sm:h-16 gap-1.5 sm:gap-2.5">
          {/* Brand - Compact & Always Fits */}
          <div
            onClick={() => setActiveTab('dashboard')}
            className="flex items-center gap-1.5 sm:gap-2 cursor-pointer shrink-0"
          >
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
              <Boxes className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="flex items-baseline gap-0.5 sm:gap-1">
              <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
                KhoVatTu<span className="text-indigo-600">Pro</span>
              </span>
            </div>
          </div>

          {/* Desktop & Laptop Responsive Navigation Links (Visible on lg+ screens >= 1024px) */}
          <nav className="hidden lg:flex items-center justify-center gap-0.5 xl:gap-1 text-xs font-medium min-w-0">
            {/* 1. Core Operational Tabs - Always Visible on Laptops & Desktops */}
            {primaryNavItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-1 px-2 xl:px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-slate-900 text-white font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.badge !== undefined && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums ${
                        item.badgeColor || 'bg-slate-700 text-white'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}

            {/* 2. Secondary Management Tabs: Inline on Wide Screens (>= 1400px / 2xl), Compact Dropdown on Laptop Screens (1024px - 1399px) */}
            {/* 2a. Laptop Compact Dropdown: "Quản lý ▾" (hidden on 2xl where tabs are shown inline) */}
            <div className="relative 2xl:hidden">
              <button
                type="button"
                onClick={() => setIsManageMenuOpen(!isManageMenuOpen)}
                className={`flex items-center gap-1 px-2 xl:px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                  isSecondaryActive
                    ? 'bg-slate-900 text-white font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
                title="Các mục quản lý danh mục, kho hàng và người dùng"
              >
                {activeSecondaryItem ? (
                  <>
                    {activeSecondaryItem.icon}
                    <span>{activeSecondaryItem.label}</span>
                    {activeSecondaryItem.badge !== undefined && (
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums ${
                          activeSecondaryItem.badgeColor || 'bg-slate-700 text-white'
                        }`}
                      >
                        {activeSecondaryItem.badge}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <FolderTree className="w-3.5 h-3.5" />
                    <span>Quản lý</span>
                  </>
                )}
                <ChevronDown className="w-3 h-3 opacity-70 ml-0.5" />
              </button>

              {isManageMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsManageMenuOpen(false)}
                  />
                  <div className="absolute left-0 mt-1.5 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5 text-xs animate-in zoom-in-95 duration-150">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 py-1">
                      Danh mục &amp; Quản trị
                    </div>
                    {secondaryNavItems.map((item) => {
                      const isActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setActiveTab(item.id);
                            setIsManageMenuOpen(false);
                          }}
                          className={`w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center justify-between text-xs font-medium transition-colors ${
                            isActive
                              ? 'text-indigo-600 bg-indigo-50/70 font-semibold'
                              : 'text-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={isActive ? 'text-indigo-600' : 'text-slate-500'}>
                              {item.icon}
                            </span>
                            <span>{item.label}</span>
                          </div>
                          {item.badge !== undefined && (
                            <span
                              className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums ${
                                item.badgeColor || 'bg-slate-700 text-white'
                              }`}
                            >
                              {item.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* 2b. Wide Screen Inline Tabs (visible only on >= 1400px / 2xl:flex) */}
            {secondaryNavItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`hidden 2xl:flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-slate-900 text-white font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.badge !== undefined && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums ${
                        item.badgeColor || 'bg-slate-700 text-white'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Action & User Cluster - Right side, Auto-fitting */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {/* Live Real-Time Cloud Sync Badge & Button */}
            <button
              type="button"
              onClick={() => setIsSyncModalOpen(true)}
              className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap shadow-2xs border ${
                firestoreConnectionState === 'CONNECTED' || realtimeConnectionState === 'CONNECTED'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title={
                firestoreConnectionState === 'CONNECTED'
                  ? 'Firebase Firestore & Realtime WebSocket đang hoạt động (0s). Nhấn để xem trạng thái.'
                  : realtimeConnectionState === 'CONNECTED'
                  ? 'Supabase Realtime WebSocket đang hoạt động (0s). Nhấn để xem trạng thái.'
                  : 'Đồng bộ tự động đám mây. Nhấn để xem trạng thái.'
              }
            >
              <span className="relative flex h-2 w-2">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    firestoreConnectionState === 'CONNECTED' || realtimeConnectionState === 'CONNECTED' || syncStatus === 'synced'
                      ? 'bg-emerald-400'
                      : syncStatus === 'syncing'
                      ? 'bg-blue-400'
                      : 'bg-rose-400'
                  }`}
                />
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    firestoreConnectionState === 'CONNECTED' || realtimeConnectionState === 'CONNECTED' || syncStatus === 'synced'
                      ? 'bg-emerald-500'
                      : syncStatus === 'syncing'
                      ? 'bg-blue-500'
                      : 'bg-rose-500'
                  }`}
                />
              </span>
              <Zap className="w-3 h-3 text-amber-500 fill-amber-400 shrink-0" />
              <span className="hidden sm:inline font-medium">
                {firestoreConnectionState === 'CONNECTED'
                  ? 'Firestore'
                  : realtimeConnectionState === 'CONNECTED'
                  ? 'Realtime'
                  : syncStatus === 'syncing'
                  ? 'Syncing'
                  : 'Live 5s'}
              </span>
              <span className="text-[10px] text-slate-400 hidden 2xl:inline">
                {lastSyncedAt
                  ? lastSyncedAt.toLocaleTimeString('vi-VN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''}
              </span>
            </button>

            {/* Quick Create Dropdown */}
            {canManage && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsCreateMenuOpen(!isCreateMenuOpen)}
                  className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs whitespace-nowrap"
                  title="Tạo phiếu hoặc vật tư mới"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Tạo mới</span>
                  <ChevronDown className="w-3 h-3 opacity-80" />
                </button>

                {isCreateMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsCreateMenuOpen(false)}
                    />
                    <div className="absolute right-0 mt-1.5 w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5 text-xs animate-in zoom-in-95 duration-150">
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
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreateMenuOpen(false);
                          setActiveTab('categories');
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-medium"
                      >
                        <FolderTree className="w-4 h-4 text-indigo-600" />
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
            )}

            {/* Current User Pill & Logout */}
            {currentUser && (
              <div className="flex items-center gap-1 sm:gap-1.5 pl-1.5 sm:pl-2 border-l border-slate-200">
                <div
                  className="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                  title={`Tài khoản: ${currentUser.fullName} (@${currentUser.username}) • Thiết bị này: ${currentDeviceInfo.name}`}
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] text-white shrink-0 ${
                      currentUser.role === 'ADMIN'
                        ? 'bg-indigo-600'
                        : currentUser.role === 'THU_KHO'
                        ? 'bg-emerald-600'
                        : 'bg-blue-600'
                    }`}
                  >
                    {currentUser.fullName.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-semibold text-slate-800 max-w-[80px] sm:max-w-[110px] truncate hidden md:inline">
                    {currentUser.fullName}
                  </span>
                  <span
                    className={`text-[9px] sm:text-[10px] px-1 py-0.2 rounded font-bold uppercase ${
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
                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
                  title="Đăng xuất"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Mobile / Tablet Menu Button (< 1024px) */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg lg:hidden shrink-0 border border-slate-200"
              title="Mở menu danh mục"
            >
              {isMobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Auto-fitting Responsive Sub-Navigation Row for Tablets & Mobile (< 1024px) */}
      <div className="lg:hidden border-t border-slate-100 bg-slate-50/90 px-2 py-1.5 overflow-x-auto scrollbar-none flex items-center gap-1">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                setIsMobileMenuOpen(false);
              }}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-slate-900 text-white font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge !== undefined && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold tabular-nums ${
                    item.badgeColor || 'bg-slate-700 text-white'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Mobile Drawer (When hamburger menu is opened on small screens) */}
      {isMobileMenuOpen && (
        <div className="lg:hidden border-t border-slate-200 bg-white shadow-xl animate-in slide-in-from-top-2 duration-150 p-3 space-y-1">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1">
            Menu Chức Năng Hệ Thống
          </div>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setIsMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between p-2.5 rounded-xl text-xs font-semibold transition-colors ${
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
