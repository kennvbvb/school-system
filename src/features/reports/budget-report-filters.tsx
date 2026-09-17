'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckboxField, SelectField, TextField } from '@/features/forms/fields';
import {
  BUDGET_REPORT_DIMENSIONS,
  BUDGET_REPORT_DIMENSION_LABELS_TH,
} from '@/domain/budget/report';
import type { BudgetReportDimension } from '@/domain/budget/report';
import { hasActiveBudgetReportFilter } from '@/domain/budget/report-schemas';
import type { BudgetReportFilter } from '@/domain/budget/report-schemas';
import type { FiscalYearOption } from '@/server/reports/repository';

/**
 * ตัวกรองรายงานงบประมาณ (PR-09a)
 *
 * เก็บสถานะไว้ใน query string ไม่ใช่ใน component ด้วยเหตุผลเดียวกับตัวกรอง
 * audit log — เจ้าหน้าที่ต้องส่งลิงก์ของตัวเลขชุดที่ตัวเองเห็นให้ผู้บริหารดูได้
 * ถ้าสถานะอยู่ใน component ลิงก์ที่ส่งไปจะเปิดมาเป็นตัวเลขคนละชุด
 * ซึ่งอันตรายกว่าลิงก์ที่เปิดไม่ได้ เพราะทั้งสองฝ่ายคิดว่ากำลังดูเลขเดียวกัน
 */
export function BudgetReportFilters({
  filter,
  fiscalYears,
}: {
  filter: BudgetReportFilter;
  fiscalYears: readonly FiscalYearOption[];
}) {
  const router = useRouter();

  const [fiscalYearId, setFiscalYearId] = useState(filter.fiscalYearId ?? '');
  const [dimension, setDimension] = useState<BudgetReportDimension>(filter.dimension);
  const [asOf, setAsOf] = useState(filter.asOf ?? '');
  const [onlyOpen, setOnlyOpen] = useState(filter.onlyOpen);

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const next = new URLSearchParams();
    if (fiscalYearId) next.set('fiscalYearId', fiscalYearId);
    if (dimension !== 'PROJECT') next.set('dimension', dimension);
    if (asOf) next.set('asOf', asOf);
    if (onlyOpen) next.set('onlyOpen', '1');

    router.push(`/reports/budget${next.size > 0 ? `?${next}` : ''}`);
  }

  return (
    <form
      onSubmit={apply}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
      aria-label="ตัวกรองรายงานงบประมาณ"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SelectField
          label="ปีงบประมาณ"
          value={fiscalYearId}
          onChange={setFiscalYearId}
          placeholder="— ทุกปีงบ —"
          options={fiscalYears.map((year) => ({ id: year.id, label: year.label }))}
        />
        {/* ตัวเลือกว่างของ SelectField จะกลับไปเป็น "ตามโครงการ" ซึ่งเป็นค่าเริ่มต้น
            จึงไม่มีสถานะ "ไม่ได้เลือกวิธีจัดกลุ่ม" ที่ทำให้หน้าว่างเปล่า */}
        <SelectField
          label="จัดกลุ่มตาม"
          value={dimension}
          onChange={(value) => setDimension(value as BudgetReportDimension)}
          placeholder={BUDGET_REPORT_DIMENSION_LABELS_TH.PROJECT}
          options={BUDGET_REPORT_DIMENSIONS.map((value) => ({
            id: value,
            label: BUDGET_REPORT_DIMENSION_LABELS_TH[value],
          }))}
        />
        <TextField
          label="ยอด ณ วันที่"
          type="date"
          value={asOf}
          onChange={setAsOf}
          hint="นับเฉพาะรายการที่มีผลไม่เกินวันนี้ เว้นว่างเพื่อดูยอดล่าสุด"
        />
        <CheckboxField
          label="เฉพาะบัญชีที่ยังเปิดอยู่"
          checked={onlyOpen}
          onChange={setOnlyOpen}
          hint="บัญชีที่ปิดแล้วยังถือยอดที่ใช้ไปของปีนั้น การซ่อนจะทำให้ยอดรวมน้อยลง"
          className="sm:col-span-2 lg:col-span-1"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800"
        >
          แสดงรายงาน
        </button>
        {/* ปุ่มที่ขึ้นตลอดเวลาทำให้ผู้อ่านไม่รู้ว่าตอนนี้กำลังกรองอยู่หรือเปล่า
            ซึ่งสำคัญกว่าปกติในรายงาน เพราะตัวเลขที่เห็นอาจเป็นเพียงบางส่วน */}
        {hasActiveBudgetReportFilter(filter) ? (
          <button
            type="button"
            onClick={() => router.push('/reports/budget')}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ล้างตัวกรอง
          </button>
        ) : null}
      </div>
    </form>
  );
}
