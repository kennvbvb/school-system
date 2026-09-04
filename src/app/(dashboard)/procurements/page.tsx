import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAnyPermissionForPage } from '@/server/auth/guard';
import { listProcurements } from '@/server/procurement/repository';
import { formatThaiDate } from '@/lib/format/thai-date';
import { STATUS_CLASSES, STATUS_LABELS_TH, formatBaht } from '@/features/procurements/format';

export const metadata: Metadata = { title: 'รายการจัดซื้อจัดจ้าง' };

/**
 * รายการจัดซื้อจัดจ้าง
 *
 * ไม่มีเงื่อนไขกรองว่า "ของฉัน" หรือ "ทั้งหมด" ในโค้ดนี้ — RLS เป็นผู้ตัดสิน
 * ผู้ที่มีเพียง procurement.read.own จะได้เฉพาะรายการของตนโดยอัตโนมัติ
 * ถ้าเขียนเงื่อนไขที่นี่แทน จะกลายเป็นการควบคุมการเข้าถึงที่ฝั่งแอป
 * ซึ่งเลี่ยงได้ด้วยการเรียก API ตรง (ข้อ 4.2)
 */
export default async function ProcurementsPage() {
  const viewer = await requireAnyPermissionForPage(
    '/procurements',
    'procurement.read.own',
    'procurement.read.all',
  );

  const procurements = await listProcurements();
  const canCreate = viewer.permissions.has('procurement.create');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">รายการจัดซื้อจัดจ้าง</h1>
          <p className="text-slate-600">
            {procurements.length === 0 ? 'ยังไม่มีรายการ' : `ทั้งหมด ${procurements.length} รายการ`}
          </p>
        </div>

        {canCreate ? (
          <Link
            href="/procurements/new"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            สร้างรายการใหม่
          </Link>
        ) : null}
      </header>

      {procurements.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">
          ยังไม่มีรายการจัดซื้อจัดจ้างที่คุณเข้าถึงได้
          {canCreate ? ' กดปุ่มสร้างรายการใหม่เพื่อเริ่มต้น' : ''}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[48rem] text-sm">
            <caption className="sr-only">รายการจัดซื้อจัดจ้างที่คุณเข้าถึงได้</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-left">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  เลขอ้างอิง
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  ชื่อเรื่อง
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  ผู้ขาย
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  วันที่ขอ
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  ยอดรวม (บาท)
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  สถานะ
                </th>
              </tr>
            </thead>
            <tbody>
              {procurements.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      href={{ pathname: `/procurements/${row.id}` }}
                      className="text-sky-800 underline underline-offset-2"
                    >
                      {row.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{row.subject}</td>
                  <td className="px-4 py-3 text-slate-600">{row.vendorName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatThaiDate(new Date(`${row.requestDate}T00:00:00Z`))}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatBaht(row.totals.grandTotal)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[row.status]}`}
                    >
                      {STATUS_LABELS_TH[row.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
