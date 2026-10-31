import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { 
  LayoutDashboard, 
  ArrowDownLeft, 
  ArrowUpRight, 
  BarChart3, 
  Warehouse, 
  Package, 
  Users, 
  ShieldAlert,
  FileSpreadsheet,
  CheckCircle2
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  const { currentUser, isAdmin } = useAuth();

  const navItems = [
    {
      id: 'dashboard',
      label: 'Tổng Quan & KPI',
      icon: LayoutDashboard,
      badge: null,
      adminOnly: false
    },
    {
      id: 'inbound',
      label: 'Quản Lý Nhập Kho',
      icon: ArrowDownLeft,
      badge: 'Excel',
      adminOnly: false
    },
    {
      id: 'outbound',
      label: 'Quản Lý Xuất Kho',
      icon: ArrowUpRight,
      badge: 'Excel',
      adminOnly: false
    },
    {
      id: 'report',
      label: 'Báo Cáo Nhập-Xuất-Tồn',
      icon: BarChart3,
      badge: 'Đa điều kiện',
      adminOnly: false
    },
    {
      section: 'QUẢN TRỊ DANH MỤC (ADMIN)'
    },
    {
      id: 'warehouses',
      label: 'Quản Lý Kho Bãi',
      icon: Warehouse,
      badge: 'Admin',
      adminOnly: true
    },
    {
      id: 'materials',
      label: 'Danh Mục Vật Tư',
      icon: Package,
      badge: 'Admin',
      adminOnly: true
    },
    {
      id: 'users',
      label: 'Người Sử Dụng',
      icon: Users,
      badge: 'Admin',
      adminOnly: true
    }
  ];

  return (
    <aside className="w-full md:w-64 bg-white border-r border-slate-200/80 p-4 flex flex-col justify-between shrink-0">
      <div className="space-y-1">
        {navItems.map((item, index) => {
          if (item.section) {
            return (
              <div 
                key={index} 
                className="px-3 pt-5 pb-2 text-[10px] font-bold tracking-wider text-slate-400 uppercase"
              >
                {item.section}
              </div>
            );
          }

          const Icon = item.icon!;
          const isActive = activeTab === item.id;
          const isLocked = item.adminOnly && !isAdmin;

          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id!)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
                isActive 
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20' 
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </div>

              {item.badge && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${
                  isActive 
                    ? 'bg-blue-700 text-white' 
                    : item.badge === 'Admin' 
                      ? 'bg-rose-50 text-rose-700 border border-rose-200/60' 
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                }`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Admin Status Card in Sidebar */}
      <div className="pt-4 border-t border-slate-100">
        <div className={`p-3 rounded-2xl border text-xs ${
          isAdmin 
            ? 'bg-emerald-50/60 border-emerald-200/80 text-emerald-900' 
            : 'bg-amber-50/60 border-amber-200/80 text-amber-900'
        }`}>
          <div className="flex items-center gap-1.5 font-bold mb-1">
            {isAdmin ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <ShieldAlert className="w-4 h-4 text-amber-600" />}
            <span>{isAdmin ? 'Quyền Quản Trị Viên' : 'Chế độ Nhân Viên'}</span>
          </div>
          <p className="text-[11px] text-slate-600">
            {isAdmin 
              ? 'Toàn quyền thêm/sửa/xóa kho bãi, vật tư, người dùng & duyệt phiếu' 
              : 'Quyền thực hiện nhập/xuất kho và tra cứu báo cáo tồn kho'}
          </p>
        </div>
      </div>
    </aside>
  );
};
