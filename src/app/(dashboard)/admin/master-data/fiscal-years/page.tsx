import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermissionForPage } from '@/server/auth/guard';
import { listFiscalYears } from '@/server/master-data/repository';
import { closeFiscalYear, createFiscalYear, reopenFiscalYear } from '@/server/master-data/actions';
import { formatThaiDate } from '@/lib/format/thai-date';
import { FiscalYearForm } from '@/features/master-data/fiscal-year-form';
import { ReasonActionButton } from '@/features/master-data/reason-action-button';

export const metadata: Metadata = { title: 'ปีงบประมาณ' };

/**
 * จัดการปีงบประมาณ (FR-MST-002)
 *
 * ใช้สิทธิ์ `settings.manage` ตรงกับ policy ใน migration 0004 — ปีงบประมาณ
 * ไม่ใช่ข้อมูลพื้นฐานทั่วไป เพราะการปิดปีเปลี่ยนว่าใครบันทึกรายการอะไรได้บ้าง
 */
export default async function FiscalYearsPage() {
  await requirePermissionForPage('/admin/master-data/fiscal-years', 'settings.manage');
  const fiscalYears = await listFiscalYears();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/admin/master-data" className="text-sm text-sky-800 underline">
          ← ข้อมูลพื้นฐาน
        </Link>
        <h1 className="text-2xl font-semibold">ปีงบประมาณ</h1>
        <p className="text-slate-600">
          ช่วงวันที่ของแต่ละปีต้องไม่ทับกัน เพราะระบบต้องหาปีงบประมาณจากวันที่ได้คำตอบเดียว
        </p>
      </header>

      <section
        aria-labelledby="add-heading"
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <h2 id="add-heading" className="mb-4 text-lg font-semibold">
          เพิ่มปีงบประมาณ
        </h2>
        <FiscalYearForm action={createFiscalYear} />
      </section>

      <section aria-labelledby="list-heading" className="space-y-3">
        <h2 id="list-heading" className="text-lg font-semibold">
          ปีงบประมาณที่มีอยู่
        </h2>

        {fiscalYears.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">
            ยังไม่มีปีงบประมาณ — ต้องเพิ่มอย่างน้อยหนึ่งปีก่อนจึงจะสร้างโครงการและบัญชีงบได้
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[42rem] text-sm">
              <caption className="sr-only">รายการปีงบประมาณทั้งหมด</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    รหัส
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    ปี พ.ศ.
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    ช่วงวันที่
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    สถานะ
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    การจัดการ
                  </th>
                </tr>
              </thead>
              <tbody>
                {fiscalYears.map((year) => (
                  <tr key={year.id} className="border-b border-slate-100 align-top last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">{year.code}</td>
                    <td className="px-4 py-3 tabular-nums">{year.yearBE}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatThaiDate(new Date(`${year.startDate}T00:00:00Z`))} –{' '}
                      {formatThaiDate(new Date(`${year.endDate}T00:00:00Z`))}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          year.status === 'OPEN'
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {year.status === 'OPEN' ? 'เปิดอยู่' : 'ปิดแล้ว'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {year.status === 'OPEN' ? (
                        <ReasonActionButton
                          label="ปิดปีงบประมาณ"
                          title={`ปิดปีงบประมาณ ${year.code}`}
                          confirmLabel="ยืนยันการปิด"
                          reasonLabel="เหตุผลการปิด"
                          variant="danger"
                          action={async (reason) => {
                            'use server';
                            return closeFiscalYear({ fiscalYearId: year.id, reason });
                          }}
                        />
                      ) : (
                        <ReasonActionButton
                          label="เปิดกลับมา"
                          title={`เปิดปีงบประมาณ ${year.code} กลับมา`}
                          confirmLabel="ยืนยันการเปิด"
                          reasonLabel="เหตุผลที่ต้องเปิดกลับมา"
                          action={async (reason) => {
                            'use server';
                            return reopenFiscalYear({ fiscalYearId: year.id, reason });
                          }}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
