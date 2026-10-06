import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetPasswordPanel } from '@/features/auth/reset-password-panel';

const replace = vi.fn();
const refresh = vi.fn();
const setSession = vi.fn();
const getUser = vi.fn();
const updateUser = vi.fn();
const signOut = vi.fn();
const recordPasswordSet = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}));

vi.mock('@/lib/supabase/browser-client', () => ({
  createSupabaseBrowserClientWithoutUrlDetection: () => ({
    auth: { setSession, getUser, updateUser, signOut },
  }),
}));

vi.mock('@/server/auth/actions', () => ({
  recordPasswordSet: () => recordPasswordSet(),
}));

const GOOD_PASSWORD = 'correct horse battery staple';

function openAt(hash: string) {
  window.history.replaceState(null, '', `/reset-password${hash}`);
}

beforeEach(() => {
  replace.mockReset();
  refresh.mockReset();
  setSession.mockReset().mockResolvedValue({ error: null });
  getUser.mockReset().mockResolvedValue({ data: { user: null } });
  updateUser.mockReset().mockResolvedValue({ error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
  recordPasswordSet.mockReset().mockResolvedValue(undefined);
  openAt('');
});

async function fillAndSubmit(password: string, confirm = password) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('รหัสผ่านใหม่'), password);
  await user.type(screen.getByLabelText('ยืนยันรหัสผ่านใหม่'), confirm);
  await user.click(screen.getByRole('button', { name: 'ตั้งรหัสผ่าน' }));
}

describe('ResetPasswordPanel — การตรวจลิงก์', () => {
  it('ลิงก์เชิญ: ตั้ง session จาก hash แล้วลบ token ออกจาก URL ก่อน', async () => {
    openAt('#access_token=ACCESS&refresh_token=REFRESH&type=invite');
    render(<ResetPasswordPanel />);

    expect(await screen.findByLabelText('รหัสผ่านใหม่')).toBeInTheDocument();
    expect(setSession).toHaveBeenCalledWith({ access_token: 'ACCESS', refresh_token: 'REFRESH' });
    // token ต้องไม่ค้างใน URL (ประวัติเบราว์เซอร์/Referer)
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('ACCESS');
    expect(getUser).not.toHaveBeenCalled();
  });

  it('ลิงก์รีเซ็ตที่แลก code แล้ว: ไม่มี hash แต่มี session ใน cookie ก็แสดงฟอร์ม', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    render(<ResetPasswordPanel />);

    expect(await screen.findByLabelText('รหัสผ่านใหม่')).toBeInTheDocument();
    expect(setSession).not.toHaveBeenCalled();
  });

  it('ไม่มี token และไม่มี session: ไม่แสดงฟอร์ม และชี้ไปขอลิงก์ใหม่', async () => {
    render(<ResetPasswordPanel />);

    expect(await screen.findByRole('alert')).toHaveTextContent('ลิงก์ไม่ถูกต้อง');
    expect(screen.queryByLabelText('รหัสผ่านใหม่')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'หน้าลืมรหัสผ่าน' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('ลิงก์หมดอายุ/ถูกใช้แล้ว: บอกตรง ๆ และไม่เรียก auth', async () => {
    openAt('#error=access_denied&error_code=otp_expired&error_description=expired');
    render(<ResetPasswordPanel />);

    expect(await screen.findByRole('alert')).toHaveTextContent('ลิงก์หมดอายุหรือถูกใช้ไปแล้ว');
    expect(setSession).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('token ที่ Supabase ปฏิเสธ: ไม่แสดงฟอร์ม', async () => {
    setSession.mockResolvedValue({ error: { message: 'invalid JWT' } });
    openAt('#access_token=BAD&refresh_token=BAD&type=invite');
    render(<ResetPasswordPanel />);

    expect(await screen.findByRole('alert')).toHaveTextContent('ลิงก์หมดอายุหรือถูกใช้ไปแล้ว');
    expect(screen.queryByLabelText('รหัสผ่านใหม่')).not.toBeInTheDocument();
  });

  it('ชนิดลิงก์ที่ไม่ใช่ invite/recovery ถูกปฏิเสธ ไม่ตั้ง session', async () => {
    openAt('#access_token=A&refresh_token=R&type=magiclink');
    render(<ResetPasswordPanel />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(setSession).not.toHaveBeenCalled();
  });
});

describe('ResetPasswordPanel — การตั้งรหัสผ่าน', () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  });

  it('ใช้ autocomplete=new-password และมี label ผูกทุกช่อง (NFR-005)', async () => {
    render(<ResetPasswordPanel />);

    expect(await screen.findByLabelText('รหัสผ่านใหม่')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
    expect(screen.getByLabelText('ยืนยันรหัสผ่านใหม่')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
  });

  it('รหัสผ่านสั้นเกิน: แจ้งและไม่ยิงไปที่ auth', async () => {
    render(<ResetPasswordPanel />);
    await fillAndSubmit('short');

    expect(await screen.findByRole('alert')).toHaveTextContent('อย่างน้อย 12 ตัวอักษร');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('สองช่องไม่ตรงกัน: แจ้งและไม่ยิงไปที่ auth', async () => {
    render(<ResetPasswordPanel />);
    await fillAndSubmit(GOOD_PASSWORD, `${GOOD_PASSWORD}x`);

    expect(await screen.findByRole('alert')).toHaveTextContent('ไม่ตรงกัน');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('สำเร็จ: เปลี่ยนรหัสผ่าน ตัด session อื่น บันทึก audit แล้วไปหน้าแรก', async () => {
    render(<ResetPasswordPanel />);
    await fillAndSubmit(GOOD_PASSWORD);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(updateUser).toHaveBeenCalledWith({ password: GOOD_PASSWORD });
    expect(signOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(recordPasswordSet).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
  });

  it('ตัด session อื่นล้มเหลว (reject): ยังถือว่าสำเร็จ เพราะรหัสผ่านเปลี่ยนไปแล้ว', async () => {
    signOut.mockRejectedValue(new Error('network'));
    render(<ResetPasswordPanel />);
    await fillAndSubmit(GOOD_PASSWORD);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(recordPasswordSet).toHaveBeenCalledTimes(1);
  });

  it('รหัสผ่านซ้ำกับของเดิม: แปลเป็นข้อความที่แก้ได้ และไม่ไปหน้าแรก', async () => {
    updateUser.mockResolvedValue({
      error: { code: 'same_password', message: 'New password should be different' },
    });
    render(<ResetPasswordPanel />);
    await fillAndSubmit(GOOD_PASSWORD);

    expect(await screen.findByRole('alert')).toHaveTextContent('ต้องไม่ซ้ำกับรหัสผ่านเดิม');
    expect(replace).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(recordPasswordSet).not.toHaveBeenCalled();
  });

  it('รหัสผ่านอ่อนตามเกณฑ์ของ Supabase: แปลเป็นข้อความไทย', async () => {
    updateUser.mockResolvedValue({ error: { code: 'weak_password', message: 'weak' } });
    render(<ResetPasswordPanel />);
    await fillAndSubmit(GOOD_PASSWORD);

    expect(await screen.findByRole('alert')).toHaveTextContent('ไม่ผ่านเกณฑ์ความปลอดภัย');
  });

  it('error อื่นไม่รั่วข้อความดิบ และไม่ log ค่ารหัสผ่าน', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    updateUser.mockResolvedValue({
      error: { code: 'unexpected_failure', message: `db error for ${GOOD_PASSWORD}` },
    });
    render(<ResetPasswordPanel />);
    await fillAndSubmit(GOOD_PASSWORD);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ตั้งรหัสผ่านไม่สำเร็จ');
    expect(alert).not.toHaveTextContent(GOOD_PASSWORD);
    // ห้ามมีรหัสผ่านใน log ไม่ว่าทางใด (FR-AUD-004)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(GOOD_PASSWORD);
    consoleError.mockRestore();
  });
});
