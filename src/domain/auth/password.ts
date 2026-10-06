/**
 * กติกาของรหัสผ่านใหม่ (FR-AUTH-003)
 *
 * ไฟล์นี้เป็นตรรกะล้วน ไม่มี I/O — ใช้ตรวจที่ฟอร์มเพื่อให้ผู้ใช้แก้ได้ทันที
 *
 * **การตรวจที่นี่ไม่ใช่ชั้นความปลอดภัย** ผู้ใช้ข้ามฟอร์มแล้วเรียก Supabase Auth ตรงได้
 * ตัวบังคับจริงคือค่า "Minimum password length" ของโครงการ Supabase เอง
 * ซึ่งต้องตั้งให้ไม่ต่ำกว่า {@link PASSWORD_MIN_LENGTH} (ดู docs/setup-supabase-vercel.md)
 */
import { z } from 'zod';

/**
 * ความยาวขั้นต่ำ — ค่าเริ่มต้นที่ผู้พัฒนาเลือกเอง ยังไม่ใช่นโยบายที่โรงเรียนรับรอง
 * (ระบบนี้ไม่มี MFA จึงเลือกให้ยาวกว่าค่ามาตรฐานทั่วไป) แก้ที่นี่ที่เดียวได้
 * แต่ต้องแก้ค่าใน Supabase ให้ตรงกันด้วย
 */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * ความยาวสูงสุดเป็น **ไบต์** ไม่ใช่ตัวอักษร
 *
 * Supabase Auth เข้ารหัสรหัสผ่านด้วย bcrypt ซึ่งรับได้ไม่เกิน 72 ไบต์
 * ตัวอักษรไทยหนึ่งตัวใช้ 3 ไบต์ใน UTF-8 จึงนับเป็นตัวอักษรไม่ได้
 * มิฉะนั้นรหัสผ่านภาษาไทยยาว ๆ จะผ่านฟอร์มแล้วถูกปฏิเสธทีหลังโดยไม่มีคำอธิบาย
 */
export const PASSWORD_MAX_BYTES = 72;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, {
        message: `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`,
      })
      .refine((value) => utf8ByteLength(value) <= PASSWORD_MAX_BYTES, {
        message: `รหัสผ่านยาวเกินไป (ไม่เกิน ${PASSWORD_MAX_BYTES} ไบต์ ตัวอักษรไทยนับตัวละ 3 ไบต์)`,
      })
      // ห้ามทั้งช่องเป็นช่องว่าง — ไม่ trim รหัสผ่านเพราะช่องว่างกลางและท้ายเป็นส่วนของรหัสได้
      .refine((value) => value.trim().length > 0, {
        message: 'รหัสผ่านต้องไม่เป็นช่องว่างล้วน',
      }),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน',
  });

export type NewPasswordInput = z.infer<typeof newPasswordSchema>;
