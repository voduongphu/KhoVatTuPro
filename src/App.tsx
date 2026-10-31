/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { DashboardOverview } from './components/dashboard/DashboardOverview';
import { InboundManager } from './components/inbound/InboundManager';
import { OutboundManager } from './components/outbound/OutboundManager';
import { InventoryReport } from './components/reports/InventoryReport';
import { WarehouseManager } from './components/warehouses/WarehouseManager';
import { MaterialCatalog } from './components/materials/MaterialCatalog';
import { UserManager } from './components/users/UserManager';
import { 
  LayoutDashboard, 
  ArrowDownLeft, 
  ArrowUpRight, 
  BarChart3, 
  Warehouse, 
  Package, 
  Users 
} from 'lucide-react';

import { LoginScreen } from './components/auth/LoginScreen';

const MainLayout: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const { currentUser, isAdmin } = useAuth();

  // Hiển thị màn hình đăng nhập nếu người dùng chưa xác thực
  if (!currentUser) {
    return <LoginScreen />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardOverview onNavigate={(tab) => setActiveTab(tab)} />;
      case 'inbound':
        return <InboundManager />;
      case 'outbound':
        return <OutboundManager />;
      case 'report':
        return <InventoryReport />;
      case 'warehouses':
        return <WarehouseManager />;
      case 'materials':
        return <MaterialCatalog />;
      case 'users':
        return <UserManager />;
      default:
        return <DashboardOverview onNavigate={(tab) => setActiveTab(tab)} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-100/70 flex flex-col font-sans">
      <Navbar />

      <div className="flex-1 flex flex-col md:flex-row max-w-7xl w-full mx-auto">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          {renderContent()}
        </main>
      </div>

      {/* Mobile Bottom Navigation for quick accessibility on mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-30 flex justify-around p-2 text-[10px] font-semibold text-slate-600 shadow-lg">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center gap-1 p-1 ${activeTab === 'dashboard' ? 'text-blue-600' : ''}`}
        >
          <LayoutDashboard className="w-4 h-4" />
          <span>Tổng quan</span>
        </button>
        <button
          onClick={() => setActiveTab('inbound')}
          className={`flex flex-col items-center gap-1 p-1 ${activeTab === 'inbound' ? 'text-blue-600' : ''}`}
        >
          <ArrowDownLeft className="w-4 h-4" />
          <span>Nhập kho</span>
        </button>
        <button
          onClick={() => setActiveTab('outbound')}
          className={`flex flex-col items-center gap-1 p-1 ${activeTab === 'outbound' ? 'text-blue-600' : ''}`}
        >
          <ArrowUpRight className="w-4 h-4" />
          <span>Xuất kho</span>
        </button>
        <button
          onClick={() => setActiveTab('report')}
          className={`flex flex-col items-center gap-1 p-1 ${activeTab === 'report' ? 'text-blue-600' : ''}`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Báo cáo</span>
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('users')}
            className={`flex flex-col items-center gap-1 p-1 ${activeTab === 'users' ? 'text-blue-600' : ''}`}
          >
            <Users className="w-4 h-4" />
            <span>Người dùng</span>
          </button>
        )}
      </nav>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <MainLayout />
    </AuthProvider>
  );
}
