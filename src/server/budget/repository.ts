import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import type { MovementType } from '@/domain/budget/movement';

/**
 * การอ่านข้อมูลบัญชีงบ
 *
 * ยอดคงเหลืออ่านจาก view `budget_account_balances` เสมอ ไม่คำนวณซ้ำที่นี่
 * และไม่มีคอลัมน์ยอดในตาราง — ยอดที่แก้ได้โดยไม่มีร่องรอยคือยอดที่ตรวจสอบไม่ได้
 * (ADR 0008)
 *
 * บัญชีงบและรายการเคลื่อนไหวอ่านได้เฉพาะผู้ถือ `budget.read` ซึ่งบังคับด้วย RLS
 * ไม่ใช่เงื่อนไขที่นี่
 */

export interface BudgetBalance {
  granted: string;
  reserved: string;
  used: string;
  available: string;
}

export interface BudgetAccountSummary {
  id: string;
  code: string;
  status: 'OPEN' | 'CLOSED';
  fiscalYearId: string;
  fiscalYearCode: string | null;
  projectName: string | null;
  fundingSourceName: string | null;
  departmentName: string | null;
  note: string | null;
  balance: BudgetBalance;
}

interface AccountRow {
  id: string;
  code: string;
  status: 'OPEN' | 'CLOSED';
  fiscal_year_id: string;
  note: string | null;
  fiscal_years: { code: string } | null;
  projects: { name_th: string } | null;
  funding_sources: { name_th: string } | null;
  departments: { name_th: string } | null;
}

interface BalanceRow {
  budget_account_id: string;
  granted_amount: string;
  reserved_amount: string;
  used_amount: string;
  available_amount: string;
}

const ZERO_BALANCE: BudgetBalance = {
  granted: '0.00',
  reserved: '0.00',
  used: '0.00',
  available: '0.00',
};

function toBalance(row: BalanceRow | undefined): BudgetBalance {
  if (!row) return ZERO_BALANCE;
  return {
    granted: row.granted_amount,
    reserved: row.reserved_amount,
    used: row.used_amount,
    available: row.available_amount,
  };
}

/*
 * ดึงยอดแยกอีก query แทนการ join
 *
 * PostgREST ยังไม่รู้จักความสัมพันธ์ระหว่างตารางกับ view ที่ไม่มี foreign key
 * การทำสอง query ที่ตรงไปตรงมาอ่านง่ายกว่าการสร้าง view ซ้อนเพื่อให้ join ได้
 * (เหตุผลเดียวกับที่ repository ของรายการจัดซื้อทำ)
 */
async function loadBalances(accountIds: readonly string[]): Promise<Map<string, BalanceRow>> {
  if (accountIds.length === 0) return new Map();

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('budget_account_balances')
    .select('budget_account_id, granted_amount, reserved_amount, used_amount, available_amount')
    .in('budget_account_id', [...accountIds])
    .returns<BalanceRow[]>();

  return new Map((data ?? []).map((row) => [row.budget_account_id, row]));
}

const ACCOUNT_COLUMNS =
  'id, code, status, fiscal_year_id, note, ' +
  'fiscal_years(code), projects(name_th), funding_sources(name_th), departments(name_th)';

function toSummary(row: AccountRow, balances: Map<string, BalanceRow>): BudgetAccountSummary {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    fiscalYearId: row.fiscal_year_id,
    fiscalYearCode: row.fiscal_years?.code ?? null,
    projectName: row.projects?.name_th ?? null,
    fundingSourceName: row.funding_sources?.name_th ?? null,
    departmentName: row.departments?.name_th ?? null,
    note: row.note,
    balance: toBalance(balances.get(row.id)),
  };
}

export async function listBudgetAccounts(): Promise<BudgetAccountSummary[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('budget_accounts')
    .select(ACCOUNT_COLUMNS)
    .order('code')
    .returns<AccountRow[]>();

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const balances = await loadBalances(rows.map((row) => row.id));
  return rows.map((row) => toSummary(row, balances));
}

export async function getBudgetAccount(id: string): Promise<BudgetAccountSummary | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('budget_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', id)
    .maybeSingle<AccountRow>();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const balances = await loadBalances([data.id]);
  return toSummary(data, balances);
}

export interface BudgetMovementRow {
  id: string;
  type: MovementType;
  amount: string;
  effectiveDate: string;
  reason: string | null;
  approvalReference: string | null;
  sourceType: string | null;
  reversesMovementId: string | null;
  /** true = แถวนี้ถูกย้อนไปแล้ว จึงย้อนซ้ำไม่ได้ */
  isReversed: boolean;
  createdAt: string;
}

interface MovementDbRow {
  id: string;
  movement_type: MovementType;
  amount: string;
  effective_date: string;
  reason: string | null;
  approval_reference: string | null;
  source_type: string | null;
  reverses_movement_id: string | null;
  created_at: string;
}

/**
 * รายการเคลื่อนไหวของบัญชีหนึ่ง เรียงใหม่ก่อนเก่า
 *
 * `isReversed` คำนวณจากชุดที่ดึงมาทั้งหมด ไม่ใช่ query แยกต่อแถว เพราะรายการ
 * ย้อนของบัญชีเดียวกันต้องอยู่ในชุดนี้เสมอ (migration 0009 บังคับว่าย้อนข้ามบัญชีไม่ได้)
 */
export async function listBudgetMovements(accountId: string): Promise<BudgetMovementRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('budget_movements')
    .select(
      'id, movement_type, amount, effective_date, reason, approval_reference, ' +
        'source_type, reverses_movement_id, created_at',
    )
    .eq('budget_account_id', accountId)
    .order('effective_date', { ascending: false })
    .order('created_at', { ascending: false })
    .returns<MovementDbRow[]>();

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const reversedIds = new Set(
    rows.flatMap((row) => (row.reverses_movement_id ? [row.reverses_movement_id] : [])),
  );

  return rows.map((row) => ({
    id: row.id,
    type: row.movement_type,
    amount: row.amount,
    effectiveDate: row.effective_date,
    reason: row.reason,
    approvalReference: row.approval_reference,
    sourceType: row.source_type,
    reversesMovementId: row.reverses_movement_id,
    isReversed: reversedIds.has(row.id),
    createdAt: row.created_at,
  }));
}

export interface BudgetAccountOptions {
  fiscalYears: { id: string; label: string }[];
  projects: { id: string; label: string; fiscalYearId: string }[];
  fundingSources: { id: string; label: string }[];
  departments: { id: string; label: string }[];
}

/**
 * ตัวเลือกสำหรับฟอร์มสร้างบัญชีงบ
 *
 * โครงการพ่วง fiscalYearId มาด้วย เพื่อให้ฟอร์มกรองให้เหลือเฉพาะโครงการของปีที่เลือก
 * ถ้าไม่กรอง ผู้ใช้จะสร้างบัญชีที่ปีงบกับโครงการคนละปีได้ ซึ่งทำให้ยอดของปีหนึ่ง
 * ไปผูกกับโครงการของอีกปีโดยที่ฐานข้อมูลไม่ได้ห้ามไว้
 */
export async function loadBudgetAccountOptions(): Promise<BudgetAccountOptions> {
  const supabase = await createSupabaseServerClient();

  const [fiscalYears, projects, fundingSources, departments] = await Promise.all([
    supabase
      .from('fiscal_years')
      .select('id, code, year_be')
      .eq('status', 'OPEN')
      .order('year_be', { ascending: false })
      .returns<{ id: string; code: string; year_be: number }[]>(),
    supabase
      .from('projects')
      .select('id, code, name_th, fiscal_year_id')
      .eq('is_active', true)
      .order('code')
      .returns<{ id: string; code: string; name_th: string; fiscal_year_id: string }[]>(),
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
      label: `${row.code} (พ.ศ. ${row.year_be})`,
    })),
    projects: (projects.data ?? []).map((row) => ({
      id: row.id,
      label: `${row.name_th} (${row.code})`,
      fiscalYearId: row.fiscal_year_id,
    })),
    fundingSources: (fundingSources.data ?? []).map((row) => ({
      id: row.id,
      label: `${row.name_th} (${row.code})`,
    })),
    departments: (departments.data ?? []).map((row) => ({ id: row.id, label: row.name_th })),
  };
}
