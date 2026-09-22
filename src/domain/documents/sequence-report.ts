/**
 * รายงานสถานะเอกสาร (PR-09, "document status/missing documents")
 *
 * ปิดข้อค้นพบสองข้อที่ทะเบียนจัดซื้อจัดจ้าง (PR-09b) ตั้งใจไม่ทำ เพราะเป็นเรื่อง
 * ของ **ทะเบียนเลขที่เอกสาร** ไม่ใช่ของทะเบียนรายการ:
 *
 *   F-12  ลำดับซ้ำ — ลำดับ 139 ปรากฏ 2 แถวในไฟล์จริง
 *   F-13  เลขกระโดด — `๑๓/๒๕๖๙` แล้วต่อด้วย `๙๑/๒๕๖๙`, `๙๒/๒๕๖๙`
 *
 * **ทั้งสองข้อตรวจจาก `running_no` ซึ่งเป็นค่าที่ระบบเดาจากข้อความ ไม่ใช่ข้อเท็จจริง**
 * (ดู `extractRunningNumber()` ใน document-register.ts) รายงานนี้จึงเป็นการ
 * **ยกขึ้นมาให้คนตรวจ** ไม่ใช่การตัดสินว่าผิด และไม่มีปุ่มแก้เลขให้อัตโนมัติ
 * ตามกลไกที่ระบุไว้สำหรับ F-13 — "ห้ามแก้อัตโนมัติโดยเดา"
 *
 * ไฟล์นี้เป็นตรรกะบริสุทธิ์ ห้าม import Supabase หรือ Next.js
 */
import type { DocumentKind, DocumentNumberStatus } from './document-register';
import { DOCUMENT_KINDS } from './document-register';

/**
 * หนึ่งลำดับ = หนึ่งคู่ (ปีงบ × ชนิดเอกสาร)
 *
 * เป็นขอบเขตเดียวกับ `document_numbers_unique_idx` ที่กันเลขซ้ำอยู่จริง
 * ถ้ารายงานใช้ขอบเขตอื่น มันจะรายงานช่องว่างของลำดับที่ระบบไม่ได้คุมอยู่
 */
export interface DocumentSequenceRow {
  fiscalYearId: string;
  fiscalYearCode: string | null;
  documentKind: DocumentKind;

  issuedCount: number;
  voidedCount: number;
  pendingCount: number;
  notRequiredCount: number;

  /** เลขลำดับต่ำสุด/สูงสุดที่ถูกใช้ไปแล้ว — null เมื่อยังไม่มีเลขใดเลย */
  minRunning: number | null;
  maxRunning: number | null;
  /** จำนวนเลขลำดับที่ไม่ซ้ำกันซึ่งถูกใช้ไปแล้ว */
  usedRunningCount: number;

  /** จำนวนเลขที่ขาดหายในช่วง min..max ทั้งหมด (F-13) */
  missingCount: number;
  /**
   * ตัวอย่างเลขที่ขาด — อาจไม่ครบตาม missingCount
   *
   * ว่างได้สองกรณี: ไม่มีเลขขาดเลย หรือช่วง min..max กว้างเกินกว่าจะไล่ทีละเลข
   * ผู้เรียกแยกสองกรณีนี้ด้วย missingCount ไม่ใช่ด้วยความยาวของอาร์เรย์
   */
  missingSample: number[];

  /** เลขลำดับที่ปรากฏมากกว่าหนึ่งครั้ง (F-12) */
  duplicateRunning: number[];

  /**
   * แถวที่แยกเลขลำดับจากข้อความไม่ได้เลย
   *
   * แถวเหล่านี้ไม่อยู่ในการวิเคราะห์ลำดับ การไม่บอกจำนวนไว้จะทำให้ผู้อ่านสงสัย
   * ว่าทำไมจำนวนที่ออกเลขแล้วไม่ตรงกับจำนวนเลขที่ถูกใช้
   */
  unparsedCount: number;
}

/** ช่วงเลขต่อเนื่อง — `from` และ `to` รวมปลายทั้งสองข้าง */
export interface NumberRange {
  from: number;
  to: number;
}

/**
 * ยุบเลขที่ขาดให้เป็นช่วง เพื่อให้อ่านออกเมื่อขาดทีละหลายสิบเลข
 *
 * `[14, 15, 16, 20]` -> `[{from:14,to:16}, {from:20,to:20}]`
 *
 * ข้อค้นพบ F-13 คือเลขกระโดดจาก 13 ไป 91 ซึ่งขาด 77 เลขรวด การพิมพ์ออกมา
 * ทีละเลขทำให้หน้าจอเต็มไปด้วยตัวเลขจนไม่เห็นว่ามีกี่ช่วงและกว้างแค่ไหน
 *
 * เรียงและตัดค่าซ้ำให้เองเพื่อไม่ต้องเชื่อว่าผู้เรียกส่งมาเรียงแล้ว
 */
export function toNumberRanges(numbers: readonly number[]): NumberRange[] {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const ranges: NumberRange[] = [];

  for (const value of sorted) {
    const last = ranges.at(-1);
    if (last !== undefined && value === last.to + 1) last.to = value;
    else ranges.push({ from: value, to: value });
  }

  return ranges;
}

/**
 * ข้อสังเกตของลำดับหนึ่ง — ตรงกับข้อค้นพบที่รายงานตรวจนับไว้
 *
 *   HAS_GAPS            F-13 — เลขกระโดด
 *   DUPLICATE_RUNNING   F-12 — ลำดับซ้ำ
 *   HAS_PENDING         F-14 — เอกสารที่ต้องมีเลขแต่ยังไม่ได้เลข
 *   HAS_UNPARSED        เลขที่แยกลำดับไม่ได้ จึงตรวจสองข้อแรกกับมันไม่ได้
 */
export const SEQUENCE_FLAGS = [
  'HAS_GAPS',
  'DUPLICATE_RUNNING',
  'HAS_PENDING',
  'HAS_UNPARSED',
] as const;

export type SequenceFlag = (typeof SEQUENCE_FLAGS)[number];

export const SEQUENCE_FLAG_LABELS_TH: Readonly<Record<SequenceFlag, string>> = {
  HAS_GAPS: 'มีเลขที่ขาดช่วง',
  DUPLICATE_RUNNING: 'มีเลขลำดับซ้ำ',
  HAS_PENDING: 'มีเอกสารที่ยังไม่ได้เลข',
  HAS_UNPARSED: 'มีเลขที่แยกลำดับไม่ได้',
};

/**
 * ข้อสังเกตของลำดับหนึ่ง เรียงตามลำดับใน SEQUENCE_FLAGS เสมอ
 *
 * ลำดับคงที่ทำให้ผลลัพธ์ไม่ขึ้นกับลำดับที่เขียนเงื่อนไขในฟังก์ชันนี้
 */
export function sequenceFlagsOf(row: DocumentSequenceRow): SequenceFlag[] {
  const flags: SequenceFlag[] = [];

  if (row.missingCount > 0) flags.push('HAS_GAPS');
  if (row.duplicateRunning.length > 0) flags.push('DUPLICATE_RUNNING');
  if (row.pendingCount > 0) flags.push('HAS_PENDING');
  if (row.unparsedCount > 0) flags.push('HAS_UNPARSED');

  return flags;
}

export interface DocumentStatusTotals {
  sequenceCount: number;
  issuedCount: number;
  voidedCount: number;
  pendingCount: number;
  notRequiredCount: number;
  missingCount: number;
  duplicateCount: number;
}

export interface FlaggedSequence {
  row: DocumentSequenceRow;
  flags: SequenceFlag[];
}

export interface DocumentStatusReport {
  rows: DocumentSequenceRow[];
  totals: DocumentStatusTotals;
  /** ลำดับที่มีข้อสังเกตอย่างน้อยหนึ่งข้อ เรียงแบบเดียวกับ rows */
  flagged: FlaggedSequence[];
}

/**
 * เรียงตามปีงบใหม่ไปเก่า แล้วตามลำดับของ DOCUMENT_KINDS
 *
 * ชนิดเอกสารเรียงตามลำดับการใช้งานจริง (ขออนุมัติ → สั่งซื้อ → ตรวจรับ → เบิกจ่าย)
 * ไม่ใช่ตามตัวอักษร ผู้อ่านจึงไล่ตามเส้นทางของงานได้
 */
function compareRows(a: DocumentSequenceRow, b: DocumentSequenceRow): number {
  const byYear = (b.fiscalYearCode ?? '').localeCompare(a.fiscalYearCode ?? '', 'th');
  if (byYear !== 0) return byYear;
  return DOCUMENT_KINDS.indexOf(a.documentKind) - DOCUMENT_KINDS.indexOf(b.documentKind);
}

/**
 * สรุปรายงานจากแถวที่ได้มา
 *
 * ยอดรวมและรายการที่มีข้อสังเกต **คิดจาก `rows` ชุดเดียวกัน** ด้วยเหตุผลเดียวกับ
 * รายงานงบและทะเบียน — ตัวเลขสองส่วนที่มาจากคนละแหล่งจะค่อย ๆ ไม่ตรงกัน
 * โดยไม่มีอะไรฟ้อง
 */
export function buildDocumentStatusReport(
  rows: readonly DocumentSequenceRow[],
): DocumentStatusReport {
  const sorted = [...rows].sort(compareRows);

  const totals = sorted.reduce<DocumentStatusTotals>(
    (acc, row) => ({
      sequenceCount: acc.sequenceCount + 1,
      issuedCount: acc.issuedCount + row.issuedCount,
      voidedCount: acc.voidedCount + row.voidedCount,
      pendingCount: acc.pendingCount + row.pendingCount,
      notRequiredCount: acc.notRequiredCount + row.notRequiredCount,
      missingCount: acc.missingCount + row.missingCount,
      duplicateCount: acc.duplicateCount + row.duplicateRunning.length,
    }),
    {
      sequenceCount: 0,
      issuedCount: 0,
      voidedCount: 0,
      pendingCount: 0,
      notRequiredCount: 0,
      missingCount: 0,
      duplicateCount: 0,
    },
  );

  const flagged = sorted
    .map((row) => ({ row, flags: sequenceFlagsOf(row) }))
    .filter((entry) => entry.flags.length > 0);

  return { rows: sorted, totals, flagged };
}

/**
 * หนึ่งแถวของรายการยกเว้น — เอกสารที่ยังไม่ได้เลข ไม่ต้องมีเลข หรือยกเลิกเลขแล้ว
 *
 * ทั้งสามสถานะต้องมีเหตุผลกำกับเสมอ (`document_numbers_reason_required`)
 * รายงานนี้จึงเป็นที่เดียวที่อ่านเหตุผลทั้งหมดต่อกันได้ ซึ่งเป็นสิ่งที่ผู้ตรวจทำ
 */
export interface DocumentExceptionRow {
  documentNumberId: string;
  fiscalYearCode: string | null;
  documentKind: DocumentKind;
  status: DocumentNumberStatus;
  documentNo: string | null;
  runningNo: number | null;
  reason: string | null;
  procurementId: string;
  /** null เมื่อผู้อ่านไม่มีสิทธิ์อ่านรายการต้นทาง แต่เห็นทะเบียนเลขได้ */
  procurementReference: string | null;
  procurementSubject: string | null;
  createdAt: string;
  voidedAt: string | null;
}
