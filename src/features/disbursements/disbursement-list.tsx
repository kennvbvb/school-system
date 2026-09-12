'use client';

import { useState } from 'react';
import { FormError, SubmitButton, TextField } from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import { formatSatang } from '@/domain/money/money';
import { formatThaiDate } from '@/lib/format/thai-date';
import type { ActionOutcome } from '@/features/forms/use-action-form';

export interface DisbursementView {
  id: string;
  amountSatang: bigint;
  paidOn: string;
  documentNo: string | null;
  payeeName: string | null;
  note: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

/**
 * รายการเบิกจ่ายของรายการจัดซื้อหนึ่ง (PR-04d)
 *
 * **แสดงรายการที่ยกเลิกแล้วด้วย ไม่ซ่อน** การจ่ายเงินที่เคยบันทึกไว้เป็นข้อเท็จจริง
 * ที่ผู้ตรวจสอบต้องเห็น รวมถึงตอนที่บันทึกผิดแล้วยกเลิก การซ่อนจะทำให้ประวัติ
 * บนหน้าจอไม่ตรงกับที่อยู่ในฐานข้อมูล
 */
export function DisbursementList({
  rows,
  canVoid,
  onVoid,
}: {
  rows: readonly DisbursementView[];
  canVoid: boolean;
  onVoid: (input: { disbursementId: string; reason: string }) => Promise<ActionOutcome>;
}) {
  if (rows.length === 0) {
    return <p className="text-slate-600">ยังไม่มีการเบิกจ่ายสำหรับรายการนี้</p>;
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li
          key={row.id}
          className={`rounded-lg border p-4 ${
            row.voidedAt ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-0.5">
              <p className="font-medium">
                <span className="font-mono">{formatSatang(row.amountSatang)}</span> บาท
                {row.voidedAt ? (
                  <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                    ยกเลิกแล้ว
                  </span>
                ) : null}
              </p>
              <p className="text-sm text-slate-600">
                จ่ายเมื่อ {formatThaiDate(new Date(row.paidOn))}
                {row.documentNo ? ` · เลขที่ ${row.documentNo}` : ''}
                {row.payeeName ? ` · ${row.payeeName}` : ''}
              </p>
              {row.note ? <p className="text-sm text-slate-600">{row.note}</p> : null}
              {row.voidReason ? (
                <p className="text-sm text-slate-600">เหตุผลที่ยกเลิก: {row.voidReason}</p>
              ) : null}
            </div>

            {canVoid && !row.voidedAt ? (
              <VoidButton disbursementId={row.id} onVoid={onVoid} />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * ปุ่มยกเลิก — ต้องกรอกเหตุผลก่อนเสมอ
 *
 * เปิดช่องเหตุผลเมื่อกดครั้งแรก แทนที่จะยกเลิกทันที ทำให้การกดผิดไม่กลายเป็น
 * การกลับรายการบัญชีทันที และได้เหตุผลที่ฐานข้อมูลบังคับอยู่แล้วไปพร้อมกัน
 */
function VoidButton({
  disbursementId,
  onVoid,
}: {
  disbursementId: string;
  onVoid: (input: { disbursementId: string; reason: string }) => Promise<ActionOutcome>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState('');
  const form = useActionForm({ onSuccess: () => setIsOpen(false) });

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        ยกเลิกการเบิกจ่าย
      </button>
    );
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        await form.submit(() => onVoid({ disbursementId, reason }));
      }}
      className="w-full max-w-sm space-y-2"
    >
      <FormError message={form.errorMessage} />
      <TextField label="เหตุผลที่ยกเลิก" required value={reason} onChange={setReason} />
      <div className="flex gap-2">
        <SubmitButton isSubmitting={form.isSubmitting}>ยืนยันการยกเลิก</SubmitButton>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ไม่ยกเลิก
        </button>
      </div>
    </form>
  );
}
