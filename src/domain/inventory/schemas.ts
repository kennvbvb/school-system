/**
 * Zod schema ของรายการพัสดุและการลงรายการเคลื่อนไหวคลัง (ข้อ 10.1)
 *
 * schema เดียวใช้ทั้งฟอร์มและขอบเขต server เช่นเดียวกับ schema อื่นในระบบ
 * ข้อจำกัดที่นี่ต้องตรงกับ constraint ใน migration 0021/0022 เสมอ
 * ฝั่งฐานข้อมูลเป็นชั้นที่บังคับจริง ที่นี่ทำให้ผู้ใช้เห็นปัญหาก่อนกดบันทึก
 */
import { z } from 'zod';
import { businessDateSchema } from '@/domain/master-data/schemas';

const requiredText = (label: string, max = 255) =>
  z
    .string()
    .trim()
    .min(1, { message: `กรุณากรอก${label}` })
    .max(max, { message: `${label}ต้องไม่เกิน ${max} ตัวอักษร` });

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
 * จำนวนรับเป็นข้อความ ไม่ใช่ number (ตามหลักการเดียวกับ ADR 0005 ที่ใช้กับเงิน)
 * ทศนิยมไม่เกิน 3 ตำแหน่ง ตรงกับ numeric(18,3) ของ stock_movements.quantity
 */
export const positiveQuantitySchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,3})?$/, {
    message: 'จำนวนต้องเป็นตัวเลขไม่ติดลบ และมีทศนิยมไม่เกิน 3 ตำแหน่ง',
  })
  .refine((value) => Number(value) > 0, { message: 'จำนวนต้องมากกว่าศูนย์' });

const nonNegativeQuantitySchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,3})?$/, {
    message: 'จำนวนต้องเป็นตัวเลขไม่ติดลบ และมีทศนิยมไม่เกิน 3 ตำแหน่ง',
  });

// -----------------------------------------------------------------------------
// รายการพัสดุ
// -----------------------------------------------------------------------------

export const inventoryItemSchema = z.object({
  code: codeField('รหัสพัสดุ'),
  nameTh: requiredText('ชื่อรายการพัสดุ'),
  itemCategoryId: z.uuid().optional(),
  unitId: z.uuid({ message: 'กรุณาเลือกหน่วยนับ' }),
  locationId: z.uuid().optional(),
  minimumQuantity: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? '0' : value),
    nonNegativeQuantitySchema,
  ),
  note: optionalText(),
});

export type InventoryItemInput = z.infer<typeof inventoryItemSchema>;

// -----------------------------------------------------------------------------
// รับเข้า / รับคืน / ยอดยกมา — ชนิดที่ผู้ถือสิทธิ์ inventory.receive ลงเองได้
//
// จงใจไม่รวม ISSUE และ ADJUSTMENT_* เพราะทั้งสองต้องมีผู้อนุมัติกำกับ
// (ดู stock_movements_issue_requires_actors / _adjustment_requires_reason
// ในฐานข้อมูล) จึงแยก schema และหน้าจอออกจากกันให้ชัดว่าใครอนุมัติอะไร
// -----------------------------------------------------------------------------

export const RECEIVE_MOVEMENT_TYPES = ['OPENING_BALANCE', 'RECEIPT', 'RETURN'] as const;
export type ReceiveMovementType = (typeof RECEIVE_MOVEMENT_TYPES)[number];

export const stockReceiveSchema = z.object({
  itemId: z.uuid({ message: 'กรุณาเลือกรายการพัสดุ' }),
  type: z.enum(RECEIVE_MOVEMENT_TYPES, { message: 'กรุณาเลือกประเภทรายการ' }),
  quantity: positiveQuantitySchema,
  effectiveDate: businessDateSchema,
  reference: requiredText('เลขที่เอกสารอ้างอิง'),
  reason: optionalText(),
});

export type StockReceiveInput = z.infer<typeof stockReceiveSchema>;

// -----------------------------------------------------------------------------
// เบิกจ่าย — ต้องมีทั้งผู้เบิกและผู้อนุมัติเสมอ
// -----------------------------------------------------------------------------

export const stockIssueSchema = z
  .object({
    itemId: z.uuid({ message: 'กรุณาเลือกรายการพัสดุ' }),
    quantity: positiveQuantitySchema,
    effectiveDate: businessDateSchema,
    reference: requiredText('เลขที่ใบเบิก'),
    requestedBy: z.uuid({ message: 'กรุณาเลือกผู้เบิก' }),
    approvedBy: z.uuid({ message: 'กรุณาเลือกผู้อนุมัติ' }),
    reason: optionalText(),
  })
  // แยกหน้าที่: คนขอเบิกอนุมัติใบเบิกของตัวเองไม่ได้ (ฐานข้อมูลตรวจซ้ำใน stock_post_movement)
  .refine((value) => value.requestedBy !== value.approvedBy, {
    path: ['approvedBy'],
    message: 'ผู้เบิกกับผู้อนุมัติต้องเป็นคนละคน',
  });

export type StockIssueInput = z.infer<typeof stockIssueSchema>;

// -----------------------------------------------------------------------------
// ปรับยอด — ต้องมีเหตุผลและผู้อนุมัติเสมอ เพราะเป็นการแก้ยอดที่ไม่มีเอกสารซื้อ/เบิกรองรับ
// -----------------------------------------------------------------------------

export const ADJUSTMENT_MOVEMENT_TYPES = ['ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE'] as const;
export type AdjustmentMovementType = (typeof ADJUSTMENT_MOVEMENT_TYPES)[number];

export const stockAdjustmentSchema = z.object({
  itemId: z.uuid({ message: 'กรุณาเลือกรายการพัสดุ' }),
  type: z.enum(ADJUSTMENT_MOVEMENT_TYPES, { message: 'กรุณาเลือกทิศทางการปรับยอด' }),
  quantity: positiveQuantitySchema,
  effectiveDate: businessDateSchema,
  reference: requiredText('เลขที่บันทึกปรับยอด'),
  reason: requiredText('เหตุผลการปรับยอด', 1000),
  approvedBy: z.uuid({ message: 'กรุณาเลือกผู้อนุมัติ' }),
});

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

// -----------------------------------------------------------------------------
// ย้อนรายการ
// -----------------------------------------------------------------------------

export const stockReversalSchema = z.object({
  movementId: z.uuid({ message: 'กรุณาระบุรายการที่ต้องการย้อน' }),
  effectiveDate: businessDateSchema,
  reason: requiredText('เหตุผลการย้อนรายการ', 1000),
});

export type StockReversalInput = z.infer<typeof stockReversalSchema>;
