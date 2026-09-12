/**
 * ทะเบียนเลขที่เอกสาร (FR-NUM-003, FR-NUM-004) — ปิด F-12, F-13 และ F-14
 *
 * **โรงเรียนเป็นผู้กำหนดเลขเอง** (Q3) ระบบไม่ออกเลขให้อัตโนมัติ สิ่งที่ระบบทำคือ
 *
 *   1. กันเลขซ้ำ (F-12)  — เลขที่ใช้ไปแล้วในชนิดเอกสารเดียวกันของปีงบเดียวกัน
 *                          ห้ามใช้อีก **รวมถึงเลขที่ยกเลิกไปแล้วด้วย**
 *   2. แยก running เป็นจำนวนเต็ม (F-13) — เก็บแยกจากรูปแบบที่แสดง เพื่อให้รู้ว่า
 *                          เลขกระโดดช่วงไหน โดยไม่ต้องแกะข้อความตอนทำรายงาน
 *   3. รับกรณี "ไม่มีเลข" อย่างเป็นทางการ (F-14) — 12 แถวในไฟล์จริงไม่มีเลขเอกสาร
 *                          และบางรายการไม่ต้องมีเลขจริง ๆ การบังคับให้กรอกทุกแถว
 *                          จะทำให้คนกรอกเลขปลอม ซึ่งแย่กว่าบันทึกว่า "ไม่ต้องมี
 *                          เพราะอะไร"
 *   4. เสนอเลขถัดไป — **ต่อจากรูปแบบที่โรงเรียนใช้อยู่แล้วเท่านั้น** ระบบไม่คิด
 *                          รูปแบบขึ้นเอง และผู้ใช้แก้ทับได้เสมอ
 *
 * ไฟล์นี้เป็นตรรกะบริสุทธิ์ ห้าม import Supabase หรือ Next.js
 * กติกาเดียวกันนี้ถูกบังคับซ้ำที่ฐานข้อมูล — ดู migration 0014 และ
 * `tests/unit/document-number-parity.test.ts` ที่อ่าน SQL จริงมาเทียบ
 */

/** สถานะเลขที่เอกสาร ตรงกับ enum `document_number_status` ใน migration 0014 */
export const DOCUMENT_NUMBER_STATUSES = ['ISSUED', 'NOT_REQUIRED', 'PENDING', 'VOIDED'] as const;

export type DocumentNumberStatus = (typeof DOCUMENT_NUMBER_STATUSES)[number];

/**
 * สถานะที่ **ต้อง** มีเหตุผลกำกับ (F-14, รหัส `DOCUMENT_NUMBER_REASON_REQUIRED`)
 *
 * `ISSUED` ไม่ต้องมีเหตุผลเพราะตัวเลขคือคำอธิบายในตัวเอง อีกสามสถานะเป็นการบอกว่า
 * "ทำไมถึงไม่มีเลข" หรือ "ทำไมเลขที่เคยมีถึงใช้ไม่ได้แล้ว" ซึ่งเป็นคำถามที่ผู้ตรวจสอบ
 * จะย้อนกลับมาถามแน่นอน
 */
export const REASON_REQUIRED_STATUSES: readonly DocumentNumberStatus[] = [
  'NOT_REQUIRED',
  'PENDING',
  'VOIDED',
];

export function requiresReason(status: DocumentNumberStatus): boolean {
  return REASON_REQUIRED_STATUSES.includes(status);
}

/**
 * ชนิดเอกสารที่มีเลขของตัวเอง ตรงกับ enum `document_kind` ใน migration 0014
 *
 * รายการนี้มาจากเอกสารที่พบในไฟล์จริง ไม่ได้เดาจากระเบียบ — ชนิดที่ยังไม่พบ
 * ให้เพิ่มเมื่อเจอจริง ไม่ใช่เผื่อไว้ เพราะชนิดที่ไม่มีใครใช้ยังต้องถูกดูแลตลอดไป
 */
export const DOCUMENT_KINDS = [
  'REQUEST_MEMO',
  'PURCHASE_ORDER',
  'INSPECTION_REPORT',
  'DISBURSEMENT',
  'OTHER',
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface DocumentNumberRecord {
  id: string;
  documentKind: DocumentKind;
  status: DocumentNumberStatus;
  /** เลขตามที่โรงเรียนพิมพ์ — null เมื่อสถานะไม่ใช่ `ISSUED` */
  documentNo: string | null;
  runningNo: number | null;
}

export interface DocumentNumberDraft {
  documentKind: DocumentKind;
  status: DocumentNumberStatus;
  documentNo?: string | null;
  reason?: string | null;
}

/* -------------------------------------------------------------------------- */
/* การทำให้เป็นรูปแบบมาตรฐานก่อนเทียบซ้ำ                                        */
/* -------------------------------------------------------------------------- */

/** เลขไทย ๐–๙ (U+0E50–U+0E59) เรียงตามค่า */
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/**
 * แปลงเลขที่เอกสารให้เป็นรูปแบบมาตรฐานก่อนเทียบว่าซ้ำหรือไม่
 *
 * **เหตุผลที่ต้องมี: ไฟล์จริงใช้เลขไทย** (`๑๓/๒๕๖๙` ในทะเบียนใบสั่งจ้าง) ถ้าเทียบ
 * ข้อความตรง ๆ คนที่พิมพ์ `13/2569` จะบันทึกซ้ำกับ `๑๓/๒๕๖๙` ได้โดยระบบไม่ทักเลย
 * ซึ่งเท่ากับไม่ได้กัน F-12 จริง
 *
 * ทำสามอย่าง: แปลงเลขไทยเป็นอารบิก · ตัดช่องว่างทั้งหมด · ตัวพิมพ์เล็ก
 *
 * **ไม่** ยุบ `/` กับ `-` ให้เป็นตัวเดียวกัน เพราะเอกสารคนละชุดอาจใช้ตัวคั่นต่างกัน
 * โดยตั้งใจ การยุบจะบล็อกเลขที่ถูกต้อง ซึ่งแย่กว่าปล่อยให้มีเลขที่ดูคล้ายกัน
 *
 * ฟังก์ชันนี้ต้องตรงกับ `public.normalize_document_number()` ใน SQL เสมอ
 */
export function normalizeDocumentNumber(value: string): string {
  return value
    .replace(/[๐-๙]/g, (digit) => String(THAI_DIGITS.indexOf(digit)))
    .replace(/\s+/g, '')
    .toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* การแยกเลขลำดับออกจากรูปแบบ (F-13)                                            */
/* -------------------------------------------------------------------------- */

interface DigitGroup {
  value: number;
  width: number;
  start: number;
  end: number;
}

/**
 * ช่วงปีที่ถือว่า "น่าจะเป็นปี ไม่ใช่เลขลำดับ"
 *
 * ใช้เฉพาะตอนเดาว่ากลุ่มตัวเลขใดคือเลขลำดับ ไม่เคยใช้ตัดสินว่าเลขซ้ำหรือไม่
 * — ความไม่ซ้ำตัดสินจากข้อความที่ทำให้เป็นมาตรฐานแล้วทั้งสตริงเสมอ
 */
const BE_YEAR_RANGE = [2400, 2700] as const;
const CE_YEAR_RANGE = [1900, 2200] as const;

const isYearLike = (group: DigitGroup): boolean =>
  group.width === 4 &&
  ((group.value >= BE_YEAR_RANGE[0] && group.value <= BE_YEAR_RANGE[1]) ||
    (group.value >= CE_YEAR_RANGE[0] && group.value <= CE_YEAR_RANGE[1]));

/** เกินนี้ไม่ใช่เลขลำดับที่เป็นไปได้ และเกินช่วง integer ของฐานข้อมูล */
const MAX_RUNNING_DIGITS = 9;

function digitGroups(normalized: string): DigitGroup[] {
  return [...normalized.matchAll(/\d+/g)]
    .filter((match) => match[0].length <= MAX_RUNNING_DIGITS)
    .map((match) => {
      const text = match[0];
      const start = match.index;

      return { value: Number(text), width: text.length, start, end: start + text.length };
    });
}

/**
 * หากลุ่มตัวเลขที่เป็น "เลขลำดับ" ในเลขที่เอกสาร
 *
 * กติกา: **กลุ่มสุดท้ายที่ไม่ใช่ปี** ซึ่งครอบคลุมรูปแบบที่พบจริงทั้งสองแบบ
 *
 *   `๑๓/๒๕๖๙`          -> [13, 2569]        ตัดปีออก เหลือ 13
 *   `ศธ04/0007/2569`   -> [04, 0007, 2569]  ตัดปีออก กลุ่มสุดท้ายคือ 0007
 *
 * ถ้าเอากลุ่มแรกจะได้ `04` ซึ่งเป็นส่วนของคำนำหน้า ไม่ใช่เลขลำดับ
 *
 * **เป็นการเดา ไม่ใช่ข้อเท็จจริง** จึงใช้กับสองเรื่องที่ผิดแล้วไม่เสียหายเท่านั้น
 * คือค่าเสนอแนะ กับคอลัมน์ `running_no` ที่ไว้ดูว่าเลขกระโดดช่วงไหน
 * **ไม่เคยใช้ตัดสินความไม่ซ้ำ**
 *
 * ตำแหน่ง `start`/`end` ที่คืนมาอ้างอิงข้อความที่ส่งเข้ามา ผู้เรียกที่ต้องการเขียนทับ
 * ค่าในข้อความเดิมจึงต้องส่งข้อความเดิม (แปลงเลขไทยแล้วแต่ยังไม่ตัดช่องว่าง) เข้ามา
 * — การตัดช่องว่างทำให้ดัชนีเลื่อน `"13 / 2569"` กับ `"13/2569"` ต่างกันสองตัวอักษร
 */
function findRunningGroup(value: string): DigitGroup | null {
  const groups = digitGroups(value);
  if (groups.length === 0) return null;

  const candidates = groups.filter((group) => !isYearLike(group));

  return candidates.at(-1) ?? groups.at(-1) ?? null;
}

/** แปลงเฉพาะเลขไทยเป็นอารบิก โดยคงความยาวและตำแหน่งของตัวอักษรอื่นไว้ */
const thaiDigitsToArabic = (value: string): string =>
  value.replace(/[๐-๙]/g, (digit) => String(THAI_DIGITS.indexOf(digit)));

/** เลขลำดับที่แยกได้จากเลขที่เอกสาร คืน null เมื่อไม่มีตัวเลขเลย */
export function extractRunningNumber(documentNo: string): number | null {
  return findRunningGroup(normalizeDocumentNumber(documentNo))?.value ?? null;
}

/* -------------------------------------------------------------------------- */
/* เลขเสนอแนะ                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * เสนอเลขถัดไปโดยต่อจากรูปแบบที่โรงเรียนใช้อยู่แล้ว
 *
 * **ระบบไม่คิดรูปแบบขึ้นเอง** ถ้ายังไม่มีเลขใดในชนิดเอกสารและปีงบนั้นเลย จะคืน
 * `null` แล้วปล่อยให้ผู้ใช้พิมพ์เอง — การเดารูปแบบให้โรงเรียนคือการสร้างแหล่งความจริง
 * ที่สองที่ขัดกับเลขที่ใช้จริง
 *
 * วิธีคิด: หยิบแถวที่ `runningNo` สูงสุด แล้วแทนที่เฉพาะกลุ่มตัวเลขที่เป็นเลขลำดับ
 * ด้วยค่า +1 โดยคงจำนวนหลักเดิมไว้ ส่วนอื่นของเลขไม่แตะเลย
 *
 *   `13/2569`      -> `14/2569`
 *   `ศธ04/0007/2569` -> `ศธ04/0008/2569`
 *
 * แถวที่ยกเลิกแล้ว (`VOIDED`) **นับด้วย** เพราะเลขนั้นถูกใช้ไปแล้วและห้ามนำกลับมาใช้
 * ถ้าไม่นับ ระบบจะเสนอเลขที่ตัวเองจะปฏิเสธในวินาทีถัดไป
 */
export function suggestNextDocumentNumber(
  existing: readonly DocumentNumberRecord[],
  documentKind: DocumentKind,
): string | null {
  const sameKind = existing.filter(
    (record) =>
      record.documentKind === documentKind &&
      record.documentNo !== null &&
      record.runningNo !== null,
  );
  if (sameKind.length === 0) return null;

  const latest = sameKind.reduce((best, record) =>
    (record.runningNo ?? 0) > (best.runningNo ?? 0) ? record : best,
  );

  const source = latest.documentNo;
  if (source === null) return null;

  /*
   * แกะตำแหน่งจากข้อความดั้งเดิม ไม่ใช่ข้อความที่ทำให้เป็นมาตรฐานแล้ว
   *
   * แปลงเฉพาะเลขไทยเป็นอารบิกเพื่อให้หากลุ่มตัวเลขได้ แต่ไม่ตัดช่องว่าง เพราะ
   * ต้องใช้ตำแหน่งไปตัดต่อกับ `source` ตัวจริง และเลขที่เสนอต้องยังเป็นเลขไทย
   * ถ้าของเดิมเป็นเลขไทย
   */
  const group = findRunningGroup(thaiDigitsToArabic(source));
  if (!group) return null;

  const next = String(group.value + 1).padStart(group.width, '0');
  const rendered = usesThaiDigits(source) ? toThaiDigits(next) : next;

  return source.slice(0, group.start) + rendered + source.slice(group.end);
}

const usesThaiDigits = (value: string): boolean => /[๐-๙]/.test(value);

const toThaiDigits = (value: string): string =>
  value.replace(/\d/g, (digit) => THAI_DIGITS[Number(digit)] as string);

/* -------------------------------------------------------------------------- */
/* กติกาที่ server บังคับ                                                        */
/* -------------------------------------------------------------------------- */

export interface DocumentNumberRejection {
  code:
    'DOCUMENT_NUMBER_DUPLICATE' | 'DOCUMENT_NUMBER_REASON_REQUIRED' | 'DOCUMENT_NUMBER_REQUIRED';
  messageTh: string;
}

/**
 * ตรวจร่างเลขที่เอกสารก่อนบันทึก
 *
 * อยู่ในชั้นโดเมนเพื่อให้หน้าจอเรียกใช้ตัวเดียวกับที่ server บังคับได้ — ถ้าแยกกัน
 * จะเกิดกรณีที่ฟอร์มยอมแต่ server ปฏิเสธด้วยเหตุผลที่ผู้ใช้แก้ตามไม่ได้
 *
 * **การซ่อนปุ่มหรือเตือนในหน้าจอไม่ใช่การบังคับ** ฐานข้อมูลมี unique index กันไว้
 * อีกชั้นเสมอ ฟังก์ชันนี้ทำให้ผู้ใช้เห็นปัญหาก่อนกด ไม่ใช่แทนการบังคับ
 *
 * `existing` ต้องเป็นรายการในขอบเขตความไม่ซ้ำเดียวกันเท่านั้น
 * (ชนิดเอกสารเดียวกัน ปีงบเดียวกัน — ดู assumptions ข้อ 2.7)
 * และต้องรวมแถวที่ยกเลิกแล้วด้วย
 */
export function checkDocumentNumberRule(
  draft: DocumentNumberDraft,
  existing: readonly DocumentNumberRecord[],
  options: { excludeId?: string } = {},
): DocumentNumberRejection | null {
  if (requiresReason(draft.status) && !draft.reason?.trim()) {
    return {
      code: 'DOCUMENT_NUMBER_REASON_REQUIRED',
      messageTh: 'กรุณาระบุเหตุผล เพราะรายการนี้ไม่ได้ออกเลขที่เอกสาร',
    };
  }

  if (draft.status !== 'ISSUED') return null;

  const documentNo = draft.documentNo?.trim();
  if (!documentNo) {
    return {
      code: 'DOCUMENT_NUMBER_REQUIRED',
      messageTh: 'กรุณากรอกเลขที่เอกสาร',
    };
  }

  const normalized = normalizeDocumentNumber(documentNo);
  const clash = existing.find(
    (record) =>
      record.id !== options.excludeId &&
      record.documentKind === draft.documentKind &&
      record.documentNo !== null &&
      normalizeDocumentNumber(record.documentNo) === normalized,
  );

  if (clash) {
    return {
      code: 'DOCUMENT_NUMBER_DUPLICATE',
      messageTh:
        clash.status === 'VOIDED'
          ? `เลขที่ ${clash.documentNo} เคยออกแล้วและถูกยกเลิกไป เลขที่ยกเลิกแล้วนำกลับมาใช้ไม่ได้`
          : `เลขที่ ${clash.documentNo} ถูกใช้ไปแล้วในชนิดเอกสารเดียวกันของปีงบประมาณนี้`,
    };
  }

  return null;
}
