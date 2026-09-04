'use client';

import { useEffect } from 'react';

/**
 * Error boundary ระดับแอป
 *
 * แสดง digest ที่ Next.js สร้างให้ผู้ใช้แจ้งเจ้าหน้าที่ได้ (ข้อ 12.6, NFR-009)
 * และตั้งใจไม่แสดง stack trace หรือข้อความจากระบบภายในบนหน้าจอผู้ใช้
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app] เกิดข้อผิดพลาดที่ไม่ได้จัดการ', {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">เกิดข้อผิดพลาดในระบบ</h1>
      <p className="text-slate-700">
        ระบบไม่สามารถทำรายการนี้ให้เสร็จได้ กรุณาลองใหม่อีกครั้ง
        หากยังพบปัญหาให้แจ้งผู้ดูแลระบบพร้อมรหัสอ้างอิงด้านล่าง
      </p>
      {error.digest ? (
        <p className="rounded-md bg-slate-100 px-4 py-3 font-mono text-sm">
          รหัสอ้างอิง: {error.digest}
        </p>
      ) : null}
      <div>
        <button
          type="button"
          onClick={reset}
          className="bg-brand-600 hover:bg-brand-700 rounded-md px-5 py-2.5 font-medium text-white"
        >
          ลองอีกครั้ง
        </button>
      </div>
    </main>
  );
}
