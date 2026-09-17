import { BUDGET_REPORT_DIMENSION_LABELS_TH, utilizationBasisPoints } from '@/domain/budget/report';
import type { BudgetReport, BudgetReportAmounts } from '@/domain/budget/report';
import { formatSatang, formatUtilization, utilizationBarClass } from './format';

/**
 * ตารางยอดงบตามมิติที่เลือก (PR-09a)
 *
 * เป็น server component — ตัวเลขงบทั้งโรงเรียนไม่ควรถูกฝังลงใน payload
 * ที่เบราว์เซอร์เก็บไว้เป็น props ของ client component โดยไม่จำเป็น
 *
 * แถวสรุปอยู่ใน `tfoot` และคิดจากแถวชุดเดียวกับที่สร้างกลุ่มข้างบน
 * (ดู buildBudgetReport) จึงไม่มีทางที่ยอดรวมกับรายละเอียดจะไม่ตรงกัน
 */

const NUMERIC_CELL = 'px-4 py-3 text-right font-mono tabular-nums';

function AmountCells({ amounts }: { amounts: BudgetReportAmounts }) {
  const negative = amounts.availableSatang < 0n;

  return (
    <>
      <td className={NUMERIC_CELL}>{formatSatang(amounts.grantedSatang)}</td>
      <td className={NUMERIC_CELL}>{formatSatang(amounts.reservedSatang)}</td>
      <td className={NUMERIC_CELL}>{formatSatang(amounts.usedSatang)}</td>
      <td className={`${NUMERIC_CELL} font-semibold ${negative ? 'text-rose-700' : ''}`}>
        {formatSatang(amounts.availableSatang)}
        {negative ? <span className="sr-only"> (ติดลบ)</span> : null}
      </td>
    </>
  );
}

function UtilizationCell({ amounts }: { amounts: BudgetReportAmounts }) {
  const basisPoints = utilizationBasisPoints(amounts);
  /* แถบเป็นเพียงภาพประกอบ ตัวเลขข้างหน้าเป็นตัวสื่อความหมายจริง (ข้อ 12.4) */
  const width = basisPoints === null ? 0 : Math.min(100, basisPoints / 100);

  return (
    <td className="px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="w-14 text-right font-mono text-xs tabular-nums">
          {formatUtilization(basisPoints)}
        </span>
        <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
          <span
            className={`block h-full ${utilizationBarClass(basisPoints)}`}
            style={{ width: `${width}%` }}
          />
        </span>
      </div>
    </td>
  );
}

export function BudgetReportTable({ report }: { report: BudgetReport }) {
  const dimensionLabel = BUDGET_REPORT_DIMENSION_LABELS_TH[report.dimension];

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[60rem] text-sm">
        <caption className="sr-only">
          ยอดงบประมาณแยกตาม{dimensionLabel} พร้อมแถวยอดรวมท้ายตาราง
        </caption>
        <thead className="border-b border-slate-200 bg-slate-50 text-left">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {dimensionLabel}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              บัญชี
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              งบที่ได้รับ
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              กันไว้
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              ใช้ไปแล้ว
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              ใช้ได้
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              สัดส่วนที่ใช้
            </th>
          </tr>
        </thead>
        <tbody>
          {report.groups.map((group) => (
            <tr key={group.key} className="border-b border-slate-100">
              <th scope="row" className="px-4 py-3 text-left font-normal">
                {group.labelTh}
              </th>
              <td className="px-4 py-3 text-right font-mono tabular-nums">{group.accountCount}</td>
              <AmountCells amounts={group.amounts} />
              <UtilizationCell amounts={group.amounts} />
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
          <tr>
            <th scope="row" className="px-4 py-3 text-left">
              รวมทั้งหมด
            </th>
            <td className="px-4 py-3 text-right font-mono tabular-nums">{report.accountCount}</td>
            <AmountCells amounts={report.total} />
            <UtilizationCell amounts={report.total} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
