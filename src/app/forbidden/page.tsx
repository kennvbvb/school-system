import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'ไม่มีสิทธิ์เข้าถึง' };

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">คุณไม่มีสิทธิ์เข้าถึงหน้านี้</h1>
      <p className="text-slate-700">
        หากคิดว่าควรมีสิทธิ์ กรุณาติดต่อผู้ดูแลระบบเพื่อขอมอบหมายบทบาทที่เหมาะสม
      </p>
      <Link href="/dashboard" className="text-brand-700 font-medium underline">
        กลับไปหน้าแรก
      </Link>
    </main>
  );
}
