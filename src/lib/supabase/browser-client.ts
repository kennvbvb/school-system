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
