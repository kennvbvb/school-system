import type { Metadata } from 'next';
import { ResetPasswordPanel } from '@/features/auth/reset-password-panel';

export const metadata: Metadata = {
  title: 'ตั้งรหัสผ่าน',
  // URL หน้านี้อาจมี token ชั่วคราวใน hash ไม่ให้ติดดัชนีของเครื่องมือค้นหาหรือถูกส่งต่อเป็น Referer
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * หน้าตั้งรหัสผ่าน (FR-AUTH-003, แผนข้อ 12.1) — ผู้ถูกเชิญตั้งรหัสผ่านครั้งแรก และผู้ลืมรหัสผ่าน
 *
 * ไม่พาผู้ที่เข้าสู่ระบบแล้วไปหน้าอื่น เพราะผู้ที่กดลิงก์เชิญ/รีเซ็ตจะมี session อยู่แล้ว
 * ตัวหน้าจึงต้องแสดงฟอร์มให้ทั้งกรณีนั้น ส่วนการตัดสินว่าลิงก์ใช้ได้หรือไม่ทำในตัว panel
 */
export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">ตั้งรหัสผ่าน</h1>
        <p className="text-slate-600">ตั้งรหัสผ่านใหม่สำหรับเข้าระบบงานพัสดุและจัดซื้อจัดจ้าง</p>
      </header>

      <ResetPasswordPanel />
    </main>
  );
}
