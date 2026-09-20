/**
 * Zod schema ของตัวกรองทะเบียนจัดซื้อจัดจ้าง (ข้อ 10.1)
 *
 * เหตุผลเดียวกับ src/domain/budget/report-schemas.ts — ค่าทั้งหมดมาจาก query
 * string ซึ่งผู้ใช้แก้ในแถบที่อยู่เองได้ schema นี้จึงแปลงค่าที่พิมพ์มั่วให้เป็น
 * ค่าเริ่มต้นที่ปลอดภัยแทนที่จะทำให้ทั้งหน้าล้ม
 *
 * **ค่าเริ่มต้นของทุกช่องคือ "ไม่กรอง"** ทะเบียนที่ซ่อนแถวไว้เป็นค่าเริ่มต้น
 * จะทำให้ยอดรวมน้อยกว่าความจริงโดยที่หน้าจอดูปกติทุกอย่าง ซึ่งเป็นความผิดพลาด
 * ที่อันตรายที่สุดของรายงาน
 */
import { z } from 'zod';
import { PROCUREMENT_STATUSES } from './status';
import { PROCUREMENT_CLASSIFICATIONS } from './schemas';

const optionalUuid = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.uuid().optional().catch(undefined),
);

const optionalDate = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.iso.date().optional().catch(undefined),
);

export const procurementRegisterFilterSchema = z.object({
  fiscalYearId: optionalUuid,
  /** undefined = ทุกประเภท — ทะเบียนซื้อและทะเบียนจ้างอยู่ในเล่มเดียวกันได้ */
  classification: z.enum(PROCUREMENT_CLASSIFICATIONS).optional().catch(undefined),
  /** undefined = ทุกสถานะ รวมฉบับร่าง รายการที่ไม่อนุมัติ และที่ยกเลิก */
  status: z.enum(PROCUREMENT_STATUSES).optional().catch(undefined),
  /**
   * ช่วง "วันที่ขอ" ไม่ใช่วันที่ออกใบสั่งซื้อ
   *
   * วันที่ขอเป็นช่องเดียวที่ทุกแถวมีเสมอ (not null ตั้งแต่ migration 0007)
   * การกรองด้วยวันที่ออกใบสั่งซื้อจะทำให้รายการที่ยังไม่ออกใบสั่งซื้อหายไป
   * จากทะเบียนทั้งหมด ซึ่งเป็นรายการที่ผู้ตรวจอยากเห็นมากที่สุด
   *
   * โรงเรียนอาจต้องการกรองด้วยวันที่อื่น — บันทึกไว้เป็นคำถาม Q34
   */
  dateFrom: optionalDate,
  dateTo: optionalDate,
});

export type ProcurementRegisterFilter = z.infer<typeof procurementRegisterFilterSchema>;

/** อ่านตัวกรองจาก searchParams ของ Next.js ซึ่งค่าอาจเป็น array ได้ */
export function parseProcurementRegisterFilter(
  params: Record<string, string | string[] | undefined>,
): ProcurementRegisterFilter {
  const first = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  return procurementRegisterFilterSchema.parse({
    fiscalYearId: first('fiscalYearId'),
    classification: first('classification'),
    status: first('status'),
    dateFrom: first('dateFrom'),
    dateTo: first('dateTo'),
  });
}

/** ตัวกรองนี้แคบกว่า "ดูทั้งหมด" หรือไม่ — ใช้ตัดสินว่าจะแสดงปุ่มล้างตัวกรอง */
export function hasActiveRegisterFilter(filter: ProcurementRegisterFilter): boolean {
  return (
    filter.fiscalYearId !== undefined ||
    filter.classification !== undefined ||
    filter.status !== undefined ||
    filter.dateFrom !== undefined ||
    filter.dateTo !== undefined
  );
}

/**
 * ช่วงวันที่กลับด้านหรือไม่ (เริ่มหลังสิ้นสุด)
 *
 * ไม่แก้ให้อัตโนมัติด้วยการสลับค่า เพราะผู้ใช้จะได้ผลลัพธ์ของช่วงที่ตัวเองไม่ได้ขอ
 * โดยไม่รู้ตัว และไม่ปล่อยให้เงียบ เพราะผลลัพธ์ที่ได้คือศูนย์แถวซึ่งอ่านได้ว่า
 * "ช่วงนี้โรงเรียนไม่ได้จัดซื้ออะไรเลย" — คำตอบที่ผิดและน่าเชื่อ
 */
export function hasReversedDateRange(filter: ProcurementRegisterFilter): boolean {
  if (filter.dateFrom === undefined || filter.dateTo === undefined) return false;
  return filter.dateFrom > filter.dateTo;
}
