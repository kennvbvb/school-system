/**
 * ตรรกะล้วนของลิงก์ในอีเมล (เชิญผู้ใช้ / รีเซ็ตรหัสผ่าน) — ไม่มี I/O
 *
 * **ทำไมต้องอ่าน hash เอง**
 * ลิงก์เชิญที่ส่งจากฝั่ง server (`inviteUserByEmail`) ใช้ implicit flow จึงพา token กลับมา
 * ใน URL hash (`#access_token=...`) ซึ่ง server อ่านไม่ได้ ส่วน browser client ของแอปตั้งเป็น
 * PKCE (ค่าบังคับของ @supabase/ssr) และ client แบบ PKCE จะ **ปฏิเสธ** hash แบบนี้เองด้วยข้อความ
 * "Not a valid PKCE flow url" ไม่ตั้ง session ให้ — ตรวจแล้วใน auth-js ที่ตรึงเวอร์ชันไว้
 * หน้าตั้งรหัสผ่านจึงต้องแยก hash แล้วเรียก setSession เอง
 *
 * ฟังก์ชันในไฟล์นี้ **ไม่เคยคืนหรือ log ค่า token** ในผลลัพธ์ฝั่ง error (FR-AUD-004)
 */

/** ชนิดลิงก์ที่หน้าตั้งรหัสผ่านยอมรับ — ชนิดอื่น (เช่น magiclink) ไม่ใช่ทางเข้าของหน้านี้ */
export type AuthLinkType = 'invite' | 'recovery';

export type AuthHashResult =
  | { kind: 'none' }
  | { kind: 'error'; reason: 'expired' | 'invalid' }
  | { kind: 'session'; accessToken: string; refreshToken: string; linkType: AuthLinkType };

/** JWT ปกติยาวไม่เกินสองสามกิโลไบต์ ค่าที่ยาวผิดปกติไม่ใช่ token จริง */
const MAX_TOKEN_LENGTH = 8192;

function isLinkType(value: string | null): value is AuthLinkType {
  return value === 'invite' || value === 'recovery';
}

export function parseAuthHash(hash: string): AuthHashResult {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') return { kind: 'none' };

  const params = new URLSearchParams(raw);

  const hasError =
    params.has('error') || params.has('error_code') || params.has('error_description');
  if (hasError) {
    const code = params.get('error_code') ?? '';
    const description = params.get('error_description') ?? '';
    // Supabase ใช้ otp_expired ทั้งลิงก์หมดอายุและลิงก์ที่ใช้ไปแล้ว
    const expired = code === 'otp_expired' || /expired/i.test(description);
    return { kind: 'error', reason: expired ? 'expired' : 'invalid' };
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const linkType = params.get('type');

  // hash ที่ไม่เกี่ยวกับ auth เลย (เช่น #section) ไม่ใช่ความผิดพลาด
  if (!accessToken && !refreshToken && !linkType) return { kind: 'none' };

  if (
    !accessToken ||
    !refreshToken ||
    accessToken.length > MAX_TOKEN_LENGTH ||
    refreshToken.length > MAX_TOKEN_LENGTH ||
    !isLinkType(linkType)
  ) {
    return { kind: 'error', reason: 'invalid' };
  }

  return { kind: 'session', accessToken, refreshToken, linkType };
}

/**
 * ต่อ URL ของแอปกับ path ภายใน — ใช้สร้าง `redirectTo` ของอีเมลเชิญ
 *
 * ตัด `/` ท้ายของฐานออกเพื่อไม่ให้ได้ `//` ซึ่ง Supabase เทียบกับรายการ Redirect URLs
 * ที่อนุญาตไม่ตรงแล้วส่งผู้ใช้ไปที่ Site URL แทนโดยไม่แจ้งอะไร
 */
export function joinAppUrl(appUrl: string, path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('path ต้องเป็น path ภายในระบบที่ขึ้นต้นด้วย /');
  }
  return `${appUrl.replace(/\/+$/, '')}${path}`;
}

/** หน้าปลายทางหลังแลก code จากลิงก์รีเซ็ตรหัสผ่านสำเร็จ — ค่าคงที่ ไม่รับจาก query */
export const RESET_PASSWORD_PATH = '/reset-password';
export const FORGOT_PASSWORD_PATH = '/forgot-password';
export const AUTH_CALLBACK_PATH = '/auth/callback';
