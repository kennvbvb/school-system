'use client';

import { useState } from 'react';
import { FormError, SubmitButton, TextAreaField } from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import type { ActionOutcome } from '@/features/forms/use-action-form';

/**
 * ปุ่มสำหรับการกระทำที่ต้องมีเหตุผลกำกับ
 *
 * ใช้กับการปิด/เปิดปีงบประมาณและการปิดบัญชีงบ ทั้งสามอย่างเปลี่ยนว่าใครบันทึก
 * รายการอะไรได้บ้าง จึงเป็นสิ่งที่ผู้ตรวจสอบต้องอ่านย้อนหลังได้ว่า "ทำไม"
 *
 * ไม่ใช้ `window.confirm()` เพราะกล่องนั้นรับข้อความไม่ได้ และเหตุผลที่ไม่ได้
 * บันทึกไว้เท่ากับไม่มีเหตุผล ปุ่มนี้จึงเปิดฟอร์มจริงแทน
 */
export function ReasonActionButton({
  label,
  title,
  confirmLabel,
  reasonLabel,
  variant = 'primary',
  action,
}: {
  label: string;
  title: string;
  confirmLabel: string;
  reasonLabel: string;
  variant?: 'primary' | 'danger';
  action: (reason: string) => Promise<ActionOutcome>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState('');

  const form = useActionForm({
    onSuccess: () => {
      setReason('');
      setIsOpen(false);
    },
  });

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={
          variant === 'danger'
            ? 'rounded-md border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-800 hover:bg-rose-50'
            : 'rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50'
        }
      >
        {label}
      </button>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await form.submit(() => action(reason));
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-md border border-slate-300 bg-slate-50 p-4"
    >
      <h3 className="font-medium">{title}</h3>
      <FormError message={form.errorMessage} />

      <TextAreaField
        label={reasonLabel}
        required
        rows={2}
        value={reason}
        onChange={setReason}
        error={form.fieldError('reason')}
      />

      <div className="flex gap-2">
        <SubmitButton isSubmitting={form.isSubmitting} variant={variant}>
          {confirmLabel}
        </SubmitButton>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-white"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}
