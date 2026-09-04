import { z } from 'zod';

/**
 * ตัวแปร environment ที่ระบบต้องมีจึงจะทำงานได้ พร้อมกติกาตรวจค่าและคำแนะนำภาษาไทย
 *
 * แยกออกมาเป็นไฟล์ของตัวเองเพราะถูกใช้จากสี่ที่ที่มี runtime ต่างกัน:
 *   - proxy (edge) ใช้ตรวจว่าตั้งค่าครบและถูกต้องหรือยัง
 *   - env/server.ts และ env/client.ts ใช้เป็นฐานของ schema ฝั่งตัวเอง
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
 * URL ที่ยอมรับค่าที่ไม่มี scheme แล้วเติม https:// ให้
 *
 * Vercel และ Supabase แสดง URL ในหน้า dashboard โดยไม่มี scheme
 * (เช่น "abc.vercel.app" หรือ "abc.supabase.co") คนที่คัดลอกมาวางตรง ๆ
 * จึงได้ค่าที่ z.url() ปฏิเสธ ทั้งที่เจตนาชัดเจนอยู่แล้ว
 *
 * การเติม https:// ให้ปลอดภัย เพราะทั้งสองบริการให้บริการผ่าน https เท่านั้น
 * ส่วนการพัฒนาในเครื่องใช้ http://localhost ซึ่งมี scheme อยู่แล้วจึงไม่ถูกแตะ
 *
 * ลำดับสำคัญ: ต้องเติม scheme ก่อนแล้วค่อยตัด "/" ท้าย ถ้าตัดก่อนค่าอย่าง
 * "https://" จะเหลือ "https:" ซึ่งหลุดกติกา scheme แล้วถูกเติมซ้ำเป็น
 * "https://https:" ที่นับเป็น URL ถูกต้องทั้งที่ผู้ดูแลยังกรอกไม่เสร็จ
 */
export const urlField = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return trimmed;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}, z.url());

/**
 * ค่าที่บังคับและต้องไม่เป็นช่องว่างล้วน
 *
 * การคัดลอกค่ามาวางมักติดช่องว่างหรือขึ้นบรรทัดใหม่มาด้วย ถ้าไม่ตัดทิ้ง
 * ค่าที่มีแต่ช่องว่างจะผ่าน min(1) ไปได้ทั้งที่ใช้เชื่อมต่อจริงไม่ได้
 */
const requiredSecret = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() : value),
  z.string().min(1),
);

/**
 * กติกาตรวจตัวแปรสาธารณะ — เป็นแหล่งความจริงเดียวของทั้งระบบ
 *
 * env/server.ts ต่อยอด schema นี้ ส่วน env/client.ts และ proxy ใช้ตรงนี้
 * การมีชุดกฎเดียวทำให้ไม่เกิดกรณีที่ proxy ปล่อยผ่านแต่หน้าเว็บพัง
 */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: urlField,
  NEXT_PUBLIC_SUPABASE_URL: urlField,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: requiredSecret,
});

/**
 * คืนชื่อตัวแปรที่ "ไม่ได้ตั้ง หรือ ตั้งแล้วแต่ค่าใช้ไม่ได้" — ใช้ใน proxy บน edge runtime
 *
 * ตรวจด้วย schema ชุดเดียวกับที่หน้าเว็บใช้จริง ไม่ใช่แค่ดูว่ามีค่าหรือไม่
 * เพราะค่าที่ผิดรูปแบบ (เช่น URL ที่พิมพ์ตกหล่น) ทำให้ระบบพังไม่ต่างจากการไม่ตั้งค่า
 * แต่เดิมผู้ดูแลจะเห็นเพียงหน้า error พร้อมรหัสอ้างอิงซึ่งแก้ตามไม่ได้
 *
 * คืนเฉพาะ "ชื่อ" ไม่คืนค่าและไม่บอกว่าผิดอย่างไร เพื่อไม่ให้ค่าลับหลุดทางหน้าจอหรือ log
 */
export function findInvalidPublicEnvVars(read: (name: string) => string | undefined): string[] {
  const values = Object.fromEntries(
    REQUIRED_PUBLIC_ENV_VARS.map((variable) => [variable.name, read(variable.name)]),
  );
  const parsed = publicEnvSchema.safeParse(values);
  if (parsed.success) return [];

  const invalid = new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')));
  // เรียงตามลำดับในรายการเสมอ เพื่อให้ log และหน้าจออ่านง่ายและ test คาดเดาได้
  return REQUIRED_PUBLIC_ENV_VARS.filter((variable) => invalid.has(variable.name)).map(
    (variable) => variable.name,
  );
}
