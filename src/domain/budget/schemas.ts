/**
 * Zod schema ของบัญชีงบและการลงรายการเคลื่อนไหว (ข้อ 10.1)
 *
 * schema เดียวใช้ทั้งฟอร์มและขอบเขต server เช่นเดียวกับ schema อื่นในระบบ
 * ข้อจำกัดที่นี่ต้องตรงกับ constraint ใน migration 0005 และ 0009 เสมอ
 * ฝั่งฐานข้อมูลเป็นชั้นที่บังคับจริง ที่นี่ทำให้ผู้ใช้เห็นปัญหาก่อนกดบันทึก
 */
import { z } from 'zod';
import { businessDateSchema } from '@/domain/master-data/schemas';
import type { MovementType } from './movement';

const requiredText = (label: string, max = 255) =>
  z
    .string()
    .trim()
    .min(1, { message: `กรุณากรอก${label}` })
    .max(max, { message: `${label}ต้องไม่เกิน ${max} ตัวอักษร` });

/*
 * ช่องที่ไม่บังคับ — ใช้ preprocess แทน transform ด้วยเหตุผลเดียวกับ schema อื่น
 * (transform ทำให้ key กลายเป็น "บังคับแต่เป็น undefined ได้" ในชนิดผลลัพธ์)
 */
const optionalText = (max = 1000) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional(),
  );

const codeField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, { message: `กรุณากรอก${label}` })
    .max(32, { message: `${label}ต้องไม่เกิน 32 ตัวอักษร` })
    .regex(/^[A-Za-z0-9._-]+$/, {
      message: `${label}ใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง`,
    });

/**
 * จำนวนเงินรับเป็นข้อความ ไม่ใช่ number (ADR 0005) และต้องมากกว่าศูนย์
 *
 * ทิศทางของรายการมาจากชนิด ไม่ใช่จากเครื่องหมายของตัวเลข จำนวนติดลบจึงไม่มี
 * ความหมายที่นี่ และ `> 0` เป็นเงื่อนไขเดียวกับที่ budget_post_movement บังคับ
 */
export const positiveAmountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, {
    message: 'จำนวนเงินต้องเป็นตัวเลขไม่ติดลบ และมีทศนิยมไม่เกิน 2 ตำแหน่ง',
  })
  .refine((value) => Number(value) > 0, { message: 'จำนวนเงินต้องมากกว่าศูนย์' });

// -----------------------------------------------------------------------------
// บัญชีงบ
// -----------------------------------------------------------------------------

/**
 * บัญชีงบต้องผูกกับ scope อย่างน้อยหนึ่งอย่าง
 *
 * ตรงกับ constraint `budget_accounts_scope_required` ในฐานข้อมูล บัญชีที่ไม่ผูก
 * กับอะไรเลยจะไม่มีความหมาย เพราะไม่รู้ว่ากำลังคุมยอดของอะไรอยู่ และรายงาน
 * ตามโครงการหรือตามแหล่งเงินจะรวมยอดไม่ได้
 */
export const budgetAccountSchema = z
  .object({
    code: codeField('รหัสบัญชีงบ'),
    fiscalYearId: z.uuid({ message: 'กรุณาเลือกปีงบประมาณ' }),
    projectId: z.uuid().optional(),
    fundingSourceId: z.uuid().optional(),
    departmentId: z.uuid().optional(),
    note: optionalText(),
  })
  .refine((value) => Boolean(value.projectId ?? value.fundingSourceId ?? value.departmentId), {
    message: 'บัญชีงบต้องผูกกับโครงการ แหล่งเงิน หรือหน่วยงาน อย่างน้อยหนึ่งอย่าง',
    path: ['projectId'],
  });

export type BudgetAccountInput = z.infer<typeof budgetAccountSchema>;

// -----------------------------------------------------------------------------
// การลงรายการด้วยมือ
// -----------------------------------------------------------------------------

/**
 * ชนิดที่ผู้ใช้ลงเองจากหน้าจอได้
 *
 * จงใจไม่ครบทุกชนิดใน MOVEMENT_TYPES:
 *
 *   * `RESERVE` / `RELEASE` / `COMMIT` / `ACTUAL` เป็นผลจากขั้นตอนของรายการจัดซื้อ
 *     ถ้าลงเองได้ ยอดที่กันไว้จะไม่ผูกกับเอกสารใด และการคืนยอดจะไม่มีต้นทางให้อ้าง
 *   * `TRANSFER_IN` / `TRANSFER_OUT` ต้องเกิดเป็นคู่ในทรานแซกชันเดียว จึงต้องผ่าน
 *     budget_transfer เท่านั้น ลงข้างเดียวได้เมื่อใด เงินจะหายหรืองอกจากระบบ
 *   * `REVERSAL` ต้องอ้างแถวต้นทาง จึงมี schema แยกด้านล่าง
 */
export const MANUAL_MOVEMENT_TYPES = ['ALLOCATION', 'INCREASE', 'DECREASE'] as const;

export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export function isManualMovementType(value: MovementType): value is ManualMovementType {
  return (MANUAL_MOVEMENT_TYPES as readonly MovementType[]).includes(value);
}

export const budgetMovementSchema = z.object({
  accountId: z.uuid({ message: 'กรุณาเลือกบัญชีงบ' }),
  type: z.enum(MANUAL_MOVEMENT_TYPES, { message: 'กรุณาเลือกประเภทรายการ' }),
  amount: positiveAmountSchema,
  effectiveDate: businessDateSchema,
  /**
   * เหตุผลไม่บังคับที่ชั้นนี้ แต่ฐานข้อมูลบังคับเมื่อยอดคงเหลือจะติดลบ
   * ตรวจซ้ำที่นี่ไม่ได้ เพราะยอดคงเหลือ ณ เวลาที่กดบันทึกรู้ได้ที่ server เท่านั้น
   */
  reason: optionalText(),
  approvalReference: optionalText(255),
});

export type BudgetMovementInput = z.infer<typeof budgetMovementSchema>;

// -----------------------------------------------------------------------------
// การโอนงบ
// -----------------------------------------------------------------------------

/**
 * โอนงบระหว่างบัญชี — ปิดข้อค้นพบ F-02 (ใช้เงินข้ามโครงการโดยไม่มีเอกสารโอน)
 *
 * เหตุผล **บังคับ** ต่างจากการลงรายการทั่วไป เพราะการโอนงบคือการเปลี่ยนวงเงิน
 * ที่ผู้อนุมัติเคยเห็น ถ้าไม่มีเหตุผลกำกับ การตรวจสอบย้อนหลังจะบอกไม่ได้ว่า
 * ทำไมงบของโครงการหนึ่งจึงไปอยู่อีกโครงการหนึ่ง
 */
export const budgetTransferSchema = z
  .object({
    fromAccountId: z.uuid({ message: 'กรุณาเลือกบัญชีต้นทาง' }),
    toAccountId: z.uuid({ message: 'กรุณาเลือกบัญชีปลายทาง' }),
    amount: positiveAmountSchema,
    effectiveDate: businessDateSchema,
    reason: requiredText('เหตุผลการโอนงบ', 1000),
    approvalReference: optionalText(255),
  })
  .refine((value) => value.fromAccountId !== value.toAccountId, {
    message: 'โอนงบไปบัญชีเดียวกันไม่ได้',
    path: ['toAccountId'],
  });

export type BudgetTransferInput = z.infer<typeof budgetTransferSchema>;

// -----------------------------------------------------------------------------
// การย้อนรายการ
// -----------------------------------------------------------------------------

/**
 * ย้อนรายการที่ลงผิด
 *
 * ledger เป็น append-only การแก้ตัวเลขที่ลงผิดจึงทำด้วยการลงแถวใหม่ที่กลับทิศ
 * ไม่ใช่การ update หรือ delete แถวเดิม ยอดที่แก้ได้โดยไม่มีร่องรอยคือยอดที่
 * ตรวจสอบไม่ได้ (ADR 0008)
 *
 * เหตุผลบังคับเสมอ เพราะแถวที่ย้อนแล้วยังอยู่ในรายงาน ผู้อ่านต้องรู้ว่าทำไม
 */
export const budgetReversalSchema = z.object({
  movementId: z.uuid({ message: 'กรุณาระบุรายการที่ต้องการย้อน' }),
  effectiveDate: businessDateSchema,
  reason: requiredText('เหตุผลการย้อนรายการ', 1000),
});

export type BudgetReversalInput = z.infer<typeof budgetReversalSchema>;

// -----------------------------------------------------------------------------
// การปิดบัญชีงบ
// -----------------------------------------------------------------------------

export const budgetAccountCloseSchema = z.object({
  accountId: z.uuid(),
  reason: requiredText('เหตุผลการปิดบัญชี', 1000),
});

export type BudgetAccountCloseInput = z.infer<typeof budgetAccountCloseSchema>;
