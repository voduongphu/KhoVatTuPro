import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  User as FirebaseUser,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from './firebase';
import { ADMIN_EMAIL } from './gmailNotificationService';

// Cấu hình Google Auth Provider với scope Gmail send theo yêu cầu
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/gmail.send');
provider.setCustomParameters({
  prompt: 'select_account',
});

// Cache access token trong bộ nhớ tạm (không lưu vào localStorage theo nguyên tắc bảo mật)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export interface GoogleAuthResult {
  user: FirebaseUser;
  email: string;
  displayName: string;
  photoURL?: string | null;
  accessToken?: string | null;
  isAdmin: boolean;
}

/**
 * Kiểm tra xem email có phải là quản trị viên hệ thống không
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

/**
 * Khởi tạo listener theo dõi trạng thái đăng nhập Firebase Auth
 */
export function initGoogleAuthListener(
  onUserChanged: (user: FirebaseUser | null, accessToken: string | null) => void
): () => void {
  return onAuthStateChanged(auth, async (user: FirebaseUser | null) => {
    if (!user) {
      cachedAccessToken = null;
      onUserChanged(null, null);
    } else {
      onUserChanged(user, cachedAccessToken);
    }
  });
}

/**
 * Đăng nhập bằng Google Popup
 */
export async function signInWithGoogle(): Promise<GoogleAuthResult> {
  if (isSigningIn) {
    throw new Error('Đang trong quá trình đăng nhập Google...');
  }

  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedAccessToken = credential?.accessToken || null;

    const email = result.user.email || '';
    const displayName = result.user.displayName || email.split('@')[0];

    return {
      user: result.user,
      email,
      displayName,
      photoURL: result.user.photoURL,
      accessToken: cachedAccessToken,
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
 * Lấy access token hiện tại được lưu trong bộ nhớ
 */
export function getGoogleAccessToken(): string | null {
  return cachedAccessToken;
}

/**
 * Đăng xuất tài khoản Google
 */
export async function signOutGoogle(): Promise<void> {
  cachedAccessToken = null;
  try {
    await signOut(auth);
  } catch (err) {
    console.warn('[GoogleAuth] Lỗi khi đăng xuất:', err);
  }
}
