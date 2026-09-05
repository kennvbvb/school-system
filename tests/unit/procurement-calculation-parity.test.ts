import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { calculateDocument } from '@/domain/money/calculation';
import type { LineInput, TaxMode } from '@/domain/money/calculation';

/**
 * กันไม่ให้การคำนวณเงินฝั่ง SQL กับฝั่งโดเมนหลุดจากกัน
 *
 * ยอดเงินถูกคำนวณสองที่โดยเจตนา: view ใน PostgreSQL เป็นแหล่งความจริงของฐานข้อมูล
 * ส่วนโดเมนใช้แสดงผลและตรวจก่อนบันทึก ถ้าสองฝั่งปัดเศษต่างกันแม้สตางค์เดียว
 * ยอดบนหน้าจอจะไม่ตรงกับยอดในเอกสารที่ออกจริง ซึ่งเป็นข้อผิดพลาดชนิดที่
 * ตรวจพบยากมากเมื่อขึ้นระบบไปแล้ว
 *
 * test นี้อ่านค่าคาดหวังจาก supabase/tests/procurement_draft_test.sql ตรง ๆ
 * ไฟล์ SQL นั้นจึงเป็นแหล่งความจริงเดียว: ถ้าใครแก้กติกาการปัดเศษฝั่งใดฝั่งหนึ่ง
 * จะล้มทั้งสองฝั่งพร้อมกัน ไม่ใช่ล้มเงียบ ๆ ข้างเดียว
 */

interface GoldenCase {
  taxMode: TaxMode;
  lines: LineInput[];
  subtotal: bigint;
  discountTotal: bigint;
  taxTotal: bigint;
  grandTotal: bigint;
}

/**
 * บรรทัดในไฟล์ SQL มีรูปแบบ:
 *   -- GOLDEN: <โหมดภาษี> | <บรรทัด> ; <บรรทัด> | subtotal | discount | tax | grand
 * โดยแต่ละบรรทัดเขียนเป็น  <จำนวน>@<ราคา> d<ส่วนลด> t<อัตราภาษี>
 */
function parseGoldenCases(sql: string): GoldenCase[] {
  const rows = [...sql.matchAll(/^-- GOLDEN: (.+)$/gm)].map((match) => match[1] ?? '');

  return rows.map((row) => {
    const parts = row.split('|').map((part) => part.trim());
    const [mode, lineSpec, subtotal, discountTotal, taxTotal, grandTotal] = parts;

    const lines = (lineSpec ?? '').split(';').map((spec, index): LineInput => {
      const match = /^([\d.]+)@([\d.]+)\s+d([\d.]+)\s+t([\d.]+)$/.exec(spec.trim());
      if (!match) throw new Error(`อ่านบรรทัด golden ไม่ออก: ${spec}`);
      return {
        lineNo: index + 1,
        quantity: match[1] as string,
        unitPrice: match[2] as string,
        discountAmount: match[3] as string,
        taxRate: match[4] as string,
      };
    });

    return {
      taxMode: mode as TaxMode,
      lines,
      subtotal: BigInt(subtotal as string),
      discountTotal: BigInt(discountTotal as string),
      taxTotal: BigInt(taxTotal as string),
      grandTotal: BigInt(grandTotal as string),
    };
  });
}

const sql = readFileSync('supabase/tests/procurement_draft_test.sql', 'utf8');
const goldenCases = parseGoldenCases(sql);

describe('ยอดเงินฝั่งโดเมนต้องตรงกับค่าที่ SQL test ยืนยัน', () => {
  it('ไฟล์ SQL มีกรณีทดสอบให้ตรวจจริง', () => {
    // ถ้าใครลบบรรทัด GOLDEN ออก test นี้ต้องล้ม ไม่ใช่ผ่านเพราะไม่มีอะไรให้ตรวจ
    expect(goldenCases.length).toBeGreaterThanOrEqual(4);
  });

  it('ครอบคลุมโหมดภาษีทั้งสามแบบ', () => {
    const modes = new Set(goldenCases.map((c) => c.taxMode));
    expect(modes).toContain('EXEMPT');
    expect(modes).toContain('EXCLUSIVE');
    expect(modes).toContain('INCLUSIVE');
  });

  for (const [index, testCase] of goldenCases.entries()) {
    const label = `${testCase.taxMode} กรณีที่ ${index + 1}`;

    it(`${label}: subtotal, ส่วนลด, ภาษี และยอดรวมตรงกันทุกช่อง`, () => {
      const actual = calculateDocument(testCase.lines, testCase.taxMode);

      expect(actual.subtotal, `${label} subtotal`).toBe(testCase.subtotal);
      expect(actual.discountTotal, `${label} ส่วนลด`).toBe(testCase.discountTotal);
      expect(actual.taxTotal, `${label} ภาษี`).toBe(testCase.taxTotal);
      expect(actual.grandTotal, `${label} ยอดรวม`).toBe(testCase.grandTotal);
    });

    it(`${label}: ยอดรวมเท่ากับผลบวกของบรรทัดพอดี ไม่มีเศษหลุด`, () => {
      const actual = calculateDocument(testCase.lines, testCase.taxMode);
      const sumOfLines = actual.lines.reduce((sum, line) => sum + line.lineTotal, 0n);

      expect(sumOfLines).toBe(actual.grandTotal);
    });
  }
});
