'use client';

import { ProcurementForm } from './procurement-form';
import type {
  ProcurementFormOptions,
  ProcurementFormValues,
  SubmitResult,
} from './procurement-form';

/** ตัวห่อฝั่ง client ของฟอร์มแก้ไข — ดูเหตุผลใน create-form.tsx */
export function EditProcurementForm({
  options,
  initialValues,
  action,
}: {
  options: ProcurementFormOptions;
  initialValues: ProcurementFormValues;
  action: (values: ProcurementFormValues) => Promise<SubmitResult>;
}) {
  return (
    <ProcurementForm
      options={options}
      submitLabel="บันทึกการแก้ไข"
      onSubmit={action}
      initialValues={initialValues}
    />
  );
}
