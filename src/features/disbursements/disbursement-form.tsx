'use client';

import { useMemo, useState } from 'react';
import { FormError, SubmitButton, TextAreaField, TextField } from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import { DISBURSEMENT_MESSAGES_TH, checkDisbursement } from '@/domain/procurement/disbursement';
import { decimalStringToSatang, formatSatang } from '@/domain/money/money';
import type { ActionOutcome } from '@/features/forms/use-action-form';
import type { ProcurementStatus } from '@/domain/procurement/status';

/**
 * ฟอร์มบันทึกการเบิกจ่าย (PR-04d)
 *
 * **ไม่มีช่องเลือกบัญชีงบ** ระบบแบ่งยอดตามสัดส่วนของยอดที่ยังกันไว้ให้เอง
 * รายการหนึ่งใช้เงินได้หลายแหล่ง (F-02) การให้ผู้ใช้คำนวณสัดส่วนเองเป็นงาน
 * ที่ผิดได้ง่าย และผิดแล้วยอดรวมยังตรง จึงไม่มีอะไรฟ้อง
 *
 * การเตือนที่นี่ใช้ `checkDisbursement` **ตัวเดียวกับที่โดเมนใช้** และเป็นเรื่อง UX
 * เท่านั้น — `procurement_disburse()` ที่ฐานข้อมูลเป็นผู้บังคับจริง
 */
export function DisbursementForm({
  procurementId,
  status,
  outstandingSatang,
  onSubmit,
}: {
  procurementId: string;
  status: ProcurementStatus;
  outstandingSatang: bigint;
  onSubmit: (input: {
    procurementId: string;
    amount: string;
    paidOn: string;
    documentNo: string;
    payeeName: string;
    note: string;
  }) => Promise<ActionOutcome>;
}) {
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [documentNo, setDocumentNo] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [note, setNote] = useState('');

  const form = useActionForm({
    onSuccess: () => {
      setAmount('');
      setDocumentNo('');
      setPayeeName('');
      setNote('');
    },
  });

  /*
   * แปลงเป็นสตางค์เพื่อตรวจ และกลืน error ของรูปแบบที่ยังพิมพ์ไม่เสร็จ
   *
   * ระหว่างพิมพ์ ค่าจะผ่านสถานะอย่าง "1." ซึ่งแปลงไม่ได้ — ถือว่ายังไม่มีอะไร
   * ให้ตรวจ ดีกว่าขึ้น error แดงตั้งแต่ตัวอักษรแรก
   */
  const amountSatang = useMemo(() => {
    if (amount.trim() === '') return null;
    try {
      return decimalStringToSatang(amount.trim());
    } catch {
      return null;
    }
  }, [amount]);

  const rejection = useMemo(() => {
    if (amountSatang === null) return null;
    return checkDisbursement({
      status,
      amountSatang,
      outstanding: [{ budgetAccountId: 'all', amountSatang: outstandingSatang }],
    });
  }, [status, amountSatang, outstandingSatang]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await form.submit(() =>
      onSubmit({ procurementId, amount, paidOn, documentNo, payeeName, note }),
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
    >
      <FormError message={form.errorMessage} />

      <p className="text-sm text-slate-600">
        ยอดที่กันไว้และยังไม่ได้จ่าย{' '}
        <strong className="font-mono">{formatSatang(outstandingSatang)}</strong> บาท
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="จำนวนเงินที่จ่าย" required value={amount} onChange={setAmount} />
        <TextField label="วันที่จ่าย" required type="date" value={paidOn} onChange={setPaidOn} />
        <TextField label="เลขที่เอกสารการจ่าย" value={documentNo} onChange={setDocumentNo} />
        <TextField label="ผู้รับเงิน" value={payeeName} onChange={setPayeeName} />
      </div>

      <TextAreaField label="หมายเหตุ" rows={2} value={note} onChange={setNote} />

      {rejection ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {DISBURSEMENT_MESSAGES_TH[rejection]}
        </p>
      ) : null}

      {/*
        กันไว้เฉพาะกรณีที่กดไปก็ถูกปฏิเสธแน่นอน ไม่กันเพราะช่องยังกรอกไม่ครบ
        ปุ่มที่กดไม่ได้ตั้งแต่ฟอร์มยังว่างทำให้ผู้ใช้ไม่รู้ว่าขาดอะไร
      */}
      <SubmitButton isSubmitting={form.isSubmitting} disabled={rejection !== null}>
        บันทึกการเบิกจ่าย
      </SubmitButton>
    </form>
  );
}
