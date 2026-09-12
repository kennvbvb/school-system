/**
 * การเบิกจ่าย — แปลงยอดที่กันไว้ให้เป็นค่าใช้จ่ายจริง (ข้อ 6.1, F-01)
 *
 * ก่อนมีขั้นตอนนี้ การอนุมัติจะกันยอด (`RESERVE`) ไว้แล้วไม่มีอะไรมาปลด ยอดที่กันไว้
 * จึงค้างตลอดไป และงบที่ใช้ได้จะต่ำกว่าความจริงเรื่อย ๆ จนโรงเรียนเลิกเชื่อตัวเลข
 *
 * การเบิกจ่ายหนึ่งครั้งทำสองอย่าง **ในทรานแซกชันเดียวกันเสมอ**
 *
 *   1. คืนยอดที่กันไว้ (`RELEASE`) ตามจำนวนที่จ่าย
 *   2. ลงค่าใช้จ่ายจริง (`ACTUAL`) จำนวนเดียวกัน
 *
 * ถ้าแยกกันทำ จะมีช่วงเวลาที่ยอดถูกนับซ้ำหรือหายไปทั้งก้อน
 *
 * ไฟล์นี้เป็นตรรกะบริสุทธิ์ ห้าม import Supabase หรือ Next.js
 * กติกาเดียวกันถูกบังคับซ้ำที่ฐานข้อมูล — ดู migration 0019 และ
 * `tests/unit/disbursement.test.ts` ที่อ่าน SQL จริงมาเทียบ
 */
import type { ProcurementStatus } from './status';

/**
 * สถานะที่เบิกจ่ายได้
 *
 * จ่ายเงินได้เมื่อรับของแล้วเท่านั้น ไม่ว่าจะรับครบหรือรับบางส่วน — การจ่ายก่อนรับของ
 * เป็นความเสี่ยงที่ระบบไม่ควรเปิดทางให้โดยปริยาย
 *
 * **ยังไม่ครอบคลุมงานจ้างเหมาบริการ** ที่อาจจ่ายตามงวดโดยไม่มีการ "รับของ"
 * เป็นคำถาม Q31 ใน docs/assumptions.md ที่โรงเรียนต้องตอบก่อนใช้งานจริง
 */
export const STATUSES_ALLOWING_DISBURSEMENT: readonly ProcurementStatus[] = [
  'PARTIALLY_RECEIVED',
  'RECEIVED',
];

export function statusAllowsDisbursement(status: ProcurementStatus): boolean {
  return STATUSES_ALLOWING_DISBURSEMENT.includes(status);
}

export type DisbursementRejection =
  'STATUS_NOT_ALLOWED' | 'AMOUNT_NOT_POSITIVE' | 'NOTHING_RESERVED' | 'EXCEEDS_RESERVED';

export const DISBURSEMENT_MESSAGES_TH: Record<DisbursementRejection, string> = {
  STATUS_NOT_ALLOWED: 'เบิกจ่ายได้เมื่อรับของแล้วเท่านั้น',
  AMOUNT_NOT_POSITIVE: 'จำนวนเงินที่เบิกจ่ายต้องมากกว่าศูนย์',
  NOTHING_RESERVED: 'รายการนี้ไม่มียอดที่กันไว้เหลือให้เบิกจ่าย',
  EXCEEDS_RESERVED:
    'เบิกจ่ายเกินยอดที่กันไว้ไม่ได้ ถ้าราคาจริงสูงกว่าที่อนุมัติ ต้องขออนุมัติเพิ่มก่อน',
};

/** ยอดที่ยังกันไว้ของบัญชีงบหนึ่ง ภายใต้รายการจัดซื้อหนึ่ง */
export interface OutstandingReserve {
  budgetAccountId: string;
  amountSatang: bigint;
}

export interface DisbursementLine {
  budgetAccountId: string;
  amountSatang: bigint;
}

export function checkDisbursement(input: {
  status: ProcurementStatus;
  amountSatang: bigint;
  outstanding: readonly OutstandingReserve[];
}): DisbursementRejection | null {
  if (!statusAllowsDisbursement(input.status)) return 'STATUS_NOT_ALLOWED';
  if (input.amountSatang <= 0n) return 'AMOUNT_NOT_POSITIVE';

  const total = totalOutstanding(input.outstanding);
  if (total <= 0n) return 'NOTHING_RESERVED';
  if (input.amountSatang > total) return 'EXCEEDS_RESERVED';

  return null;
}

export function totalOutstanding(outstanding: readonly OutstandingReserve[]): bigint {
  return outstanding.reduce((sum, row) => sum + row.amountSatang, 0n);
}

/**
 * แบ่งยอดที่จ่ายไปตามบัญชีงบ ตามสัดส่วนของยอดที่ยังกันไว้
 *
 * **ทำไมต้องแบ่งเอง ไม่ให้ผู้ใช้กรอกรายบัญชี** — รายการหนึ่งใช้เงินได้หลายแหล่ง (F-02)
 * ถ้าให้กรอกเอง ผู้ใช้จะต้องคำนวณสัดส่วนด้วยมือทุกครั้ง ซึ่งเป็นงานที่ผิดได้ง่าย
 * และผิดแล้วไม่มีอะไรฟ้อง เพราะยอดรวมยังตรง
 *
 * **เศษสตางค์ไปอยู่บรรทัดที่ยอดกันไว้มากที่สุด** ไม่ใช่บรรทัดแรก — บรรทัดแรกเป็น
 * ลำดับที่ผู้ใช้กรอก ซึ่งไม่มีความหมายทางบัญชี ส่วนบรรทัดที่ใหญ่ที่สุดรับเศษได้
 * โดยกระทบสัดส่วนน้อยที่สุด เมื่อยอดเท่ากันให้ใช้ id เป็นตัวตัดสิน เพื่อให้ผลลัพธ์
 * เหมือนเดิมทุกครั้งที่เรียกด้วยข้อมูลชุดเดียวกัน
 *
 * ผลรวมของทุกบรรทัดเท่ากับ `amountSatang` เสมอ — ไม่มีสตางค์หายหรืองอก
 */
export function splitProRata(
  outstanding: readonly OutstandingReserve[],
  amountSatang: bigint,
): DisbursementLine[] {
  const total = totalOutstanding(outstanding);

  if (total <= 0n || amountSatang <= 0n) return [];

  const lines = outstanding
    .filter((row) => row.amountSatang > 0n)
    .map((row) => ({
      budgetAccountId: row.budgetAccountId,
      reservedSatang: row.amountSatang,
      /* ปัดลงก่อนทุกบรรทัด แล้วค่อยแจกเศษ — ปัดขึ้นก่อนจะทำให้ผลรวมเกินได้ */
      amountSatang: (row.amountSatang * amountSatang) / total,
    }));

  const assigned = lines.reduce((sum, line) => sum + line.amountSatang, 0n);
  let remainder = amountSatang - assigned;

  /*
   * แจกเศษทีละสตางค์ ไล่จากบรรทัดที่กันไว้มากที่สุด
   *
   * เศษมีค่าไม่เกินจำนวนบรรทัดลบหนึ่ง จึงวนไม่เกินหนึ่งรอบของ sorted
   */
  const sorted = [...lines].sort((a, b) => {
    if (a.reservedSatang !== b.reservedSatang) return a.reservedSatang > b.reservedSatang ? -1 : 1;
    return a.budgetAccountId < b.budgetAccountId ? -1 : 1;
  });

  for (const line of sorted) {
    if (remainder <= 0n) break;
    line.amountSatang += 1n;
    remainder -= 1n;
  }

  return lines
    .filter((line) => line.amountSatang > 0n)
    .map((line) => ({ budgetAccountId: line.budgetAccountId, amountSatang: line.amountSatang }));
}
