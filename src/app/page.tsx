import { redirect } from 'next/navigation';

export default function HomePage() {
  // ระบบนี้ไม่มีหน้าสาธารณะ — ผู้ใช้ทุกคนเริ่มที่ dashboard แล้วให้การ์ดตัดสินใจต่อ
  redirect('/dashboard');
}
