import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@/lib/checksum';

describe('sha256Hex', () => {
  it('ให้ค่าตรงกับ SHA-256 ที่รู้คำตอบอยู่แล้ว (ข้อความว่าง)', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('ให้ค่าตรงกับ SHA-256 ที่รู้คำตอบอยู่แล้ว ("abc")', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('รับ Buffer ได้เช่นเดียวกับ string และให้ผลตรงกันเมื่อเนื้อหาเดียวกัน', () => {
    expect(sha256Hex(Buffer.from('abc', 'utf-8'))).toBe(sha256Hex('abc'));
  });

  it('เนื้อหาต่างกันแม้เพียงอักขระเดียวต้องได้ checksum ต่างกัน', () => {
    expect(sha256Hex('abc')).not.toBe(sha256Hex('abd'));
  });

  it('คืนข้อความ hex ความยาว 64 ตัวอักษรเสมอ (256 บิต)', () => {
    expect(sha256Hex('เนื้อหาภาษาไทยก็ต้องใช้ได้')).toHaveLength(64);
  });
});
