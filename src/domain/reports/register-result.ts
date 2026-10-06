/**
 * ตีความผลของ `procurement_register_result` — ตัดสินว่าข้อมูล "ครบ" "ถูกตัด" หรือ "ผิดปกติ"
 * (แก้ F-01 ในรายงานตรวจสอบ 2026-10-06)
 *
 * เดิมเดาว่าถูกตัดเมื่อได้แถวเกินเพดาน แต่ทั้ง SQL clamp (5,000) และ PostgREST
 * `max_rows` ตัดแถวก่อนถึงแอปโดยไม่บอก จึงมีไฟล์ที่ขาดแถวแต่ดูเหมือนครบ
 * ตอนนี้ฐานข้อมูลบอก `total_count` เองใน snapshot เดียวกับแถว และที่นี่เทียบสองค่านี้:
 *
 *   - total_count <= เพดาน  → ต้องได้แถวครบเท่า total_count
 *   - total_count >  เพดาน  → ต้องได้แถวเท่าเพดานพอดี และถือว่า "ถูกตัด" (ผู้เรียกปฏิเสธ export)
 *   - จำนวนแถวที่ได้ไม่ตรงสองข้อนี้ → ผิดปกติ (ชั้นไหนตัดแถวเงียบ ๆ) **throw** ไม่คืนข้อมูลบางส่วน
 *
 * ไฟล์ที่ส่งออกจึงเป็นได้สองอย่างเท่านั้น: ครบทุกแถว หรือไม่มีไฟล์
 */

/** เพดานสูงสุดที่ฟังก์ชัน SQL ยอมคืน (`least(..., 5000)`) — ขอเกินนี้ไม่มีผล */
export const REGISTER_SQL_MAX_ROWS = 5000;

export class ReportCompletenessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportCompletenessError';
  }
}

export interface InterpretedRegisterResult<T> {
  rows: T[];
  /** true = มีแถวที่ตรงตัวกรองมากกว่าเพดาน — แถวที่ได้เป็นเพียงส่วนแรก */
  truncated: boolean;
  /** จำนวนแถวที่ตรงตัวกรองทั้งหมดตามที่ฐานข้อมูลนับ */
  totalCount: number;
}

function parseTotalCount(value: unknown): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ReportCompletenessError('ผลทะเบียนจากฐานข้อมูลไม่มี total_count ที่ใช้ได้');
  }
  return parsed;
}

export function interpretRegisterResult<T>(
  payload: unknown,
  rowLimit: number,
): InterpretedRegisterResult<T> {
  if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > REGISTER_SQL_MAX_ROWS) {
    throw new ReportCompletenessError(
      `เพดานแถวต้องเป็นจำนวนเต็ม 1–${REGISTER_SQL_MAX_ROWS} เพราะฐานข้อมูลคืนได้ไม่เกินนี้`,
    );
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ReportCompletenessError('ผลทะเบียนจากฐานข้อมูลอยู่ในรูปแบบที่ไม่รู้จัก');
  }

  const { total_count: rawTotal, rows } = payload as { total_count?: unknown; rows?: unknown };
  if (!Array.isArray(rows)) {
    throw new ReportCompletenessError('ผลทะเบียนจากฐานข้อมูลไม่มีรายการแถว');
  }

  const totalCount = parseTotalCount(rawTotal);
  const expected = Math.min(totalCount, rowLimit);

  if (rows.length !== expected) {
    throw new ReportCompletenessError(
      `ได้แถวไม่ครบ: ฐานข้อมูลนับ ${totalCount} แถว เพดาน ${rowLimit} ควรได้ ${expected} แถว แต่ได้ ${rows.length} ` +
        '— อาจมีชั้นใดตัดแถวเงียบ ๆ จึงไม่ส่งข้อมูลบางส่วน',
    );
  }

  return { rows: rows as T[], truncated: totalCount > rowLimit, totalCount };
}
