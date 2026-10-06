import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, newPasswordSchema } from '@/domain/auth/password';

function parse(password: string, confirmPassword = password) {
  return newPasswordSchema.safeParse({ password, confirmPassword });
}

function firstMessage(result: ReturnType<typeof parse>): string | undefined {
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('newPasswordSchema', () => {
  it('รับรหัสผ่านที่ยาวพอและตรงกัน', () => {
    expect(parse('a'.repeat(PASSWORD_MIN_LENGTH)).success).toBe(true);
    // 22 ตัวอักษรไทย = 66 ไบต์ อยู่ในเพดาน 72 ไบต์
    expect(parse('ข้าวผัดกะเพราไก่ไข่ดาว').success).toBe(true);
  });

  it('ปฏิเสธรหัสผ่านที่สั้นกว่าขั้นต่ำพอดีหนึ่งตัว', () => {
    expect(parse('a'.repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(false);
    expect(firstMessage(parse('short'))).toContain(String(PASSWORD_MIN_LENGTH));
  });

  it('ปฏิเสธเมื่อสองช่องไม่ตรงกัน และชี้ที่ช่องยืนยัน', () => {
    const result = parse('a'.repeat(PASSWORD_MIN_LENGTH), 'b'.repeat(PASSWORD_MIN_LENGTH));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['confirmPassword']);
      expect(result.error.issues[0]?.message).toBe('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    }
  });

  it('นับความยาวสูงสุดเป็นไบต์ — ภาษาไทยตัวละ 3 ไบต์ (bcrypt รับไม่เกิน 72 ไบต์)', () => {
    // 24 ตัวอักษรไทย = 72 ไบต์ พอดี
    expect(parse('ก'.repeat(PASSWORD_MAX_BYTES / 3)).success).toBe(true);
    // 25 ตัว = 75 ไบต์ ทั้งที่ยาวไม่ถึง 72 ตัวอักษร
    const tooLong = parse('ก'.repeat(PASSWORD_MAX_BYTES / 3 + 1));
    expect(tooLong.success).toBe(false);
    expect(firstMessage(tooLong)).toContain('ไบต์');

    // วลีไทยที่ฟังดูไม่ยาว (31 ตัวอักษร = 93 ไบต์) ก็เกินเพดาน ผู้ใช้ต้องได้ข้อความที่อธิบายเหตุผลนี้
    const thaiSentence = parse('ฉันชอบกินข้าวผัดกะเพราไก่ไข่ดาว');
    expect(thaiSentence.success).toBe(false);
    expect(firstMessage(thaiSentence)).toContain('ตัวอักษรไทยนับตัวละ 3 ไบต์');

    // ภาษาอังกฤษ 72 ตัว = 72 ไบต์ ผ่าน และ 73 ตัวไม่ผ่าน
    expect(parse('a'.repeat(PASSWORD_MAX_BYTES)).success).toBe(true);
    expect(parse('a'.repeat(PASSWORD_MAX_BYTES + 1)).success).toBe(false);
  });

  it('ปฏิเสธรหัสผ่านที่เป็นช่องว่างล้วน แต่ไม่ตัดช่องว่างของรหัสที่มีตัวอักษร', () => {
    expect(parse(' '.repeat(PASSWORD_MIN_LENGTH)).success).toBe(false);
    // ช่องว่างหัวท้ายเป็นส่วนของรหัสได้ — ต้องไม่ถูก trim จนความยาวเปลี่ยน
    const padded = `  ${'a'.repeat(PASSWORD_MIN_LENGTH - 2)}  `;
    const result = parse(padded);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.password).toBe(padded);
  });
});
