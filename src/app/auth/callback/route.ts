import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import { FORGOT_PASSWORD_PATH, RESET_PASSWORD_PATH } from '@/domain/auth/auth-link';

/**
 * ปลายทางของลิงก์รีเซ็ตรหัสผ่านในอีเมล (PKCE) — แลก `code` เป็น session ที่ server
 * แล้วพาไปหน้าตั้งรหัสผ่าน
 *
 * **ปลายทางเป็นค่าคงที่ ไม่รับจาก query** ไม่มีพารามิเตอร์ `next` ให้ใครส่งมาชี้ไปที่อื่นได้
 * (กัน open redirect) และ `code` ใช้ครั้งเดียวเท่านั้น
 *
 * ล้มเมื่อ code ผิด/หมดอายุ/ไม่มี code verifier ในเบราว์เซอร์นี้ (เปิดลิงก์คนละเบราว์เซอร์กับที่ขอ)
 * ทุกกรณีพาไปขอลิงก์ใหม่ โดยไม่ส่งรายละเอียดข้อผิดพลาดกลับไปใน URL และไม่ log ค่า code
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');

  const failureUrl = new URL(FORGOT_PASSWORD_PATH, request.url);
  failureUrl.searchParams.set('error', 'link');

  if (!code) return NextResponse.redirect(failureUrl);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('[auth] แลก code เป็น session ไม่สำเร็จ', error.code ?? error.status);
    return NextResponse.redirect(failureUrl);
  }

  return NextResponse.redirect(new URL(RESET_PASSWORD_PATH, request.url));
}
