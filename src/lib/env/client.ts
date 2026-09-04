import { z } from 'zod';

/**
 * Client-safe environment schema.
 *
 * ต้องอ้าง `process.env.NEXT_PUBLIC_*` แบบเต็มสตริง เพราะ Next.js แทนค่าตอน build
 * ด้วยการ match ข้อความตรง ๆ การเขียน `process.env[key]` จะได้ undefined
 */
/** ใช้กติกาเดียวกับฝั่ง server เพื่อไม่ให้สองฝั่งยอมรับค่าต่างกัน (ดู env/server.ts) */
const urlField = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (trimmed === '' || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}, z.url());

const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: urlField,
  NEXT_PUBLIC_SUPABASE_URL: urlField,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

let cached: ClientEnv | null = null;

export function getClientEnv(): ClientEnv {
  if (cached) return cached;

  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    throw new Error('ตั้งค่า NEXT_PUBLIC_* ไม่ครบ กรุณาตรวจไฟล์ .env.local เทียบกับ .env.example');
  }

  cached = parsed.data;
  return cached;
}
