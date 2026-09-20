import type { DocumentSequenceRow } from '@/domain/documents/sequence-report';
import {
  sequenceFlagsOf,
  SEQUENCE_FLAG_LABELS_TH,
  toNumberRanges,
} from '@/domain/documents/sequence-report';
import { DOCUMENT_KIND_LABELS_TH } from '@/features/documents/format';

/**
 * ช่วงเลขที่ขาด แสดงเป็นช่วงแทนที่จะไล่ทีละเลข
 *
 * `14–90` อ่านแล้วเห็นทันทีว่าขาดยาวแค่ไหน ส่วน `14, 15, 16, …` ยาว 77 ตัว
 * ทำให้ไม่เห็นว่ามีกี่ช่วงและช่วงไหนกว้าง
 */
function rangeText(numbers: readonly number[]): string {
  return toNumberRanges(numbers)
    .map((range) => (range.from === range.to ? `${range.from}` : `${range.from}–${range.to}`))
    .join(', ');
}

/**
 * ข้อความอธิบายเลขที่ขาดของลำดับหนึ่ง
 *
 * แยกสามกรณีที่ตัวเลขชุดเดียวกันหมายถึงคนละเรื่อง:
 *   ไม่ขาดเลย · ขาดและมีตัวอย่างครบ · ขาดแต่ช่วงกว้างเกินกว่าจะไล่รายตัว
 *
 * กรณีที่สามเกิดจากเลขที่กรอกผิดหนึ่งตัวดันขอบของช่วงออกไปไกล การแสดง
 * "ไม่มีเลขขาด" ในกรณีนั้นจะเป็นคำตอบที่ผิดและน่าเชื่อ
 */
function missingText(row: DocumentSequenceRow): string {
  if (row.missingCount === 0) return '—';
  if (row.missingSample.length === 0) {
    return `ขาด ${row.missingCount.toLocaleString('th-TH')} เลข (ช่วงกว้างเกินกว่าจะไล่รายตัว)`;
  }

  const shown = rangeText(row.missingSample);
  if (row.missingSample.length < row.missingCount) {
    return `${shown} … รวม ${row.missingCount.toLocaleString('th-TH')} เลข`;
  }

  return shown;
}

export function DocumentSequenceTable({ rows }: { rows: readonly DocumentSequenceRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <caption className="sr-only">ลำดับเลขที่เอกสาร แยกตามปีงบประมาณและชนิดเอกสาร</caption>
        <thead className="bg-slate-50 text-left text-xs text-slate-600">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              ปีงบ
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              ชนิดเอกสาร
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              ออกเลขแล้ว
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              ยกเลิก
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              รอออกเลข
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              ไม่ต้องมีเลข
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              ช่วงเลขที่ใช้
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              เลขที่ขาด
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              เลขลำดับซ้ำ
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const flags = sequenceFlagsOf(row);
            return (
              <tr key={`${row.fiscalYearId}-${row.documentKind}`} className="align-top">
                <td className="px-3 py-2 whitespace-nowrap">{row.fiscalYearCode ?? '—'}</td>
                <td className="px-3 py-2">
                  <div>{DOCUMENT_KIND_LABELS_TH[row.documentKind]}</div>
                  {/* ข้อสังเกตอยู่ติดกับแถวที่มันพูดถึง ผู้อ่านที่ไล่ดูทีละแถว
                      จึงไม่ต้องจำว่าแถวไหนถูกยกไว้ข้างบน */}
                  {flags.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {flags.map((flag) => (
                        <li key={flag} className="text-xs text-amber-900">
                          • {SEQUENCE_FLAG_LABELS_TH[flag]}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.issuedCount.toLocaleString('th-TH')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.voidedCount.toLocaleString('th-TH')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.pendingCount.toLocaleString('th-TH')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.notRequiredCount.toLocaleString('th-TH')}
                </td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {row.minRunning === null ? '—' : `${row.minRunning}–${row.maxRunning}`}
                  {row.unparsedCount > 0 ? (
                    <div className="text-xs text-slate-500">
                      อีก {row.unparsedCount} ฉบับแยกลำดับไม่ได้
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-amber-900 tabular-nums">{missingText(row)}</td>
                <td className="px-3 py-2 text-rose-900 tabular-nums">
                  {row.duplicateRunning.length === 0 ? '—' : rangeText(row.duplicateRunning)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
