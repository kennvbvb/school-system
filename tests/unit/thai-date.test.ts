import { describe, expect, it } from 'vitest';
import {
  formatThaiDate,
  formatThaiDateTime,
  getBangkokParts,
  suggestFiscalYearBE,
  toBangkokDateString,
  toDisplayYear,
} from '@/lib/format/thai-date';

describe('getBangkokParts', () => {
  it('แปลง UTC เป็นเวลาไทย (+7)', () => {
    const parts = getBangkokParts(new Date('2026-09-03T10:30:00Z'));
    expect(parts).toMatchObject({ year: 2026, month: 9, day: 3, hour: 17, minute: 30 });
  });

  it('ข้ามวันเมื่อ UTC ใกล้เที่ยงคืน', () => {
    const parts = getBangkokParts(new Date('2026-09-03T18:00:00Z'));
    expect(parts).toMatchObject({ year: 2026, month: 9, day: 4, hour: 1 });
  });

  it('คืนชั่วโมง 0 ไม่ใช่ 24 สำหรับเที่ยงคืนเวลาไทย', () => {
    expect(getBangkokParts(new Date('2026-09-03T17:00:00Z')).hour).toBe(0);
  });

  it('ปฏิเสธวันที่ไม่ถูกต้อง', () => {
    expect(() => getBangkokParts(new Date('ไม่ใช่วันที่'))).toThrow(RangeError);
  });
});

describe('toBangkokDateString', () => {
  it('คืนวันที่ทางธุรกิจตามเวลาไทย ไม่ใช่ UTC', () => {
    expect(toBangkokDateString(new Date('2026-09-03T18:00:00Z'))).toBe('2026-09-04');
    expect(toBangkokDateString(new Date('2026-01-05T02:00:00Z'))).toBe('2026-01-05');
  });
});

describe('formatThaiDate', () => {
  it('แสดงปี พ.ศ. โดยค่าเริ่มต้น', () => {
    expect(formatThaiDate(new Date('2026-09-03T04:00:00Z'))).toBe('3 กันยายน 2569');
  });

  it('แสดงปี ค.ศ. เมื่อผู้ใช้เลือก', () => {
    expect(formatThaiDate(new Date('2026-09-03T04:00:00Z'), { era: 'CE' })).toBe('3 กันยายน 2026');
  });

  it('รองรับชื่อเดือนย่อ', () => {
    expect(formatThaiDate(new Date('2026-02-01T04:00:00Z'), { month: 'short' })).toBe(
      '1 ก.พ. 2569',
    );
  });
});

describe('formatThaiDateTime', () => {
  it('แสดงวันที่ย่อพร้อมเวลาไทย', () => {
    expect(formatThaiDateTime(new Date('2026-09-03T07:05:00Z'))).toBe('3 ก.ย. 2569 14:05 น.');
  });
});

describe('toDisplayYear', () => {
  it('แปลง ค.ศ. เป็น พ.ศ. เฉพาะตอนแสดงผล', () => {
    expect(toDisplayYear(2026, 'BE')).toBe(2569);
    expect(toDisplayYear(2026, 'CE')).toBe(2026);
  });
});

describe('suggestFiscalYearBE', () => {
  it('ปีงบประมาณเริ่ม 1 ตุลาคม', () => {
    expect(suggestFiscalYearBE(new Date('2026-09-30T16:00:00Z'))).toBe(2569); // 30 ก.ย. 2569 เวลาไทย
    expect(suggestFiscalYearBE(new Date('2026-09-30T17:00:00Z'))).toBe(2570); // 1 ต.ค. 2569 เวลาไทย
    expect(suggestFiscalYearBE(new Date('2026-12-15T04:00:00Z'))).toBe(2570);
    expect(suggestFiscalYearBE(new Date('2027-01-15T04:00:00Z'))).toBe(2570);
  });
});
