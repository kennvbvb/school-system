import Link from 'next/link';
import type { DocumentExceptionRow } from '@/domain/documents/sequence-report';
import {
  DOCUMENT_KIND_LABELS_TH,
  DOCUMENT_NUMBER_STATUS_CLASSES,
  DOCUMENT_NUMBER_STATUS_LABELS_TH,
} from '@/features/documents/format';
import { formatThaiDate } from '@/lib/format/thai-date';

export function DocumentExceptionList({ rows }: { rows: readonly DocumentExceptionRow[] }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {rows.map((row) => (
        <li key={row.documentNumberId} className="space-y-1 p-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs ${DOCUMENT_NUMBER_STATUS_CLASSES[row.status]}`}
            >
              {DOCUMENT_NUMBER_STATUS_LABELS_TH[row.status]}
            </span>
            <span className="text-sm">{DOCUMENT_KIND_LABELS_TH[row.documentKind]}</span>
            <span className="text-xs text-slate-500">{row.fiscalYearCode ?? '—'}</span>
            {/* เลขเดิมของฉบับที่ยกเลิก — แสดงไว้เพราะเลขนั้นถูกกินไปแล้วและห้ามใช้ซ้ำ */}
            {row.documentNo !== null ? (
              <span className="font-mono text-xs text-slate-700">{row.documentNo}</span>
            ) : null}
          </div>

          <div className="text-sm">
            {row.procurementReference === null ? (
              /* ผู้ถือ documents.issue เห็นทะเบียนเลขทั้งเล่มได้ แต่อาจอ่านรายการ
                 ต้นทางไม่ได้ — บอกตรง ๆ ดีกว่าแสดงช่องว่างที่อ่านได้ว่าไม่มีข้อมูล */
              <span className="text-slate-500">(ไม่มีสิทธิ์อ่านรายการต้นทางของเอกสารฉบับนี้)</span>
            ) : (
              <Link
                href={{ pathname: `/procurements/${row.procurementId}` }}
                className="text-sky-800 underline underline-offset-2"
              >
                <span className="font-mono text-xs">{row.procurementReference}</span>{' '}
                {row.procurementSubject}
              </Link>
            )}
          </div>

          <p className="text-sm text-slate-700">
            <span className="text-slate-500">เหตุผล:</span> {row.reason ?? '—'}
          </p>

          <p className="text-xs text-slate-500">
            บันทึกเมื่อ {formatThaiDate(new Date(row.createdAt))}
            {row.voidedAt !== null
              ? ` · ยกเลิกเมื่อ ${formatThaiDate(new Date(row.voidedAt))}`
              : null}
          </p>
        </li>
      ))}
    </ul>
  );
}
