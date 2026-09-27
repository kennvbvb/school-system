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

export interface IssueFormValues {
  itemId: string;
  quantity: string;
  effectiveDate: string;
  reference: string;
  requestedBy: string;
  approvedBy: string;
  reason: string;
}

/** ฟอร์มเบิกจ่าย — ต้องมี inventory.issue และต้องระบุทั้งผู้เบิกและผู้อนุมัติเสมอ */
export function IssueForm({
  itemId,
  defaultDate,
  actors,
  action,
}: {
  itemId: string;
  defaultDate: string;
  actors: readonly SelectOption[];
  action: (values: IssueFormValues) => Promise<ActionOutcome>;
}) {
  const [quantity, setQuantity] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(defaultDate);
  const [reference, setReference] = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [reason, setReason] = useState('');

  const form = useActionForm({
    onSuccess: () => {
      setQuantity('');
      setReference('');
      setReason('');
    },
  });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await form.submit(() =>
      action({
        itemId,
        quantity: quantity.trim(),
        effectiveDate,
        reference,
        requestedBy,
        approvedBy,
        reason,
      }),
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormError message={form.errorMessage} />

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="จำนวน"
          required
          value={quantity}
          onChange={setQuantity}
          error={form.fieldError('quantity')}
          hint="ทศนิยมไม่เกิน 3 ตำแหน่ง — เบิกเกินยอดคงเหลือจะถูกปฏิเสธ"
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
          label="เลขที่ใบเบิก"
          required
          value={reference}
          onChange={setReference}
          error={form.fieldError('reference')}
        />
        <SelectField
          label="ผู้เบิก"
          required
          value={requestedBy}
          onChange={setRequestedBy}
          options={actors}
          error={form.fieldError('requestedBy')}
        />
        <SelectField
          label="ผู้อนุมัติ"
          required
          value={approvedBy}
          onChange={setApprovedBy}
          options={actors}
          error={form.fieldError('approvedBy')}
        />
        <TextAreaField
          label="หมายเหตุ"
          rows={2}
          value={reason}
          onChange={setReason}
          error={form.fieldError('reason')}
          className="md:col-span-2"
        />
      </div>

      <SubmitButton isSubmitting={form.isSubmitting}>บันทึกเบิกจ่าย</SubmitButton>
    </form>
  );
}
