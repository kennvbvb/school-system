import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/features/auth/login-form';
import { getCurrentUser } from '@/server/auth/session';

export const metadata: Metadata = { title: 'เข้าสู่ระบบ' };

// หน้านี้อ่าน session จาก cookie เพื่อพาผู้ที่เข้าสู่ระบบแล้วไปหน้าแรก จึงเป็น dynamic เสมอ
export const dynamic = 'force-dynamic';

/**
 * หน้าเข้าสู่ระบบ (FR-AUTH-001, FR-AUTH-002)
 *
 * ไม่มีลิงก์ "สมัครสมาชิก" โดยเจตนา — บัญชีสร้างโดยผู้ดูแลระบบเท่านั้น
 * และ Supabase Auth ปิด enable_signup ไว้ที่ระดับโครงการอีกชั้นหนึ่ง
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  const { returnTo } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">ระบบงานพัสดุและจัดซื้อจัดจ้าง</h1>
        <p className="text-slate-600">สำหรับบุคลากรภายในโรงเรียนเท่านั้น</p>
      </header>

      <LoginForm returnTo={returnTo} />

      <p className="text-sm text-slate-600">
        ระบบนี้ไม่เปิดให้สมัครสมาชิกเอง หากยังไม่มีบัญชีหรือเข้าใช้งานไม่ได้
        กรุณาติดต่อผู้ดูแลระบบของโรงเรียน
      </p>
    </main>
  );
}
