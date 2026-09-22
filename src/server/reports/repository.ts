import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import { decimalStringToSatang } from '@/domain/money/money';
import type { BudgetReportRow } from '@/domain/budget/report';
import type { BudgetReportFilter } from '@/domain/budget/report-schemas';
import type { ProcurementStatus } from '@/domain/procurement/status';
import type {
  ProcurementClassification,
  ProcurementMethodCode,
} from '@/domain/procurement/schemas';
import type { DocumentNumberStatus, ProcurementRegisterRow } from '@/domain/procurement/register';
import type { ProcurementRegisterFilter } from '@/domain/procurement/register-schemas';
/* DocumentNumberStatus ไม่ได้ import ที่นี่ เพราะ register.ts ส่งต่อชนิดเดียวกันมาแล้ว
   ด้านบน — เป็น enum เดียวกันในฐานข้อมูล ไม่ใช่สองชนิดที่บังเอิญหน้าตาเหมือนกัน */
import type { DocumentKind } from '@/domain/documents/document-register';
import type { DocumentExceptionRow, DocumentSequenceRow } from '@/domain/documents/sequence-report';
import type { DocumentStatusFilter } from '@/domain/documents/sequence-report-schemas';

/**
 * การอ่านข้อมูลสำหรับรายงานงบประมาณ
 *
 * เรียกผ่าน client ของผู้ใช้ ไม่ใช่ service-role และ function ฝั่งฐานข้อมูล
 * เป็น security invoker — **RLS จึงเป็นตัวกรองจริง** ถ้าที่นี่ใช้ service-role
 * การลืมตรวจสิทธิ์ในชั้นแอปจะกลายเป็นการเปิดยอดงบทั้งโรงเรียนให้ทุกคนอ่าน
 * (เหตุผลเดียวกับ repository ของ audit log)
 *
 * ไม่มีคำสั่งเขียนใด ๆ ในไฟล์นี้ รายงานเป็นการอ่านอย่างเดียว
 */

/**
 * แถวที่ function คืนมา — จำนวนเงินเป็นข้อความทศนิยมของ numeric(18,2)
 *
 * RPC ที่คืนเป็น table ถูก type ของ supabase-js มองว่าอาจเป็นแถวเดียวหรือหลายแถว
 * จึงต้องระบุชนิดของผลลัพธ์เอง ไม่ใช้ `.returns<T[]>()` ซึ่งชนกับ type ของ rpc()
 */
interface ReportDbRow {
  budget_account_id: string;
  account_code: string;
  account_status: 'OPEN' | 'CLOSED';
  fiscal_year_id: string;
  fiscal_year_code: string | null;
  project_id: string | null;
  project_name: string | null;
  funding_source_id: string | null;
  funding_source_name: string | null;
  department_id: string | null;
  department_name: string | null;
  granted_amount: string;
  reserved_amount: string;
  used_amount: string;
}

/**
 * แปลงเป็นหน่วยสตางค์ที่ขอบ repository ตามกติกาของ src/domain/money/money.ts
 *
 * ค่าที่ฐานข้อมูลส่งมาอาจเป็น number ได้เมื่อ driver แปลงให้ — `decimalStringToSatang`
 * รับทั้งสองแบบและปฏิเสธค่าที่มีทศนิยมเกินสองตำแหน่ง จึงไม่ปัดเศษให้เงียบ ๆ
 */
function toSatang(value: string): bigint {
  return decimalStringToSatang(value);
}

export async function loadBudgetReportRows(filter: BudgetReportFilter): Promise<BudgetReportRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc('budget_report_rows', {
    p_fiscal_year_id: filter.fiscalYearId ?? null,
    p_as_of: filter.asOf ?? null,
    p_only_open: filter.onlyOpen,
  });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ReportDbRow[];

  return rows.map((row) => ({
    accountId: row.budget_account_id,
    accountCode: row.account_code,
    status: row.account_status,
    fiscalYearId: row.fiscal_year_id,
    fiscalYearCode: row.fiscal_year_code,
    projectId: row.project_id,
    projectName: row.project_name,
    fundingSourceId: row.funding_source_id,
    fundingSourceName: row.funding_source_name,
    departmentId: row.department_id,
    departmentName: row.department_name,
    grantedSatang: toSatang(row.granted_amount),
    reservedSatang: toSatang(row.reserved_amount),
    usedSatang: toSatang(row.used_amount),
  }));
}

export interface FiscalYearOption {
  id: string;
  label: string;
}

/**
 * ปีงบทั้งหมดสำหรับตัวกรอง — รวมปีที่ปิดแล้วด้วย
 *
 * ต่างจากฟอร์มสร้างบัญชีงบที่เลือกได้เฉพาะปีที่เปิดอยู่ เพราะการดูรายงาน
 * ย้อนหลังของปีที่ปิดไปแล้วคือเหตุผลหลักที่รายงานนี้มีอยู่
 */
export async function loadFiscalYearOptions(): Promise<FiscalYearOption[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('fiscal_years')
    .select('id, code, year_be, status')
    .order('year_be', { ascending: false })
    .returns<{ id: string; code: string; year_be: number; status: 'OPEN' | 'CLOSED' }[]>();

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    label: `${row.code} (พ.ศ. ${row.year_be})${row.status === 'CLOSED' ? ' — ปิดแล้ว' : ''}`,
  }));
}

// -----------------------------------------------------------------------------
// ทะเบียนจัดซื้อจัดจ้าง (PR-09b)
// -----------------------------------------------------------------------------

/**
 * เพดานจำนวนแถวที่หน้าเดียวรับไหว
 *
 * ทะเบียนไม่แบ่งหน้าโดยตั้งใจ — ยอดรวมและยอดรายสถานะต้องคิดจากแถวชุดเดียวกับ
 * ที่แสดง ถ้าแบ่งหน้าแล้วคิดยอดรวมจาก query อีกชุด ตัวเลขสองส่วนจะค่อย ๆ
 * ไม่ตรงกันโดยไม่มีอะไรฟ้อง (เหตุผลเดียวกับ src/domain/budget/report.ts)
 *
 * เมื่อข้อมูลเกินเพดาน หน้าจอ **ไม่แสดงยอดรวมเลย** แทนที่จะแสดงยอดของแถว
 * ที่เหลือรอด — ยอดรวมบางส่วนที่ติดป้ายว่า "ยอดรวม" คือคำตอบที่ผิดและน่าเชื่อ
 */
export const REGISTER_ROW_LIMIT = 1000;

interface RegisterDbRow {
  procurement_id: string;
  reference: string;
  subject: string;
  status: ProcurementStatus;
  classification: ProcurementClassification | null;
  procurement_method: ProcurementMethodCode | null;
  is_emergency: boolean;
  fiscal_year_id: string;
  fiscal_year_code: string | null;
  department_name: string | null;
  vendor_name: string | null;
  request_date: string;
  order_or_agreement_date: string | null;
  request_memo_no: string | null;
  request_memo_status: DocumentNumberStatus | null;
  purchase_order_no: string | null;
  purchase_order_status: DocumentNumberStatus | null;
  grand_total: string;
  funding_total: string;
}

export interface ProcurementRegisterResult {
  rows: ProcurementRegisterRow[];
  /** true = ยังมีแถวที่ตรงตัวกรองอยู่อีก แต่เกินเพดานจึงไม่ได้ถูกดึงมา */
  truncated: boolean;
}

/**
 * อ่านทะเบียนตามตัวกรอง พร้อมบอกว่าถูกตัดแถวหรือไม่
 *
 * ขอเกินเพดานหนึ่งแถวเพื่อให้รู้ว่ามีแถวที่ถูกตัดจริง — วิธีนับจำนวนทั้งหมด
 * ด้วย query แยกจะบอกได้เหมือนกัน แต่เป็นการอ่านสองครั้งที่อาจเห็นข้อมูลคนละ
 * ช่วงเวลา ทำให้หน้าจอบอกว่า "ครบแล้ว" ทั้งที่เพิ่งมีแถวใหม่เข้ามา
 *
 * เรียกผ่าน client ของผู้ใช้ และ function เป็น security invoker — **RLS ของ
 * public.procurements เป็นตัวกำหนดขอบเขตแถวจริง** ผู้ที่มีเพียง
 * procurement.read.own จะได้เฉพาะรายการของตน แม้จะเรียก RPC ตรงก็ตาม
 */
export async function loadProcurementRegister(
  filter: ProcurementRegisterFilter,
): Promise<ProcurementRegisterResult> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc('procurement_register_rows', {
    p_fiscal_year_id: filter.fiscalYearId ?? null,
    p_classification: filter.classification ?? null,
    p_status: filter.status ?? null,
    p_date_from: filter.dateFrom ?? null,
    p_date_to: filter.dateTo ?? null,
    p_limit: REGISTER_ROW_LIMIT + 1,
  });

  if (error) throw new Error(error.message);

  const dbRows = (data ?? []) as RegisterDbRow[];
  const truncated = dbRows.length > REGISTER_ROW_LIMIT;

  return {
    truncated,
    rows: dbRows.slice(0, REGISTER_ROW_LIMIT).map((row) => ({
      procurementId: row.procurement_id,
      reference: row.reference,
      subject: row.subject,
      status: row.status,
      classification: row.classification,
      method: row.procurement_method,
      isEmergency: row.is_emergency,
      fiscalYearId: row.fiscal_year_id,
      fiscalYearCode: row.fiscal_year_code,
      departmentName: row.department_name,
      vendorName: row.vendor_name,
      requestDate: row.request_date,
      orderDate: row.order_or_agreement_date,
      requestMemoNo: row.request_memo_no,
      requestMemoStatus: row.request_memo_status,
      purchaseOrderNo: row.purchase_order_no,
      purchaseOrderStatus: row.purchase_order_status,
      grandTotalSatang: toSatang(row.grand_total),
      fundingTotalSatang: toSatang(row.funding_total),
    })),
  };
}

// -----------------------------------------------------------------------------
// รายงานสถานะเอกสาร (PR-09c)
// -----------------------------------------------------------------------------

/**
 * เพดานจำนวนแถวของรายการยกเว้น
 *
 * ต่างจากทะเบียนจัดซื้อจัดจ้างตรงที่ **ไม่ต้องซ่อนยอดรวมเมื่อถูกตัด** เพราะ
 * ยอดรวมของรายงานนี้มาจาก document_sequence_rows() ซึ่งนับที่ฐานข้อมูลจากทุกแถว
 * ไม่ได้นับจากรายการที่ส่งมาแสดง การตัดรายการยกเว้นจึงตัดแค่รายละเอียด
 * ไม่ได้ทำให้ตัวเลขสรุปผิด
 */
export const DOCUMENT_EXCEPTION_LIMIT = 500;

interface SequenceDbRow {
  fiscal_year_id: string;
  fiscal_year_code: string | null;
  document_kind: DocumentKind;
  issued_count: number;
  voided_count: number;
  pending_count: number;
  not_required_count: number;
  min_running: number | null;
  max_running: number | null;
  used_running_count: number;
  missing_count: number;
  missing_sample: number[] | null;
  duplicate_running: number[] | null;
  unparsed_count: number;
}

export async function loadDocumentSequenceRows(
  filter: DocumentStatusFilter,
): Promise<DocumentSequenceRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc('document_sequence_rows', {
    p_fiscal_year_id: filter.fiscalYearId ?? null,
    p_document_kind: filter.documentKind ?? null,
  });

  if (error) throw new Error(error.message);

  return ((data ?? []) as SequenceDbRow[]).map((row) => ({
    fiscalYearId: row.fiscal_year_id,
    fiscalYearCode: row.fiscal_year_code,
    documentKind: row.document_kind,
    issuedCount: row.issued_count,
    voidedCount: row.voided_count,
    pendingCount: row.pending_count,
    notRequiredCount: row.not_required_count,
    minRunning: row.min_running,
    maxRunning: row.max_running,
    usedRunningCount: row.used_running_count,
    missingCount: row.missing_count,
    /* อาร์เรย์ที่ว่างอาจมาเป็น null ได้เมื่อ driver แปลงให้ — ทั้งสองแบบแปลว่า
       "ไม่มีตัวอย่างให้แสดง" ซึ่งไม่เท่ากับ "ไม่มีเลขขาด" (ดู missingCount) */
    missingSample: row.missing_sample ?? [],
    duplicateRunning: row.duplicate_running ?? [],
    unparsedCount: row.unparsed_count,
  }));
}

interface ExceptionDbRow {
  document_number_id: string;
  fiscal_year_code: string | null;
  document_kind: DocumentKind;
  status: DocumentNumberStatus;
  document_no: string | null;
  running_no: number | null;
  reason: string | null;
  procurement_id: string;
  procurement_reference: string | null;
  procurement_subject: string | null;
  created_at: string;
  voided_at: string | null;
}

export interface DocumentExceptionResult {
  rows: DocumentExceptionRow[];
  /** true = ยังมีข้อยกเว้นอีก แต่เกินเพดานจึงไม่ได้ถูกดึงมา */
  truncated: boolean;
}

export async function loadDocumentExceptions(
  filter: DocumentStatusFilter,
): Promise<DocumentExceptionResult> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc('document_number_exceptions', {
    p_fiscal_year_id: filter.fiscalYearId ?? null,
    p_document_kind: filter.documentKind ?? null,
    p_status: filter.exceptionStatus ?? null,
    p_limit: DOCUMENT_EXCEPTION_LIMIT + 1,
  });

  if (error) throw new Error(error.message);

  const dbRows = (data ?? []) as ExceptionDbRow[];

  return {
    truncated: dbRows.length > DOCUMENT_EXCEPTION_LIMIT,
    rows: dbRows.slice(0, DOCUMENT_EXCEPTION_LIMIT).map((row) => ({
      documentNumberId: row.document_number_id,
      fiscalYearCode: row.fiscal_year_code,
      documentKind: row.document_kind,
      status: row.status,
      documentNo: row.document_no,
      runningNo: row.running_no,
      reason: row.reason,
      procurementId: row.procurement_id,
      procurementReference: row.procurement_reference,
      procurementSubject: row.procurement_subject,
      createdAt: row.created_at,
      voidedAt: row.voided_at,
    })),
  };
}
