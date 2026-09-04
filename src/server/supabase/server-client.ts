import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getServerEnv } from '@/lib/env/server';

/**
 * Supabase client ฝั่ง server ที่ผูกกับ session ของผู้ใช้ผ่าน cookie
 *
 * client ตัวนี้ใช้ anon key จึงยังอยู่ภายใต้ RLS ทุกครั้ง
 * เป็นตัวที่ควรใช้เป็นค่าเริ่มต้นสำหรับการอ่าน/เขียนแทนผู้ใช้
 */
export async function createSupabaseServerClient() {
  /*
   * ต้องเรียก cookies() ก่อน getServerEnv() เสมอ — ลำดับนี้สำคัญ ไม่ใช่เรื่องสไตล์
   *
   * cookies() เป็นสัญญาณที่บอก Next.js ว่า route นี้เป็น dynamic
   * ถ้า getServerEnv() มาก่อนแล้วโยน error (เช่นตอน build บนเครื่องที่ยังไม่ได้ตั้ง env)
   * Next.js จะยังไม่รู้ว่า route เป็น dynamic จึงพยายาม prerender แล้ว build ล้มทั้งชุด
   * ทั้งที่หน้าเหล่านี้ไม่ควรถูก prerender ตั้งแต่แรกเพราะต้องอ่าน session ของผู้ใช้
   */
  const cookieStore = await cookies();
  const env = getServerEnv();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // เรียกจาก Server Component ที่เขียน cookie ไม่ได้
          // proxy เป็นผู้ต่ออายุ session ให้แล้ว จึงข้ามได้อย่างปลอดภัย
        }
      },
    },
  });
}
