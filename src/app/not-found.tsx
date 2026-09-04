import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">ไม่พบหน้าที่ต้องการ</h1>
      <p className="text-slate-700">หน้าที่คุณเปิดอาจถูกย้าย ถูกลบ หรือคุณอาจพิมพ์ที่อยู่ผิด</p>
      <Link href="/dashboard" className="text-brand-700 font-medium underline">
        กลับไปหน้าแรก
      </Link>
    </main>
  );
}
