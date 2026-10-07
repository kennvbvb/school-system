import type { ProcurementDraftInput } from '@/domain/procurement/schemas';

/**
 * แปลงข้อมูลฟอร์มร่างจัดซื้อเป็น payload ของ RPC `procurement_create_draft` / `procurement_save_draft`
 * (migration 20261007000100 — F-08)
 *
 * RPC เขียนแม่ + รายการย่อย + แหล่งเงิน + audit ใน transaction เดียว จึงรับ payload ก้อนเดียวเป็น jsonb
 *
 * **ไม่ส่ง** ผู้สร้าง สถานะ เวลา version ปีงบ (ตอนบันทึก) หรือยอดเงินใด ๆ — ฟิลด์เหล่านี้ฐานข้อมูลกำหนดเอง
 * RPC เมินคีย์เหล่านั้นอยู่แล้ว แต่ไม่ส่งตั้งแต่ต้นทำให้ไม่มีใครเข้าใจผิดว่าตั้งได้
 * ค่าว่างส่งเป็น null (ไม่ใช่ undefined) เพราะ JSON.stringify ทิ้ง undefined ทำให้คีย์หายแทนที่จะล้างค่า
 */
export function toDraftPayload(input: ProcurementDraftInput): Record<string, unknown> {
  return {
    subject: input.subject,
    purpose: input.purpose ?? null,
    tax_mode: input.taxMode,
    fiscal_year_id: input.fiscalYearId,
    department_id: input.departmentId ?? null,
    vendor_id: input.vendorId ?? null,
    request_date: input.requestDate,
    required_date: input.requiredDate ?? null,
    report_date: input.reportDate ?? null,
    approved_date: input.approvedDate ?? null,
    selection_date: input.selectionDate ?? null,
    order_or_agreement_date: input.orderOrAgreementDate ?? null,
    delivery_or_service_date: input.deliveryOrServiceDate ?? null,
    inspection_date: input.inspectionDate ?? null,
    sent_to_finance_date: input.sentToFinanceDate ?? null,
    classification: input.classification ?? null,
    procurement_method: input.procurementMethod ?? null,
    method_legal_basis_code: input.methodLegalBasisCode ?? null,
    is_emergency: input.isEmergency,
    note: input.note ?? null,
    items: input.items.map((item) => ({
      line_no: item.lineNo,
      description: item.description,
      quantity: item.quantity,
      unit_id: item.unitId ?? null,
      unit_price: item.unitPrice,
      discount_amount: item.discountAmount,
      tax_rate: item.taxRate,
      item_category_id: item.itemCategoryId ?? null,
    })),
    funding_allocations: input.fundingAllocations.map((row) => ({
      line_no: row.lineNo,
      budget_account_id: row.budgetAccountId,
      amount: row.amount,
      note: row.note ?? null,
    })),
  };
}

/** คีย์ที่ห้ามอยู่ใน payload เด็ดขาด — ฐานข้อมูลกำหนดเอง (ใช้ในเทสต์) */
export const FORBIDDEN_DRAFT_PAYLOAD_KEYS = [
  'id',
  'reference',
  'status',
  'version',
  'created_by',
  'created_at',
  'updated_by',
  'updated_at',
  'deleted_at',
  'deleted_by',
  'exception_reason',
  'exception_attachment_id',
  'exception_granted_by',
  'exception_granted_at',
  'grand_total',
  'subtotal',
  'tax_total',
] as const;
