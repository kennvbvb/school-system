import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermissionForPage } from '@/server/auth/guard';
import { listFundingSources } from '@/server/master-data/repository';
import { createFundingSource, setFundingSourceActive } from '@/server/master-data/actions';
import { FundingSourceForm } from '@/features/master-data/funding-source-form';
import { ActiveToggleButton } from '@/features/master-data/active-toggle-button';

export const metadata: Metadata = { title: 'แหล่งเงิน' };

/** จัดการแหล่งเงิน (FR-MST-006) — ที่มาของเงินที่ใช้ข้ามปีงบประมาณได้ */
export default async function FundingSourcesPage() {
  await requirePermissionForPage('/admin/master-data/funding-sources', 'masters.manage');
  const fundingSources = await listFundingSources();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/admin/master-data" className="text-sm text-sky-800 underline">
          ← ข้อมูลพื้นฐาน
        </Link>
        <h1 className="text-2xl font-semibold">แหล่งเงิน</h1>
        <p className="text-slate-600">
          แหล่งเงินไม่ผูกกับปีงบประมาณ จึงเพิ่มครั้งเดียวแล้วใช้ได้ทุกปี
        </p>
      </header>

      <section
        aria-labelledby="add-heading"
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <h2 id="add-heading" className="mb-4 text-lg font-semibold">
          เพิ่มแหล่งเงิน
        </h2>
        <FundingSourceForm action={createFundingSource} />
      </section>

      <section aria-labelledby="list-heading" className="space-y-3">
        <h2 id="list-heading" className="text-lg font-semibold">
          แหล่งเงินที่มีอยู่
        </h2>

        {fundingSources.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">
            ยังไม่มีแหล่งเงิน
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[42rem] text-sm">
              <caption className="sr-only">รายการแหล่งเงินทั้งหมด</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    รหัส
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    ชื่อ
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    คำอธิบาย
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
                {fundingSources.map((source) => (
                  <tr key={source.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">{source.code}</td>
                    <td className="px-4 py-3">{source.nameTh}</td>
                    <td className="px-4 py-3 text-slate-600">{source.description ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          source.isActive
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {source.isActive ? 'ใช้งานอยู่' : 'ปิดใช้แล้ว'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ActiveToggleButton
                        isActive={source.isActive}
                        action={async (next) => {
                          'use server';
                          return setFundingSourceActive(source.id, next);
                        }}
                      />
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
