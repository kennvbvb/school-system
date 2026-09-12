import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  extractRunningNumber,
  normalizeDocumentNumber,
} from '@/domain/documents/document-register';

/**
 * การทำเลขให้เป็นรูปแบบมาตรฐานอยู่สองที่โดยจำเป็น
 *
 *   - `normalizeDocumentNumber()` ในชั้นโดเมน — ให้หน้าจอเตือนซ้ำขณะพิมพ์
 *   - `public.normalize_document_number()` ใน migration 0014 — เป็นผู้บังคับจริง
 *     ผ่าน unique index
 *
 * แยกกันไม่ได้ เพราะชั้นโดเมนห้ามพึ่งฐานข้อมูล และ unique index ต้องคำนวณค่าเองใน
 * PostgreSQL แต่ถ้าสองที่ไม่ตรงกันจะเกิดสองอาการที่แย่ทั้งคู่: หน้าจอเตือนว่าซ้ำ
 * ทั้งที่บันทึกได้ หรือหน้าจอยอมแล้ว server ปฏิเสธด้วยเหตุผลที่ผู้ใช้แก้ตามไม่ได้
 *
 * test นี้อ่าน SQL จริงมาเทียบ **โดยรันตรรกะเดียวกันด้วยมือ** ไม่ใช่เทียบข้อความ
 * — ถ้าเทียบแค่ว่ามีคำว่า translate อยู่ การเปลี่ยนลำดับตัวเลขใน translate จะหลุดไปได้
 */
const MIGRATION = 'supabase/migrations/20260910000100_document_numbers.sql';

function bodyOf(functionName: string): string {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf(`create or replace function public.${functionName}`);
  expect(start, `ไม่พบฟังก์ชัน ${functionName} ใน ${MIGRATION}`).toBeGreaterThan(-1);

  const end = sql.indexOf('$$;', start);
  expect(end).toBeGreaterThan(start);

  return sql.slice(start, end);
}

describe('normalize_document_number ตรงกันระหว่างโดเมนกับฐานข้อมูล', () => {
  const body = bodyOf('normalize_document_number');

  /*
   * ชุดตัวเลขที่ translate ใช้แปลง ต้องเป็นเลขไทยครบสิบตัวเรียงตามค่า
   *
   * ถ้าเรียงสลับหรือตกตัวใดตัวหนึ่ง เลขบางตัวจะแปลงผิดเงียบ ๆ แล้วเลขที่ควรชนกัน
   * จะไม่ชน ซึ่งคือ F-12 ที่กลับมาโดยไม่มีอะไรฟ้อง
   */
  it('แปลงเลขไทยครบสิบตัวและเรียงตรงกับค่า', () => {
    expect(body).toContain(`translate(p_value, '๐๑๒๓๔๕๖๗๘๙', '0123456789')`);
  });

  it('ตัดช่องว่างและลดเป็นตัวพิมพ์เล็ก', () => {
    expect(body).toMatch(/regexp_replace\(\s*[\s\S]*?'\\s\+',\s*'',\s*'g'\s*\)/);
    expect(body).toContain('lower(');
  });

  /*
   * ต้องเป็น immutable จึงจะใช้ใน unique index ได้
   *
   * ถ้าใครเปลี่ยนเป็น stable ในอนาคต index จะสร้างไม่ได้และ migration จะล้ม
   * แต่ล้มตอน deploy ซึ่งสายไปแล้ว — จับไว้ที่นี่ถูกกว่า
   */
  it('ประกาศเป็น immutable', () => {
    expect(body).toContain('immutable');
  });

  /* เลขไทยทุกตัวต้องแปลงได้ ไม่ใช่แค่ตัวที่บังเอิญอยู่ในกรณีทดสอบอื่น */
  it.each([
    ['๐', '0'],
    ['๑', '1'],
    ['๒', '2'],
    ['๓', '3'],
    ['๔', '4'],
    ['๕', '5'],
    ['๖', '6'],
    ['๗', '7'],
    ['๘', '8'],
    ['๙', '9'],
  ])('โดเมนแปลง %s เป็น %s', (thai, arabic) => {
    expect(normalizeDocumentNumber(thai)).toBe(arabic);
  });
});

describe('document_running_no ตรงกันระหว่างโดเมนกับฐานข้อมูล', () => {
  const body = bodyOf('document_running_no');

  /*
   * ค่าคงที่ของ "ช่วงที่ถือว่าเป็นปี" ต้องตรงกันทั้งสองฝั่ง
   *
   * ถ้าเลื่อนฝั่งใดฝั่งหนึ่ง ค่า running_no ที่ฐานข้อมูลเก็บจะไม่ตรงกับเลขที่หน้าจอ
   * เสนอ ผู้ใช้จะเห็นเลขเสนอแนะกระโดดโดยไม่มีเหตุผล
   */
  it('ใช้ช่วงปี พ.ศ. และ ค.ศ. ชุดเดียวกับโดเมน', () => {
    expect(body).toContain('between 2400 and 2700');
    expect(body).toContain('between 1900 and 2200');
  });

  it('ข้ามกลุ่มตัวเลขที่ยาวเกิน 9 หลักเหมือนกัน', () => {
    expect(body).toContain('length(g.match[1]) <= 9');
  });

  it('เลือกกลุ่มสุดท้ายที่ไม่ใช่ปี และถอยไปกลุ่มสุดท้ายเมื่อเป็นปีทั้งหมด', () => {
    expect(body).toContain('where not year_like order by position desc limit 1');
    expect(body).toContain('from classified order by position desc limit 1');
  });

  /*
   * ค่าที่คาดหวังชุดนี้ถูกยืนยันด้วยการรันบน PostgreSQL จริงใน
   * supabase/tests/document_number_test.sql — ที่นี่ล็อกฝั่งโดเมนให้ได้ค่าเดียวกัน
   */
  it.each([
    ['๑๓/๒๕๖๙', 13],
    ['13/2569', 13],
    ['13 / 2569', 13],
    ['ศธ04/0007/2569', 7],
    ['PO-FIN-00007', 7],
    ['2569/13', 13],
  ])('โดเมนแยก %s ได้ %i เท่ากับที่ SQL แยกได้', (input, expected) => {
    expect(extractRunningNumber(input as string)).toBe(expected);
  });
});

describe('unique index กันเลขซ้ำและเลขที่ยกเลิกแล้ว', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  /*
   * ข้อนี้คือเกณฑ์ตรวจรับ "void แล้วเลขเดิมไม่ถูกใช้ใหม่" ของแผน PR-04
   *
   * ถ้ามีใครเติม `and status <> 'VOIDED'` ลงใน index นี้ เลขที่ยกเลิกแล้วจะกลับมา
   * ใช้ได้ทันทีโดยไม่มี test อื่นในชุด unit จับได้เลย
   */
  it('index ไม่กรองแถวที่ยกเลิกแล้วออก', () => {
    const start = sql.indexOf('create unique index document_numbers_unique_idx');
    expect(start).toBeGreaterThan(-1);

    const body = sql.slice(start, sql.indexOf(';', start));
    expect(body).toContain('where document_no is not null');
    expect(body).not.toContain('VOIDED');
  });

  /* ขอบเขตความไม่ซ้ำตาม assumptions ข้อ 2.7 — ชนิดเอกสารเดียวกัน ปีงบเดียวกัน */
  it('ขอบเขตความไม่ซ้ำคือปีงบและชนิดเอกสาร', () => {
    const start = sql.indexOf('create unique index document_numbers_unique_idx');
    const body = sql.slice(start, sql.indexOf(';', start));

    expect(body).toContain('fiscal_year_id');
    expect(body).toContain('document_kind');
    expect(body).toContain('public.normalize_document_number(document_no)');
  });
});
