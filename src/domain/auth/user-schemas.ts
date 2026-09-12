/**
 * Zod schema ของการจัดการผู้ใช้ (ข้อ 10.1)
 *
 * **ไม่มีช่องรหัสผ่านในทุก schema ของไฟล์นี้โดยเจตนา** ระบบไม่รับ ไม่ส่ง และไม่เก็บ
 * รหัสผ่านเลย การสร้างบัญชีใช้การเชิญทางอีเมลแล้วให้เจ้าของบัญชีตั้งรหัสผ่านเอง
 * (ข้อ 14.2 ห้ามบันทึกรหัสผ่านลง log — วิธีที่แน่นอนที่สุดคือไม่ให้มันผ่านระบบเลย)
 */
import { z } from 'zod';

const blankToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema,
  );

const requiredText = (label: string, max = 255) =>
  z
    .string()
    .trim()
    .min(1, { message: `กรุณากรอก${label}` })
    .max(max, { message: `${label}ต้องไม่เกิน ${max} ตัวอักษร` });

/** เก็บอีเมลเป็นตัวพิมพ์เล็กเสมอ ตรงกับ constraint `profiles_email_lowercase` */
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'รูปแบบอีเมลไม่ถูกต้อง' }))
  .pipe(z.string().max(255, { message: 'อีเมลต้องไม่เกิน 255 ตัวอักษร' }));

const roleCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z_]*$/, { message: 'รหัสบทบาทไม่ถูกต้อง' });

/** ชุดบทบาทของผู้ใช้ — ต้องมีอย่างน้อยหนึ่ง มิฉะนั้นผู้ใช้เข้าระบบไปก็ทำอะไรไม่ได้ */
const roleCodesSchema = z
  .array(roleCodeSchema)
  .min(1, { message: 'กรุณาเลือกอย่างน้อยหนึ่งบทบาท' })
  .max(8, { message: 'เลือกบทบาทได้ไม่เกิน 8 บทบาท' })
  /* ส่งซ้ำมาไม่ใช่ความผิดของผู้ใช้ แต่จะทำให้ปลายทางเขียนแถวซ้ำ จึงยุบตั้งแต่ขอบเขต */
  .transform((roles) => [...new Set(roles)]);

export const userProfileSchema = z.object({
  titleTh: blankToUndefined(z.string().trim().max(32).optional()),
  firstNameTh: requiredText('ชื่อ', 128),
  lastNameTh: requiredText('นามสกุล', 128),
  employeeCode: blankToUndefined(z.string().trim().max(32).optional()),
  positionId: blankToUndefined(z.uuid().optional()),
  departmentId: blankToUndefined(z.uuid().optional()),
});

/** เชิญผู้ใช้ใหม่ — สร้างบัญชีเข้าระบบและโปรไฟล์พร้อมกัน */
export const userInviteSchema = userProfileSchema.extend({
  email: emailSchema,
  roleCodes: roleCodesSchema,
});

export type UserInviteInput = z.infer<typeof userInviteSchema>;

export const userUpdateSchema = userProfileSchema.extend({
  userId: z.uuid(),
});

export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const userRolesSchema = z.object({
  userId: z.uuid(),
  roleCodes: roleCodesSchema,
});

export type UserRolesInput = z.infer<typeof userRolesSchema>;

export const userActiveSchema = z.object({
  userId: z.uuid(),
  isActive: z.boolean(),
});

export type UserActiveInput = z.infer<typeof userActiveSchema>;
