import { describe, expect, it } from 'vitest';
import { redactSensitive } from '@/lib/redact';

/**
 * FR-AUD-004 — ห้ามบันทึกรหัสผ่าน token หรือ secret ลง audit log
 * test นี้เป็นด่านสุดท้ายก่อนข้อมูลถูกเขียนลงตารางที่แก้ไม่ได้
 */
describe('redactSensitive', () => {
  it('ปิดค่าของ field ที่อ่อนไหวในระดับบนสุด', () => {
    expect(redactSensitive({ email: 'a@example.com', password: 'p' })).toEqual({
      email: 'a@example.com',
      password: '[redacted]',
    });
  });

  it('ปิดค่าที่ซ้อนอยู่ในวัตถุและอาร์เรย์', () => {
    expect(
      redactSensitive({
        user: { name: 'ทดสอบ', credentials: { access_token: 'x', refresh_token: 'y' } },
        sessions: [{ id: 1, token: 'z' }],
      }),
    ).toEqual({
      user: {
        name: 'ทดสอบ',
        credentials: { access_token: '[redacted]', refresh_token: '[redacted]' },
      },
      sessions: [{ id: 1, token: '[redacted]' }],
    });
  });

  it('จับชื่อ field ได้แม้เขียนคนละรูปแบบ', () => {
    const result = redactSensitive({
      apiKey: 'a',
      'API-KEY': 'b',
      api_key: 'c',
      serviceRoleKey: 'd',
      Authorization: 'Bearer e',
      Cookie: 'f',
      bank_data_encrypted: { accountNo: '123' },
    }) as Record<string, unknown>;

    for (const value of Object.values(result)) {
      expect(value).toBe('[redacted]');
    }
  });

  it('ไม่แตะค่าที่ไม่อ่อนไหว', () => {
    const input = {
      subject: 'จัดซื้อวัสดุสำนักงาน',
      grandTotal: '1234.56',
      itemCount: 3,
      approved: true,
      cancelledAt: null,
    };
    expect(redactSensitive(input)).toEqual(input);
  });

  it('ไม่วนลูปไม่รู้จบกับโครงสร้างที่อ้างถึงตัวเอง', () => {
    const cyclic: Record<string, unknown> = { name: 'ทดสอบ' };
    cyclic.self = cyclic;
    expect(() => redactSensitive(cyclic)).not.toThrow();
  });

  it('คืนค่า primitive ตามเดิม', () => {
    expect(redactSensitive('ข้อความ')).toBe('ข้อความ');
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive(undefined)).toBe(undefined);
  });
});
