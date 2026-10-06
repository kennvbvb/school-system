import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotPasswordForm } from '@/features/auth/forgot-password-form';

export const metadata: Metadata = { title: 'ลืมรหัสผ่าน' };

// อ่าน query ของ request จึงเป็น dynamic เสมอ
export const dynamic = 'force-dynamic';

/**
 * หน้าขอลิงก์รีเซ็ตรหัสผ่าน (FR-AUTH-003, แผนข้อ 12.1)
 *
 * เป็นหน้าสาธารณะ จึงต้องตอบเหมือนกันไม่ว่าอีเมลมีบัญชีหรือไม่ — ดูที่ ForgotPasswordForm
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">ลืมรหัสผ่าน</h1>
        <p className="text-slate-600">
          กรอกอีเมลที่ใช้เข้าระบบ แล้วเราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้
        </p>
      </header>

      {/* รหัสเดียวที่ /auth/callback ส่งมา ไม่แสดงค่าอื่นจาก query ลงหน้าจอ */}
      {error === 'link' ? (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-900"
        >
          <span aria-hidden="true">⚠ </span>
          ลิงก์ไม่ถูกต้อง หมดอายุ หรือเปิดคนละเบราว์เซอร์กับที่ขอ กรุณาขอลิงก์ใหม่ด้านล่าง
          แล้วเปิดลิงก์ในเบราว์เซอร์เดียวกัน
        </p>
      ) : null}

      <ForgotPasswordForm />

      <p className="text-sm">
        <Link href="/login" className="text-brand-700 underline">
          กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </p>
    </main>
  );
}
