import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  User as FirebaseUser,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from './firebase';

export const ADMIN_USERNAME = 'phuvo';
export const ADMIN_EMAIL = 'voduongphu@gmail.com';

// Cấu hình Google Auth Provider đơn giản và nhanh chóng
const provider = new GoogleAuthProvider();
provider.setCustomParameters({
  prompt: 'select_account',
});

let isSigningIn = false;

export interface GoogleAuthResult {
  user: FirebaseUser;
  email: string;
  displayName: string;
  photoURL?: string | null;
  isAdmin: boolean;
}

/**
 * Kiểm tra xem tài khoản có phải là quản trị viên hệ thống duy nhất (phuvo) không
 */
export function isAdminEmail(identifier: string | null | undefined): boolean {
  if (!identifier) return false;
  const clean = identifier.trim().toLowerCase();
  return clean === ADMIN_USERNAME.toLowerCase();
}

/**
 * Khởi tạo listener theo dõi trạng thái đăng nhập Firebase Auth
 */
export function initGoogleAuthListener(
  onUserChanged: (user: FirebaseUser | null) => void
): () => void {
  return onAuthStateChanged(auth, async (user: FirebaseUser | null) => {
    onUserChanged(user);
  });
}

/**
 * Đăng nhập bằng Google Mail Popup
 */
export async function signInWithGoogle(): Promise<GoogleAuthResult> {
  if (isSigningIn) {
    throw new Error('Đang trong quá trình đăng nhập Google...');
  }

  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const email = (result.user.email || '').trim().toLowerCase();
    const displayName = result.user.displayName || email.split('@')[0];

    return {
      user: result.user,
      email,
      displayName,
      photoURL: result.user.photoURL,
      isAdmin: isAdminEmail(email),
    };
  } catch (error: any) {
    console.error('[GoogleAuth] Lỗi đăng nhập Google:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
}

/**
 * Đăng xuất tài khoản Google
 */
export async function signOutGoogle(): Promise<void> {
  try {
    await signOut(auth);
  } catch (err) {
    console.warn('[GoogleAuth] Lỗi khi đăng xuất:', err);
  }
}
