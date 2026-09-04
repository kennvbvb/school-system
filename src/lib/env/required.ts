/**
 * ตัวแปร environment ที่ระบบต้องมีจึงจะทำงานได้ พร้อมคำแนะนำภาษาไทย
 *
 * แยกออกมาเป็นไฟล์ของตัวเองเพราะถูกใช้จากสามที่ที่มี runtime ต่างกัน:
 *   - proxy (edge) ใช้ตรวจว่าตั้งค่าครบหรือยัง
 *   - หน้า /setup-required (static) ใช้แสดงรายการให้ผู้ดูแล
 *   - เอกสารและ test ใช้ตรวจว่ารายการตรงกับ .env.example
 *
 * ไฟล์นี้ต้องไม่ import อะไรที่ผูกกับ runtime ใด runtime หนึ่ง
 */

export interface RequiredEnvVar {
  name: string;
  hintTh: string;
}

/**
 * เฉพาะตัวที่ "ขาดแล้วระบบทำงานไม่ได้" เท่านั้น
 *
 * ตัวที่มีค่า default ในโค้ด (APP_TIMEZONE, bucket ต่าง ๆ) หรือยังไม่มีฟีเจอร์ที่ใช้
 * (SENTRY_DSN, SUPABASE_SERVICE_ROLE_KEY) ไม่นับอยู่ในรายการนี้
 * เพราะการบังคับให้ตั้งค่าที่ยังไม่จำเป็นทำให้ผู้ดูแลเสียเวลาโดยเปล่าประโยชน์
 */
export const REQUIRED_PUBLIC_ENV_VARS: readonly RequiredEnvVar[] = [
  {
    name: 'NEXT_PUBLIC_APP_URL',
    hintTh: 'URL ของเว็บนี้ เช่น https://ชื่อโครงการ.vercel.app',
  },
  {
    name: 'NEXT_PUBLIC_SUPABASE_URL',
    hintTh: 'Project URL จาก Supabase → Project Settings → API',
  },
  {
    name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    hintTh: 'anon / public key จากหน้าเดียวกัน (เปิดเผยได้ ถูก RLS กรองอีกชั้น)',
  },
];

/**
 * ตรวจว่าค่าที่ได้มาพอใช้งานหรือไม่ — ใช้ใน proxy ที่รันบน edge runtime
 *
 * ตรวจแค่ "มีค่าและไม่ว่าง" ไม่ตรวจรูปแบบ URL เพราะการตรวจเต็มรูปแบบ
 * ทำที่ getServerEnv() ซึ่งเป็นแหล่งความจริงเดียว การตรวจซ้ำสองที่ด้วยกฎ
 * คนละชุดจะทำให้เกิดกรณีที่ proxy ปล่อยผ่านแต่หน้าเว็บพัง
 */
export function findMissingPublicEnvVars(read: (name: string) => string | undefined): string[] {
  return REQUIRED_PUBLIC_ENV_VARS.filter((variable) => !read(variable.name)?.trim()).map(
    (variable) => variable.name,
  );
}
