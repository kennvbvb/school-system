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
import { RECEIVE_MOVEMENT_TYPES } from '@/domain/inventory/schemas';
import { STOCK_MOVEMENT_TYPE_LABELS_TH } from '@/domain/inventory/movement';
import type { ReceiveMovementType } from '@/domain/inventory/schemas';
import type { ActionOutcome } from '@/features/forms/use-action-form';

export interface ReceiveFormValues {
  itemId: string;
  type: ReceiveMovementType;
  quantity: string;
  effectiveDate: string;
  reference: string;
  reason: string;
}

const TYPE_OPTIONS = RECEIVE_MOVEMENT_TYPES.map((type) => ({
  id: type,
  label: STOCK_MOVEMENT_TYPE_LABELS_TH[type],
}));

/**
 * ฟอร์มรับเข้า/รับคืน/ยอดยกมา — ต้องมี inventory.receive
 *
 * ไม่มี ISSUE และ ADJUSTMENT_* ในฟอร์มนี้เพราะทั้งสองต้องมีผู้อนุมัติกำกับ
 * (ดูเหตุผลใน src/domain/inventory/schemas.ts)
 */
export function ReceiveForm({
  itemId,
  defaultDate,
  hasOpeningBalance,
  action,
}: {
  itemId: string;
  defaultDate: string;
  /** true = รายการนี้มีรายการเคลื่อนไหวแล้ว จึงลงยอดยกมาซ้ำไม่ได้ */
  hasOpeningBalance: boolean;
  action: (values: ReceiveFormValues) => Promise<ActionOutcome>;
}) {
  const [type, setType] = useState<ReceiveMovementType>(
    hasOpeningBalance ? 'RECEIPT' : 'OPENING_BALANCE',
  );
  const [quantity, setQuantity] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(defaultDate);
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');

  const typeOptions = hasOpeningBalance
    ? TYPE_OPTIONS.filter((option) => option.id !== 'OPENING_BALANCE')
    : TYPE_OPTIONS;

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
      action({ itemId, type, quantity: quantity.trim(), effectiveDate, reference, reason }),
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormError message={form.errorMessage} />

      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label="ประเภทรายการ"
          required
          value={type}
          onChange={(value) => setType(value as ReceiveMovementType)}
          options={typeOptions}
          placeholder="— เลือก —"
          error={form.fieldError('type')}
        />
        <TextField
          label="จำนวน"
          required
          value={quantity}
          onChange={setQuantity}
          error={form.fieldError('quantity')}
          hint="ทศนิยมไม่เกิน 3 ตำแหน่ง"
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
          label="เลขที่เอกสารอ้างอิง"
          required
          value={reference}
          onChange={setReference}
          error={form.fieldError('reference')}
          hint="เลขที่ใบรับ/ใบส่งของ หรือ 'ยอดยกมา FY...' สำหรับยอดยกมา"
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

      <SubmitButton isSubmitting={form.isSubmitting}>บันทึกรับเข้า</SubmitButton>
    </form>
  );
}
