import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { requirePermissionForPage } from '@/server/auth/guard';
import { getProcurement } from '@/server/procurement/repository';
import { loadProcurementFormOptions } from '@/server/procurement/options';
import { updateProcurementDraft } from '@/server/procurement/actions';
import { EditProcurementForm } from '@/features/procurements/edit-form';
import { isEditable } from '@/domain/procurement/draft';
import type { ProcurementFormValues } from '@/features/procurements/procurement-form';

export const metadata: Metadata = { title: 'แก้ไขรายการจัดซื้อจัดจ้าง' };

export default async function EditProcurementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermissionForPage(`/procurements/${id}/edit`, 'procurement.edit_draft');

  const procurement = await getProcurement(id);
  if (!procurement) notFound();

  /*
   * สถานะที่แก้ไม่ได้ ส่งกลับไปหน้ารายละเอียดแทนการแสดงฟอร์มที่กดบันทึกแล้วล้ม
   * ฐานข้อมูลปฏิเสธอยู่แล้วด้วย RLS การตรวจที่นี่เป็นเรื่องประสบการณ์ใช้งาน
   */
  if (!isEditable(procurement.status)) {
    redirect(`/procurements/${id}`);
  }

  const options = await loadProcurementFormOptions();

  const initialValues: ProcurementFormValues = {
    id: procurement.id,
    expectedVersion: procurement.version,
    subject: procurement.subject,
    purpose: procurement.purpose ?? '',
    taxMode: procurement.taxMode,
    fiscalYearId: procurement.fiscalYearId,
    departmentId: procurement.departmentId ?? '',
    vendorId: procurement.vendorId ?? '',
    requestDate: procurement.requestDate,
    requiredDate: procurement.requiredDate ?? '',
    reportDate: procurement.reportDate ?? '',
    approvedDate: procurement.approvedDate ?? '',
    selectionDate: procurement.selectionDate ?? '',
    orderOrAgreementDate: procurement.orderOrAgreementDate ?? '',
    deliveryOrServiceDate: procurement.deliveryOrServiceDate ?? '',
    inspectionDate: procurement.inspectionDate ?? '',
    sentToFinanceDate: procurement.sentToFinanceDate ?? '',
    classification: procurement.classification ?? '',
    procurementMethod: procurement.procurementMethod ?? '',
    methodLegalBasisCode: procurement.methodLegalBasisCode ?? '',
    isEmergency: procurement.isEmergency,
    note: procurement.note ?? '',
    items: procurement.items.map((item) => ({
      lineNo: item.lineNo,
      description: item.description,
      quantity: item.quantity,
      unitId: item.unitId ?? '',
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount,
      taxRate: item.taxRate,
    })),
    fundingAllocations: procurement.fundingAllocations.map((row) => ({
      lineNo: row.lineNo,
      budgetAccountId: row.budgetAccountId,
      amount: row.amount,
    })),
  };

  async function action(values: ProcurementFormValues) {
    'use server';

    const result = await updateProcurementDraft({
      id: values.id,
      expectedVersion: values.expectedVersion,
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
        <p className="font-mono text-sm text-slate-500">{procurement.reference}</p>
        <h1 className="text-2xl font-semibold">แก้ไขรายการจัดซื้อจัดจ้าง</h1>
        <p className="text-slate-600">
          หากมีผู้อื่นแก้ไขรายการนี้ระหว่างที่คุณเปิดหน้าอยู่ ระบบจะไม่บันทึกทับ
          แต่จะแจ้งให้โหลดหน้าใหม่
        </p>
      </header>

      <EditProcurementForm options={options} initialValues={initialValues} action={action} />
    </div>
  );
}
