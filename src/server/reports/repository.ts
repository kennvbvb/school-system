import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import { decimalStringToSatang } from '@/domain/money/money';
import type { BudgetReportRow } from '@/domain/budget/report';
import type { BudgetReportFilter } from '@/domain/budget/report-schemas';

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
