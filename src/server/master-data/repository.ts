import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import type { FiscalYear } from '@/domain/master-data/fiscal-year';
import { vendorAddressToLine } from '@/domain/master-data/vendor';
import type { VendorSummary } from '@/domain/master-data/vendor';

/**
 * การอ่านข้อมูลพื้นฐาน
 *
 * ทุก query ผ่าน client ของผู้ใช้ ไม่ใช่ service-role — RLS จึงเป็นตัวกรอง
 * ว่าใครเห็นอะไร ไม่ใช่เงื่อนไข where ที่นี่ (ADR 0003, 0004)
 *
 * ไม่กรอง is_active ออกในหน้าจอผู้ดูแล เพราะผู้ดูแลต้องเห็นรายการที่ปิดใช้แล้ว
 * จึงจะเปิดกลับมาได้ การกรองที่กระทบการ "เลือกใช้" อยู่ที่ options.ts ของแต่ละฟอร์ม
 */

interface FiscalYearRow {
  id: string;
  code: string;
  year_be: number;
  start_date: string;
  end_date: string;
  status: 'OPEN' | 'CLOSED';
  closed_at: string | null;
}

export async function listFiscalYears(): Promise<FiscalYear[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('fiscal_years')
    .select('id, code, year_be, start_date, end_date, status, closed_at')
    .order('year_be', { ascending: false })
    .returns<FiscalYearRow[]>();

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    yearBE: row.year_be,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
  }));
}

export interface FundingSourceSummary {
  id: string;
  code: string;
  nameTh: string;
  description: string | null;
  isActive: boolean;
}

export async function listFundingSources(): Promise<FundingSourceSummary[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('funding_sources')
    .select('id, code, name_th, description, is_active')
    .order('code')
    .returns<
      {
        id: string;
        code: string;
        name_th: string;
        description: string | null;
        is_active: boolean;
      }[]
    >();

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    nameTh: row.name_th,
    description: row.description,
    isActive: row.is_active,
  }));
}

export interface ProjectSummary {
  id: string;
  code: string;
  nameTh: string;
  fiscalYearId: string;
  fiscalYearCode: string | null;
  fundingSourceName: string | null;
  departmentName: string | null;
  isActive: boolean;
}

interface ProjectRow {
  id: string;
  code: string;
  name_th: string;
  fiscal_year_id: string;
  is_active: boolean;
  fiscal_years: { code: string } | null;
  funding_sources: { name_th: string } | null;
  departments: { name_th: string } | null;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('projects')
    .select(
      'id, code, name_th, fiscal_year_id, is_active, ' +
        'fiscal_years(code), funding_sources(name_th), departments(name_th)',
    )
    .order('code')
    .returns<ProjectRow[]>();

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    nameTh: row.name_th,
    fiscalYearId: row.fiscal_year_id,
    fiscalYearCode: row.fiscal_years?.code ?? null,
    fundingSourceName: row.funding_sources?.name_th ?? null,
    departmentName: row.departments?.name_th ?? null,
    isActive: row.is_active,
  }));
}

export interface SelectOption {
  id: string;
  label: string;
}

export interface MasterDataOptions {
  fiscalYears: SelectOption[];
  fundingSources: SelectOption[];
  departments: SelectOption[];
}

/**
 * ตัวเลือกสำหรับฟอร์มข้อมูลพื้นฐาน
 *
 * ปีงบประมาณที่ปิดแล้วยังเลือกได้ในฟอร์มโครงการ เพราะการเพิ่มโครงการย้อนหลัง
 * เข้าปีที่ปิดแล้วเป็นงานธุรการที่เกิดขึ้นจริง (เช่นบันทึกข้อมูลเก่าเข้าระบบ)
 * ส่วนการ **ลงรายการเงิน** ในปีที่ปิดแล้วยังต้องใช้สิทธิ์ budget.override เหมือนเดิม
 */
export async function loadMasterDataOptions(): Promise<MasterDataOptions> {
  const supabase = await createSupabaseServerClient();

  const [fiscalYears, fundingSources, departments] = await Promise.all([
    supabase
      .from('fiscal_years')
      .select('id, code, year_be, status')
      .order('year_be', { ascending: false })
      .returns<{ id: string; code: string; year_be: number; status: string }[]>(),
    supabase
      .from('funding_sources')
      .select('id, code, name_th')
      .eq('is_active', true)
      .order('code')
      .returns<{ id: string; code: string; name_th: string }[]>(),
    supabase
      .from('departments')
      .select('id, name_th')
      .eq('is_active', true)
      .order('name_th')
      .returns<{ id: string; name_th: string }[]>(),
  ]);

  return {
    fiscalYears: (fiscalYears.data ?? []).map((row) => ({
      id: row.id,
      label:
        row.status === 'CLOSED'
          ? `${row.code} (พ.ศ. ${row.year_be} — ปิดแล้ว)`
          : `${row.code} (พ.ศ. ${row.year_be})`,
    })),
    fundingSources: (fundingSources.data ?? []).map((row) => ({
      id: row.id,
      label: `${row.name_th} (${row.code})`,
    })),
    departments: (departments.data ?? []).map((row) => ({ id: row.id, label: row.name_th })),
  };
}

// -----------------------------------------------------------------------------
// ผู้ขาย (FR-MST-005)
// -----------------------------------------------------------------------------

/**
 * รายละเอียดผู้ขายที่หน้าจอผู้ดูแลต้องใช้
 *
 * ขยายจาก `VendorSummary` ของชั้นโดเมน ซึ่งมีเฉพาะช่องที่ใช้ตรวจซ้ำ —
 * ชั้นโดเมนไม่ควรรู้จักเบอร์โทรหรือที่อยู่ เพราะไม่ได้ใช้ตัดสินอะไรเลย
 */
export interface VendorDetail extends VendorSummary {
  address: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
}

interface VendorRow {
  id: string;
  vendor_code: string;
  name: string;
  tax_id: string | null;
  branch_no: string | null;
  address: unknown;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  is_active: boolean;
}

const VENDOR_COLUMNS =
  'id, vendor_code, name, tax_id, branch_no, address, contact_name, phone, email, note, is_active';

function toVendorDetail(row: VendorRow): VendorDetail {
  return {
    id: row.id,
    vendorCode: row.vendor_code,
    name: row.name,
    taxId: row.tax_id,
    branchNo: row.branch_no,
    address: vendorAddressToLine(row.address),
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    note: row.note,
    isActive: row.is_active,
  };
}

/**
 * ผู้ขายทั้งหมดที่ยังไม่ถูกลบ
 *
 * รวมผู้ขายที่ปิดใช้แล้วด้วย เพราะการตรวจซ้ำต้องเทียบกับผู้ขายที่ปิดใช้ด้วย —
 * ถ้าไม่เทียบ ผู้ใช้จะบันทึกผู้ขายรายเดิมซ้ำได้เพียงเพราะรายเดิมถูกปิดใช้ไว้
 * ซึ่งจะได้ข้อมูลซ้ำที่ชนกับ unique index ของเลขผู้เสียภาษีอยู่ดี
 */
export async function listVendors(): Promise<VendorDetail[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('vendors')
    .select(VENDOR_COLUMNS)
    .is('deleted_at', null)
    .order('vendor_code')
    .returns<VendorRow[]>();

  if (error) throw new Error(error.message);

  return (data ?? []).map(toVendorDetail);
}
