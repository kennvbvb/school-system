/**
 * Zod schema ของตัวกรองรายงานงบประมาณ (ข้อ 10.1)
 *
 * ค่าทั้งหมดมาจาก query string จึงเป็น string หรือ undefined เสมอ และผู้ใช้
 * แก้ในแถบที่อยู่เองได้ schema นี้จึงเป็นด่านที่แปลงค่าที่พิมพ์มั่วให้เป็น
 * ค่าเริ่มต้นที่ปลอดภัย แทนที่จะทำให้ทั้งหน้าล้ม — ผู้ที่เจอหน้า error
 * จากการแก้ URL เองจะไม่รู้ว่าต้องแก้อะไรกลับ
 */
import { z } from 'zod';
import { BUDGET_REPORT_DIMENSIONS } from './report';

const optionalUuid = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.uuid().optional().catch(undefined),
);

const optionalDate = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.iso.date().optional().catch(undefined),
);

export const budgetReportFilterSchema = z.object({
  /** undefined = ทุกปีงบ ซึ่งเป็นค่าที่ไม่ซ่อนข้อมูลใดไว้ */
  fiscalYearId: optionalUuid,
  dimension: z.enum(BUDGET_REPORT_DIMENSIONS).catch('PROJECT'),
  /**
   * ยอด ณ สิ้นวันที่ระบุ — นับเฉพาะรายการที่มีผลไม่เกินวันนี้
   *
   * undefined = นับทุกรายการ ซึ่งตรงกับยอดในหน้าบัญชีงบ
   */
  asOf: optionalDate,
  /**
   * true = แสดงเฉพาะบัญชีที่ยังเปิดอยู่
   *
   * ค่าเริ่มต้นคือ false โดยตั้งใจ — บัญชีที่ปิดแล้วยังถือยอดที่ใช้ไปของปีนั้น
   * การซ่อนไว้เป็นค่าเริ่มต้นทำให้ยอดรวมน้อยกว่าความจริงโดยที่หน้าจอดูปกติ
   */
  /*
   * ไม่มี .catch() ที่นี่ต่างจากช่องอื่น เพราะ preprocess คืน boolean เสมอ
   * z.boolean() จึงไม่มีทางล้ม — .catch() ที่เขียนไว้จะเป็นโค้ดที่ไม่มีวันทำงาน
   * และทำให้ผู้อ่านเข้าใจว่ามีตาข่ายรองรับอยู่ทั้งที่ไม่มี
   *
   * ค่าที่ปลอดภัยมาจากตัว preprocess เอง: ทุกอย่างที่ไม่ใช่ '1' หรือ 'true'
   * แปลว่าไม่ได้เลือก จึงไม่ซ่อนบัญชีใดไว้
   */
  onlyOpen: z.preprocess((value) => value === '1' || value === 'true', z.boolean()),
});

export type BudgetReportFilter = z.infer<typeof budgetReportFilterSchema>;

/** อ่านตัวกรองจาก searchParams ของ Next.js ซึ่งค่าอาจเป็น array ได้ */
export function parseBudgetReportFilter(
  params: Record<string, string | string[] | undefined>,
): BudgetReportFilter {
  const first = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  return budgetReportFilterSchema.parse({
    fiscalYearId: first('fiscalYearId'),
    dimension: first('dimension'),
    asOf: first('asOf'),
    onlyOpen: first('onlyOpen'),
  });
}

/**
 * ตัวกรองนี้แคบกว่า "ดูทั้งหมด" หรือไม่
 *
 * ใช้ตัดสินว่าจะแสดงปุ่มล้างตัวกรอง มิติที่เลือกไม่นับเป็นการกรอง
 * เพราะเปลี่ยนวิธีจัดกลุ่มเท่านั้น ไม่ได้ตัดข้อมูลออกจากยอดรวม
 */
export function hasActiveBudgetReportFilter(filter: BudgetReportFilter): boolean {
  return filter.fiscalYearId !== undefined || filter.asOf !== undefined || filter.onlyOpen === true;
}
