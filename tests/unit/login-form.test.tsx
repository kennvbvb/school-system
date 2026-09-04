import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from '@/features/auth/login-form';

const replace = vi.fn();
const refresh = vi.fn();
const signInWithPassword = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}));

vi.mock('@/lib/supabase/browser-client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { signInWithPassword } }),
}));

beforeEach(() => {
  replace.mockReset();
  refresh.mockReset();
  signInWithPassword.mockReset();
  signInWithPassword.mockResolvedValue({ error: null });
});

describe('LoginForm', () => {
  it('มี label ผูกกับ input ทุกช่อง (NFR-005)', () => {
    render(<LoginForm />);
    expect(screen.getByLabelText('อีเมล')).toBeInTheDocument();
    expect(screen.getByLabelText('รหัสผ่าน')).toBeInTheDocument();
  });

  it('ตรวจรูปแบบอีเมลก่อนยิงไปที่ auth', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText('อีเมล'), 'ไม่ใช่อีเมล');
    await user.type(screen.getByLabelText('รหัสผ่าน'), 'secret');
    await user.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('รูปแบบอีเมลไม่ถูกต้อง');
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('normalize อีเมลเป็นตัวพิมพ์เล็กและตัดช่องว่าง', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText('อีเมล'), '  Staff@Example.COM  ');
    await user.type(screen.getByLabelText('รหัสผ่าน'), 'secret');
    await user.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'staff@example.com',
      password: 'secret',
    });
  });

  it('ข้อความ error ไม่บอกแยกว่าอีเมลไม่มีอยู่หรือรหัสผ่านผิด (ข้อ 19.5)', async () => {
    const user = userEvent.setup();
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    render(<LoginForm />);

    await user.type(screen.getByLabelText('อีเมล'), 'staff@example.com');
    await user.type(screen.getByLabelText('รหัสผ่าน'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    // ต้องไม่รั่วข้อความดิบจาก auth provider ออกไปหน้าจอ
    expect(alert).not.toHaveTextContent('Invalid login credentials');
  });

  it('พาไปหน้าแรกเมื่อเข้าสู่ระบบสำเร็จ', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText('อีเมล'), 'staff@example.com');
    await user.type(screen.getByLabelText('รหัสผ่าน'), 'secret');
    await user.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    expect(replace).toHaveBeenCalledWith('/dashboard');
  });

  it('ปฏิเสธ returnTo ที่ชี้ออกนอกระบบ (open redirect)', async () => {
    const user = userEvent.setup();
    render(<LoginForm returnTo="//evil.example.com/steal" />);

    await user.type(screen.getByLabelText('อีเมล'), 'staff@example.com');
    await user.type(screen.getByLabelText('รหัสผ่าน'), 'secret');
    await user.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    expect(replace).toHaveBeenCalledWith('/dashboard');
  });

  it('ยอมรับ returnTo ที่เป็น path ภายในระบบ', async () => {
    const user = userEvent.setup();
    render(<LoginForm returnTo="/admin/system" />);

    await user.type(screen.getByLabelText('อีเมล'), 'staff@example.com');
    await user.type(screen.getByLabelText('รหัสผ่าน'), 'secret');
    await user.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    expect(replace).toHaveBeenCalledWith('/admin/system');
  });
});
