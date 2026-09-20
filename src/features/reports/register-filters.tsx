'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SelectField, TextField } from '@/features/forms/fields';
import { PROCUREMENT_STATUSES } from '@/domain/procurement/status';
import {
  PROCUREMENT_CLASSIFICATIONS,
  CLASSIFICATION_LABELS_TH,
} from '@/domain/procurement/schemas';
import type { ProcurementClassification } from '@/domain/procurement/schemas';
import type { ProcurementStatus } from '@/domain/procurement/status';
import { hasActiveRegisterFilter } from '@/domain/procurement/register-schemas';
import type { ProcurementRegisterFilter } from '@/domain/procurement/register-schemas';
import { STATUS_LABELS_TH } from '@/features/procurements/format';
import type { FiscalYearOption } from '@/server/reports/repository';

/**
 * ตัวกรองทะเบียนจัดซื้อจัดจ้าง (PR-09b)
 *
 * เก็บสถานะไว้ใน query string ด้วยเหตุผลเดียวกับตัวกรองรายงานงบ — เจ้าหน้าที่
 * ต้องส่งลิงก์ของชุดตัวเลขที่ตัวเองเห็นให้ผู้บริหารหรือผู้ตรวจเปิดดูได้
 * ถ้าสถานะอยู่ใน component ลิงก์ที่ส่งไปจะเปิดมาเป็นข้อมูลคนละชุด
 */
export function RegisterFilters({
  filter,
  fiscalYears,
}: {
  filter: ProcurementRegisterFilter;
  fiscalYears: readonly FiscalYearOption[];
}) {
  const router = useRouter();

  const [fiscalYearId, setFiscalYearId] = useState(filter.fiscalYearId ?? '');
  const [classification, setClassification] = useState(filter.classification ?? '');
  const [status, setStatus] = useState(filter.status ?? '');
  const [dateFrom, setDateFrom] = useState(filter.dateFrom ?? '');
  const [dateTo, setDateTo] = useState(filter.dateTo ?? '');

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const next = new URLSearchParams();
    if (fiscalYearId) next.set('fiscalYearId', fiscalYearId);
    if (classification) next.set('classification', classification);
    if (status) next.set('status', status);
    if (dateFrom) next.set('dateFrom', dateFrom);
    if (dateTo) next.set('dateTo', dateTo);

    router.push(`/reports/procurements${next.size > 0 ? `?${next}` : ''}`);
  }

  return (
    <form
      onSubmit={apply}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
      aria-label="ตัวกรองทะเบียนจัดซื้อจัดจ้าง"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SelectField
          label="ปีงบประมาณ"
          value={fiscalYearId}
          onChange={setFiscalYearId}
          placeholder="— ทุกปีงบ —"
          options={fiscalYears.map((year) => ({ id: year.id, label: year.label }))}
        />
        <SelectField
          label="ประเภทงาน"
          value={classification}
          onChange={(value) => setClassification(value as ProcurementClassification | '')}
          placeholder="— ทุกประเภท —"
          options={PROCUREMENT_CLASSIFICATIONS.map((value) => ({
            id: value,
            label: CLASSIFICATION_LABELS_TH[value],
          }))}
        />
        <SelectField
          label="สถานะ"
          value={status}
          onChange={(value) => setStatus(value as ProcurementStatus | '')}
          placeholder="— ทุกสถานะ —"
          options={PROCUREMENT_STATUSES.map((value) => ({
            id: value,
            label: STATUS_LABELS_TH[value],
          }))}
        />
        <TextField
          label="วันที่ขอ ตั้งแต่"
          type="date"
          value={dateFrom}
          onChange={setDateFrom}
          hint="กรองด้วยวันที่ขอ ซึ่งเป็นวันที่ที่ทุกรายการมีเสมอ"
        />
        <TextField label="ถึงวันที่" type="date" value={dateTo} onChange={setDateTo} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800"
        >
          แสดงทะเบียน
        </button>
        {hasActiveRegisterFilter(filter) ? (
          <button
            type="button"
            onClick={() => router.push('/reports/procurements')}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ล้างตัวกรอง
          </button>
        ) : null}
      </div>
    </form>
  );
}
