import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import type { ProcurementStatus } from '@/domain/procurement/status';
import type { TaxModeCode } from '@/domain/procurement/schemas';

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
        'vendor_id, request_date, required_date, note, version, created_by, vendors(name)',
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
