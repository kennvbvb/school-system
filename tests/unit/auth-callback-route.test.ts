// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const exchangeCodeForSession = vi.fn();

vi.mock('@/server/supabase/server-client', () => ({
  createSupabaseServerClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

import { GET } from '@/app/auth/callback/route';

function call(query: string) {
  return GET(new NextRequest(`https://school.example.com/auth/callback${query}`));
}

beforeEach(() => {
  exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
});

describe('GET /auth/callback', () => {
  it('แลก code สำเร็จ: พาไปหน้าตั้งรหัสผ่าน', async () => {
    const response = await call('?code=abc123');

    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc123');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://school.example.com/reset-password');
  });

  it('ไม่มี code: ไม่เรียก auth และพาไปขอลิงก์ใหม่', async () => {
    const response = await call('');

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(
      'https://school.example.com/forgot-password?error=link',
    );
  });

  it('แลก code ไม่สำเร็จ: พาไปขอลิงก์ใหม่ และไม่ส่งรายละเอียดข้อผิดพลาดใน URL', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    exchangeCodeForSession.mockResolvedValue({
      error: { code: 'flow_state_not_found', message: 'secret internal detail' },
    });
    const response = await call('?code=expired-code');

    const location = response.headers.get('location') ?? '';
    expect(location).toBe('https://school.example.com/forgot-password?error=link');
    expect(location).not.toContain('secret');
    // ห้าม log ค่า code (เป็น credential ชั่วคราว)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('expired-code');
    consoleError.mockRestore();
  });

  it('ไม่รับปลายทางจาก query — ?next= ชี้ออกนอกระบบก็ไม่มีผล (กัน open redirect)', async () => {
    for (const next of ['https://evil.example.com', '//evil.example.com', '/\\evil.example.com']) {
      const response = await call(`?code=abc&next=${encodeURIComponent(next)}`);
      expect(response.headers.get('location')).toBe('https://school.example.com/reset-password');
    }
  });
});
