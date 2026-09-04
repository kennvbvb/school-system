import { publicEnvSchema } from './required';
import type { z } from 'zod';

/**
 * Client-safe environment schema.
 *
 * ต้องอ้าง `process.env.NEXT_PUBLIC_*` แบบเต็มสตริง เพราะ Next.js แทนค่าตอน build
 * ด้วยการ match ข้อความตรง ๆ การเขียน `process.env[key]` จะได้ undefined
 *
 * ใช้ publicEnvSchema ร่วมกับฝั่ง server และ proxy เพื่อไม่ให้สองฝั่งยอมรับค่าต่างกัน
 */
export type ClientEnv = z.infer<typeof publicEnvSchema>;

let cached: ClientEnv | null = null;

export function getClientEnv(): ClientEnv {
  if (cached) return cached;

  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      'ตั้งค่า NEXT_PUBLIC_* ไม่ครบหรือไม่ถูกต้อง กรุณาตรวจไฟล์ .env.local เทียบกับ .env.example',
    );
  }

  cached = parsed.data;
  return cached;
}
