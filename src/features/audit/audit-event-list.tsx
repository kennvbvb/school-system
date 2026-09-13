import { AUDIT_ACTION_LABELS_TH, summarizeChanges } from '@/domain/audit/audit-view';
import { formatThaiDateTime } from '@/lib/format/thai-date';
import type { AuditEventRow } from '@/server/audit/repository';

/**
 * รายการเหตุการณ์ (PR-05b)
 *
 * เป็น server component โดยเจตนา — ไม่มี interaction และข้อมูลชุดนี้เป็น
 * ข้อมูลส่วนบุคคลของบุคลากรทุกคน การส่งไปเป็น props ของ client component
 * จะทำให้ข้อมูลทั้งหน้าถูกฝังลง payload ที่เบราว์เซอร์เก็บไว้โดยไม่จำเป็น
 */
export function AuditEventList({ rows }: { rows: readonly AuditEventRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-700">
        ไม่พบเหตุการณ์ตามเงื่อนไขที่เลือก
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const changes = summarizeChanges(row.before, row.after);

        return (
          <li key={row.id} className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-0.5">
                <p className="font-medium">{AUDIT_ACTION_LABELS_TH[row.action] ?? row.action}</p>
                <p className="text-sm text-slate-600">
                  {row.actorName ?? 'ไม่ทราบผู้กระทำ'}
                  {' · '}
                  {formatThaiDateTime(new Date(row.createdAt))}
                </p>
                <p className="text-sm text-slate-600">
                  {row.entityType}
                  {row.entityId ? ` · ${row.entityId}` : ''}
                </p>
              </div>

              {/*
                แสดง request id ไว้ด้วย — เป็นเลขเดียวกับที่ผู้ใช้เห็นบนหน้า error
                ทำให้เรื่องที่ผู้ใช้แจ้งเข้ามาถูกตามหาใน log ได้โดยไม่ต้องเดาเวลา
              */}
              <p className="font-mono text-xs text-slate-500">{row.requestId}</p>
            </div>

            {changes.length > 0 ? (
              <div className="mt-3 overflow-x-auto border-t border-slate-100 pt-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-600">
                      <th scope="col" className="py-1 pr-4 font-medium">
                        ช่อง
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        เดิม
                      </th>
                      <th scope="col" className="py-1 font-medium">
                        ใหม่
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((change) => (
                      <tr key={change.field} className="align-top">
                        <td className="py-1 pr-4 font-mono text-xs">{change.field}</td>
                        <td className="py-1 pr-4 text-slate-600">{change.before ?? '—'}</td>
                        <td className="py-1">{change.after ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
