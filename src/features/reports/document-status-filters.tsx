'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SelectField } from '@/features/forms/fields';
import { DOCUMENT_KINDS } from '@/domain/documents/document-register';
import type { DocumentKind } from '@/domain/documents/document-register';
import {
  DOCUMENT_EXCEPTION_STATUSES,
  hasActiveDocumentStatusFilter,
} from '@/domain/documents/sequence-report-schemas';
import type {
  DocumentExceptionStatus,
  DocumentStatusFilter,
} from '@/domain/documents/sequence-report-schemas';
import {
  DOCUMENT_KIND_LABELS_TH,
  DOCUMENT_NUMBER_STATUS_LABELS_TH,
} from '@/features/documents/format';
import type { FiscalYearOption } from '@/server/reports/repository';

/**
 * ตัวกรองรายงานสถานะเอกสาร (PR-09c)
 *
 * เก็บสถานะไว้ใน query string ด้วยเหตุผลเดียวกับรายงานอื่น — ผู้ตรวจต้องส่งลิงก์
 * ของลำดับที่มีปัญหาให้เจ้าหน้าที่พัสดุเปิดดูชุดเดียวกันได้
 */
export function DocumentStatusFilters({
  filter,
  fiscalYears,
}: {
  filter: DocumentStatusFilter;
  fiscalYears: readonly FiscalYearOption[];
}) {
  const router = useRouter();

  const [fiscalYearId, setFiscalYearId] = useState(filter.fiscalYearId ?? '');
  const [documentKind, setDocumentKind] = useState(filter.documentKind ?? '');
  const [exceptionStatus, setExceptionStatus] = useState(filter.exceptionStatus ?? '');

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const next = new URLSearchParams();
    if (fiscalYearId) next.set('fiscalYearId', fiscalYearId);
    if (documentKind) next.set('documentKind', documentKind);
    if (exceptionStatus) next.set('exceptionStatus', exceptionStatus);

    router.push(`/reports/documents${next.size > 0 ? `?${next}` : ''}`);
  }

  return (
    <form
      onSubmit={apply}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
      aria-label="ตัวกรองรายงานสถานะเอกสาร"
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
          label="ชนิดเอกสาร"
          value={documentKind}
          onChange={(value) => setDocumentKind(value as DocumentKind | '')}
          placeholder="— ทุกชนิด —"
          options={DOCUMENT_KINDS.map((value) => ({
            id: value,
            label: DOCUMENT_KIND_LABELS_TH[value],
          }))}
        />
        {/* ตัวกรองนี้มีผลกับรายการข้อยกเว้นเท่านั้น ไม่ได้เปลี่ยนการวิเคราะห์ลำดับ
            ซึ่งต้องนับเลขที่ถูกใช้ไปแล้วทุกเลขเสมอจึงจะไม่ประกาศช่องว่างปลอม */}
        <SelectField
          label="สถานะของข้อยกเว้น"
          value={exceptionStatus}
          onChange={(value) => setExceptionStatus(value as DocumentExceptionStatus | '')}
          placeholder="— ทุกสถานะ —"
          options={DOCUMENT_EXCEPTION_STATUSES.map((value) => ({
            id: value,
            label: DOCUMENT_NUMBER_STATUS_LABELS_TH[value],
          }))}
          hint="มีผลกับรายการด้านล่างเท่านั้น ไม่เปลี่ยนการวิเคราะห์ลำดับเลข"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800"
        >
          แสดงรายงาน
        </button>
        {hasActiveDocumentStatusFilter(filter) ? (
          <button
            type="button"
            onClick={() => router.push('/reports/documents')}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ล้างตัวกรอง
          </button>
        ) : null}
      </div>
    </form>
  );
}
