'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getClientEnv } from '@/lib/env/client';

/**
 * Supabase client ฝั่ง browser — ใช้ anon key เท่านั้น จึงอยู่ใต้ RLS เสมอ
 * ใช้สำหรับ auth flow (เข้าสู่ระบบ ออกจากระบบ) ไม่ใช้เขียนข้อมูลธุรกรรม (ข้อ 10.3)
 */
export function createSupabaseBrowserClient() {
  const env = getClientEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * client สำหรับหน้าตั้งรหัสผ่านโดยเฉพาะ — ปิดการตรวจ session จาก URL อัตโนมัติ
 *
 * ลิงก์เชิญพา token มาใน URL hash แต่ client แบบ PKCE ปฏิเสธ hash ชนิดนี้เอง
 * และล้าง session ทิ้งตอนปฏิเสธ หน้านี้จึงอ่าน hash เองแล้วเรียก setSession
 * (ดู src/domain/auth/auth-link.ts) การปล่อยให้ client ตรวจเองซ้ำจะได้ error ที่ไม่มีใครต้องการ
 *
 * ไม่ใช้ singleton เพื่อไม่ให้ตั้งค่านี้ไปกระทบ client ตัวอื่นที่สร้างไว้ก่อนในหน้าเดียวกัน
 */
export function createSupabaseBrowserClientWithoutUrlDetection() {
  const env = getClientEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    isSingleton: false,
    auth: { detectSessionInUrl: false },
  });
}
