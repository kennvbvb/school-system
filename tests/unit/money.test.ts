import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  decimalStringToSatang,
  divideRoundHalfUp,
  formatSatang,
  parseScaled,
  satangToDecimalString,
} from '@/domain/money/money';

describe('divideRoundHalfUp', () => {
  it('ปัดครึ่งขึ้นสำหรับค่าบวก', () => {
    expect(divideRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divideRoundHalfUp(4n, 2n)).toBe(2n);
    expect(divideRoundHalfUp(3n, 2n)).toBe(2n);
    expect(divideRoundHalfUp(1n, 3n)).toBe(0n);
    expect(divideRoundHalfUp(2n, 3n)).toBe(1n);
  });

  it('ปัดออกจากศูนย์สำหรับค่าลบ', () => {
    expect(divideRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divideRoundHalfUp(-3n, 2n)).toBe(-2n);
    expect(divideRoundHalfUp(5n, -2n)).toBe(-3n);
  });

  it('ปฏิเสธการหารด้วยศูนย์', () => {
    expect(() => divideRoundHalfUp(1n, 0n)).toThrow(MoneyError);
  });
});

describe('parseScaled', () => {
  it('แปลงข้อความทศนิยมโดยไม่ผ่าน floating point', () => {
    expect(parseScaled('0.1', 2n)).toBe(10n);
    expect(parseScaled('1234.56', 2n)).toBe(123456n);
    expect(parseScaled('-1234.56', 2n)).toBe(-123456n);
    expect(parseScaled('7', 4n)).toBe(70000n);
    expect(parseScaled('0', 4n)).toBe(0n);
  });

  it('เติมศูนย์ให้ครบ scale', () => {
    expect(parseScaled('1.5', 4n)).toBe(15000n);
  });

  it('ปฏิเสธทศนิยมที่เกิน scale แทนการปัดเงียบ ๆ', () => {
    expect(() => parseScaled('1.005', 2n)).toThrow(/ทศนิยมเกิน 2 ตำแหน่ง/);
  });

  it('ปฏิเสธข้อความที่ไม่ใช่ตัวเลข', () => {
    expect(() => parseScaled('1,000', 2n)).toThrow(MoneyError);
    expect(() => parseScaled('abc', 2n)).toThrow(MoneyError);
    expect(() => parseScaled('', 2n)).toThrow(MoneyError);
  });

  it('รักษาความแม่นยำของค่าที่ floating point ทำพลาด', () => {
    // 0.1 + 0.2 ใน floating point ได้ 0.30000000000000004
    const sum = parseScaled('0.1', 2n) + parseScaled('0.2', 2n);
    expect(sum).toBe(parseScaled('0.3', 2n));
  });
});

describe('การแปลงกลับไปมาระหว่างสตางค์กับข้อความบาท', () => {
  it('ไม่สูญเสียค่าเมื่อแปลงกลับไปกลับมา', () => {
    for (const value of ['0.00', '0.01', '1234.56', '-98.70', '99999999999999.99']) {
      expect(satangToDecimalString(decimalStringToSatang(value))).toBe(value);
    }
  });
});

describe('formatSatang', () => {
  it('ใส่คั่นหลักพันและทศนิยม 2 ตำแหน่งเสมอ', () => {
    expect(formatSatang(0n)).toBe('0.00');
    expect(formatSatang(5n)).toBe('0.05');
    expect(formatSatang(100n)).toBe('1.00');
    expect(formatSatang(123456789n)).toBe('1,234,567.89');
    expect(formatSatang(-123456789n)).toBe('-1,234,567.89');
  });
});
