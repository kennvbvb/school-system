import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import type { ProcurementFormOptions } from '@/features/procurements/procurement-form';

/**
 * ตัวเลือกสำหรับ dropdown ในฟอร์ม
 *
 * ดึงเฉพาะรายการที่ยังใช้งานอยู่ (is_active) เพราะรายการที่ปิดใช้แล้ว
 * ต้องยังอ้างถึงได้ในเอกสารเก่า แต่ต้องเลือกใหม่ไม่ได้ (FR-MST-008)
 *
 * RLS เป็นผู้กรองว่าผู้ใช้เห็นบัญชีงบใดได้บ้าง ไม่ใช่เงื่อนไขที่นี่
 */
export async function loadProcurementFormOptions(): Promise<ProcurementFormOptions> {
  const supabase = await createSupabaseServerClient();

  const [fiscalYears, vendors, departments, units, budgetAccounts] = await Promise.all([
    supabase
      .from('fiscal_years')
      .select('id, code, year_be')
      .eq('status', 'OPEN')
      .order('year_be', { ascending: false })
      .returns<{ id: string; code: string; year_be: number }[]>(),
    supabase
      .from('vendors')
      .select('id, name, vendor_code')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name')
      .returns<{ id: string; name: string; vendor_code: string }[]>(),
    supabase
      .from('departments')
      .select('id, name_th')
      .eq('is_active', true)
      .order('name_th')
      .returns<{ id: string; name_th: string }[]>(),
    supabase
      .from('units')
      .select('id, name_th')
      .eq('is_active', true)
      .order('name_th')
      .returns<{ id: string; name_th: string }[]>(),
    supabase
      .from('budget_accounts')
      .select('id, code')
      .eq('status', 'OPEN')
      .order('code')
      .returns<{ id: string; code: string }[]>(),
  ]);

  return {
    fiscalYears: (fiscalYears.data ?? []).map((row) => ({
      id: row.id,
      label: `${row.code} (พ.ศ. ${row.year_be})`,
    })),
    vendors: (vendors.data ?? []).map((row) => ({
      id: row.id,
      label: `${row.name} (${row.vendor_code})`,
    })),
    departments: (departments.data ?? []).map((row) => ({ id: row.id, label: row.name_th })),
    units: (units.data ?? []).map((row) => ({ id: row.id, label: row.name_th })),
    budgetAccounts: (budgetAccounts.data ?? []).map((row) => ({ id: row.id, label: row.code })),
  };
}
