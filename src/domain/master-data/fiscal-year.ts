/**
 * โดเมนปีงบประมาณ (FR-MST-002, ข้อ 9.3)
 *
 * กติกาสำคัญที่สุดของไฟล์นี้:
 *
 *   ปีงบประมาณที่ "มีผลจริง" มาจาก record ในตาราง fiscal_years เสมอ
 *   ไม่ใช่จากการคำนวณ year + 543 หรือการเดาว่าปีงบประมาณเริ่ม 1 ตุลาคม
 *
 * `suggestFiscalYearBE()` ใน src/lib/format/thai-date.ts เป็นเพียงค่าเสนอแนะ
 * ตอนกรอกฟอร์ม ส่วนฟังก์ชันในไฟล์นี้ตัดสินจากข้อมูลจริงที่โรงเรียนบันทึกไว้
 *
 * เหตุผล: วันเริ่ม-สิ้นสุดปีงบประมาณของแต่ละโรงเรียนอาจไม่ตรงกัน และคำถาม Q6
 * ใน docs/assumptions.md ยังไม่ได้คำตอบ การอ่านจาก record ทำให้คำตอบนั้น
 * เปลี่ยนได้ด้วยการแก้ข้อมูล ไม่ต้องแก้โค้ดหรือ schema
 */
import { toBangkokDateString } from '@/lib/format/thai-date';

export type FiscalYearStatus = 'OPEN' | 'CLOSED';

export interface FiscalYear {
  id: string;
  code: string;
  yearBE: number;
  /** วันที่ในรูป YYYY-MM-DD ตามเวลาไทย (คอลัมน์ชนิด date ไม่มีเขตเวลา) */
  startDate: string;
  endDate: string;
  status: FiscalYearStatus;
}

export class FiscalYearError extends Error {
  readonly code: 'NOT_FOUND' | 'CLOSED' | 'INVALID_RANGE' | 'OVERLAPPING' | 'DUPLICATE_YEAR';

  constructor(code: FiscalYearError['code'], message: string) {
    super(message);
    this.name = 'FiscalYearError';
    this.code = code;
  }
}

/** ตรวจว่าวันที่อยู่ในช่วงของปีงบประมาณหรือไม่ (รวมวันเริ่มและวันสิ้นสุด) */
export function coversDate(fiscalYear: FiscalYear, businessDate: string): boolean {
  return businessDate >= fiscalYear.startDate && businessDate <= fiscalYear.endDate;
}

/**
 * หาปีงบประมาณจากวันที่ทางธุรกิจ
 *
 * รับ Date แล้วแปลงเป็นวันที่ตามเวลาไทยก่อนเทียบเสมอ เพราะรายการที่บันทึก
 * ตอน 23:30 ของวันที่ 30 กันยายน เวลาไทย ต้องอยู่ในปีงบประมาณเดิม
 * ไม่ใช่ปีถัดไปตามเวลา UTC
 */
export function findFiscalYearForDate(
  fiscalYears: readonly FiscalYear[],
  date: Date,
): FiscalYear | undefined {
  const businessDate = toBangkokDateString(date);
  return fiscalYears.find((fiscalYear) => coversDate(fiscalYear, businessDate));
}

/**
 * หาปีงบประมาณที่ใช้บันทึกรายการได้ ณ วันที่ที่ระบุ
 *
 * ปีงบประมาณที่ปิดแล้วห้ามบันทึกรายการใหม่ (ข้อ 7.3 "วันที่ต้องอยู่ในปีงบประมาณ
 * ที่เปิดอยู่ หรือผู้มีสิทธิ์ override")
 *
 * @param allowClosed ผู้มีสิทธิ์ override สามารถบันทึกย้อนหลังในปีที่ปิดแล้วได้
 *   ผู้เรียกต้องตรวจสิทธิ์มาก่อนแล้ว และต้องบันทึก audit event พร้อมเหตุผล
 */
export function requireFiscalYearForDate(
  fiscalYears: readonly FiscalYear[],
  date: Date,
  options: { allowClosed?: boolean } = {},
): FiscalYear {
  const found = findFiscalYearForDate(fiscalYears, date);

  if (!found) {
    throw new FiscalYearError(
      'NOT_FOUND',
      `ไม่พบปีงบประมาณที่ครอบคลุมวันที่ ${toBangkokDateString(date)} — กรุณาให้ผู้ดูแลระบบเพิ่มปีงบประมาณก่อน`,
    );
  }

  if (found.status === 'CLOSED' && !options.allowClosed) {
    throw new FiscalYearError(
      'CLOSED',
      `ปีงบประมาณ ${found.yearBE} ปิดแล้ว ไม่สามารถบันทึกรายการใหม่ได้`,
    );
  }

  return found;
}

export interface FiscalYearDraft {
  yearBE: number;
  startDate: string;
  endDate: string;
}

/**
 * ตรวจความถูกต้องของปีงบประมาณก่อนบันทึก
 *
 * ฐานข้อมูลมี exclude constraint กันช่วงเวลาทับกันอยู่แล้ว แต่การตรวจที่นี่
 * ให้ข้อความภาษาไทยที่ผู้ใช้แก้ได้ แทนที่จะได้ error ดิบจาก PostgreSQL
 * ทั้งสองชั้นจำเป็น: ชั้นนี้เพื่อ UX ชั้นฐานข้อมูลเพื่อความถูกต้องเมื่อมีการเขียนพร้อมกัน
 *
 * @param existing ปีงบประมาณที่มีอยู่แล้ว ไม่รวมแถวที่กำลังแก้ไข
 */
export function assertFiscalYearValid(
  draft: FiscalYearDraft,
  existing: readonly FiscalYear[],
): void {
  if (draft.endDate <= draft.startDate) {
    throw new FiscalYearError('INVALID_RANGE', 'วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น');
  }

  if (!Number.isInteger(draft.yearBE) || draft.yearBE < 2500 || draft.yearBE > 2700) {
    throw new FiscalYearError(
      'INVALID_RANGE',
      'ปีงบประมาณต้องเป็นปีพุทธศักราชระหว่าง 2500 ถึง 2700 — ตรวจว่าไม่ได้กรอกปี ค.ศ.',
    );
  }

  const duplicate = existing.find((item) => item.yearBE === draft.yearBE);
  if (duplicate) {
    throw new FiscalYearError('DUPLICATE_YEAR', `มีปีงบประมาณ ${draft.yearBE} อยู่แล้ว`);
  }

  const overlapping = existing.find(
    (item) => draft.startDate <= item.endDate && draft.endDate >= item.startDate,
  );
  if (overlapping) {
    throw new FiscalYearError(
      'OVERLAPPING',
      `ช่วงวันที่ทับกับปีงบประมาณ ${overlapping.yearBE} (${overlapping.startDate} ถึง ${overlapping.endDate})`,
    );
  }
}
