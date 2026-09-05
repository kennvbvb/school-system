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

export interface ProjectFormOptions {
  fiscalYears: SelectOption[];
  fundingSources: SelectOption[];
  departments: SelectOption[];
}

export interface ProjectFormValues {
  code: string;
  nameTh: string;
  fiscalYearId: string;
  departmentId?: string;
  fundingSourceId?: string;
  description: string;
  isActive: boolean;
}

/**
 * ฟอร์มเพิ่มโครงการ
 *
 * **ไม่มีช่องวงเงิน** โดยเจตนา (ADR 0008)
 *
 * วงเงินของโครงการอยู่ในบัญชีงบ ซึ่งเป็น ledger ที่แก้ยอดไม่ได้นอกจากลงรายการใหม่
 * ถ้าฟอร์มนี้มีช่องวงเงินด้วย ระบบจะมีวงเงินสองชุดที่ไม่ตรงกันได้ ซึ่งเป็นรูปแบบ
 * เดียวกับที่ทำให้เกิดข้อค้นพบ F-01 (โครงการที่ยอดคงเหลือติดลบโดยไม่มีอะไรฟ้อง)
 */
export function ProjectForm({
  options,
  action,
}: {
  options: ProjectFormOptions;
  action: (values: ProjectFormValues) => Promise<ActionOutcome>;
}) {
  const [code, setCode] = useState('');
  const [nameTh, setNameTh] = useState('');
  const [fiscalYearId, setFiscalYearId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [fundingSourceId, setFundingSourceId] = useState('');
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
    await form.submit(() =>
      action({
        code,
        nameTh,
        fiscalYearId,
        // ช่องที่ไม่บังคับส่ง undefined ไม่ใช่ค่าว่าง เพราะ schema ถือว่าค่าว่างคือ "ละไว้"
        ...(departmentId ? { departmentId } : {}),
        ...(fundingSourceId ? { fundingSourceId } : {}),
        description,
        isActive: true,
      }),
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormError message={form.errorMessage} />

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="รหัสโครงการ"
          required
          value={code}
          onChange={setCode}
          error={form.fieldError('code')}
          hint="ซ้ำข้ามปีงบประมาณได้ แต่ห้ามซ้ำภายในปีเดียวกัน"
        />
        <TextField
          label="ชื่อโครงการ"
          required
          value={nameTh}
          onChange={setNameTh}
          error={form.fieldError('nameTh')}
        />
        <SelectField
          label="ปีงบประมาณ"
          required
          value={fiscalYearId}
          onChange={setFiscalYearId}
          options={options.fiscalYears}
          error={form.fieldError('fiscalYearId')}
        />
        <SelectField
          label="แหล่งเงิน"
          value={fundingSourceId}
          onChange={setFundingSourceId}
          options={options.fundingSources}
          placeholder="— ยังไม่ระบุ —"
          error={form.fieldError('fundingSourceId')}
        />
        <SelectField
          label="หน่วยงานเจ้าของโครงการ"
          value={departmentId}
          onChange={setDepartmentId}
          options={options.departments}
          placeholder="— ยังไม่ระบุ —"
          error={form.fieldError('departmentId')}
        />
        <TextAreaField
          label="คำอธิบาย"
          value={description}
          onChange={setDescription}
          error={form.fieldError('description')}
          className="md:col-span-2"
        />
      </div>

      <p className="text-sm text-slate-600">
        วงเงินของโครงการกำหนดที่บัญชีงบ ไม่ได้กำหนดที่นี่ — สร้างโครงการแล้วจึงไปสร้างบัญชีงบ
        และจัดสรรวงเงินในหน้างบประมาณ
      </p>

      <SubmitButton isSubmitting={form.isSubmitting}>เพิ่มโครงการ</SubmitButton>
    </form>
  );
}
