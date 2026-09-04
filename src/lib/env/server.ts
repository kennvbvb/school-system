import 'server-only';
import { z } from 'zod';
import { publicEnvSchema } from './required';

/**
 * Server-side environment schema.
 *
 * ตรวจ env ตอน import ครั้งแรก (FR-SYS, 17.2) เพื่อให้ deploy ที่ตั้งค่าไม่ครบ
 * ล้มตั้งแต่ตอน build/boot แทนที่จะไปพังตอนผู้ใช้กดปุ่ม
 *
 * ตัวแปรสาธารณะสามตัวมาจาก publicEnvSchema ใน env/required.ts ซึ่งเป็นชุดกฎ
 * เดียวกับที่ proxy และฝั่ง client ใช้ จึงไม่มีทางที่ proxy ปล่อยผ่านแต่ที่นี่ปฏิเสธ
 */

/**
 * ตัวแปรที่ไม่บังคับมักถูกประกาศไว้เป็นค่าว่างใน .env หรือใน Vercel
 * ถือค่าว่างเท่ากับ "ไม่ได้ตั้ง" เพื่อไม่ให้ build ล้มโดยไม่จำเป็น
 */
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const serverEnvSchema = publicEnvSchema.extend({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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

/**
 * error สำหรับ "ตั้งค่าไม่ครบ" โดยเฉพาะ แยกจาก error ทั่วไป
 *
 * เก็บเฉพาะ "ชื่อ" ตัวแปรที่มีปัญหา ไม่เก็บค่า เพื่อให้หน้าจอบอกผู้ดูแลได้ว่า
 * ต้องไปแก้อะไร โดยไม่เสี่ยงทำให้ค่าลับหลุดออกไปทาง error message
 * ชื่อตัวแปรเปิดเผยอยู่แล้วใน .env.example จึงไม่ใช่ข้อมูลลับ
 */
export class EnvConfigurationError extends Error {
  readonly invalidVariables: readonly string[];

  constructor(invalidVariables: readonly string[]) {
    super(`ตั้งค่า environment variables ไม่ครบหรือไม่ถูกต้อง: ${invalidVariables.join(', ')}`);
    this.name = 'EnvConfigurationError';
    this.invalidVariables = invalidVariables;
  }
}

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const invalid = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '(root)'))),
    ];
    throw new EnvConfigurationError(invalid);
  }

  cached = parsed.data;
  return cached;
}
