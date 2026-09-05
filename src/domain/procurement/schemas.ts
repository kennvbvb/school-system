/**
 * Zod schema ของรายการจัดซื้อจัดจ้าง (ข้อ 10.1)
 *
 * schema เดียวใช้ทั้งฟอร์มและขอบเขต server ฟอร์มจึงได้ข้อความ error ภาษาไทย
 * ชุดเดียวกับที่ server ใช้ปฏิเสธ ไม่มีกรณีที่ฟอร์มยอมแต่ server ปฏิเสธด้วยเหตุผลอื่น
 *
 * ข้อจำกัดที่นี่ต้องตรงกับ constraint ใน migration 0007 เสมอ
 * ฝั่งฐานข้อมูลเป็นชั้นที่บังคับจริง ที่นี่ทำให้ผู้ใช้เห็นปัญหาก่อนกดบันทึก
 *
 * **ยอดเงินไม่อยู่ใน schema นี้โดยเจตนา** — ยอดคำนวณจากรายการย่อยที่ server
 * เสมอ ถ้ารับยอดรวมจาก client ก็เท่ากับเปิดช่องให้ส่งยอดที่ไม่ตรงกับรายการ
 */
import { z } from 'zod';
import { businessDateSchema } from '@/domain/master-data/schemas';

const requiredText = (label: string, max = 255) =>
  z
    .string()
    .trim()
    .min(1, { message: `กรุณากรอก${label}` })
    .max(max, { message: `${label}ต้องไม่เกิน ${max} ตัวอักษร` });

/*
 * ช่องที่ไม่บังคับ
 *
 * ใช้ preprocess แทน transform เพราะ transform ทำให้ key กลายเป็น "บังคับแต่เป็น
 * undefined ได้" ในชนิดผลลัพธ์ ผู้เรียกจึงต้องเขียน note: undefined ทุกครั้ง
 * ทั้งที่ตั้งใจให้ละไว้ได้
 */
const optionalText = (max = 1000) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional(),
  );

/**
 * ตัวเลขรับเป็นข้อความ ไม่ใช่ number (ADR 0005)
 *
 * number ทำให้ค่าผ่าน floating point ตั้งแต่ตอน parse JSON
 * เช่น 0.1 + 0.2 ที่ไม่เท่ากับ 0.3 ข้อความจะถูกแปลงเป็น BigInt ที่ชั้นโดเมน
 */
const decimalString = (label: string, maxDecimals: number) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d+(\\.\\d{1,${maxDecimals}})?$`), {
      message: `${label}ต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน ${maxDecimals} ตำแหน่ง`,
    });

export const TAX_MODES = ['INCLUSIVE', 'EXCLUSIVE', 'EXEMPT'] as const;
export type TaxModeCode = (typeof TAX_MODES)[number];

export const TAX_MODE_LABELS_TH: Readonly<Record<TaxModeCode, string>> = {
  INCLUSIVE: 'ราคารวมภาษีแล้ว',
  EXCLUSIVE: 'ราคายังไม่รวมภาษี',
  EXEMPT: 'ไม่มีภาษี',
};

// -----------------------------------------------------------------------------
// รายการย่อย
// -----------------------------------------------------------------------------

export const procurementItemSchema = z
  .object({
    lineNo: z.number().int().min(1, { message: 'เลขบรรทัดต้องเริ่มที่ 1' }),
    description: requiredText('รายละเอียดพัสดุ'),
    quantity: decimalString('จำนวน', 4).refine((value) => Number(value) > 0, {
      message: 'จำนวนต้องมากกว่าศูนย์',
    }),
    unitId: z.uuid().optional(),
    unitPrice: decimalString('ราคาต่อหน่วย', 4),
    discountAmount: decimalString('ส่วนลด', 2).default('0'),
    taxRate: decimalString('อัตราภาษี', 4)
      .refine((value) => Number(value) <= 100, { message: 'อัตราภาษีต้องไม่เกิน 100' })
      .default('0'),
    itemCategoryId: z.uuid().optional(),
  })
  /*
   * ส่วนลดเกินมูลค่าบรรทัดทำให้ยอดติดลบ ซึ่งไม่มีความหมายทางบัญชี
   * ตรวจที่นี่ด้วยแม้ฐานข้อมูลจะมี check constraint อยู่แล้ว
   * เพราะผู้ใช้ควรเห็นปัญหาที่ช่องกรอก ไม่ใช่เห็นเป็น error ตอนกดบันทึก
   */
  .refine((item) => Number(item.discountAmount) <= Number(item.quantity) * Number(item.unitPrice), {
    message: 'ส่วนลดต้องไม่เกินมูลค่าของบรรทัดนี้',
    path: ['discountAmount'],
  });

export type ProcurementItemInput = z.infer<typeof procurementItemSchema>;

// -----------------------------------------------------------------------------
// แหล่งเงิน (F-02)
// -----------------------------------------------------------------------------

export const fundingAllocationSchema = z.object({
  lineNo: z.number().int().min(1),
  budgetAccountId: z.uuid({ message: 'กรุณาเลือกบัญชีงบประมาณ' }),
  amount: decimalString('จำนวนเงิน', 2).refine((value) => Number(value) > 0, {
    message: 'จำนวนเงินต้องมากกว่าศูนย์',
  }),
  note: optionalText(255),
});

export type FundingAllocationInput = z.infer<typeof fundingAllocationSchema>;

// -----------------------------------------------------------------------------
// รายการจัดซื้อ (ขั้น draft)
// -----------------------------------------------------------------------------

/**
 * schema ของการบันทึกฉบับร่าง
 *
 * ตั้งใจให้ผ่อนปรน: ฉบับร่างต้องบันทึกค้างไว้ได้แม้ข้อมูลยังไม่ครบ (แผนข้อ 7.2)
 * การตรวจความครบถ้วนสำหรับการส่งอนุมัติอยู่ที่ PR-03 ซึ่งเป็นคนละชุดกฎ
 * ถ้าบังคับครบตั้งแต่ตอนร่าง ผู้ใช้จะกรอกค้างไว้ไม่ได้เลย
 */
export const procurementDraftSchema = z.object({
  subject: requiredText('ชื่อเรื่อง'),
  purpose: optionalText(),
  taxMode: z.enum(TAX_MODES, { message: 'กรุณาเลือกวิธีคิดภาษี' }).default('EXEMPT'),
  fiscalYearId: z.uuid({ message: 'กรุณาเลือกปีงบประมาณ' }),
  departmentId: z.uuid().optional(),
  vendorId: z.uuid().optional(),
  requestDate: businessDateSchema,
  requiredDate: businessDateSchema.optional(),
  note: optionalText(),
  items: z.array(procurementItemSchema).default([]),
  fundingAllocations: z.array(fundingAllocationSchema).default([]),
});

export type ProcurementDraftInput = z.infer<typeof procurementDraftSchema>;

/**
 * เวอร์ชันสำหรับการแก้ไข — ต้องส่ง version ที่อ่านมาด้วยเสมอ
 *
 * ถ้าไม่บังคับ ผู้เรียกที่ลืมส่งจะเขียนทับงานของคนอื่นเงียบ ๆ
 * ซึ่งแย่กว่าการได้ error ที่บอกให้โหลดใหม่
 */
export const procurementUpdateSchema = procurementDraftSchema.extend({
  id: z.uuid(),
  expectedVersion: z.number().int().min(1, { message: 'ไม่พบเวอร์ชันของรายการที่กำลังแก้' }),
});

export type ProcurementUpdateInput = z.infer<typeof procurementUpdateSchema>;
