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
import { ADJUSTMENT_MOVEMENT_TYPES } from '@/domain/inventory/schemas';
import { STOCK_MOVEMENT_TYPE_LABELS_TH } from '@/domain/inventory/movement';
import type { AdjustmentMovementType } from '@/domain/inventory/schemas';
import type { SelectOption } from '@/features/forms/fields';
import type { ActionOutcome } from '@/features/forms/use-action-form';

export interface AdjustmentFormValues {
  itemId: string;
  type: AdjustmentMovementType;
  quantity: string;
  effectiveDate: string;
  reference: string;
  reason: string;
  approvedBy: string;
}

const TYPE_OPTIONS = ADJUSTMENT_MOVEMENT_TYPES.map((type) => ({
  id: type,
  label: STOCK_MOVEMENT_TYPE_LABELS_TH[type],
}));

/**
 * ฟอร์มปรับยอด — ต้องมี inventory.adjust และต้องระบุเหตุผลและผู้อนุมัติเสมอ
 *
 * ใช้กับกรณีนับสต็อกแล้วไม่ตรงกับบัญชี ไม่ใช่ช่องทางแก้ยอดที่ลงผิดจากรายการ
 * รับเข้า/เบิกจ่าย — กรณีนั้นใช้ "ย้อนรายการ" แทน (ดูปุ่มในตารางด้านล่าง)
 */
export function AdjustmentForm({
  itemId,
  defaultDate,
  approvers,
  action,
}: {
  itemId: string;
  defaultDate: string;
  approvers: readonly SelectOption[];
  action: (values: AdjustmentFormValues) => Promise<ActionOutcome>;
}) {
  const [type, setType] = useState<AdjustmentMovementType>('ADJUSTMENT_INCREASE');
  const [quantity, setQuantity] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(defaultDate);
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [approvedBy, setApprovedBy] = useState('');

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
        type,
        quantity: quantity.trim(),
        effectiveDate,
        reference,
        reason,
        approvedBy,
      }),
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormError message={form.errorMessage} />

      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label="ทิศทางการปรับยอด"
          required
          value={type}
          onChange={(value) => setType(value as AdjustmentMovementType)}
          options={TYPE_OPTIONS}
          placeholder="— เลือก —"
          error={form.fieldError('type')}
        />
        <TextField
          label="จำนวนที่ต่างจากบัญชี"
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
          label="เลขที่บันทึกปรับยอด"
          required
          value={reference}
          onChange={setReference}
          error={form.fieldError('reference')}
        />
        <SelectField
          label="ผู้อนุมัติ"
          required
          value={approvedBy}
          onChange={setApprovedBy}
          options={approvers}
          error={form.fieldError('approvedBy')}
        />
        <TextAreaField
          label="เหตุผลการปรับยอด"
          required
          rows={2}
          value={reason}
          onChange={setReason}
          error={form.fieldError('reason')}
          className="md:col-span-2"
          hint="บังคับกรอกเสมอ เช่น 'นับสต็อกประจำเดือน ก.ย. 2569 พบขาด/เกิน'"
        />
      </div>

      <SubmitButton isSubmitting={form.isSubmitting}>บันทึกปรับยอด</SubmitButton>
    </form>
  );
}
