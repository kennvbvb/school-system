import 'server-only';
import { z } from 'zod';

/**
 * Server-side environment schema.
 *
 * ตรวจ env ตอน import ครั้งแรก (FR-SYS, 17.2) เพื่อให้ deploy ที่ตั้งค่าไม่ครบ
 * ล้มตั้งแต่ตอน build/boot แทนที่จะไปพังตอนผู้ใช้กดปุ่ม
 */
/**
 * ตัวแปรที่ไม่บังคับมักถูกประกาศไว้เป็นค่าว่างใน .env หรือใน Vercel
 * ถือค่าว่างเท่ากับ "ไม่ได้ตั้ง" เพื่อไม่ให้ build ล้มโดยไม่จำเป็น
 */
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  /** ใช้เฉพาะฝั่ง server เท่านั้น ห้ามหลุดเข้า client bundle */
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SENTRY_DSN: optionalString,
  APP_TIMEZONE: z.string().default('Asia/Bangkok'),
  DOCUMENT_STORAGE_BUCKET: z.string().default('issued-documents'),
  ATTACHMENT_STORAGE_BUCKET: z.string().default('attachments'),
  /** commit SHA สำหรับแสดงในหน้าผู้ดูแล (FR-SYS-003) */
  APP_COMMIT_SHA: z.string().default('unknown'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`ตั้งค่า environment variables ไม่ครบหรือไม่ถูกต้อง:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}
