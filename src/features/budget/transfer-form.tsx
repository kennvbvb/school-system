'use client';

import { useState } from 'react';
import {
  FormError,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import type { SelectOption } from '@/features/forms/fields';
import type { ActionOutcome } from '@/features/forms/use-action-form';

export interface TransferFormValues {
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  effectiveDate: string;
  reason: string;
  approvalReference: string;
}

/**
 * ฟอร์มโอนงบระหว่างบัญชี — ปิดข้อค้นพบ F-02
 *
 * F-02 คือการใช้เงินข้ามโครงการโดยไม่มีเอกสารโอนงบรองรับ ซึ่งเกิดได้เพราะใน
 * สเปรดชีตไม่มีขั้นตอนที่บังคับให้บันทึกการโอน ที่นี่การโอนเป็นรายการคู่ที่ลง
 * พร้อมกันในทรานแซกชันเดียว และ **บังคับเหตุผลทุกครั้ง** ผู้ตรวจสอบจึงอ่านย้อนหลัง
 * ได้เสมอว่าเงินย้ายจากไหนไปไหน เพราะอะไร
 */
export function TransferForm({
  accounts,
  currentAccountId,
  defaultDate,
  action,
}: {
  accounts: SelectOption[];
  currentAccountId: string;
  defaultDate: string;
  action: (values: TransferFormValues) => Promise<ActionOutcome>;
}) {
  const [toAccountId, setToAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(defaultDate);
  const [reason, setReason] = useState('');
  const [approvalReference, setApprovalReference] = useState('');

  const form = useActionForm({
    onSuccess: () => {
      setToAccountId('');
      setAmount('');
      setReason('');
      setApprovalReference('');
    },
  });

  // บัญชีต้นทางคือบัญชีของหน้านี้ จึงตัดออกจากรายการปลายทางเสมอ
  const destinations = accounts.filter((account) => account.id !== currentAccountId);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await form.submit(() =>
      action({
        fromAccountId: currentAccountId,
        toAccountId,
        amount: amount.trim(),
        effectiveDate,
        reason,
        approvalReference,
      }),
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormError message={form.errorMessage} />

      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label="บัญชีปลายทาง"
          required
          value={toAccountId}
          onChange={setToAccountId}
          options={destinations}
          error={form.fieldError('toAccountId')}
        />
        <TextField
          label="จำนวนเงินที่โอน (บาท)"
          required
          value={amount}
          onChange={setAmount}
          error={form.fieldError('amount')}
        />
        <TextField
          label="วันที่มีผล"
          type="date"
          required
          value={effectiveDate}
          onChange={setEffectiveDate}
          error={form.fieldError('effectiveDate')}
        />
        <TextField
          label="เลขที่หนังสืออนุมัติ"
          value={approvalReference}
          onChange={setApprovalReference}
          error={form.fieldError('approvalReference')}
        />
        <TextAreaField
          label="เหตุผลการโอนงบ"
          required
          rows={2}
          value={reason}
          onChange={setReason}
          error={form.fieldError('reason')}
          className="md:col-span-2"
          hint="บังคับเสมอ — การโอนงบเปลี่ยนวงเงินที่ผู้อนุมัติเคยเห็น"
        />
      </div>

      <SubmitButton isSubmitting={form.isSubmitting}>โอนงบ</SubmitButton>
    </form>
  );
}
