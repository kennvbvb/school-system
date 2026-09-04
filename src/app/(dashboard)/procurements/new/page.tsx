import type { Metadata } from 'next';
import { requirePermissionForPage } from '@/server/auth/guard';
import { loadProcurementFormOptions } from '@/server/procurement/options';
import { createProcurementDraft } from '@/server/procurement/actions';
import { CreateProcurementForm } from '@/features/procurements/create-form';
import { toBangkokDateString } from '@/lib/format/thai-date';
import type { ProcurementFormValues } from '@/features/procurements/procurement-form';

export const metadata: Metadata = { title: 'สร้างรายการจัดซื้อจัดจ้าง' };

export default async function NewProcurementPage() {
  await requirePermissionForPage('/procurements/new', 'procurement.create');

  const options = await loadProcurementFormOptions();
  // วันที่ตั้งต้นเป็นวันนี้ตามเวลาไทยเสมอ ไม่ใช่เวลาของเครื่องผู้ใช้
  const today = toBangkokDateString(new Date());

  async function action(values: ProcurementFormValues) {
    'use server';

    const result = await createProcurementDraft({
      subject: values.subject,
      purpose: values.purpose,
      taxMode: values.taxMode,
      fiscalYearId: values.fiscalYearId,
      departmentId: values.departmentId || undefined,
      vendorId: values.vendorId || undefined,
      requestDate: values.requestDate,
      requiredDate: values.requiredDate || undefined,
      note: values.note,
      items: values.items.map((item) => ({
        lineNo: item.lineNo,
        description: item.description,
        quantity: item.quantity,
        unitId: item.unitId || undefined,
        unitPrice: item.unitPrice,
        discountAmount: item.discountAmount,
        taxRate: item.taxRate,
      })),
      fundingAllocations: values.fundingAllocations.map((row) => ({
        lineNo: row.lineNo,
        budgetAccountId: row.budgetAccountId,
        amount: row.amount,
      })),
    });

    return result.ok
      ? { ok: true as const }
      : { ok: false as const, error: result.error, fieldErrors: result.fieldErrors };
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">สร้างรายการจัดซื้อจัดจ้าง</h1>
        <p className="text-slate-600">
          บันทึกเป็นฉบับร่างได้แม้ข้อมูลยังไม่ครบ ระบบจะตรวจความครบถ้วนอีกครั้งตอนส่งอนุมัติ
        </p>
      </header>

      {options.fiscalYears.length === 0 ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          ยังไม่มีปีงบประมาณที่เปิดอยู่ในระบบ ผู้ดูแลระบบต้องเพิ่มปีงบประมาณก่อนจึงจะสร้างรายการได้
        </p>
      ) : (
        <CreateProcurementForm
          options={options}
          defaultFiscalYearId={options.fiscalYears[0]?.id ?? ''}
          today={today}
          action={action}
        />
      )}
    </div>
  );
}
