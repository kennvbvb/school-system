'use client';

import { ProcurementForm } from './procurement-form';
import type {
  ProcurementFormOptions,
  ProcurementFormValues,
  SubmitResult,
} from './procurement-form';

/**
 * ตัวห่อฝั่ง client ของฟอร์มสร้างรายการ
 *
 * มีไว้เพื่อแยก server action ออกจาก component ที่ต้องรับ prop เป็นฟังก์ชัน
 * ซึ่ง server component ส่งข้ามไปตรง ๆ ไม่ได้
 */
export function CreateProcurementForm({
  options,
  defaultFiscalYearId,
  today,
  action,
}: {
  options: ProcurementFormOptions;
  defaultFiscalYearId: string;
  today: string;
  action: (values: ProcurementFormValues) => Promise<SubmitResult>;
}) {
  return (
    <ProcurementForm
      options={options}
      submitLabel="บันทึกฉบับร่าง"
      onSubmit={action}
      initialValues={{
        subject: '',
        purpose: '',
        taxMode: 'EXEMPT',
        fiscalYearId: defaultFiscalYearId,
        departmentId: '',
        vendorId: '',
        requestDate: today,
        requiredDate: '',
        note: '',
        items: [],
        fundingAllocations: [],
      }}
    />
  );
}
