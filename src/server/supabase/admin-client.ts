import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env/server';

/**
 * Supabase client ที่ใช้ service-role key — ข้าม RLS ทั้งหมด
 *
 * คำเตือน (ข้อ 10.3, 14.1):
 *   * ห้าม import ไฟล์นี้จาก client component เด็ดขาด
 *     'server-only' จะทำให้ build ล้มถ้ามีใครเผลอ import และ eslint มีกฎห้ามซ้ำอีกชั้น
 *   * ใช้เฉพาะงานที่ทำแทนผู้ใช้ไม่ได้จริง ๆ เช่น การสร้างบัญชีผู้ใช้ครั้งแรก
 *     และการเขียน audit event ที่ต้องบันทึกให้ได้แม้ผู้ใช้จะไม่มีสิทธิ์อ่านกลับ
 *   * ทุกจุดที่เรียกต้องตรวจสิทธิ์ในระดับ domain service มาก่อนแล้วเสมอ
 */
export function createSupabaseAdminClient() {
  const env = getServerEnv();

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'ไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY — งานที่ต้องใช้สิทธิ์ระดับระบบทำไม่ได้',
    );
  }

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
