/**
 * Zod schema ของข้อมูลพื้นฐาน (ข้อ 10.1 "Zod schema ใช้ร่วมระหว่าง form และ server boundary")
 *
 * schema เดียวใช้ทั้งสองฝั่งโดยเจตนา ฟอร์มได้ข้อความ error ภาษาไทยชุดเดียวกับ
 * ที่ server ใช้ปฏิเสธ ทำให้ไม่มีกรณีที่ฟอร์มยอมแต่ server ปฏิเสธด้วยเหตุผลอื่น
 *
 * ข้อจำกัดที่นี่ต้องตรงกับ constraint ในฐานข้อมูล (migration 0003) เสมอ
 * ฝั่งฐานข้อมูลเป็นชั้นที่บังคับจริง ส่วนที่นี่ทำให้ผู้ใช้เห็นปัญหาก่อนกดบันทึก
 */
import { z } from 'zod';

/** ข้อความ error ที่ผู้ใช้อ่านแล้วรู้ว่าต้องแก้อะไร ไม่ใช่ศัพท์เทคนิค */
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
 * undefined ได้" ในชนิดผลลัพธ์ ผู้เรียกจึงต้องระบุทุกช่องแม้ตั้งใจละไว้
 */
const optionalText = (max = 255) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional(),
  );

/** รหัสอ้างอิงใช้ในเลขเอกสารและการค้นหา จึงจำกัดให้เป็นอักขระที่ปลอดภัย */
const codeField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, { message: `กรุณากรอก${label}` })
    .max(32, { message: `${label}ต้องไม่เกิน 32 ตัวอักษร` })
    .regex(/^[A-Za-z0-9._-]+$/, {
      message: `${label}ใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง`,
    });

/** เลขประจำตัวผู้เสียภาษีไทยเป็นตัวเลข 13 หลัก ตรงกับ constraint ในฐานข้อมูล */
export const thaiTaxIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{13}$/, { message: 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก' });

/**
 * วันที่ทางธุรกิจในรูป YYYY-MM-DD ตรงกับคอลัมน์ชนิด date
 *
 * ตรวจด้วยการแปลงกลับไปกลับมา ไม่ใช่แค่ `!Number.isNaN(Date.parse(...))`
 * เพราะ Date.parse ปัดวันที่ที่ไม่มีจริงให้เงียบ ๆ แทนที่จะปฏิเสธ:
 *   Date.parse('2026-02-30T00:00:00Z') -> วันที่ 2 มีนาคม 2026
 * ถ้าไม่ตรวจแบบนี้ ผู้ใช้ที่พิมพ์ "30 กุมภาพันธ์" จะได้วันที่อื่นโดยไม่รู้ตัว
 */
export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD' })
  .refine(
    (value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    },
    { message: 'ไม่มีวันที่นี้อยู่จริงในปฏิทิน' },
  );

/**
 * อีเมลถูกบังคับเป็นตัวพิมพ์เล็กด้วย check constraint ในฐานข้อมูล
 * จึงแปลงให้ตรงกันตั้งแต่ขอบเขตนี้ แทนที่จะปล่อยให้ insert ล้มภายหลัง
 */
const emailField = z
  .email({ message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  .transform((value) => value.toLowerCase())
  .optional();

// -----------------------------------------------------------------------------
// ข้อมูลโรงเรียน (FR-MST-001)
// -----------------------------------------------------------------------------

export const schoolSettingsSchema = z
  .object({
    nameTh: requiredText('ชื่อโรงเรียน'),
    nameEn: optionalText(),
    addressTh: requiredText('ที่อยู่', 1000),
    phone: optionalText(32),
    email: emailField,
    taxId: thaiTaxIdSchema.optional(),
    logoPath: optionalText(500),
    effectiveFrom: businessDateSchema,
    effectiveTo: businessDateSchema.optional(),
  })
  .refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
    message: 'วันสิ้นสุดต้องไม่มาก่อนวันเริ่มมีผล',
    path: ['effectiveTo'],
  });

export type SchoolSettingsInput = z.infer<typeof schoolSettingsSchema>;

// -----------------------------------------------------------------------------
// ปีงบประมาณ (FR-MST-002)
// -----------------------------------------------------------------------------

export const fiscalYearSchema = z
  .object({
    code: codeField('รหัสปีงบประมาณ'),
    yearBE: z
      .number()
      .int({ message: 'ปีงบประมาณต้องเป็นจำนวนเต็ม' })
      .min(2500, { message: 'ปีงบประมาณต้องเป็นปีพุทธศักราช เช่น 2569' })
      .max(2700, { message: 'ปีงบประมาณเกินช่วงที่ระบบรองรับ' }),
    startDate: businessDateSchema,
    endDate: businessDateSchema,
  })
  .refine((value) => value.endDate > value.startDate, {
    message: 'วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น',
    path: ['endDate'],
  });

export type FiscalYearInput = z.infer<typeof fiscalYearSchema>;

// -----------------------------------------------------------------------------
// ผู้ขาย (FR-MST-005)
// -----------------------------------------------------------------------------

export const vendorSchema = z.object({
  vendorCode: codeField('รหัสผู้ขาย'),
  name: requiredText('ชื่อผู้ขาย'),
  taxId: thaiTaxIdSchema.optional(),
  branchNo: z
    .string()
    .trim()
    .regex(/^[0-9]{1,5}$/, { message: 'รหัสสาขาต้องเป็นตัวเลขไม่เกิน 5 หลัก' })
    .optional(),
  address: optionalText(1000),
  contactName: optionalText(),
  phone: optionalText(32),
  email: emailField,
  note: optionalText(1000),
  isActive: z.boolean().default(true),
});

export type VendorInput = z.infer<typeof vendorSchema>;

// -----------------------------------------------------------------------------
// โครงการและแหล่งเงิน (FR-MST-006)
// -----------------------------------------------------------------------------

export const fundingSourceSchema = z.object({
  code: codeField('รหัสแหล่งเงิน'),
  nameTh: requiredText('ชื่อแหล่งเงิน'),
  description: optionalText(1000),
  isActive: z.boolean().default(true),
});

export type FundingSourceInput = z.infer<typeof fundingSourceSchema>;

/**
 * วงเงินรับเป็นข้อความ ไม่ใช่ number โดยเจตนา (ADR 0005)
 *
 * number ทำให้ค่าผ่าน floating point ตั้งแต่ตอน parse JSON
 * ข้อความจะถูกแปลงเป็น BigInt หน่วยสตางค์ด้วย decimalStringToSatang()
 * ที่ชั้น repository โดยไม่เสียความแม่นยำ
 */
export const budgetAmountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, {
    message: 'วงเงินต้องเป็นตัวเลขไม่ติดลบ และมีทศนิยมไม่เกิน 2 ตำแหน่ง',
  });

export const projectSchema = z.object({
  code: codeField('รหัสโครงการ'),
  nameTh: requiredText('ชื่อโครงการ'),
  fiscalYearId: z.uuid({ message: 'กรุณาเลือกปีงบประมาณ' }),
  departmentId: z.uuid().optional(),
  fundingSourceId: z.uuid().optional(),
  budgetAmount: budgetAmountSchema.default('0'),
  description: optionalText(1000),
  isActive: z.boolean().default(true),
});

export type ProjectInput = z.infer<typeof projectSchema>;

// -----------------------------------------------------------------------------
// หน่วยนับ สถานที่ และหมวดพัสดุ (FR-MST-003, FR-MST-007)
// -----------------------------------------------------------------------------

export const unitSchema = z.object({
  code: codeField('รหัสหน่วยนับ'),
  nameTh: requiredText('ชื่อหน่วยนับ', 64),
  isActive: z.boolean().default(true),
});

export type UnitInput = z.infer<typeof unitSchema>;

export const locationSchema = z.object({
  code: codeField('รหัสสถานที่'),
  nameTh: requiredText('ชื่อสถานที่'),
  departmentId: z.uuid().optional(),
  building: optionalText(128),
  room: optionalText(64),
  isActive: z.boolean().default(true),
});

export type LocationInput = z.infer<typeof locationSchema>;

export const ITEM_KINDS = ['SUPPLY', 'ASSET'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_KIND_LABELS_TH: Readonly<Record<ItemKind, string>> = {
  SUPPLY: 'วัสดุ',
  ASSET: 'ครุภัณฑ์',
};

export const itemCategorySchema = z.object({
  code: codeField('รหัสหมวด'),
  nameTh: requiredText('ชื่อหมวด'),
  kind: z.enum(ITEM_KINDS, { message: 'กรุณาเลือกประเภท (วัสดุ หรือ ครุภัณฑ์)' }),
  parentId: z.uuid().optional(),
  defaultUnitId: z.uuid().optional(),
  isActive: z.boolean().default(true),
});

export type ItemCategoryInput = z.infer<typeof itemCategorySchema>;

// -----------------------------------------------------------------------------
// การปิดและเปิดปีงบประมาณใหม่
// -----------------------------------------------------------------------------

/**
 * การปิดปีงบประมาณเป็นเหตุการณ์ทางธุรการ ไม่ใช่การแก้ค่าในตาราง
 *
 * เหตุผลบังคับทั้งตอนปิดและตอนเปิดใหม่ เพราะทั้งสองอย่างเปลี่ยนว่าใครบันทึก
 * รายการอะไรได้บ้าง การเปิดปีที่ปิดไปแล้วกลับมาโดยไม่มีเหตุผลกำกับ ทำให้
 * ผู้ตรวจสอบแยกไม่ออกระหว่าง "ปิดผิดแล้วแก้" กับ "เปิดกลับมาเพื่อแก้ตัวเลข"
 */
export const fiscalYearStatusChangeSchema = z.object({
  fiscalYearId: z.uuid(),
  reason: requiredText('เหตุผล', 1000),
});

export type FiscalYearStatusChangeInput = z.infer<typeof fiscalYearStatusChangeSchema>;
