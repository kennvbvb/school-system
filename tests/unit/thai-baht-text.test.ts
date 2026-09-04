import { describe, expect, it } from 'vitest';
import { satangToThaiBahtText } from '@/domain/money/thai-baht-text';
import { MoneyError } from '@/domain/money/money';

const bahtText = (baht: string): string => {
  const [whole = '0', fraction = '0'] = baht.split('.');
  return satangToThaiBahtText(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
};

describe('satangToThaiBahtText — กรณีขอบ', () => {
  it('ศูนย์', () => {
    expect(satangToThaiBahtText(0n)).toBe('ศูนย์บาทถ้วน');
  });

  it('จำนวนเต็มลงท้ายด้วย "ถ้วน"', () => {
    expect(bahtText('1')).toBe('หนึ่งบาทถ้วน');
    expect(bahtText('100')).toBe('หนึ่งร้อยบาทถ้วน');
  });

  it('มีสตางค์', () => {
    expect(satangToThaiBahtText(1n)).toBe('ศูนย์บาทหนึ่งสตางค์');
    expect(satangToThaiBahtText(50n)).toBe('ศูนย์บาทห้าสิบสตางค์');
    expect(bahtText('21.25')).toBe('ยี่สิบเอ็ดบาทยี่สิบห้าสตางค์');
    expect(bahtText('1.11')).toBe('หนึ่งบาทสิบเอ็ดสตางค์');
  });
});

describe('satangToThaiBahtText — กฎการอ่านเลขไทย', () => {
  it('ใช้ "เอ็ด" กับหลักหน่วยที่เป็น 1 เมื่อมีหลักสูงกว่า', () => {
    expect(bahtText('11')).toBe('สิบเอ็ดบาทถ้วน');
    expect(bahtText('21')).toBe('ยี่สิบเอ็ดบาทถ้วน');
    expect(bahtText('101')).toBe('หนึ่งร้อยเอ็ดบาทถ้วน');
    expect(bahtText('1000001')).toBe('หนึ่งล้านเอ็ดบาทถ้วน');
  });

  it('ใช้ "ยี่สิบ" และ "สิบ" โดยไม่มี "หนึ่ง" นำหน้า', () => {
    expect(bahtText('10')).toBe('สิบบาทถ้วน');
    expect(bahtText('20')).toBe('ยี่สิบบาทถ้วน');
    expect(bahtText('30')).toBe('สามสิบบาทถ้วน');
  });

  it('ข้ามหลักที่เป็นศูนย์', () => {
    expect(bahtText('1005')).toBe('หนึ่งพันห้าบาทถ้วน');
    expect(bahtText('100000')).toBe('หนึ่งแสนบาทถ้วน');
    expect(bahtText('205')).toBe('สองร้อยห้าบาทถ้วน');
  });
});

describe('satangToThaiBahtText — หลักล้านซ้ำ', () => {
  it('อ่านล้านชั้นเดียว', () => {
    expect(bahtText('1000000')).toBe('หนึ่งล้านบาทถ้วน');
    expect(bahtText('2500000')).toBe('สองล้านห้าแสนบาทถ้วน');
  });

  it('อ่านกลุ่มหลักที่ซ้อนกัน', () => {
    expect(bahtText('1234567')).toBe('หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทถ้วน');
  });

  it('รองรับค่าสูงสุดที่ระบบกำหนด (999,999,999,999.99 บาท)', () => {
    const nineHundredNinetyNineThousand = 'เก้าแสนเก้าหมื่นเก้าพันเก้าร้อยเก้าสิบเก้า';
    expect(bahtText('999999999999.99')).toBe(
      `${nineHundredNinetyNineThousand}ล้าน${nineHundredNinetyNineThousand}บาทเก้าสิบเก้าสตางค์`,
    );
  });

  it('ค่าที่ต้องอ่านว่า "ล้านล้าน" อยู่เหนือเพดานที่ระบบรองรับโดยตั้งใจ', () => {
    // 1,000,000,000,000 บาท = 1e14 สตางค์ ซึ่งเกิน MAX_SATANG
    // ระบบงานพัสดุโรงเรียนไม่มียอดระดับนี้ การมีเพดานช่วยจับข้อมูลที่กรอกผิด
    expect(() => bahtText('1000000000000')).toThrow(MoneyError);
  });
});

describe('satangToThaiBahtText — ค่าติดลบและค่าเกินเพดาน', () => {
  it('เติม "ลบ" นำหน้า', () => {
    expect(satangToThaiBahtText(-50n)).toBe('ลบศูนย์บาทห้าสิบสตางค์');
    expect(satangToThaiBahtText(-10_000n)).toBe('ลบหนึ่งร้อยบาทถ้วน');
  });

  it('ปฏิเสธค่าที่เกินเพดาน', () => {
    expect(() => satangToThaiBahtText(100_000_000_000_000n)).toThrow(MoneyError);
  });
});
