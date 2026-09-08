import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import type { ProcurementStatus } from '@/domain/procurement/status';
import type {
  ProcurementClassification,
  ProcurementMethodCode,
  TaxModeCode,
} from '@/domain/procurement/schemas';

/**
 * การเข้าถึงข้อมูลรายการจัดซื้อ
 *
 * ทุก query ผ่าน client ของผู้ใช้ ไม่ใช่ service-role — RLS จึงเป็นตัวกรอง
 * ว่าใครเห็นอะไร ไม่ใช่เงื่อนไข where ที่นี่ (ADR 0003, 0004)
 * เงื่อนไข where ที่มีอยู่เป็นเรื่องการแสดงผล ไม่ใช่การควบคุมการเข้าถึง
 *
 * ยอดเงินอ่านจาก view procurement_totals เสมอ ไม่มีคอลัมน์ยอดในตารางหลัก
 */

export interface ProcurementTotals {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  fundingTotal: string;
}

export interface ProcurementSummary {
  id: string;
  reference: string;
  subject: string;
  status: ProcurementStatus;
  requestDate: string;
  version: number;
  createdBy: string;
  vendorName: string | null;
  totals: ProcurementTotals;
}

interface TotalsRow {
  procurement_id: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  grand_total: string;
  funding_total: string;
}

interface ListRow {
  id: string;
  reference: string;
  subject: string;
  status: ProcurementStatus;
  request_date: string;
  version: number;
  created_by: string;
  vendors: { name: string } | null;
}

const ZERO_TOTALS: ProcurementTotals = {
  subtotal: '0.00',
  discountTotal: '0.00',
  taxTotal: '0.00',
  grandTotal: '0.00',
  fundingTotal: '0.00',
};

function toTotals(row: TotalsRow | undefined): ProcurementTotals {
  if (!row) return ZERO_TOTALS;
  return {
    subtotal: row.subtotal,
    discountTotal: row.discount_total,
    taxTotal: row.tax_total,
    grandTotal: row.grand_total,
    fundingTotal: row.funding_total,
  };
}

/**
 * รายการทั้งหมดที่ผู้ใช้ปัจจุบันมีสิทธิ์เห็น
 *
 * ดึงยอดแยกอีก query แทนการ join เพราะ PostgREST ยังไม่รู้จักความสัมพันธ์
 * ระหว่างตารางกับ view ที่ไม่มี foreign key การทำสอง query ที่ตรงไปตรงมา
 * อ่านง่ายกว่าการสร้าง view ซ้อนเพื่อให้ join ได้
 */
export async function listProcurements(limit = 50): Promise<ProcurementSummary[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('procurements')
    .select('id, reference, subject, status, request_date, version, created_by, vendors(name)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<ListRow[]>();

  if (error) throw new Error(`อ่านรายการจัดซื้อไม่สำเร็จ: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: totalsData } = await supabase
    .from('procurement_totals')
    .select('procurement_id, subtotal, discount_total, tax_total, grand_total, funding_total')
    .in(
      'procurement_id',
      rows.map((row) => row.id),
    )
    .returns<TotalsRow[]>();

  const totalsById = new Map((totalsData ?? []).map((row) => [row.procurement_id, row]));

  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    subject: row.subject,
    status: row.status,
    requestDate: row.request_date,
    version: row.version,
    createdBy: row.created_by,
    vendorName: row.vendors?.name ?? null,
    totals: toTotals(totalsById.get(row.id)),
  }));
}

export interface ProcurementItemRow {
  id: string;
  lineNo: number;
  description: string;
  quantity: string;
  unitId: string | null;
  unitPrice: string;
  discountAmount: string;
  taxRate: string;
  itemCategoryId: string | null;
}

export interface FundingAllocationRow {
  id: string;
  lineNo: number;
  budgetAccountId: string;
  amount: string;
  note: string | null;
}

export interface ProcurementDetail extends ProcurementSummary {
  purpose: string | null;
  taxMode: TaxModeCode;
  fiscalYearId: string;
  departmentId: string | null;
  vendorId: string | null;
  requiredDate: string | null;
  note: string | null;

  /* ชุดวันที่และการจัดประเภทที่เพิ่มใน PR-03 (แผนข้อ 6.3) */
  reportDate: string | null;
  approvedDate: string | null;
  selectionDate: string | null;
  orderOrAgreementDate: string | null;
  deliveryOrServiceDate: string | null;
  inspectionDate: string | null;
  sentToFinanceDate: string | null;
  classification: ProcurementClassification | null;
  procurementMethod: ProcurementMethodCode | null;
  methodLegalBasisCode: string | null;
  isEmergency: boolean;
  exceptionReason: string | null;

  items: ProcurementItemRow[];
  fundingAllocations: FundingAllocationRow[];
}

interface DetailRow extends ListRow {
  purpose: string | null;
  tax_mode: TaxModeCode;
  fiscal_year_id: string;
  department_id: string | null;
  vendor_id: string | null;
  required_date: string | null;
  note: string | null;
  report_date: string | null;
  approved_date: string | null;
  selection_date: string | null;
  order_or_agreement_date: string | null;
  delivery_or_service_date: string | null;
  inspection_date: string | null;
  sent_to_finance_date: string | null;
  classification: ProcurementClassification | null;
  procurement_method: ProcurementMethodCode | null;
  method_legal_basis_code: string | null;
  is_emergency: boolean;
  exception_reason: string | null;
}

interface ItemRow {
  id: string;
  line_no: number;
  description: string;
  quantity: string;
  unit_id: string | null;
  unit_price: string;
  discount_amount: string;
  tax_rate: string;
  item_category_id: string | null;
}

interface FundingRow {
  id: string;
  line_no: number;
  budget_account_id: string;
  amount: string;
  note: string | null;
}

/** คืน null เมื่อไม่พบหรือไม่มีสิทธิ์เห็น — ผู้เรียกต้องไม่แยกสองกรณีนี้ให้ผู้ใช้เห็น */
export async function getProcurement(id: string): Promise<ProcurementDetail | null> {
  const supabase = await createSupabaseServerClient();

  const { data: row } = await supabase
    .from('procurements')
    .select(
      'id, reference, subject, purpose, status, tax_mode, fiscal_year_id, department_id, ' +
        'vendor_id, request_date, required_date, note, version, created_by, vendors(name), ' +
        'report_date, approved_date, selection_date, order_or_agreement_date, ' +
        'delivery_or_service_date, inspection_date, sent_to_finance_date, ' +
        'classification, procurement_method, method_legal_basis_code, is_emergency, ' +
        'exception_reason',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle<DetailRow>();

  if (!row) return null;

  const [{ data: items }, { data: funding }, { data: totals }] = await Promise.all([
    supabase
      .from('procurement_items')
      .select(
        'id, line_no, description, quantity, unit_id, unit_price, discount_amount, ' +
          'tax_rate, item_category_id',
      )
      .eq('procurement_id', id)
      .order('line_no')
      .returns<ItemRow[]>(),
    supabase
      .from('procurement_funding_allocations')
      .select('id, line_no, budget_account_id, amount, note')
      .eq('procurement_id', id)
      .order('line_no')
      .returns<FundingRow[]>(),
    supabase
      .from('procurement_totals')
      .select('procurement_id, subtotal, discount_total, tax_total, grand_total, funding_total')
      .eq('procurement_id', id)
      .returns<TotalsRow[]>(),
  ]);

  return {
    id: row.id,
    reference: row.reference,
    subject: row.subject,
    purpose: row.purpose,
    status: row.status,
    taxMode: row.tax_mode,
    fiscalYearId: row.fiscal_year_id,
    departmentId: row.department_id,
    vendorId: row.vendor_id,
    requestDate: row.request_date,
    requiredDate: row.required_date,
    note: row.note,
    reportDate: row.report_date,
    approvedDate: row.approved_date,
    selectionDate: row.selection_date,
    orderOrAgreementDate: row.order_or_agreement_date,
    deliveryOrServiceDate: row.delivery_or_service_date,
    inspectionDate: row.inspection_date,
    sentToFinanceDate: row.sent_to_finance_date,
    classification: row.classification,
    procurementMethod: row.procurement_method,
    methodLegalBasisCode: row.method_legal_basis_code,
    isEmergency: row.is_emergency,
    exceptionReason: row.exception_reason,
    version: row.version,
    createdBy: row.created_by,
    vendorName: row.vendors?.name ?? null,
    totals: toTotals(totals?.[0]),
    items: (items ?? []).map((item) => ({
      id: item.id,
      lineNo: item.line_no,
      description: item.description,
      quantity: item.quantity,
      unitId: item.unit_id,
      unitPrice: item.unit_price,
      discountAmount: item.discount_amount,
      taxRate: item.tax_rate,
      itemCategoryId: item.item_category_id,
    })),
    fundingAllocations: (funding ?? []).map((row) => ({
      id: row.id,
      lineNo: row.line_no,
      budgetAccountId: row.budget_account_id,
      amount: row.amount,
      note: row.note,
    })),
  };
}

export interface ValidationRow {
  ruleCode: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  field: string | null;
  overridden: boolean;
}

/**
 * ผลตรวจกฎของรายการหนึ่ง ณ ขณะนี้
 *
 * เรียก RPC `procurement_check_submit` ซึ่งเป็น **ฟังก์ชันเดียวกับที่
 * `procurement_submit` เรียกตอนบังคับจริง** จึงไม่มีทางที่หน้าจอจะแสดงผลต่างจาก
 * สิ่งที่ระบบจะบังคับตอนกดส่ง
 */
export async function checkProcurementRules(id: string): Promise<ValidationRow[]> {
  const supabase = await createSupabaseServerClient();

  /*
   * RPC ที่คืนเป็น table ถูก type ของ supabase-js มองว่าอาจเป็นแถวเดียวหรือหลายแถว
   * จึงต้องระบุชนิดของผลลัพธ์เอง ไม่ใช้ .returns<T[]>() ซึ่งชนกับ type ของ rpc()
   */
  interface CheckRow {
    rule_code: string;
    severity: 'ERROR' | 'WARNING' | 'INFO';
    message: string;
    field: string | null;
  }

  const { data, error } = await supabase.rpc('procurement_check_submit', {
    p_procurement_id: id,
  });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as CheckRow[];

  return rows.map((row) => ({
    ruleCode: row.rule_code,
    severity: row.severity,
    message: row.message,
    field: row.field,
    overridden: false,
  }));
}
