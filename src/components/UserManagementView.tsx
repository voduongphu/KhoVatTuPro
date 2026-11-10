import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  ShieldCheck,
  KeyRound,
  Edit2,
  Trash2,
  Lock,
  Unlock,
  AlertCircle,
  Warehouse as WarehouseIcon,
  Phone,
  CheckCircle2,
  X,
  Smartphone,
  LogOut,
  RotateCcw,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';
import { User, UserRole } from '../types/inventory';
import { formatDate, getUserRoleLabel } from '../utils/formatters';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { ADMIN_EMAIL, isAdminEmail } from '../services/googleAuthService';

export const UserManagementView: React.FC = () => {
  const {
    users,
    currentUser,
    warehouses,
    addUser,
    updateUser,
    deleteUser,
    revokeUserSession,
    resetToDefaultData,
  } = useInventory();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showResetAllModal, setShowResetAllModal] = useState(false);
  const [userToRevoke, setUserToRevoke] = useState<User | null>(null);

  const activeAdminCount = users.filter(u => u.role === 'ADMIN' && u.status === 'ACTIVE').length;

  const handleRevokeSession = (user: User) => {
    setUserToRevoke(user);
  };

  const handleConfirmRevokeSession = () => {
    if (!userToRevoke) return;
    const res = revokeUserSession(userToRevoke.id);
    if (res.success) {
      setNotification({
        text: `Đã đăng xuất từ xa tài khoản ${userToRevoke.fullName}.`,
        type: 'success',
      });
    } else {
      setNotification({
        text: res.error || 'Không thể đăng xuất từ xa.',
        type: 'error',
      });
    }
    setUserToRevoke(null);
  };

  // Form states
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('THU_KHO');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [assignedWarehouseId, setAssignedWarehouseId] = useState('ALL');
  const [status, setStatus] = useState<'ACTIVE' | 'LOCKED'>('ACTIVE');
  const [formError, setFormError] = useState('');

  const isAdmin = currentUser?.role === 'ADMIN';

  const handleOpenAdd = () => {
    setEditingUser(null);
    setUsername('');
    setPassword('');
    setFullName('');
    setRole('THU_KHO');
    setEmail('');
    setPhone('');
    setAssignedWarehouseId('ALL');
    setStatus('ACTIVE');
    setFormError('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUser(user);
    setUsername(user.username);
    setPassword(user.password || '');
    setFullName(user.fullName);
    setRole(user.role);
    setEmail(user.email || '');
    setPhone(user.phone || '');
    setAssignedWarehouseId(user.assignedWarehouseId);
    setStatus(user.status);
    setFormError('');
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const finalEmail = email.trim().toLowerCase();
    const finalUsername = (username.trim() || finalEmail).toLowerCase();
    const finalPassword = password.trim() || 'google-auth-user';

    if (!finalEmail && !finalUsername) {
      setFormError('Vui lòng nhập địa chỉ Google Mail hoặc Tên đăng nhập.');
      return;
    }
    if (!fullName.trim()) {
      setFormError('Vui lòng nhập họ và tên người sử dụng.');
      return;
    }

    if (editingUser) {
      const isMainAdmin = isAdminEmail(editingUser.email) || isAdminEmail(editingUser.username);
      if (isMainAdmin && role !== 'ADMIN') {
        setFormError('Không thể hạ quyền Quản trị viên Hệ thống chính (voduongphu@gmail.com)!');
        return;
      }

      const res = updateUser(editingUser.id, {
        username: finalUsername,
        password: finalPassword,
        fullName: fullName.trim(),
        role: isMainAdmin ? 'ADMIN' : role,
        email: finalEmail,
        phone: phone.trim(),
        assignedWarehouseId,
        status: isMainAdmin ? 'ACTIVE' : status,
        authProvider: finalEmail.includes('@') ? 'google' : 'local',
      });

      if (!res.success) {
        setFormError(res.error || 'Có lỗi xảy ra khi cập nhật.');
        return;
      }
    } else {
      const res = addUser({
        username: finalUsername,
        password: finalPassword,
        fullName: fullName.trim(),
        role,
        email: finalEmail,
        phone: phone.trim(),
        assignedWarehouseId,
        status,
        authProvider: finalEmail.includes('@') ? 'google' : 'local',
      });

      if (!res.success) {
        setFormError(res.error || 'Có lỗi xảy ra khi thêm người dùng.');
        return;
      }
    }

    setIsModalOpen(false);
  };

  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [notification, setNotification] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  const handleToggleLock = (user: User) => {
    if (isAdminEmail(user.email) || isAdminEmail(user.username)) {
      setNotification({
        text: 'Không thể khóa tài khoản Quản trị viên Hệ thống chính (voduongphu@gmail.com)!',
        type: 'error',
      });
      return;
    }
    if (user.id === currentUser?.id) {
      setNotification({
        text: 'Không thể khóa chính tài khoản bạn đang đăng nhập!',
        type: 'error',
      });
      return;
    }
    const newStatus = user.status === 'ACTIVE' ? 'LOCKED' : 'ACTIVE';
    const res = updateUser(user.id, { status: newStatus });
    if (!res.success) {
      setNotification({
        text: res.error || 'Không thể thay đổi trạng thái tài khoản.',
        type: 'error',
      });
      return;
    }
    setNotification({
      text: `Đã ${newStatus === 'ACTIVE' ? 'mở khóa' : 'khóa'} tài khoản ${user.fullName}.`,
      type: 'success',
    });
  };

  const handleDelete = (user: User) => {
    if (isAdminEmail(user.email) || isAdminEmail(user.username)) {
      setNotification({
        text: 'Không thể xóa tài khoản Quản trị viên Hệ thống chính (voduongphu@gmail.com)!',
        type: 'error',
      });
      return;
    }
    if (user.id === currentUser?.id) {
      setNotification({
        text: 'Không thể xóa chính tài khoản bạn đang đăng nhập!',
        type: 'error',
      });
      return;
    }
    if (user.role === 'ADMIN' && user.status === 'ACTIVE' && activeAdminCount <= 1) {
      setNotification({
        text: 'Hệ thống phải giữ lại ít nhất 1 tài khoản Quản trị viên (Admin) đang hoạt động!',
        type: 'error',
      });
      return;
    }
    setUserToDelete(user);
  };

  const handleConfirmDeleteUser = () => {
    if (!userToDelete) return;
    const res = deleteUser(userToDelete.id);
    if (res.success) {
      setNotification({
        text: `Đã xóa người dùng ${userToDelete.fullName} thành công.`,
        type: 'success',
      });
    } else {
      setNotification({
        text: res.error || 'Có lỗi xảy ra khi xóa người dùng.',
        type: 'error',
      });
    }
    setUserToDelete(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-600" />
              <span>Quản Lý Người Sử Dụng &amp; Google Mail</span>
            </h2>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700 shadow-2xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              Đồng bộ Cloud Firestore Realtime
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Quản trị viên chính: <strong className="text-indigo-600">voduongphu@gmail.com</strong>. Cấp quyền truy cập cho nhân viên bằng địa chỉ Google Mail của họ để đăng nhập nhanh không cần mật khẩu. Toàn bộ tài khoản và quyền hạn được lưu trữ và đồng bộ đám mây Cloud Firestore hai chiều.
          </p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <button
              onClick={() => setShowResetAllModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors shadow-2xs"
              title="Xóa tất cả người dùng và dữ liệu để admin tạo lại từ đầu"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Xóa sạch dữ liệu &amp; Bắt đầu lại</span>
            </button>
            <button
              onClick={handleOpenAdd}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs"
            >
              <UserPlus className="w-4 h-4" />
              <span>Thêm người dùng mới</span>
            </button>
          </div>
        )}
      </div>

      {notification && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
            notification.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600" />
            )}
            <span className="font-medium">{notification.text}</span>
          </div>
          <button
            onClick={() => setNotification(null)}
            className="p-1 hover:bg-black/5 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Role explanation cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-indigo-100 shadow-xs">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-900">
              Quản trị viên (Admin)
            </h4>
          </div>
          <p className="text-xs text-slate-600">
            Toàn quyền hệ thống: <strong>Thêm, sửa, xóa</strong> phiếu nhập và xuất kho; <strong>Thêm, sửa, xóa</strong> người sử dụng; cấu hình kho và danh mục.
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-emerald-100 shadow-xs">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-900">
              Thủ kho (Stockkeeper)
            </h4>
          </div>
          <p className="text-xs text-slate-600">
            Lập phiếu nhập kho, xuất kho, sửa nội dung phiếu, xem thẻ kho và báo cáo tồn. <strong>Không được xóa phiếu</strong> hoặc quản lý tài khoản người dùng.
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-blue-100 shadow-xs">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-900">
              Nhân viên kỹ thuật (Viewer)
            </h4>
          </div>
          <p className="text-xs text-slate-600">
            Chỉ xem thông tin tồn kho, tra cứu thẻ kho và thông số thiết bị công trường. Chế độ chỉ đọc (Read-only).
          </p>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                <th className="py-3 px-4">Tài khoản &amp; Họ tên</th>
                <th className="py-3 px-3">Vai trò phân quyền</th>
                <th className="py-3 px-3">Kho phụ trách</th>
                <th className="py-3 px-3">Liên hệ</th>
                <th className="py-3 px-3 text-center">Trạng thái</th>
                <th className="py-3 px-3">Thiết bị &amp; Phiên online</th>
                <th className="py-3 px-3">Ngày tạo</th>
                <th className="py-3 px-4 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map(u => {
                const assignedWh = warehouses.find(w => w.id === u.assignedWarehouseId);
                const isCurrent = u.id === currentUser?.id;
                const isMainAdmin = isAdminEmail(u.email) || isAdminEmail(u.username);
                const isOnlyActiveAdmin =
                  u.role === 'ADMIN' && u.status === 'ACTIVE' && activeAdminCount <= 1;

                return (
                  <tr key={`${u.id}-${u.username}`} className="hover:bg-slate-50/80 transition-colors">
                    {/* User info */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white ${
                            isMainAdmin
                              ? 'bg-amber-600 ring-2 ring-amber-300'
                              : u.role === 'ADMIN'
                              ? 'bg-indigo-600'
                              : u.role === 'THU_KHO'
                              ? 'bg-emerald-600'
                              : 'bg-blue-600'
                          }`}
                        >
                          {u.fullName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900 flex items-center gap-1.5 flex-wrap">
                            <span>{u.fullName}</span>
                            {isMainAdmin && (
                              <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded font-bold flex items-center gap-1 shadow-2xs">
                                <ShieldCheck className="w-3 h-3 text-amber-600 inline shrink-0" />
                                Admin Chính
                              </span>
                            )}
                            {isCurrent && (
                              <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.2 rounded font-medium">
                                Bạn
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400">
                            @{u.username}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Role badge */}
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span
                        className={`inline-block px-2.5 py-1 rounded text-[11px] font-semibold ${
                          isMainAdmin
                            ? 'bg-amber-50 text-amber-800 border border-amber-300'
                            : u.role === 'ADMIN'
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                            : u.role === 'THU_KHO'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}
                      >
                        {isMainAdmin ? 'Quản trị viên Hệ thống' : getUserRoleLabel(u.role)}
                      </span>
                    </td>

                    {/* Assigned warehouse */}
                    <td className="py-3.5 px-3 text-slate-700 whitespace-nowrap">
                      {u.assignedWarehouseId === 'ALL'
                        ? 'Toàn bộ các kho'
                        : assignedWh?.name || u.assignedWarehouseId}
                    </td>

                    {/* Contact */}
                    <td className="py-3.5 px-3 text-slate-500 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {u.authProvider === 'google' || (u.email && u.email.includes('@')) ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-700 border border-red-200 font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                            Google Mail
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600 border border-slate-200">
                            Nội bộ
                          </span>
                        )}
                        <span className="text-slate-800 font-medium">{u.email || u.username}</span>
                      </div>
                      <div className="text-[11px] text-slate-400">{u.phone || ''}</div>
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-3 text-center whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                          u.status === 'ACTIVE'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {u.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã khóa'}
                      </span>
                    </td>

                    {/* Device & Session Status */}
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      {u.activeDeviceId ? (
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                            <span className="font-semibold text-emerald-700 text-[11px] flex items-center gap-1">
                              <Smartphone className="w-3.5 h-3.5 text-emerald-600 inline shrink-0" />
                              <span>{u.activeDeviceName || '1 thiết bị'}</span>
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400">
                            Hoạt động: {formatDate(u.lastActiveAt || u.lastLogin)}
                          </span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-400 text-[11px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                          Ngoại tuyến
                        </span>
                      )}
                    </td>

                    {/* Created */}
                    <td className="py-3.5 px-3 text-slate-400 text-[11px] whitespace-nowrap">
                      {formatDate(u.createdAt)}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      {isAdmin ? (
                        <div className="flex items-center justify-center gap-1">
                          {/* Force Logout from Device */}
                          {u.activeDeviceId && !isCurrent && (
                            <button
                              onClick={() => handleRevokeSession(u)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                              title={`Đăng xuất từ xa khỏi ${u.activeDeviceName || 'thiết bị'}`}
                            >
                              <LogOut className="w-4 h-4 text-rose-500" />
                            </button>
                          )}

                          <button
                            onClick={() => handleOpenEdit(u)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="Sửa thông tin tài khoản"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleToggleLock(u)}
                            disabled={isCurrent || isOnlyActiveAdmin || isMainAdmin}
                            className={`p-1.5 rounded transition-colors ${
                              isCurrent || isOnlyActiveAdmin || isMainAdmin
                                ? 'text-slate-200 cursor-not-allowed'
                                : u.status === 'ACTIVE'
                                ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                                : 'text-amber-600 hover:bg-amber-100'
                            }`}
                            title={
                              isMainAdmin
                                ? 'Không thể khóa Quản trị viên Hệ thống chính (voduongphu@gmail.com)'
                                : isCurrent
                                ? 'Không thể khóa tài khoản đang đăng nhập'
                                : isOnlyActiveAdmin
                                ? 'Không thể khóa Quản trị viên hoạt động duy nhất'
                                : u.status === 'ACTIVE'
                                ? 'Khóa tài khoản'
                                : 'Mở khóa tài khoản'
                            }
                          >
                            {u.status === 'ACTIVE' ? (
                              <Lock className="w-4 h-4" />
                            ) : (
                              <Unlock className="w-4 h-4" />
                            )}
                          </button>

                          <button
                            onClick={() => handleDelete(u)}
                            disabled={isCurrent || isOnlyActiveAdmin || isMainAdmin}
                            className={`p-1.5 rounded transition-colors ${
                              isCurrent || isOnlyActiveAdmin || isMainAdmin
                                ? 'text-slate-200 cursor-not-allowed'
                                : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                            }`}
                            title={
                              isMainAdmin
                                ? 'Không thể xóa tài khoản Quản trị viên Hệ thống chính (voduongphu@gmail.com)'
                                : isCurrent
                                ? 'Không thể xóa tài khoản đang đăng nhập'
                                : isOnlyActiveAdmin
                                ? 'Không thể xóa Quản trị viên hoạt động duy nhất'
                                : 'Xóa tài khoản'
                            }
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Chỉ xem</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-base font-bold text-slate-900">
                {editingUser ? 'Chỉnh Sửa Người Dùng' : 'Thêm Người Dùng Mới'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
              {formError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl text-xs text-indigo-900 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  Nhập địa chỉ <strong>Google Mail</strong> của người dùng để cấp quyền truy cập. Người dùng chỉ cần nhấn nút <em>&quot;Đăng nhập bằng Google Mail&quot;</em> trên màn hình đăng nhập là có thể truy cập hệ thống ngay lập tức. Dữ liệu được lưu trữ và đồng bộ đám mây Cloud Firestore.
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Địa chỉ Google Mail của người dùng *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => {
                    const val = e.target.value;
                    setEmail(val);
                    if (!username || username === email) {
                      setUsername(val);
                    }
                  }}
                  placeholder="VD: thukho.ptsc@gmail.com..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none text-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Họ và tên người sử dụng *
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="VD: Nguyễn Văn A..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Vai trò &amp; Quyền hạn *
                  </label>
                  <select
                    value={role}
                    onChange={e => setRole(e.target.value as UserRole)}
                    disabled={editingUser ? isAdminEmail(editingUser.email) || isAdminEmail(editingUser.username) : false}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none bg-white font-medium disabled:bg-slate-100"
                  >
                    <option value="ADMIN">Quản trị viên (Toàn quyền)</option>
                    <option value="THU_KHO">Thủ kho (Nhập / Xuất)</option>
                    <option value="NHAN_VIEN">Nhân viên kỹ thuật (Chỉ xem)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Kho hàng phụ trách
                  </label>
                  <select
                    value={assignedWarehouseId}
                    onChange={e => setAssignedWarehouseId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none bg-white"
                  >
                    <option value="ALL">Toàn bộ các kho</option>
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Số điện thoại
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="09xx.xxx.xxx..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Tên đăng nhập nội bộ
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder={email ? email.split('@')[0] : 'thukho_01'}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none font-mono text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Mật khẩu đăng nhập nội bộ dự phòng (tùy chọn)
                </label>
                <input
                  type="text"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Để trống nếu người dùng chỉ đăng nhập bằng Google Mail..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none font-mono text-slate-800"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Người dùng có thể đăng nhập bằng Google Mail trực tiếp mà không cần nhớ mật khẩu này.
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Trạng thái tài khoản
                </label>
                <div className="flex items-center gap-4 pt-1">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="status"
                      checked={status === 'ACTIVE'}
                      onChange={() => setStatus('ACTIVE')}
                      className="text-indigo-600"
                    />
                    <span className="text-slate-800">Đang hoạt động</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="status"
                      checked={status === 'LOCKED'}
                      onChange={() => setStatus('LOCKED')}
                      className="text-indigo-600"
                    />
                    <span className="text-slate-800">Khóa tài khoản</span>
                  </label>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-xs"
                >
                  {editingUser ? 'Lưu thay đổi' : 'Thêm người dùng'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Revoke User Session In-App Modal */}
      {userToRevoke && (
        <ConfirmDeleteModal
          isOpen={Boolean(userToRevoke)}
          title={`Đăng xuất từ xa ${userToRevoke.fullName}`}
          message={`Bạn có muốn đăng xuất tài khoản @${userToRevoke.username} khỏi thiết bị "${userToRevoke.activeDeviceName || 'đang online'}" ngay lập tức?`}
          itemDetails={[
            { label: 'Tài khoản', value: `@${userToRevoke.username} (${userToRevoke.fullName})` },
            { label: 'Thiết bị đang online', value: userToRevoke.activeDeviceName || '1 thiết bị' },
          ]}
          warningNote="Người dùng sẽ bị kết thúc phiên làm việc hiện tại trên thiết bị đó ngay tức thì."
          confirmLabel="Đăng xuất thiết bị ngay"
          onConfirm={handleConfirmRevokeSession}
          onClose={() => setUserToRevoke(null)}
        />
      )}

      {/* Delete User In-App Modal */}
      {userToDelete && (
        <ConfirmDeleteModal
          isOpen={Boolean(userToDelete)}
          title={`Xác nhận xóa người dùng ${userToDelete.fullName}`}
          message={`Bạn có chắc chắn muốn xóa vĩnh viễn tài khoản @${userToDelete.username} khỏi hệ thống?`}
          itemDetails={[
            { label: 'Tên đăng nhập', value: `@${userToDelete.username}` },
            { label: 'Họ và tên', value: userToDelete.fullName },
            { label: 'Vai trò', value: getUserRoleLabel(userToDelete.role) },
            { label: 'Email', value: userToDelete.email || 'Chưa cập nhật' },
          ]}
          warningNote="Thao tác này sẽ gỡ bỏ vĩnh viễn quyền truy cập của tài khoản này và đồng bộ xóa trên toàn bộ thiết bị."
          confirmLabel="Xác nhận xóa tài khoản"
          onConfirm={handleConfirmDeleteUser}
          onClose={() => setUserToDelete(null)}
        />
      )}

      {/* Reset All Data In-App Modal */}
      {showResetAllModal && (
        <ConfirmDeleteModal
          isOpen={showResetAllModal}
          title="Xác nhận xóa toàn bộ dữ liệu & người dùng"
          message="Bạn có chắc chắn muốn xóa TOÀN BỘ dữ liệu hiện tại (bao gồm tất cả người dùng, vật tư và giao dịch) để bắt đầu lại từ đầu?"
          itemDetails={[
            { label: 'Quản trị viên chính', value: 'voduongphu@gmail.com (Google Mail)' },
            { label: 'Tài khoản nội bộ dự phòng', value: 'admin / admin123' },
            { label: 'Dữ liệu vật tư & giao dịch', value: 'Xóa hoàn toàn về 0' },
            { label: 'Danh sách người dùng khác', value: 'Xóa toàn bộ' },
          ]}
          warningNote="Hành động này sẽ xóa sạch dữ liệu trên toàn bộ hệ thống và thiết bị đồng bộ. Giữ lại Quản trị viên chính voduongphu@gmail.com và tài khoản admin nội bộ dự phòng."
          confirmLabel="Xác nhận xóa sạch & Bắt đầu lại"
          onConfirm={() => {
            resetToDefaultData();
            setShowResetAllModal(false);
            setNotification({
              text: 'Đã xóa toàn bộ dữ liệu thành công. Quản trị viên chính: voduongphu@gmail.com (đăng nhập Google Mail).',
              type: 'success',
            });
          }}
          onClose={() => setShowResetAllModal(false)}
        />
      )}
    </div>
  );
};
