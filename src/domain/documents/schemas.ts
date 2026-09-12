/**
 * Zod schema ของทะเบียนเลขที่เอกสาร (ข้อ 10.1)
 *
 * schema เดียวใช้ทั้งฟอร์มและขอบเขต server เช่นเดียวกับโมดูลอื่น
 * ข้อจำกัดที่นี่ต้องตรงกับ constraint ใน migration 0014 เสมอ
 */
import { z } from 'zod';
import { businessDateSchema } from '@/domain/master-data/schemas';
import { DOCUMENT_KINDS, DOCUMENT_NUMBER_STATUSES, requiresReason } from './document-register';

const blankToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema,
  );

/**
 * เลขที่เอกสารรับอักขระอะไรก็ได้ที่ไม่ใช่ช่องว่างล้วน
 *
 * **ไม่บังคับรูปแบบโดยเจตนา** — Q3 ตอบว่าโรงเรียนกำหนดเลขเอง การบังคับรูปแบบ
 * ที่ระบบคิดขึ้นจะปฏิเสธเลขที่โรงเรียนใช้จริง ซึ่งเป็นความผิดพลาดที่ผู้ใช้แก้ไม่ได้เลย
 * สิ่งที่บังคับคือความไม่ซ้ำ ไม่ใช่หน้าตา
 */
const documentNoSchema = z
  .string()
  .trim()
  .min(1, { message: 'กรุณากรอกเลขที่เอกสาร' })
  .max(64, { message: 'เลขที่เอกสารต้องไม่เกิน 64 ตัวอักษร' });

const reasonSchema = z
  .string()
  .trim()
  .min(1, { message: 'กรุณาระบุเหตุผล' })
  .max(1000, { message: 'เหตุผลต้องไม่เกิน 1000 ตัวอักษร' });

export const documentNumberRecordSchema = z
  .object({
    procurementId: z.uuid(),
    documentKind: z.enum(DOCUMENT_KINDS, { message: 'กรุณาเลือกชนิดเอกสาร' }),
    status: z.enum(DOCUMENT_NUMBER_STATUSES, { message: 'กรุณาเลือกสถานะเลขที่เอกสาร' }),
    documentNo: blankToUndefined(documentNoSchema.optional()),
    issuedDate: blankToUndefined(businessDateSchema.optional()),
    reason: blankToUndefined(reasonSchema.optional()),
  })
  /*
   * ความสัมพันธ์ระหว่างสถานะกับช่องอื่นตรวจที่นี่ ไม่ใช่ปล่อยให้ฐานข้อมูลปฏิเสธ
   * ผู้ใช้จะได้เห็นว่าต้องกรอกอะไรเพิ่ม แทนที่จะได้ข้อความ constraint violation
   * ที่แปลไม่ออก — ฐานข้อมูลยังมี check constraint ชุดเดียวกันกันไว้อีกชั้น
   */
  .refine((value) => value.status !== 'ISSUED' || Boolean(value.documentNo), {
    path: ['documentNo'],
    message: 'กรุณากรอกเลขที่เอกสาร',
  })
  .refine((value) => value.status !== 'ISSUED' || Boolean(value.issuedDate), {
    path: ['issuedDate'],
    message: 'กรุณากรอกวันที่ออกเอกสาร',
  })
  .refine((value) => !requiresReason(value.status) || Boolean(value.reason), {
    path: ['reason'],
    message: 'กรุณาระบุเหตุผล เพราะรายการนี้ไม่ได้ออกเลขที่เอกสาร',
  })
  /*
   * สถานะที่ไม่ใช่ ISSUED ต้องไม่มีเลขติดมาด้วย
   *
   * ถ้ายอมให้ส่งมาแล้วเงียบ ๆ ทิ้ง จะเกิดกรณีที่ผู้ใช้พิมพ์เลขไว้ เปลี่ยนสถานะเป็น
   * "ไม่ต้องมีเลข" แล้วเข้าใจว่าเลขยังถูกบันทึกอยู่ ทั้งที่หายไปแล้ว
   */
  .refine((value) => value.status === 'ISSUED' || !value.documentNo, {
    path: ['documentNo'],
    message: 'สถานะนี้ต้องไม่มีเลขที่เอกสาร กรุณาล้างช่องเลขที่เอกสารก่อน',
  });

export type DocumentNumberRecordInput = z.infer<typeof documentNumberRecordSchema>;

/** ยกเลิกเลขที่ออกไปแล้ว — เลขเดิมจะนำกลับมาใช้ไม่ได้อีก จึงบังคับเหตุผลทุกครั้ง */
export const documentNumberVoidSchema = z.object({
  documentNumberId: z.uuid(),
  reason: reasonSchema,
});

export type DocumentNumberVoidInput = z.infer<typeof documentNumberVoidSchema>;
