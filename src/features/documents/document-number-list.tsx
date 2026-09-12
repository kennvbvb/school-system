'use client';

import { useState } from 'react';
import { FormError, SubmitButton, TextAreaField } from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import { formatThaiDate } from '@/lib/format/thai-date';
import {
  DOCUMENT_KIND_LABELS_TH,
  DOCUMENT_NUMBER_STATUS_CLASSES,
  DOCUMENT_NUMBER_STATUS_LABELS_TH,
} from './format';
import type { ActionOutcome } from '@/features/forms/use-action-form';
import type { DocumentNumberRow } from '@/server/documents/repository';

/**
 * เลขที่เอกสารของรายการหนึ่ง พร้อมปุ่มยกเลิก
 *
 * **แถวที่ยกเลิกแล้วยังแสดงอยู่** ไม่ได้ซ่อนหรือลบ เพราะเลขนั้นยังถูกกันไว้ไม่ให้
 * ใครนำกลับมาใช้ การซ่อนจะทำให้ผู้ใช้พิมพ์เลขเดิมเข้ามาแล้วงงว่าทำไมระบบปฏิเสธ
 * ทั้งที่ไม่เห็นว่ามีใครใช้อยู่
 */
export function DocumentNumberList({
  rows,
  canIssue,
  onVoid,
}: {
  rows: readonly DocumentNumberRow[];
  canIssue: boolean;
  onVoid: (input: { documentNumberId: string; reason: string }) => Promise<ActionOutcome>;
}) {
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const form = useActionForm({
    onSuccess: () => {
      setVoidingId(null);
      setReason('');
    },
  });

  if (rows.length === 0) {
    return <p className="text-slate-600">ยังไม่ได้บันทึกเลขที่เอกสาร</p>;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (voidingId) {
      await form.submit(() => onVoid({ documentNumberId: voidingId, reason }));
    }
  }

  return (
    <div className="space-y-3">
      <FormError message={form.errorMessage} />

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {rows.map((row) => (
          <li key={row.id} className="space-y-2 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="font-medium">
                {DOCUMENT_KIND_LABELS_TH[row.documentKind]}
                {row.documentNo ? (
                  <span className="ml-2 font-mono text-slate-900">{row.documentNo}</span>
                ) : null}
              </p>

              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  DOCUMENT_NUMBER_STATUS_CLASSES[row.status]
                }`}
              >
                {DOCUMENT_NUMBER_STATUS_LABELS_TH[row.status]}
              </span>
            </div>

            {row.issuedDate ? (
              <p className="text-slate-600">
                ออกเมื่อ{' '}
                <time dateTime={row.issuedDate}>{formatThaiDate(new Date(row.issuedDate))}</time>
              </p>
            ) : null}

            {row.reason ? (
              <p className="rounded-md bg-slate-50 px-3 py-2 whitespace-pre-line text-slate-800">
                {row.reason}
              </p>
            ) : null}

            {canIssue && row.status !== 'VOIDED' && voidingId !== row.id ? (
              <button
                type="button"
                onClick={() => {
                  setVoidingId(row.id);
                  setReason('');
                }}
                className="text-sm font-medium text-rose-800 underline underline-offset-2"
              >
                ยกเลิกเลขนี้
              </button>
            ) : null}

            {voidingId === row.id ? (
              <form
                onSubmit={handleSubmit}
                className="space-y-3 rounded-md border border-rose-300 p-4"
              >
                <p className="font-medium">ยืนยันการยกเลิกเลขที่เอกสาร</p>
                <p className="text-slate-700">
                  เลขที่ยกเลิกแล้ว <strong>นำกลับมาใช้ไม่ได้อีก</strong> — ต้องออกเลขใหม่แทน
                </p>
                <TextAreaField label="เหตุผล" required value={reason} onChange={setReason} />
                <div className="flex gap-2">
                  <SubmitButton
                    isSubmitting={form.isSubmitting}
                    variant="danger"
                    disabled={reason.trim() === ''}
                  >
                    ยืนยันการยกเลิก
                  </SubmitButton>
                  <button
                    type="button"
                    disabled={form.isSubmitting}
                    onClick={() => setVoidingId(null)}
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                  >
                    ไม่ยกเลิก
                  </button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
