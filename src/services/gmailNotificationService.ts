/**
 * Dịch vụ gửi email thông báo qua Google Gmail API tới Quản trị viên
 * Quản trị viên chỉ định: voduongphu@gmail.com
 */

export const ADMIN_EMAIL = 'voduongphu@gmail.com';

export interface SendApprovalEmailParams {
  applicantEmail: string;
  applicantName: string;
  applicantPhone: string;
  requestedRole: string;
  requestedAt: string;
  accessToken?: string | null;
}

/**
 * Mã hóa chuỗi UTF-8 sang Base64 an toàn cho URL (RFC 4648 / RFC 2822 cho Gmail API)
 */
function toBase64UrlSafe(str: string): string {
  // Chuyển UTF-8 an toàn sang binary string
  const utf8Bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < utf8Bytes.length; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Gửi email thông báo yêu cầu xác nhận tài khoản mới tới Quản trị viên voduongphu@gmail.com
 */
export async function sendRegistrationNotificationEmail(
  params: SendApprovalEmailParams
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const { applicantEmail, applicantName, applicantPhone, requestedRole, requestedAt, accessToken } = params;

  if (!accessToken) {
    return {
      success: false,
      error: 'Chưa có quyền truy cập Gmail (thiếu access token). Yêu cầu đã được lưu an toàn trên hệ thống Firestore.',
    };
  }

  const roleText =
    requestedRole === 'ADMIN'
      ? 'Quản trị viên (Admin)'
      : requestedRole === 'THU_KHO'
      ? 'Thủ kho (Quản lý vật tư & phiếu)'
      : 'Nhân viên (Xem tồn & lập phiếu)';

  const subject = `[KhoVatTu Pro] Yêu cầu phê duyệt tài khoản mới: ${applicantEmail}`;
  const bodyText = `Kính gửi Quản trị viên Võ Dương Phú (${ADMIN_EMAIL}),

Hệ thống KhoVatTu Pro vừa nhận được yêu cầu đăng ký tài khoản người dùng mới qua Google Mail.

THÔNG TIN CHI TIẾT NGƯỜI ĐĂNG KÝ:
--------------------------------------------------
- Họ và tên: ${applicantName}
- Địa chỉ Gmail: ${applicantEmail}
- Số điện thoại liên hệ: ${applicantPhone || 'Chưa cung cấp'}
- Vai trò đề xuất: ${roleText}
- Thời gian gửi yêu cầu: ${requestedAt}

HƯỚNG DẪN XỬ LÝ (PHÊ DUYỆT HOẶC TỪ CHỐI):
--------------------------------------------------
Bạn có thể đăng nhập vào ứng dụng KhoVatTu Pro bằng tài khoản Gmail admin (${ADMIN_EMAIL}) và mở mục "Quản Lý Người Sử Dụng" -> chọn tab "Yêu Cầu Chờ Duyệt" để:
1. Bấm "Phê duyệt" để cấp quyền và phân bổ kho làm việc cho người dùng này.
2. Hoặc bấm "Từ chối" nếu thông tin chưa phù hợp.

Trân trọng,
Hệ thống Quản lý Nhập Xuất Tồn Vật tư - KhoVatTu Pro
`;

  // Soạn RFC 2822 message
  const utf8Subject = `=?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
  const rfc2822Lines = [
    `To: ${ADMIN_EMAIL}`,
    `From: ${applicantEmail}`,
    `Subject: ${utf8Subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    bodyText,
  ];

  const rawMessage = toBase64UrlSafe(rfc2822Lines.join('\r\n'));

  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: rawMessage }),
    });

    if (res.ok) {
      const data = await res.json();
      return { success: true, messageId: data.id };
    } else {
      const errJson = await res.json().catch(() => ({}));
      const errMsg = errJson?.error?.message || `HTTP ${res.status}: ${res.statusText}`;
      console.warn('[GmailNotification] Gửi thư thất bại:', errMsg);
      return { success: false, error: errMsg };
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.warn('[GmailNotification] Exception khi gọi Gmail API:', msg);
    return { success: false, error: msg };
  }
}

/**
 * Tạo đường dẫn mailto dự phòng để mở ứng dụng email của thiết bị nếu cần
 */
export function buildMailtoFallbackLink(params: Omit<SendApprovalEmailParams, 'accessToken'>): string {
  const { applicantEmail, applicantName, applicantPhone, requestedRole, requestedAt } = params;
  const subject = encodeURIComponent(`[KhoVatTu Pro] Yêu cầu phê duyệt tài khoản mới: ${applicantEmail}`);
  const body = encodeURIComponent(
    `Kính gửi Quản trị viên Võ Dương Phú,\n\nTôi vừa đăng ký tài khoản trên ứng dụng KhoVatTu Pro bằng Gmail:\n- Họ tên: ${applicantName}\n- Email: ${applicantEmail}\n- SĐT: ${applicantPhone}\n- Vai trò: ${requestedRole}\n- Thời gian: ${requestedAt}\n\nKính nhờ Quản trị viên đăng nhập vào ứng dụng để phê duyệt tài khoản giúp tôi.\n\nTrân trọng cảm ơn!`
  );
  return `mailto:${ADMIN_EMAIL}?subject=${subject}&body=${body}`;
}
