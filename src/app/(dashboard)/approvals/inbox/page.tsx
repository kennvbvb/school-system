import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAnyPermissionForPage } from '@/server/auth/guard';
import { listApprovalInbox } from '@/server/procurement/repository';
import { STATUS_CLASSES, STATUS_LABELS_TH, formatBaht } from '@/features/procurements/format';
import { formatThaiDate } from '@/lib/format/thai-date';

export const metadata: Metadata = { title: 'รอฉันดำเนินการ' };

/**
 * กล่องงานของผู้ตรวจสอบและผู้อนุมัติ (PR-04a)
 *
 * แสดงเฉพาะรายการที่ผู้ใช้คนนี้ทำอะไรได้จริง — สถานะตรงกับสิทธิ์ที่ถือ และไม่ใช่
 * รายการของตัวเองตามกฎ separation of duties ถ้าไม่กรอง กล่องงานจะเต็มไปด้วย
 * รายการที่กดแล้วโดนปฏิเสธทุกครั้ง ซึ่งแย่กว่าไม่มีกล่องงาน
 */
export default async function ApprovalInboxPage() {
  const viewer = await requireAnyPermissionForPage(
    '/approvals/inbox',
    'procurement.review',
    'procurement.approve',
  );

  const rows = await listApprovalInbox({
    viewerId: viewer.id,
    permissions: viewer.permissions,
  });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/procurements" className="text-sm text-sky-800 underline">
          ← รายการจัดซื้อจัดจ้าง
        </Link>
        <h1 className="text-2xl font-semibold">รอฉันดำเนินการ</h1>
        <p className="text-slate-600">
          เรียงจากรายการที่รอนานที่สุด — ไม่แสดงรายการที่คุณเป็นผู้สร้างเอง
          เพราะผู้สร้างตรวจสอบหรืออนุมัติรายการของตัวเองไม่ได้
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">
          ไม่มีรายการที่รอคุณดำเนินการ
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[46rem] text-sm">
            <caption className="sr-only">รายการที่รอคุณตรวจสอบหรืออนุมัติ</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-left">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  เลขอ้างอิง
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  เรื่อง
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  วันที่ขอ
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  ยอดรวม
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  สถานะ
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      href={{ pathname: `/procurements/${row.id}` }}
                      className="text-sky-800 underline"
                    >
                      {row.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{row.subject}</td>
                  <td className="px-4 py-3">
                    {formatThaiDate(new Date(`${row.requestDate}T00:00:00Z`))}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatBaht(row.totals.grandTotal)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        STATUS_CLASSES[row.status]
                      }`}
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
