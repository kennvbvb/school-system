import { describe, expect, it } from 'vitest';
import {
  AUTH_CALLBACK_PATH,
  FORGOT_PASSWORD_PATH,
  RESET_PASSWORD_PATH,
  joinAppUrl,
  parseAuthHash,
} from '@/domain/auth/auth-link';

describe('parseAuthHash', () => {
  it('hash ว่างหรือไม่เกี่ยวกับ auth ไม่ใช่ความผิดพลาด', () => {
    expect(parseAuthHash('')).toEqual({ kind: 'none' });
    expect(parseAuthHash('#')).toEqual({ kind: 'none' });
    expect(parseAuthHash('#section-2')).toEqual({ kind: 'none' });
  });

  it('อ่าน token จากลิงก์เชิญ', () => {
    expect(
      parseAuthHash('#access_token=aaa&refresh_token=rrr&expires_in=3600&type=invite'),
    ).toEqual({ kind: 'session', accessToken: 'aaa', refreshToken: 'rrr', linkType: 'invite' });
  });

  it('อ่าน token จากลิงก์รีเซ็ต และรับ hash ที่ไม่มี # นำหน้า', () => {
    expect(parseAuthHash('access_token=aaa&refresh_token=rrr&type=recovery')).toEqual({
      kind: 'session',
      accessToken: 'aaa',
      refreshToken: 'rrr',
      linkType: 'recovery',
    });
  });

  it('ปฏิเสธชนิดลิงก์ที่ไม่ใช่ทางเข้าของหน้าตั้งรหัสผ่าน (magiclink, signup, ไม่ระบุ)', () => {
    for (const type of ['magiclink', 'signup', 'email_change', 'x']) {
      expect(parseAuthHash(`#access_token=a&refresh_token=r&type=${type}`)).toEqual({
        kind: 'error',
        reason: 'invalid',
      });
    }
    expect(parseAuthHash('#access_token=a&refresh_token=r')).toEqual({
      kind: 'error',
      reason: 'invalid',
    });
  });

  it('ปฏิเสธเมื่อมี token ไม่ครบคู่', () => {
    expect(parseAuthHash('#access_token=a&type=invite')).toEqual({
      kind: 'error',
      reason: 'invalid',
    });
    expect(parseAuthHash('#refresh_token=r&type=invite')).toEqual({
      kind: 'error',
      reason: 'invalid',
    });
  });

  it('ปฏิเสธ token ที่ยาวผิดปกติ', () => {
    const long = 'a'.repeat(9000);
    expect(parseAuthHash(`#access_token=${long}&refresh_token=r&type=invite`)).toEqual({
      kind: 'error',
      reason: 'invalid',
    });
  });

  it('แยกลิงก์หมดอายุ/ถูกใช้ไปแล้ว ออกจากลิงก์ผิดรูปแบบ', () => {
    expect(
      parseAuthHash(
        '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      ),
    ).toEqual({ kind: 'error', reason: 'expired' });

    expect(parseAuthHash('#error=server_error&error_description=Something+went+wrong')).toEqual({
      kind: 'error',
      reason: 'invalid',
    });
  });

  it('ผลฝั่ง error ไม่มีค่า token หลุดออกมา (FR-AUD-004)', () => {
    const result = parseAuthHash('#error=access_denied&access_token=SECRET&refresh_token=SECRET2');
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});

describe('joinAppUrl', () => {
  it('ต่อ URL กับ path และตัด / ท้ายของฐานออก', () => {
    expect(joinAppUrl('https://school.example.com', RESET_PASSWORD_PATH)).toBe(
      'https://school.example.com/reset-password',
    );
    expect(joinAppUrl('https://school.example.com/', RESET_PASSWORD_PATH)).toBe(
      'https://school.example.com/reset-password',
    );
    expect(joinAppUrl('https://school.example.com///', AUTH_CALLBACK_PATH)).toBe(
      'https://school.example.com/auth/callback',
    );
  });

  it('ปฏิเสธ path ที่ไม่ใช่ path ภายใน', () => {
    expect(() => joinAppUrl('https://school.example.com', 'reset-password')).toThrow();
    expect(() => joinAppUrl('https://school.example.com', '//evil.example.com')).toThrow();
    expect(() => joinAppUrl('https://school.example.com', 'https://evil.example.com')).toThrow();
  });

  it('path ที่ใช้จริงตรงกับแผนข้อ 12.1', () => {
    expect(RESET_PASSWORD_PATH).toBe('/reset-password');
    expect(FORGOT_PASSWORD_PATH).toBe('/forgot-password');
  });
});
