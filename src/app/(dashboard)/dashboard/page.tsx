import type { Metadata } from 'next';
import { requireUserForPage } from '@/server/auth/guard';
import { formatThaiDate, suggestFiscalYearBE } from '@/lib/format/thai-date';

export const metadata: Metadata = { title: 'หน้าแรก' };

/**
 * Dashboard ตั้งต้นของ Phase 1
 *
 * การ์ดสรุปตัวเลขจริง (FR-RPT-001..005) ยังทำไม่ได้ในเฟสนี้
 * เพราะตารางรายการจัดซื้อและคลังพัสดุจะเกิดใน Phase 3 และ 6
 * หน้านี้จึงยืนยันแค่ว่า auth, การ resolve สิทธิ์ และ app shell ทำงานครบวงจร
 */
export default async function DashboardPage() {
  const user = await requireUserForPage('/dashboard');
  const today = new Date();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">สวัสดี {user.fullNameTh}</h1>
        <p className="text-slate-600">
          วันที่ {formatThaiDate(today)} · ปีงบประมาณ {suggestFiscalYearBE(today)}
        </p>
      </header>

      <section
        aria-labelledby="phase-status-heading"
        className="rounded-lg border border-amber-300 bg-amber-50 p-5"
      >
        <h2 id="phase-status-heading" className="font-semibold text-amber-900">
          <span aria-hidden="true">ℹ </span>
          ระบบอยู่ระหว่างพัฒนา Phase 1 (Foundation)
        </h2>
        <p className="mt-2 text-amber-900">
          ขณะนี้เปิดใช้เฉพาะการเข้าสู่ระบบ การกำหนดสิทธิ์ และโครงหน้าจอ เมนูที่ระบุว่า
          &ldquo;ยังไม่เปิดใช้&rdquo; จะทยอยเปิดตามลำดับเฟสในแผนพัฒนา
        </p>
      </section>

      <section aria-labelledby="my-access-heading" className="space-y-3">
        <h2 id="my-access-heading" className="text-lg font-semibold">
          สิทธิ์ของคุณในระบบ
        </h2>
        {user.permissions.toArray().length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-700">
            บัญชีของคุณยังไม่ได้รับมอบหมายบทบาทใด กรุณาติดต่อผู้ดูแลระบบ
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {user.permissions.toArray().map((permission) => (
              <li
                key={permission}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-mono text-sm"
              >
                {permission}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
