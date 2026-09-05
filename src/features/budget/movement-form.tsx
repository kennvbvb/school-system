'use client';

import { useMemo, useState } from 'react';
import {
  FormError,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import { MANUAL_MOVEMENT_TYPES } from '@/domain/budget/schemas';
import { MOVEMENT_TYPE_LABELS_TH } from '@/domain/budget/movement';
import { decimalStringToSatang, formatSatang } from '@/domain/money/money';
import { satangToThaiBahtText } from '@/domain/money/thai-baht-text';
import type { ManualMovementType } from '@/domain/budget/schemas';
import type { ActionOutcome } from '@/features/forms/use-action-form';

export interface MovementFormValues {
  accountId: string;
  type: ManualMovementType;
  amount: string;
  effectiveDate: string;
  reason: string;
  approvalReference: string;
}

const TYPE_OPTIONS = MANUAL_MOVEMENT_TYPES.map((type) => ({
  id: type,
  label: MOVEMENT_TYPE_LABELS_TH[type],
}));

/**
 * ฟอร์มลงรายการงบด้วยมือ
 *
 * มีเฉพาะสามชนิดที่คนเป็นผู้สั่งจริง (จัดสรร เพิ่ม ลด) การกันยอดและการใช้จ่าย
 * เป็นผลจากขั้นตอนของรายการจัดซื้อ ไม่ใช่สิ่งที่กรอกเองได้ ส่วนการโอนต้องเกิด
 * เป็นคู่จึงมีฟอร์มแยก — เหตุผลอยู่ใน src/domain/budget/schemas.ts
 *
 * ยอดที่แสดงเป็นการอ่านตัวเลขให้ตรวจก่อนกดบันทึกเท่านั้น ไม่ได้ถูกส่งไปกับฟอร์ม
 */
export function MovementForm({
  accountId,
  defaultDate,
  action,
}: {
  accountId: string;
  defaultDate: string;
  action: (values: MovementFormValues) => Promise<ActionOutcome>;
}) {
  const [type, setType] = useState<ManualMovementType>('ALLOCATION');
  const [amount, setAmount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(defaultDate);
  const [reason, setReason] = useState('');
  const [approvalReference, setApprovalReference] = useState('');

  const form = useActionForm({
    onSuccess: () => {
      setAmount('');
      setReason('');
      setApprovalReference('');
    },
  });

  /*
   * อ่านยอดเป็นตัวหนังสือให้ตรวจก่อนบันทึก
   *
   * ค่าที่ยังพิมพ์ไม่จบ (เช่น "12.") แปลงไม่ได้ จึงต้องกันไว้ ไม่ใช่ปล่อยให้
   * ฟอร์มพังระหว่างพิมพ์
   */
  const preview = useMemo(() => {
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) return null;
    try {
      const satang = decimalStringToSatang(amount.trim());
      if (satang <= 0n) return null;
      return { formatted: formatSatang(satang), text: satangToThaiBahtText(satang) };
    } catch {
      return null;
    }
  }, [amount]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await form.submit(() =>
      action({ accountId, type, amount: amount.trim(), effectiveDate, reason, approvalReference }),
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
          onChange={(value) => setType(value as ManualMovementType)}
          options={TYPE_OPTIONS}
          placeholder="— เลือก —"
          error={form.fieldError('type')}
        />
        <TextField
          label="จำนวนเงิน (บาท)"
          required
          value={amount}
          onChange={setAmount}
          error={form.fieldError('amount')}
          hint={preview ? `${preview.formatted} บาท — ${preview.text}` : 'ทศนิยมไม่เกิน 2 ตำแหน่ง'}
        />
        <TextField
          label="วันที่มีผล"
          type="date"
          required
          value={effectiveDate}
          onChange={setEffectiveDate}
          error={form.fieldError('effectiveDate')}
          hint="ต้องอยู่ในช่วงปีงบประมาณของบัญชีนี้"
        />
        <TextField
          label="เลขที่หนังสืออนุมัติ"
          value={approvalReference}
          onChange={setApprovalReference}
          error={form.fieldError('approvalReference')}
        />
        <TextAreaField
          label="เหตุผล"
          rows={2}
          value={reason}
          onChange={setReason}
          error={form.fieldError('reason')}
          className="md:col-span-2"
          hint="บังคับสำหรับการเพิ่มและลดงบ และเมื่อยอดคงเหลือจะติดลบ"
        />
      </div>

      <SubmitButton isSubmitting={form.isSubmitting}>ลงรายการ</SubmitButton>
    </form>
  );
}
