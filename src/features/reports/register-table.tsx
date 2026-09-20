import Link from 'next/link';
import type { DocumentNumberStatus, ProcurementRegisterRow } from '@/domain/procurement/register';
import { registerFlagsOf, REGISTER_FLAG_LABELS_TH } from '@/domain/procurement/register';
import {
  DOCUMENT_NUMBER_STATUS_CLASSES,
  DOCUMENT_NUMBER_STATUS_LABELS_TH,
} from '@/features/documents/format';
import { CLASSIFICATION_LABELS_TH, METHOD_LABELS_TH } from '@/domain/procurement/schemas';
import { STATUS_CLASSES, STATUS_LABELS_TH } from '@/features/procurements/format';
import { formatSatang } from '@/features/reports/format';
import { formatThaiDate } from '@/lib/format/thai-date';

/** วันที่จากฐานข้อมูลเป็น 'YYYY-MM-DD' — อ่านเป็น UTC เสมอเพื่อไม่ให้เลื่อนวัน */
function thaiDate(value: string | null): string {
  if (value === null) return '—';
  return formatThaiDate(new Date(`${value}T00:00:00Z`));
}

/**
 * เลขที่เอกสารพร้อมสถานะ
 *
 * ไม่แสดงเป็นช่องว่างเมื่อไม่มีเลข เพราะช่องว่างอ่านได้สองอย่าง — "ยังไม่ได้กรอก"
 * กับ "ไม่ต้องมี" ซึ่งเป็นความกำกวมที่ทำให้ข้อค้นพบ F-14 ตรวจไม่ได้ในไฟล์เดิม
 *
 * ป้ายของสถานะใช้ชุดเดียวกับหน้าบันทึกเลขที่เอกสาร ไม่ได้เขียนคำใหม่ที่นี่
 * เพื่อไม่ให้สถานะเดียวกันถูกเรียกคนละชื่อในสองหน้าจอ
 */
function DocumentCell({
  documentNo,
  status,
}: {
  documentNo: string | null;
  status: DocumentNumberStatus | null;
}) {
  if (status === null) return <span className="text-slate-400">ยังไม่ได้บันทึก</span>;
  if (status === 'ISSUED') return <span className="font-mono text-xs">{documentNo ?? '—'}</span>;

  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 ${DOCUMENT_NUMBER_STATUS_CLASSES[status]}`}
    >
      {DOCUMENT_NUMBER_STATUS_LABELS_TH[status]}
    </span>
  );
}

export function RegisterTable({ rows }: { rows: readonly ProcurementRegisterRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <caption className="sr-only">ทะเบียนจัดซื้อจัดจ้าง เรียงตามวันที่ขอจากใหม่ไปเก่า</caption>
        <thead className="bg-slate-50 text-left text-xs text-slate-600">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              วันที่ขอ
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              เรื่อง
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              ประเภท / วิธี
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              ผู้ขาย
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              บันทึกขออนุมัติ
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              ใบสั่งซื้อ/จ้าง
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              จำนวนเงิน (บาท)
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              สถานะ
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const flags = registerFlagsOf(row);
            return (
              <tr key={row.procurementId} className="align-top">
                <td className="px-3 py-2 whitespace-nowrap">{thaiDate(row.requestDate)}</td>
                <td className="px-3 py-2">
                  <Link
                    href={{ pathname: `/procurements/${row.procurementId}` }}
                    className="font-medium text-sky-800 underline underline-offset-2"
                  >
                    {row.subject}
                  </Link>
                  <div className="mt-0.5 font-mono text-xs text-slate-500">{row.reference}</div>
                  {row.isEmergency ? (
                    <div className="mt-0.5 text-xs text-orange-800">กรณีเร่งด่วน</div>
                  ) : null}
                  {/* ข้อสังเกตอยู่ติดกับแถวที่มันพูดถึง ไม่ใช่รวมไว้ที่อื่นอย่างเดียว
                      ผู้อ่านที่ไล่ดูทีละแถวจึงไม่ต้องจำว่าแถวไหนถูกยกไว้ข้างบน */}
                  {flags.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {flags.map((flag) => (
                        <li key={flag} className="text-xs text-amber-900">
                          • {REGISTER_FLAG_LABELS_TH[flag]}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <div>
                    {row.classification === null
                      ? '—'
                      : CLASSIFICATION_LABELS_TH[row.classification]}
                  </div>
                  <div className="text-xs text-slate-500">
                    {row.method === null ? '—' : METHOD_LABELS_TH[row.method]}
                  </div>
                </td>
                <td className="px-3 py-2">{row.vendorName ?? '—'}</td>
                <td className="px-3 py-2">
                  <DocumentCell documentNo={row.requestMemoNo} status={row.requestMemoStatus} />
                </td>
                <td className="px-3 py-2">
                  <DocumentCell documentNo={row.purchaseOrderNo} status={row.purchaseOrderStatus} />
                  <div className="text-xs text-slate-500">{thaiDate(row.orderDate)}</div>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatSatang(row.grandTotalSatang)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_CLASSES[row.status]}`}
                  >
                    {STATUS_LABELS_TH[row.status]}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
