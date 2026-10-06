import { describe, expect, it } from 'vitest';
import {
  interpretRegisterResult,
  REGISTER_SQL_MAX_ROWS,
  ReportCompletenessError,
} from '@/domain/reports/register-result';

/** จำลองสิ่งที่ procurement_register_result คืน: นับทั้งหมดแล้วคืนแถวไม่เกิน limit (และไม่เกิน 5,000) */
function dbPayload(total: number, requestedLimit: number) {
  const returned = Math.min(total, requestedLimit, REGISTER_SQL_MAX_ROWS);
  return {
    total_count: total,
    rows: Array.from({ length: returned }, (_, i) => ({ reference: `R-${i}` })),
  };
}

describe('interpretRegisterResult — ขอบเขตเพดานหน้าจอ (1000)', () => {
  it.each([
    [999, false],
    [1000, false],
    [1001, true],
  ])('ทะเบียน %i แถว: truncated=%s', (total, truncated) => {
    const result = interpretRegisterResult(dbPayload(total, 1000), 1000);
    expect(result.truncated).toBe(truncated);
    expect(result.rows).toHaveLength(Math.min(total, 1000));
    expect(result.totalCount).toBe(total);
  });
});

describe('interpretRegisterResult — ขอบเขตเพดาน export (5000)', () => {
  it.each([
    [4999, false],
    [5000, false],
    [5001, true],
  ])('ทะเบียน %i แถว: truncated=%s', (total, truncated) => {
    const result = interpretRegisterResult(dbPayload(total, 5000), 5000);
    expect(result.truncated).toBe(truncated);
    expect(result.rows).toHaveLength(Math.min(total, 5000));
  });

  it('5001 แถวตรวจพบว่าถูกตัด — กรณีที่เดาจากจำนวนแถว (limit+1) เดิมพลาดเงียบ ๆ', () => {
    // เดิมขอ 5001 แล้ว SQL clamp เหลือ 5000 → "5000 > 5000" เป็นเท็จ ไฟล์ขาดไป 1 แถวโดยไม่มีใครรู้
    const clamped = dbPayload(5001, 5001);
    expect(clamped.rows).toHaveLength(5000);
    expect(() => interpretRegisterResult(clamped, 5000)).not.toThrow();
    expect(interpretRegisterResult(clamped, 5000).truncated).toBe(true);
  });
});

describe('interpretRegisterResult — ชั้นใดตัดแถวเงียบ ๆ ต้อง throw ไม่ส่งข้อมูลบางส่วน', () => {
  it('PostgREST max_rows=1000 ตัดผลที่ควรได้ 4999 แถวเหลือ 1000', () => {
    const cut = { total_count: 4999, rows: dbPayload(4999, 5000).rows.slice(0, 1000) };
    expect(() => interpretRegisterResult(cut, 5000)).toThrow(ReportCompletenessError);
    expect(() => interpretRegisterResult(cut, 5000)).toThrow(/ได้แถวไม่ครบ/);
  });

  it('ได้แถวมากกว่าที่ควรได้ก็ผิดปกติเช่นกัน', () => {
    const extra = { total_count: 10, rows: dbPayload(11, 11).rows };
    expect(() => interpretRegisterResult(extra, 1000)).toThrow(ReportCompletenessError);
  });

  it('เกินเพดานแต่ได้แถวไม่ถึงเพดาน (ถูกตัดซ้ำสองชั้น) ก็ throw', () => {
    const cut = { total_count: 5001, rows: dbPayload(5001, 5000).rows.slice(0, 1000) };
    expect(() => interpretRegisterResult(cut, 5000)).toThrow(ReportCompletenessError);
  });

  it.each([
    ['null', null],
    ['อาร์เรย์', []],
    ['ไม่มี rows', { total_count: 0 }],
    ['rows ไม่ใช่อาร์เรย์', { total_count: 0, rows: {} }],
    ['ไม่มี total_count', { rows: [] }],
    ['total_count ติดลบ', { total_count: -1, rows: [] }],
    ['total_count ไม่ใช่จำนวนเต็ม', { total_count: 1.5, rows: [] }],
    ['total_count เป็นข้อความที่ไม่ใช่ตัวเลข', { total_count: 'abc', rows: [] }],
  ])('รูปแบบผลที่ไม่รู้จัก (%s) ถูกปฏิเสธ', (_label, payload) => {
    expect(() => interpretRegisterResult(payload, 1000)).toThrow(ReportCompletenessError);
  });

  it('total_count เป็นข้อความตัวเลขได้ (bigint ที่ serialize เป็น string)', () => {
    const result = interpretRegisterResult({ total_count: '0', rows: [] }, 1000);
    expect(result).toEqual({ rows: [], truncated: false, totalCount: 0 });
  });

  it.each([0, -5, 1.5, REGISTER_SQL_MAX_ROWS + 1])('เพดานแถว %s ไม่ถูกต้อง', (limit) => {
    expect(() => interpretRegisterResult({ total_count: 0, rows: [] }, limit)).toThrow(
      ReportCompletenessError,
    );
  });
});
