import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAnyPermissionForPage } from '@/server/auth/guard';
import { loadBudgetReportRows, loadFiscalYearOptions } from '@/server/reports/repository';
import { parseBudgetReportFilter } from '@/domain/budget/report-schemas';
import {
  availableOf,
  BUDGET_REPORT_DIMENSION_LABELS_TH,
  buildBudgetReport,
  overdrawnRows,
} from '@/domain/budget/report';
import { BudgetReportFilters } from '@/features/reports/budget-report-filters';
import { BudgetReportTable } from '@/features/reports/budget-report-table';
import { ExportLinks } from '@/features/reports/export-links';
import { budgetReportExportHref } from '@/features/reports/export-hrefs';
import { formatSatang } from '@/features/reports/format';
import { formatThaiDate } from '@/lib/format/thai-date';

export const metadata: Metadata = { title: 'รายงานงบประมาณ' };

/**
 * รายงานงบประมาณแยกตามโครงการ แหล่งเงิน ฝ่ายงาน หรือปีงบ (PR-09)
 *
 * ก่อนมีหน้านี้ ยอดคงเหลือดูได้ทีละบัญชีเท่านั้น การตอบคำถามว่า
 * "โครงการนี้ใช้งบไปเท่าไรแล้ว" ต้องไล่บวกเองจากหลายบัญชี ซึ่งเป็นงานที่
 * ทำผิดได้ง่ายและไม่มีใครตรวจซ้ำ — เป็นวิธีเดียวกับที่ทำให้ข้อค้นพบ F-01
 * (โครงการที่งบติดลบ) ไม่มีใครเห็นในไฟล์จริง
 *
 * **อ่านอย่างเดียว** ไม่มี mutation ใด ๆ และยังไม่มีการส่งออกเป็นไฟล์
 * ซึ่งต้องตอบกติกา export ในข้อ PR-09 ของแผนต่อเนื่องก่อน
 */
export default async function BudgetReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAnyPermissionForPage('/reports/budget', 'budget.read', 'budget.manage');

  const filter = parseBudgetReportFilter(await searchParams);
  const [rows, fiscalYears] = await Promise.all([
    loadBudgetReportRows(filter),
    loadFiscalYearOptions(),
  ]);

  const report = buildBudgetReport(rows, filter.dimension);
  const overdrawn = overdrawnRows(rows);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">รายงานงบประมาณ</h1>
        <p className="text-slate-600">
          ยอดทุกช่องรวมมาจากรายการเคลื่อนไหวใน ledger โดยตรง ไม่ได้อ่านจากตัวเลขที่เก็บไว้ต่างหาก
          {filter.asOf
            ? ` — แสดงยอด ณ วันที่ ${formatThaiDate(new Date(`${filter.asOf}T00:00:00Z`))}`
            : null}
        </p>
      </header>

      <BudgetReportFilters filter={filter} fiscalYears={fiscalYears} />

      {/*
        บัญชีที่ใช้งบเกินถูกยกขึ้นมาไว้บนสุด ไม่ให้ผู้อ่านไล่หาเองในตาราง

        ข้อค้นพบ F-01 คืองบโครงการที่ติดลบอยู่ในไฟล์จริงโดยไม่มีใครเห็น
        เพราะมันเป็นเพียงผลลัพธ์ของสูตรในเซลล์หนึ่ง ไม่ใช่สิ่งที่ถูกยกขึ้นมาบอก
      */}
      {overdrawn.length > 0 ? (
        <section
          aria-labelledby="overdrawn-heading"
          className="rounded-lg border border-rose-300 bg-rose-50 p-5"
        >
          <h2 id="overdrawn-heading" className="text-lg font-semibold text-rose-900">
            บัญชีที่ใช้งบเกินยอดที่ได้รับ ({overdrawn.length} บัญชี)
          </h2>
          <p className="mt-1 text-sm text-rose-900">
            ยอดคงเหลือติดลบหมายถึงมีรายการที่ลงเกินงบไปแล้ว
            ต้องตรวจสอบว่าเกิดจากการโอนงบที่ยังไม่ได้บันทึกหรือจากการลงรายการผิด
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {overdrawn.map((row) => (
              <li key={row.accountId} className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  href={{ pathname: `/budget/accounts/${row.accountId}` }}
                  className="font-mono text-xs text-rose-900 underline underline-offset-2"
                >
                  {row.accountCode}
                </Link>
                <span className="text-rose-900">
                  {row.projectName ?? row.fundingSourceName ?? row.departmentName ?? '—'}
                </span>
                <span className="font-mono font-semibold text-rose-800 tabular-nums">
                  {formatSatang(availableOf(row))} บาท
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="table-heading" className="space-y-3">
        <h2 id="table-heading" className="text-lg font-semibold">
          ยอดงบแยกตามมิติที่เลือก
        </h2>

        {report.accountCount === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">
            ไม่พบบัญชีงบตามเงื่อนไขที่เลือก หากเพิ่งสร้างปีงบประมาณใหม่
            ให้สร้างบัญชีงบก่อนจึงจะมีตัวเลขในรายงาน
          </p>
        ) : (
          <BudgetReportTable report={report} />
        )}
      </section>

      {/*
        ปุ่มส่งออกซ่อนไว้เมื่อไม่มี reports.export — สิทธิ์นี้แยกจาก budget.read
        ที่ใช้เปิดหน้านี้โดยตั้งใจ (ดูคอมเมนต์ด้านบนของไฟล์) การดูบนจอกับการนำ
        ข้อมูลออกนอกระบบเป็นคนละสิทธิ์ ปุ่มที่ซ่อนไว้เป็นเพียง UX เท่านั้น —
        Route Handler ที่ /reports/budget/export ตรวจสิทธิ์นี้ซ้ำอีกชั้นเสมอ
      */}
      {user.permissions.has('reports.export') ? (
        <ExportLinks
          groups={[
            {
              label: `ยอดงบตาม${BUDGET_REPORT_DIMENSION_LABELS_TH[filter.dimension]}`,
              links: [
                { label: 'XLSX', href: budgetReportExportHref(filter, 'xlsx') },
                { label: 'CSV', href: budgetReportExportHref(filter, 'csv') },
              ],
            },
          ]}
        />
      ) : null}
    </div>
  );
}
