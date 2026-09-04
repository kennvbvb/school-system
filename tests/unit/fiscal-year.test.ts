import { describe, expect, it } from 'vitest';
import {
  FiscalYearError,
  assertFiscalYearValid,
  coversDate,
  findFiscalYearForDate,
  requireFiscalYearForDate,
} from '@/domain/master-data/fiscal-year';
import type { FiscalYear } from '@/domain/master-data/fiscal-year';

const fy = (
  yearBE: number,
  start: string,
  end: string,
  status: 'OPEN' | 'CLOSED' = 'OPEN',
): FiscalYear => ({
  id: `id-${yearBE}`,
  code: `FY${yearBE}`,
  yearBE,
  startDate: start,
  endDate: end,
  status,
});

const YEARS: FiscalYear[] = [
  fy(2568, '2024-10-01', '2025-09-30', 'CLOSED'),
  fy(2569, '2025-10-01', '2026-09-30'),
  fy(2570, '2026-10-01', '2027-09-30'),
];

describe('coversDate', () => {
  it('รวมวันเริ่มและวันสิ้นสุด', () => {
    const year = fy(2569, '2025-10-01', '2026-09-30');
    expect(coversDate(year, '2025-10-01')).toBe(true);
    expect(coversDate(year, '2026-09-30')).toBe(true);
    expect(coversDate(year, '2025-09-30')).toBe(false);
    expect(coversDate(year, '2026-10-01')).toBe(false);
  });
});

describe('findFiscalYearForDate', () => {
  it('หาปีงบประมาณจากวันที่ได้', () => {
    expect(findFiscalYearForDate(YEARS, new Date('2026-01-15T04:00:00Z'))?.yearBE).toBe(2569);
    expect(findFiscalYearForDate(YEARS, new Date('2026-11-15T04:00:00Z'))?.yearBE).toBe(2570);
  });

  it('ตีความวันที่ตามเวลาไทย ไม่ใช่ UTC', () => {
    // 30 ก.ย. 2026 เวลา 23:30 ไทย = 16:30Z ต้องยังอยู่ในปีงบประมาณ 2569
    expect(findFiscalYearForDate(YEARS, new Date('2026-09-30T16:30:00Z'))?.yearBE).toBe(2569);
    // 1 ต.ค. 2026 เวลา 00:30 ไทย = 17:30Z ของวันที่ 30 ก.ย. ต้องเป็นปี 2570 แล้ว
    expect(findFiscalYearForDate(YEARS, new Date('2026-09-30T17:30:00Z'))?.yearBE).toBe(2570);
  });

  it('คืน undefined เมื่อไม่มีปีงบประมาณครอบคลุม', () => {
    expect(findFiscalYearForDate(YEARS, new Date('2030-01-01T04:00:00Z'))).toBeUndefined();
  });
});

describe('requireFiscalYearForDate', () => {
  it('คืนปีงบประมาณที่เปิดอยู่', () => {
    expect(requireFiscalYearForDate(YEARS, new Date('2026-01-15T04:00:00Z')).yearBE).toBe(2569);
  });

  it('ปฏิเสธเมื่อไม่พบปีงบประมาณ พร้อมบอกวิธีแก้', () => {
    try {
      requireFiscalYearForDate(YEARS, new Date('2030-01-01T04:00:00Z'));
      throw new Error('ควรจะโยน error');
    } catch (error) {
      expect(error).toBeInstanceOf(FiscalYearError);
      expect((error as FiscalYearError).code).toBe('NOT_FOUND');
      expect((error as Error).message).toContain('2030-01-01');
    }
  });

  it('ปฏิเสธการบันทึกในปีงบประมาณที่ปิดแล้ว (ข้อ 7.3)', () => {
    try {
      requireFiscalYearForDate(YEARS, new Date('2025-01-15T04:00:00Z'));
      throw new Error('ควรจะโยน error');
    } catch (error) {
      expect((error as FiscalYearError).code).toBe('CLOSED');
    }
  });

  it('ผู้มีสิทธิ์ override บันทึกย้อนหลังในปีที่ปิดแล้วได้', () => {
    const result = requireFiscalYearForDate(YEARS, new Date('2025-01-15T04:00:00Z'), {
      allowClosed: true,
    });
    expect(result.yearBE).toBe(2568);
  });
});

describe('assertFiscalYearValid', () => {
  it('ผ่านเมื่อช่วงวันที่ไม่ทับกับปีที่มีอยู่', () => {
    expect(() =>
      assertFiscalYearValid(
        { yearBE: 2571, startDate: '2027-10-01', endDate: '2028-09-30' },
        YEARS,
      ),
    ).not.toThrow();
  });

  it('ปฏิเสธวันสิ้นสุดที่ไม่อยู่หลังวันเริ่ม', () => {
    for (const [start, end] of [
      ['2027-10-01', '2027-10-01'],
      ['2027-10-01', '2027-09-30'],
    ] as const) {
      expect(() =>
        assertFiscalYearValid({ yearBE: 2571, startDate: start, endDate: end }, YEARS),
      ).toThrow(/วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น/);
    }
  });

  it('ปฏิเสธปี ค.ศ. ที่กรอกผิดช่อง', () => {
    try {
      assertFiscalYearValid(
        { yearBE: 2027, startDate: '2027-10-01', endDate: '2028-09-30' },
        YEARS,
      );
      throw new Error('ควรจะโยน error');
    } catch (error) {
      expect((error as FiscalYearError).code).toBe('INVALID_RANGE');
      expect((error as Error).message).toContain('ปี ค.ศ.');
    }
  });

  it('ปฏิเสธปีงบประมาณที่มีอยู่แล้ว', () => {
    try {
      assertFiscalYearValid(
        { yearBE: 2569, startDate: '2030-10-01', endDate: '2031-09-30' },
        YEARS,
      );
      throw new Error('ควรจะโยน error');
    } catch (error) {
      expect((error as FiscalYearError).code).toBe('DUPLICATE_YEAR');
    }
  });

  it('ปฏิเสธช่วงวันที่ที่ทับกับปีอื่น พร้อมบอกว่าทับกับปีไหน', () => {
    try {
      assertFiscalYearValid(
        { yearBE: 2571, startDate: '2026-06-01', endDate: '2027-05-31' },
        YEARS,
      );
      throw new Error('ควรจะโยน error');
    } catch (error) {
      expect((error as FiscalYearError).code).toBe('OVERLAPPING');
      expect((error as Error).message).toContain('2569');
    }
  });

  it('จับการทับแบบคาบเกี่ยวเพียงวันเดียว', () => {
    expect(() =>
      assertFiscalYearValid(
        { yearBE: 2571, startDate: '2027-09-30', endDate: '2028-09-29' },
        YEARS,
      ),
    ).toThrow(/ทับกับปีงบประมาณ 2570/);
  });
});
