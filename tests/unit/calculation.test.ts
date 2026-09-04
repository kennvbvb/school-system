import { describe, expect, it } from 'vitest';
import { calculateDocument, calculateLine } from '@/domain/money/calculation';
import { MoneyError } from '@/domain/money/money';
import type { LineInput } from '@/domain/money/calculation';

const line = (overrides: Partial<LineInput> = {}): LineInput => ({
  lineNo: 1,
  quantity: '1',
  unitPrice: '100',
  ...overrides,
});

describe('calculateLine — EXCLUSIVE (ราคายังไม่รวมภาษี)', () => {
  it('คำนวณภาษี 7% จากยอดหลังหักส่วนลด', () => {
    const result = calculateLine(
      line({ quantity: '10', unitPrice: '100', discountAmount: '50', taxRate: '7' }),
      'EXCLUSIVE',
    );

    expect(result.base).toBe(100_000n); // 1,000.00 บาท
    expect(result.discount).toBe(5_000n); // 50.00 บาท
    expect(result.lineSubtotal).toBe(95_000n); // 950.00 บาท
    expect(result.lineTax).toBe(6_650n); // 66.50 บาท
    expect(result.lineTotal).toBe(101_650n); // 1,016.50 บาท
  });

  it('รักษาเอกลักษณ์ lineTotal = lineSubtotal + lineTax', () => {
    const result = calculateLine(
      line({ quantity: '3', unitPrice: '33.33', taxRate: '7' }),
      'EXCLUSIVE',
    );
    expect(result.lineTotal).toBe(result.lineSubtotal + result.lineTax);
  });
});

describe('calculateLine — INCLUSIVE (ราคารวมภาษีแล้ว)', () => {
  it('ถอดภาษีออกจากราคาที่รวมแล้ว', () => {
    const result = calculateLine(
      line({ quantity: '1', unitPrice: '107', taxRate: '7' }),
      'INCLUSIVE',
    );

    expect(result.lineTotal).toBe(10_700n); // 107.00 บาท
    expect(result.lineSubtotal).toBe(10_000n); // 100.00 บาท
    expect(result.lineTax).toBe(700n); // 7.00 บาท
  });

  it('ยอดที่ผู้ใช้กรอกยังเป็นยอดสุทธิเดิม แม้ภาษีจะปัดเศษ', () => {
    const result = calculateLine(
      line({ quantity: '1', unitPrice: '100', taxRate: '7' }),
      'INCLUSIVE',
    );
    expect(result.lineTotal).toBe(10_000n);
    expect(result.lineSubtotal + result.lineTax).toBe(10_000n);
  });

  it('รักษาเอกลักษณ์ base - discount = lineSubtotal', () => {
    const result = calculateLine(
      line({ quantity: '7', unitPrice: '19.99', discountAmount: '13.37', taxRate: '7' }),
      'INCLUSIVE',
    );
    expect(result.base - result.discount).toBe(result.lineSubtotal);
    expect(result.lineSubtotal + result.lineTax).toBe(result.lineTotal);
  });
});

describe('calculateLine — EXEMPT (ยกเว้นภาษี)', () => {
  it('ไม่คิดภาษีแม้จะส่ง taxRate มา', () => {
    const result = calculateLine(line({ quantity: '2', unitPrice: '50', taxRate: '7' }), 'EXEMPT');
    expect(result.lineTax).toBe(0n);
    expect(result.lineTotal).toBe(10_000n);
  });
});

describe('calculateLine — การตรวจข้อมูลเข้า', () => {
  it('ปฏิเสธจำนวนที่ไม่มากกว่า 0', () => {
    expect(() => calculateLine(line({ quantity: '0' }), 'EXCLUSIVE')).toThrow(/จำนวนต้องมากกว่า 0/);
    expect(() => calculateLine(line({ quantity: '-1' }), 'EXCLUSIVE')).toThrow(MoneyError);
  });

  it('ปฏิเสธราคาติดลบและส่วนลดติดลบ', () => {
    expect(() => calculateLine(line({ unitPrice: '-1' }), 'EXCLUSIVE')).toThrow(/ราคาต่อหน่วย/);
    expect(() => calculateLine(line({ discountAmount: '-1' }), 'EXCLUSIVE')).toThrow(/ส่วนลด/);
  });

  it('ปฏิเสธส่วนลดที่มากกว่ายอดของบรรทัด', () => {
    expect(() =>
      calculateLine(line({ unitPrice: '100', discountAmount: '200' }), 'EXCLUSIVE'),
    ).toThrow(/ส่วนลดมากกว่ายอดของบรรทัด/);
  });

  it('อ้างลำดับบรรทัดใน error เพื่อให้ผู้ใช้แก้ถูกจุด', () => {
    expect(() => calculateLine(line({ lineNo: 4, quantity: '0' }), 'EXCLUSIVE')).toThrow(
      /บรรทัดที่ 4/,
    );
  });
});

describe('calculateDocument', () => {
  it('ยอดรวมเท่ากับผลบวกของบรรทัดพอดี ไม่มีเศษหลุด', () => {
    const result = calculateDocument(
      [
        line({ lineNo: 1, quantity: '3', unitPrice: '33.33', taxRate: '7' }),
        line({ lineNo: 2, quantity: '7', unitPrice: '19.99', taxRate: '7' }),
        line({ lineNo: 3, quantity: '1', unitPrice: '0.01', taxRate: '7' }),
      ],
      'EXCLUSIVE',
    );

    const summedTotals = result.lines.reduce((sum, item) => sum + item.lineTotal, 0n);
    expect(result.grandTotal).toBe(summedTotals);
    expect(result.grandTotal).toBe(result.subtotal - result.discountTotal + result.taxTotal);
  });

  it('รองรับจำนวนทศนิยม 4 ตำแหน่ง', () => {
    const result = calculateDocument([line({ quantity: '1.2345', unitPrice: '1000' })], 'EXEMPT');
    expect(result.grandTotal).toBe(123_450n); // 1,234.50 บาท
  });

  it('ปฏิเสธเอกสารที่ไม่มีรายการ', () => {
    expect(() => calculateDocument([], 'EXCLUSIVE')).toThrow(/อย่างน้อย 1 บรรทัด/);
  });

  it('ปฏิเสธยอดที่เกินเพดานของระบบ', () => {
    expect(() =>
      calculateDocument([line({ quantity: '1000000', unitPrice: '1000000' })], 'EXEMPT'),
    ).toThrow(/เกินเพดาน/);
  });
});
