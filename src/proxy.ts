import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import {
  PATHNAME_HEADER,
  REQUEST_ID_HEADER,
  generateRequestId,
  sanitizeRequestId,
} from '@/lib/request-id';

/**
 * Proxy (เดิมชื่อ middleware) ทำสามอย่าง:
 *   1. ต่ออายุ Supabase session cookie (จำเป็นสำหรับ Server Component ที่เขียน cookie ไม่ได้)
 *   2. ใส่ request ID ให้ทุก request เพื่อผูก error บนหน้าจอกับ log และ audit event
 *   3. ส่ง pathname ต่อให้ Server Component ผ่าน header
 *
 * การตรวจสิทธิ์ "ไม่" ทำที่นี่ — proxy กันได้เฉพาะ path ที่รู้จัก
 * และเลี่ยงได้ในบางกรณี การตัดสินใจจริงอยู่ที่ requireUserForPage/requirePermission
 * ในแต่ละหน้าและ server action (ข้อ 4.2)
 */
export default async function proxy(request: NextRequest) {
  const requestId =
    sanitizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? generateRequestId();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  // Server Component อ่าน pathname เองไม่ได้ จึงส่งต่อมาทาง header
  // ให้การ์ดใช้พาผู้ใช้กลับมาหน้าเดิมหลังเข้าสู่ระบบ
  requestHeaders.set(PATHNAME_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // ปล่อยผ่านเพื่อให้หน้า error ของแอปอธิบายว่าตั้งค่า env ไม่ครบ
    // แทนที่จะได้หน้า 500 เปล่า ๆ ที่ debug ไม่ได้
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request: { headers: requestHeaders } });
        response.headers.set(REQUEST_ID_HEADER, requestId);
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // การเรียก getUser() ที่นี่คือสิ่งที่ทำให้ token ถูก refresh
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * ทุก path ยกเว้นไฟล์สถิตและรูปภาพ
     * เขียนเป็น negative lookahead เพื่อไม่ต้องไล่แก้ทุกครั้งที่เพิ่ม route ใหม่
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
};
