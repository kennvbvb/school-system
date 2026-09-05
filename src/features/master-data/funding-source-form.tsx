'use client';

import { useState } from 'react';
import { FormError, SubmitButton, TextAreaField, TextField } from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import type { ActionOutcome } from '@/features/forms/use-action-form';

/** ฟอร์มเพิ่มแหล่งเงิน — แหล่งเงินใช้ข้ามปีงบประมาณจึงไม่ผูกกับปีใดปีหนึ่ง */
export function FundingSourceForm({
  action,
}: {
  action: (values: {
    code: string;
    nameTh: string;
    description: string;
    isActive: boolean;
  }) => Promise<ActionOutcome>;
}) {
  const [code, setCode] = useState('');
  const [nameTh, setNameTh] = useState('');
  const [description, setDescription] = useState('');

  const form = useActionForm({
    onSuccess: () => {
      setCode('');
      setNameTh('');
      setDescription('');
    },
  });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await form.submit(() => action({ code, nameTh, description, isActive: true }));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormError message={form.errorMessage} />

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="รหัสแหล่งเงิน"
          required
          value={code}
          onChange={setCode}
          error={form.fieldError('code')}
          hint="เช่น UC หรือ INCOME"
        />
        <TextField
          label="ชื่อแหล่งเงิน"
          required
          value={nameTh}
          onChange={setNameTh}
          error={form.fieldError('nameTh')}
        />
        <TextAreaField
          label="คำอธิบาย"
          value={description}
          onChange={setDescription}
          error={form.fieldError('description')}
          className="md:col-span-2"
        />
      </div>

      <SubmitButton isSubmitting={form.isSubmitting}>เพิ่มแหล่งเงิน</SubmitButton>
    </form>
  );
}
