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
import type { SelectOption } from '@/features/forms/fields';
import type { ActionOutcome } from '@/features/forms/use-action-form';

export interface BudgetAccountFormOptions {
  fiscalYears: SelectOption[];
  projects: (SelectOption & { fiscalYearId: string })[];
  fundingSources: SelectOption[];
  departments: SelectOption[];
}

export interface BudgetAccountFormValues {
  code: string;
  fiscalYearId: string;
  projectId?: string;
  fundingSourceId?: string;
  departmentId?: string;
  note: string;
}

/**
 * ฟอร์มสร้างบัญชีงบ
 *
 * รายการโครงการถูกกรองให้เหลือเฉพาะโครงการของปีงบประมาณที่เลือก เพราะบัญชีงบ
 * ที่ผูกกับโครงการคนละปีจะทำให้รายงานรายปีรวมยอดผิดโดยไม่มีอะไรฟ้อง
 * server ตรวจข้อเดียวกันซ้ำ — การกรองที่นี่เป็นเรื่อง UX ไม่ใช่การควบคุม
 */
export function BudgetAccountForm({
  options,
  action,
}: {
  options: BudgetAccountFormOptions;
  action: (values: BudgetAccountFormValues) => Promise<ActionOutcome>;
}) {
  const [code, setCode] = useState('');
  const [fiscalYearId, setFiscalYearId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [fundingSourceId, setFundingSourceId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [note, setNote] = useState('');

  const form = useActionForm({
    onSuccess: () => {
      setCode('');
      setProjectId('');
      setNote('');
    },
  });

  const projectsOfYear = useMemo(
    () => options.projects.filter((project) => project.fiscalYearId === fiscalYearId),
    [options.projects, fiscalYearId],
  );

  function changeFiscalYear(value: string) {
    setFiscalYearId(value);
    // โครงการที่เลือกไว้อาจไม่อยู่ในปีใหม่ ล้างทิ้งดีกว่าปล่อยค่าที่มองไม่เห็นค้างไว้
    setProjectId('');
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await form.submit(() =>
      action({
        code,
        fiscalYearId,
        ...(projectId ? { projectId } : {}),
        ...(fundingSourceId ? { fundingSourceId } : {}),
        ...(departmentId ? { departmentId } : {}),
        note,
      }),
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormError message={form.errorMessage} />

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="รหัสบัญชีงบ"
          required
          value={code}
          onChange={setCode}
          error={form.fieldError('code')}
          hint="ซ้ำข้ามปีงบประมาณได้ แต่ห้ามซ้ำภายในปีเดียวกัน"
        />
        <SelectField
          label="ปีงบประมาณ"
          required
          value={fiscalYearId}
          onChange={changeFiscalYear}
          options={options.fiscalYears}
          error={form.fieldError('fiscalYearId')}
          hint="แสดงเฉพาะปีที่ยังเปิดอยู่"
        />
        <SelectField
          label="โครงการ"
          value={projectId}
          onChange={setProjectId}
          options={projectsOfYear}
          placeholder={fiscalYearId ? '— ยังไม่ระบุ —' : '— เลือกปีงบประมาณก่อน —'}
          error={form.fieldError('projectId')}
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
          label="หน่วยงาน"
          value={departmentId}
          onChange={setDepartmentId}
          options={options.departments}
          placeholder="— ยังไม่ระบุ —"
          error={form.fieldError('departmentId')}
        />
        <TextAreaField
          label="หมายเหตุ"
          value={note}
          onChange={setNote}
          error={form.fieldError('note')}
          className="md:col-span-2"
        />
      </div>

      <p className="text-sm text-slate-600">
        ต้องระบุอย่างน้อยหนึ่งอย่างในสามช่อง: โครงการ แหล่งเงิน หรือหน่วยงาน
        มิฉะนั้นจะไม่รู้ว่าบัญชีนี้คุมยอดของอะไร
      </p>

      <SubmitButton isSubmitting={form.isSubmitting}>สร้างบัญชีงบ</SubmitButton>
    </form>
  );
}
