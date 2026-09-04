import type { Metadata } from 'next';
import { REQUIRED_PUBLIC_ENV_VARS } from '@/lib/env/required';

export const metadata: Metadata = { title: 'ยังตั้งค่าระบบไม่เรียบร้อย' };

/**
 * หน้าสำหรับกรณีที่ระบบยังตั้งค่า environment variables ไม่ครบหรือค่าใช้ไม่ได้ (FR-SYS)
 *
 * ก่อนมีหน้านี้ การตั้งค่าไม่ครบหรือค่าผิดรูปแบบทำให้ผู้ใช้เห็นหน้า "เกิดข้อผิดพลาดในระบบ"
 * พร้อมรหัสอ้างอิงเท่านั้น ซึ่งถูกต้องในแง่ความปลอดภัย แต่ผู้ดูแลระบบ
 * แก้ปัญหาไม่ได้เลยถ้าไม่เปิด log ของ Vercel ดู
 *
 * หน้านี้บอกเฉพาะ "ชื่อ" ตัวแปรที่ต้องตั้ง ไม่บอกค่าและไม่บอกว่าตัวไหนผิด
 * ชื่อเหล่านี้เปิดเผยอยู่แล้วใน .env.example จึงไม่ใช่การรั่วข้อมูล
 *
 * ตั้งเป็น static เพราะต้องแสดงผลได้แม้ตอนที่ระบบยังตั้งค่าไม่ครบ
 * ถ้าหน้านี้ต้องอ่าน env เองก็จะพังไปพร้อมกับหน้าอื่น
 */
export const dynamic = 'force-static';

export default function SetupRequiredPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">ยังตั้งค่าระบบไม่เรียบร้อย</h1>
        <p className="text-slate-700">
          ระบบยังใช้งานไม่ได้เพราะการตั้งค่าการเชื่อมต่อยังไม่ครบหรือค่าที่ตั้งไว้ใช้ไม่ได้
          กรุณาแจ้งผู้ดูแลระบบของโรงเรียนให้ตรวจตามรายการด้านล่าง
        </p>
      </header>

      <section
        aria-labelledby="required-vars-heading"
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <h2 id="required-vars-heading" className="font-semibold">
          สำหรับผู้ดูแลระบบ
        </h2>
        <p className="mt-2 text-slate-700">
          ตรวจว่าตั้งค่าตัวแปรเหล่านี้ครบและค่าถูกต้องใน Vercel → Settings → Environment Variables
          และเลือก scope ให้ตรงกับ environment ที่กำลังเปิดอยู่
        </p>

        <ul className="mt-3 space-y-1.5">
          {REQUIRED_PUBLIC_ENV_VARS.map((variable) => (
            <li key={variable.name} className="rounded-md bg-slate-50 px-3 py-2">
              <code className="font-mono text-sm font-semibold">{variable.name}</code>
              <span className="block text-sm text-slate-600">{variable.hintTh}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 space-y-2 text-sm text-slate-700">
          <p>
            <span aria-hidden="true">⚠ </span>
            ตั้งค่าแล้วต้องกด <strong>Redeploy</strong> ทุกครั้ง เพราะค่าใหม่ไม่มีผลกับ deployment
            ที่ build ไปแล้ว
          </p>
          <p>
            <span aria-hidden="true">⚠ </span>
            หาก Vercel เตือนเรื่อง public prefix ให้เลือก <strong>
              Config
            </strong> อย่าลบคำนำหน้า <code className="font-mono">NEXT_PUBLIC_</code> ออก
            เพราะเบราว์เซอร์ต้องอ่านค่าเหล่านี้ได้
          </p>
          <p>
            <span aria-hidden="true">⚠ </span>
            ค่าที่เป็น URL ต้องเป็นที่อยู่เว็บที่ใช้ได้จริง หากคัดลอกมาไม่มี{' '}
            <code className="font-mono">https://</code> ระบบจะเติมให้เอง แต่ถ้าพิมพ์ตกหล่นจนไม่ใช่
            URL จะถือว่ายังตั้งค่าไม่เรียบร้อย
          </p>
          <p>ขั้นตอนโดยละเอียดอยู่ในเอกสาร docs/setup-supabase-vercel.md</p>
        </div>
      </section>
    </main>
  );
}
