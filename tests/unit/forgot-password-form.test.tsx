import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForgotPasswordForm } from '@/features/auth/forgot-password-form';

const resetPasswordForEmail = vi.fn();

vi.mock('@/lib/supabase/browser-client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { resetPasswordForEmail } }),
}));

beforeEach(() => {
  resetPasswordForEmail.mockReset();
  resetPasswordForEmail.mockResolvedValue({ error: null });
});

async function submit(email: string) {
  const user = userEvent.setup();
  render(<ForgotPasswordForm />);
  await user.type(screen.getByLabelText('อีเมล'), email);
  await user.click(screen.getByRole('button', { name: 'ส่งลิงก์ตั้งรหัสผ่านใหม่' }));
}

describe('ForgotPasswordForm', () => {
  it('ตรวจรูปแบบอีเมลก่อนยิงไปที่ auth', async () => {
    await submit('ไม่ใช่อีเมล');

    expect(await screen.findByRole('alert')).toHaveTextContent('รูปแบบอีเมลไม่ถูกต้อง');
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('normalize อีเมล และให้ลิงก์กลับมาที่ origin เดียวกับที่ขอ (PKCE เก็บ verifier ไว้ที่เบราว์เซอร์นี้)', async () => {
    await submit('  Staff@Example.COM  ');

    expect(resetPasswordForEmail).toHaveBeenCalledWith('staff@example.com', {
      redirectTo: `${window.location.origin}/auth/callback`,
    });
  });

  it('แสดงข้อความสำเร็จแบบเดียวกัน ไม่บอกว่าอีเมลมีบัญชีหรือไม่ (ข้อ 19.5)', async () => {
    await submit('someone@example.com');

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('หากอีเมลนี้มีบัญชีอยู่ในระบบ');
    expect(status).toHaveTextContent('เบราว์เซอร์เดียวกับที่ขอ');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ส่งคำขอบ่อยเกินไป (429) บอกให้รอ', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: { status: 429, message: 'rate limit' } });
    await submit('someone@example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent('ขอลิงก์บ่อยเกินไป');
  });

  it('error อื่นไม่รั่วข้อความดิบจาก auth provider', async () => {
    resetPasswordForEmail.mockResolvedValue({
      error: { status: 500, message: 'SMTP host smtp.internal.example unreachable' },
    });
    await submit('someone@example.com');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ส่งคำขอไม่สำเร็จ');
    expect(alert).not.toHaveTextContent('smtp.internal.example');
  });
});
