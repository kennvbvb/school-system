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
  const env = getServerEnv();
  const cookieStore = await cookies();

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
