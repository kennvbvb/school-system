import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import {
  PATHNAME_HEADER,
  REQUEST_ID_HEADER,
  generateRequestId,
  sanitizeRequestId,
} from '@/lib/request-id';
import { findMissingPublicEnvVars } from '@/lib/env/required';

/**
 * Proxy (เดิมชื่อ middleware) ทำสี่อย่าง:
 *   1. ต่ออายุ Supabase session cookie (จำเป็นสำหรับ Server Component ที่เขียน cookie ไม่ได้)
 *   2. ใส่ request ID ให้ทุก request เพื่อผูก error บนหน้าจอกับ log และ audit event
 *   3. ส่ง pathname ต่อให้ Server Component ผ่าน header
 *   4. พาไปหน้า /setup-required เมื่อยังตั้งค่า environment variables ไม่ครบ
 *
 * การตรวจสิทธิ์ "ไม่" ทำที่นี่ — proxy กันได้เฉพาะ path ที่รู้จัก
 * และเลี่ยงได้ในบางกรณี การตัดสินใจจริงอยู่ที่ requireUserForPage/requirePermission
 * ในแต่ละหน้าและ server action (ข้อ 4.2)
 */
const SETUP_REQUIRED_PATH = '/setup-required';

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

  /*
   * ตั้งค่าไม่ครบ -> พาไปหน้าที่บอกได้ว่าต้องตั้งอะไร
   *
   * ก่อนหน้านี้ปล่อยผ่านแล้วให้ error boundary รับไป ซึ่งผู้ใช้เห็นแค่
   * "เกิดข้อผิดพลาดในระบบ" พร้อมรหัสอ้างอิง ถูกต้องในแง่ความปลอดภัย
   * แต่ผู้ดูแลระบบแก้ไม่ได้เลยถ้าไม่เปิด log ของ Vercel ดู
   *
   * ยกเว้นหน้า /setup-required เอง (กัน redirect วน) และ /api/health
   * ที่ต้องตอบได้เสมอเพื่อให้ระบบ monitoring ทำงานต่อได้
   */
  const missingEnvVars = findMissingPublicEnvVars((name) => process.env[name]);
  const isExemptPath =
    request.nextUrl.pathname === SETUP_REQUIRED_PATH ||
    request.nextUrl.pathname.startsWith('/api/health');

  if (missingEnvVars.length > 0) {
    if (isExemptPath) return response;

    console.error('[proxy] ตั้งค่า environment variables ไม่ครบ', {
      requestId,
      missing: missingEnvVars,
    });

    const setupUrl = request.nextUrl.clone();
    setupUrl.pathname = SETUP_REQUIRED_PATH;
    setupUrl.search = '';
    return NextResponse.redirect(setupUrl);
  }

  // ตั้งค่าครบแล้วแต่ยังอยู่หน้า setup — พากลับหน้าแรก
  if (request.nextUrl.pathname === SETUP_REQUIRED_PATH) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    return NextResponse.redirect(homeUrl);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

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
