import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types/inventory';
import { StorageService } from '../services/storage';

interface AuthContextType {
  currentUser: User | null;
  users: User[];
  login: (username: string, pass: string) => { success: boolean; message: string };
  logout: () => void;
  isAdmin: boolean;
  isManager: boolean;
  refreshUsers: () => void;
  addUser: (user: Omit<User, 'id' | 'createdAt'>) => User;
  updateUser: (id: string, updates: Partial<User>) => User | null;
  deleteUser: (id: string) => boolean;
  resetUserPassword: (userId: string, newPass: string) => boolean;
  changeMyPassword: (oldPass: string, newPass: string) => { success: boolean; message: string };
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const CURRENT_USER_KEY = 'vtp_inventory_session_v3';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const refreshUsers = () => {
    const list = StorageService.getUsers();
    setUsers(list);
    return list;
  };

  useEffect(() => {
    const list = refreshUsers();
    // Xóa bất kỳ phiên cũ trong localStorage để khi đóng tab / đóng ứng dụng thì lần sau vào lại sẽ bắt buộc về màn hình đăng nhập
    try {
      localStorage.removeItem(CURRENT_USER_KEY);
    } catch (e) {
      // ignore
    }

    // Chỉ dùng sessionStorage: giữ phiên khi refresh trong tab hiện tại, nhưng khi đóng tab/cửa sổ/ứng dụng thì tự động hủy
    try {
      const savedUserJson = sessionStorage.getItem(CURRENT_USER_KEY);
      if (savedUserJson) {
        const parsed = JSON.parse(savedUserJson);
        const match = list.find(u => u.id === parsed.id && u.isActive);
        if (match) {
          setCurrentUser(match);
          return;
        }
      }
    } catch (e) {
      sessionStorage.removeItem(CURRENT_USER_KEY);
    }
    // Chưa đăng nhập: giữ currentUser = null để hiển thị màn hình đăng nhập
    setCurrentUser(null);
  }, []);

  const login = (username: string, pass: string): { success: boolean; message: string } => {
    const currentUsers = StorageService.getUsers();
    setUsers(currentUsers);

    const trimmedUser = username.trim();
    // So khớp không phân biệt hoa thường và chấp nhận dấu hoặc không dấu
    const user = currentUsers.find(
      u => u.username.trim().toLowerCase() === trimmedUser.toLowerCase() ||
           u.fullName.trim().toLowerCase() === trimmedUser.toLowerCase()
    );

    if (!user) {
      return {
        success: false,
        message: `Tài khoản "${username}" không tồn tại trong hệ thống. Vui lòng kiểm tra lại!`
      };
    }

    if (!user.isActive) {
      return {
        success: false,
        message: 'Tài khoản này hiện đang bị khóa hoặc ngừng kích hoạt. Vui lòng liên hệ Admin.'
      };
    }

    if (user.password !== pass) {
      return {
        success: false,
        message: 'Mật khẩu đăng nhập không chính xác. Vui lòng kiểm tra lại.'
      };
    }

    // Đăng nhập thành công - Lưu vào sessionStorage để khi đóng app sẽ tự động về màn hình đăng nhập
    const updatedUser = { ...user, lastLogin: new Date().toISOString() };
    StorageService.updateUser(user.id, { lastLogin: updatedUser.lastLogin });
    setCurrentUser(updatedUser);
    try {
      sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(updatedUser));
      localStorage.removeItem(CURRENT_USER_KEY);
    } catch (e) {
      // ignore
    }
    return { success: true, message: 'Đăng nhập thành công!' };
  };

  const logout = () => {
    setCurrentUser(null);
    try {
      sessionStorage.removeItem(CURRENT_USER_KEY);
      localStorage.removeItem(CURRENT_USER_KEY);
    } catch (e) {
      // ignore
    }
  };

  const addUser = (userData: Omit<User, 'id' | 'createdAt'>): User => {
    const newUser = StorageService.addUser(userData);
    refreshUsers();
    return newUser;
  };

  const updateUser = (id: string, updates: Partial<User>): User | null => {
    const updated = StorageService.updateUser(id, updates);
    refreshUsers();
    if (currentUser?.id === id && updated) {
      setCurrentUser(updated);
      try {
        sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(updated));
      } catch (e) {
        // ignore
      }
    }
    return updated;
  };

  const deleteUser = (id: string): boolean => {
    const success = StorageService.deleteUser(id);
    if (success) {
      refreshUsers();
    }
    return success;
  };

  const resetUserPassword = (userId: string, newPass: string): boolean => {
    const success = StorageService.resetPassword(userId, newPass);
    if (success) {
      refreshUsers();
    }
    return success;
  };

  const changeMyPassword = (oldPass: string, newPass: string): { success: boolean; message: string } => {
    if (!currentUser) {
      return { success: false, message: 'Chưa đăng nhập' };
    }
    if (currentUser.password !== oldPass) {
      return { success: false, message: 'Mật khẩu hiện tại không đúng' };
    }
    const success = StorageService.resetPassword(currentUser.id, newPass);
    if (success) {
      const updated = { ...currentUser, password: newPass };
      setCurrentUser(updated);
      try {
        sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(updated));
      } catch (e) {
        // ignore
      }
      refreshUsers();
      return { success: true, message: 'Đổi mật khẩu thành công!' };
    }
    return { success: false, message: 'Không thể đổi mật khẩu' };
  };

  const isAdmin = currentUser?.role === 'admin' || currentUser?.username === 'Võ Dương Phú';
  const isManager = isAdmin || currentUser?.role === 'manager';

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        users,
        login,
        logout,
        isAdmin,
        isManager,
        refreshUsers,
        addUser,
        updateUser,
        deleteUser,
        resetUserPassword,
        changeMyPassword
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
