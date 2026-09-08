'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/server/auth/guard';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import { recordAuditEvent } from '@/server/audit/audit-log';
import { INVALID_INPUT_MESSAGE, toFieldErrors } from '@/server/action-result';
import {
  fiscalYearSchema,
  fiscalYearStatusChangeSchema,
  fundingSourceSchema,
  projectSchema,
  vendorCreateSchema,
  vendorUpdateSchema,
} from '@/domain/master-data/schemas';
import { FiscalYearError, assertFiscalYearValid } from '@/domain/master-data/fiscal-year';
import { checkVendorDuplicateRule, vendorLineToAddress } from '@/domain/master-data/vendor';
import { listFiscalYears, listVendors } from './repository';
import type { ActionResult } from '@/server/action-result';
import type { DuplicateFinding } from '@/domain/master-data/vendor';

/**
 * Server action ของข้อมูลพื้นฐาน
 *
 * ลำดับเดิมทุกตัว (ข้อ 13): ตรวจสิทธิ์ → ตรวจข้อมูลด้วย schema เดียวกับฟอร์ม →
 * เขียนโดยมี RLS เป็นชั้นบังคับอีกชั้น → บันทึก audit
 *
 * ปีงบประมาณใช้สิทธิ์ `settings.manage` ส่วนที่เหลือใช้ `masters.manage`
 * ตรงกับ policy ใน migration 0004 — ถ้าสองที่ไม่ตรงกัน ผู้ใช้จะกดได้แล้วโดนปฏิเสธ
 * ที่ฐานข้อมูลโดยไม่มีข้อความที่แก้ตามได้
 */

/**
 * แปลงข้อผิดพลาดจาก PostgreSQL เป็นข้อความที่ผู้ใช้แก้ตามได้
 *
 * ทำที่นี่แทนการปล่อยข้อความดิบออกไป เพราะข้อความดิบบอกชื่อ constraint และ
 * ชื่อคอลัมน์ ซึ่งผู้ใช้แก้ตามไม่ได้และเปิดเผยโครงสร้างภายในโดยไม่จำเป็น
 */
function describeDatabaseError(message: string): string | null {
  if (message.includes('fiscal_years_code_key')) return 'มีรหัสปีงบประมาณนี้อยู่แล้ว';
  if (message.includes('fiscal_years_year_be_key')) return 'มีปีงบประมาณนี้อยู่แล้ว';
  if (message.includes('fiscal_years_no_overlap')) return 'ช่วงวันที่ทับกับปีงบประมาณที่มีอยู่แล้ว';
  if (message.includes('funding_sources_code_key')) return 'มีรหัสแหล่งเงินนี้อยู่แล้ว';
  if (message.includes('projects_fiscal_year_id_code_key'))
    return 'มีรหัสโครงการนี้อยู่แล้วในปีงบประมาณเดียวกัน';
  if (message.includes('vendors_vendor_code_key')) return 'มีรหัสผู้ขายนี้อยู่แล้ว';
  /*
   * unique index ของเลขผู้เสียภาษี+สาขา เป็นชั้นบังคับสุดท้ายของกฎ BLOCK
   * ถ้ามาถึงตรงนี้แปลว่ามีผู้ใช้อีกคนบันทึกผู้ขายรายเดียวกันแทรกเข้ามาระหว่างที่
   * ตรวจซ้ำกับตอนเขียน ซึ่งชั้น TypeScript จับไม่ได้โดยธรรมชาติ
   */
  if (message.includes('vendors_tax_id_branch_unique'))
    return 'มีผู้ขายที่ใช้เลขประจำตัวผู้เสียภาษีและสาขานี้อยู่แล้ว';
  if (message.includes('row-level security')) return 'คุณไม่มีสิทธิ์ดำเนินการนี้';
  return null;
}

function toActionError(error: unknown, context: string): ActionResult<never> {
  if (error instanceof FiscalYearError) {
    return { ok: false, error: error.message };
  }

  if (error instanceof Error) {
    const friendly = describeDatabaseError(error.message);
    if (friendly) return { ok: false, error: friendly };
  }

  console.error(`[master-data] ${context} ล้มเหลว`, error);
  return { ok: false, error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' };
}

// -----------------------------------------------------------------------------
// ปีงบประมาณ
// -----------------------------------------------------------------------------

export async function createFiscalYear(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('settings.manage');

    const parsed = fiscalYearSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    /*
     * ตรวจซ้ำกับข้อมูลที่มีอยู่ก่อนเขียน เพื่อให้ได้ข้อความภาษาไทยที่บอกว่า
     * ทับกับปีไหน ฐานข้อมูลยังมี exclusion constraint เป็นชั้นบังคับจริงอยู่
     * ทั้งสองชั้นจำเป็น: ชั้นนี้เพื่อ UX ชั้นฐานข้อมูลเพื่อความถูกต้องเมื่อเขียนพร้อมกัน
     */
    assertFiscalYearValid(parsed.data, await listFiscalYears());

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('fiscal_years')
      .insert({
        code: parsed.data.code,
        year_be: parsed.data.yearBE,
        start_date: parsed.data.startDate,
        end_date: parsed.data.endDate,
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !data) throw new Error(error?.message ?? 'ไม่ได้รับข้อมูลกลับจากฐานข้อมูล');

    await recordAuditEvent({
      action: 'entity.create',
      entityType: 'fiscal_year',
      entityId: data.id,
      actorId: user.id,
      after: {
        code: parsed.data.code,
        yearBE: parsed.data.yearBE,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
      },
    });

    revalidatePath('/admin/master-data/fiscal-years');
    return { ok: true, data };
  } catch (error) {
    return toActionError(error, 'สร้างปีงบประมาณ');
  }
}

/**
 * ปิดหรือเปิดปีงบประมาณ
 *
 * รวมสองทิศทางไว้ใน action เดียวเพราะกติกาเหมือนกันทุกอย่างยกเว้นค่าที่เขียน
 * และทั้งสองทิศต้องมีเหตุผลกำกับเท่ากัน การแยกเป็นสอง action จะทำให้กติกา
 * "ต้องมีเหตุผล" ถูกลืมในทิศใดทิศหนึ่งเมื่อมีการแก้ภายหลัง
 */
async function changeFiscalYearStatus(
  input: unknown,
  next: 'OPEN' | 'CLOSED',
): Promise<ActionResult<void>> {
  try {
    const user = await requirePermission('settings.manage');

    const parsed = fiscalYearStatusChangeSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    const supabase = await createSupabaseServerClient();

    const { data: current } = await supabase
      .from('fiscal_years')
      .select('id, code, status')
      .eq('id', parsed.data.fiscalYearId)
      .maybeSingle<{ id: string; code: string; status: 'OPEN' | 'CLOSED' }>();

    if (!current) {
      return { ok: false, error: 'ไม่พบปีงบประมาณนี้ หรือคุณไม่มีสิทธิ์แก้ไข' };
    }

    if (current.status === next) {
      return {
        ok: false,
        error: next === 'CLOSED' ? 'ปีงบประมาณนี้ปิดอยู่แล้ว' : 'ปีงบประมาณนี้เปิดอยู่แล้ว',
      };
    }

    /*
     * constraint fiscal_years_closed_consistency บังคับว่า CLOSED ต้องมี closed_at
     * และ OPEN ต้องไม่มี จึงเขียนทั้งสามคอลัมน์พร้อมกันเสมอ ไม่ใช่ทีละคอลัมน์
     */
    const { error } = await supabase
      .from('fiscal_years')
      .update(
        next === 'CLOSED'
          ? { status: 'CLOSED', closed_at: new Date().toISOString(), closed_by: user.id }
          : { status: 'OPEN', closed_at: null, closed_by: null },
      )
      .eq('id', parsed.data.fiscalYearId)
      .eq('status', current.status);

    if (error) throw new Error(error.message);

    await recordAuditEvent({
      action: 'admin.action',
      entityType: 'fiscal_year',
      entityId: parsed.data.fiscalYearId,
      actorId: user.id,
      before: { status: current.status },
      after: { status: next },
      metadata: { code: current.code, reason: parsed.data.reason },
    });

    revalidatePath('/admin/master-data/fiscal-years');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error, 'เปลี่ยนสถานะปีงบประมาณ');
  }
}

export async function closeFiscalYear(input: unknown): Promise<ActionResult<void>> {
  return changeFiscalYearStatus(input, 'CLOSED');
}

export async function reopenFiscalYear(input: unknown): Promise<ActionResult<void>> {
  return changeFiscalYearStatus(input, 'OPEN');
}

// -----------------------------------------------------------------------------
// แหล่งเงิน
// -----------------------------------------------------------------------------

export async function createFundingSource(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('masters.manage');

    const parsed = fundingSourceSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('funding_sources')
      .insert({
        code: parsed.data.code,
        name_th: parsed.data.nameTh,
        description: parsed.data.description ?? null,
        is_active: parsed.data.isActive,
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !data) throw new Error(error?.message ?? 'ไม่ได้รับข้อมูลกลับจากฐานข้อมูล');

    await recordAuditEvent({
      action: 'entity.create',
      entityType: 'funding_source',
      entityId: data.id,
      actorId: user.id,
      after: { code: parsed.data.code, nameTh: parsed.data.nameTh },
    });

    revalidatePath('/admin/master-data/funding-sources');
    return { ok: true, data };
  } catch (error) {
    return toActionError(error, 'สร้างแหล่งเงิน');
  }
}

/**
 * เปิด/ปิดการใช้งานแหล่งเงินและโครงการ
 *
 * ไม่มีการลบ — รายการที่เอกสารเก่าอ้างถึงต้องยังอ่านได้ตลอดไป (ข้อ 4.2)
 * การปิดใช้ทำให้เลือกใหม่ไม่ได้ แต่ของเดิมยังแสดงผลได้ถูกต้อง (FR-MST-008)
 */
async function setActiveFlag(
  table: 'funding_sources' | 'projects' | 'vendors',
  entityType: string,
  path: string,
  id: unknown,
  isActive: unknown,
): Promise<ActionResult<void>> {
  try {
    const user = await requirePermission('masters.manage');

    if (typeof id !== 'string' || typeof isActive !== 'boolean') {
      return { ok: false, error: INVALID_INPUT_MESSAGE };
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from(table)
      .update({ is_active: isActive })
      .eq('id', id)
      .select('id')
      .maybeSingle<{ id: string }>();

    if (error) throw new Error(error.message);
    if (!data) return { ok: false, error: 'ไม่พบรายการนี้ หรือคุณไม่มีสิทธิ์แก้ไข' };

    await recordAuditEvent({
      action: 'entity.update',
      entityType,
      entityId: id,
      actorId: user.id,
      after: { isActive },
    });

    revalidatePath(path);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error, `เปลี่ยนสถานะ ${entityType}`);
  }
}

export async function setFundingSourceActive(
  id: unknown,
  isActive: unknown,
): Promise<ActionResult<void>> {
  return setActiveFlag(
    'funding_sources',
    'funding_source',
    '/admin/master-data/funding-sources',
    id,
    isActive,
  );
}

// -----------------------------------------------------------------------------
// โครงการ
// -----------------------------------------------------------------------------

export async function createProject(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('masters.manage');

    const parsed = projectSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    const supabase = await createSupabaseServerClient();

    /*
     * **ไม่เขียน budget_amount** โดยเจตนา (ADR 0008)
     *
     * วงเงินของโครงการมาจากบัญชีงบใน ledger เท่านั้น ถ้าหน้าจอนี้เขียนคอลัมน์
     * budget_amount ด้วย ระบบจะมีวงเงินสองชุดที่ไม่ตรงกันได้ ซึ่งเป็นรูปแบบเดียว
     * กับที่ทำให้เกิดข้อค้นพบ F-01 คอลัมน์ยังคงอยู่เพื่อให้ rollback ได้ตามแผน
     * ใน ADR 0008 แต่ไม่มีเส้นทางใดในแอปเขียนค่าลงไป
     */
    const { data, error } = await supabase
      .from('projects')
      .insert({
        code: parsed.data.code,
        name_th: parsed.data.nameTh,
        fiscal_year_id: parsed.data.fiscalYearId,
        department_id: parsed.data.departmentId ?? null,
        funding_source_id: parsed.data.fundingSourceId ?? null,
        description: parsed.data.description ?? null,
        is_active: parsed.data.isActive,
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !data) throw new Error(error?.message ?? 'ไม่ได้รับข้อมูลกลับจากฐานข้อมูล');

    await recordAuditEvent({
      action: 'entity.create',
      entityType: 'project',
      entityId: data.id,
      actorId: user.id,
      after: {
        code: parsed.data.code,
        nameTh: parsed.data.nameTh,
        fiscalYearId: parsed.data.fiscalYearId,
      },
    });

    revalidatePath('/admin/master-data/projects');
    return { ok: true, data };
  } catch (error) {
    return toActionError(error, 'สร้างโครงการ');
  }
}

export async function setProjectActive(
  id: unknown,
  isActive: unknown,
): Promise<ActionResult<void>> {
  return setActiveFlag('projects', 'project', '/admin/master-data/projects', id, isActive);
}

// -----------------------------------------------------------------------------
// ผู้ขาย (FR-MST-005, FR-MST-009)
// -----------------------------------------------------------------------------

/** รายการที่ผู้ใช้ยืนยันว่าเป็นคนละราย เก็บลง audit เพื่อให้ตรวจย้อนหลังได้ */
function acknowledgedDuplicatesForAudit(
  findings: readonly DuplicateFinding[],
): { vendorId: string; vendorCode: string; reasonTh: string }[] | undefined {
  if (findings.length === 0) return undefined;

  return findings.map((finding) => ({
    vendorId: finding.vendor.id,
    vendorCode: finding.vendor.vendorCode,
    reasonTh: finding.reasonTh,
  }));
}

/**
 * ช่องที่บันทึกลง audit เมื่อผู้ขายเปลี่ยน
 *
 * **ไม่บันทึกเบอร์โทร ที่อยู่ อีเมล และชื่อผู้ติดต่อ** — เป็นข้อมูลติดต่อของบุคคล
 * ที่ไม่ได้ใช้ตรวจสอบการจัดซื้อ การคัดลอกไปไว้อีกที่หนึ่งจึงเพิ่มความเสี่ยง
 * โดยไม่ได้เพิ่มความสามารถในการตรวจสอบ (แผนข้อ 11.2 เก็บเท่าที่จำเป็น)
 *
 * **บันทึกเลขประจำตัวผู้เสียภาษี** เพราะเป็นตัวระบุผู้รับเงิน การเปลี่ยนเลขนี้
 * คือสิ่งที่ผู้ตรวจสอบต้องเห็น ถ้าตัดออก audit trail จะตอบไม่ได้ว่าเงินเปลี่ยน
 * ไปเข้าใครระหว่างทาง และค่านี้ผู้ใช้ที่ล็อกอินอยู่อ่านจากตาราง vendors ได้อยู่แล้ว
 */
function vendorAuditFields(vendor: {
  vendorCode: string;
  name: string;
  taxId?: string | null;
  branchNo?: string | null;
  isActive?: boolean;
}) {
  return {
    vendorCode: vendor.vendorCode,
    name: vendor.name,
    taxId: vendor.taxId ?? null,
    branchNo: vendor.branchNo ?? null,
    ...(vendor.isActive === undefined ? {} : { isActive: vendor.isActive }),
  };
}

export async function createVendor(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('masters.manage');

    const parsed = vendorCreateSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    const { acknowledgedDuplicate, ...vendor } = parsed.data;

    /*
     * ตรวจซ้ำที่ server ด้วยข้อมูลที่เพิ่งอ่านมา ไม่ใช่เชื่อผลจากเบราว์เซอร์
     *
     * รายการในเบราว์เซอร์อาจเก่าไปแล้ว และผู้ที่เรียก API ตรงต้องถูกปฏิเสธ
     * เหมือนกดผ่านหน้าจอ (ข้อ 4.2) กติกาว่าข้อไหนยกเว้นได้อยู่ที่ชั้นโดเมน
     */
    const { rejection, findings } = checkVendorDuplicateRule(
      vendor,
      await listVendors(),
      acknowledgedDuplicate,
    );
    if (rejection) return { ok: false, error: rejection };

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('vendors')
      .insert({
        vendor_code: vendor.vendorCode,
        name: vendor.name,
        tax_id: vendor.taxId ?? null,
        branch_no: vendor.branchNo ?? null,
        address: vendorLineToAddress(vendor.address),
        contact_name: vendor.contactName ?? null,
        phone: vendor.phone ?? null,
        email: vendor.email ?? null,
        note: vendor.note ?? null,
        is_active: vendor.isActive,
        created_by: user.id,
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !data) throw new Error(error?.message ?? 'ไม่ได้รับข้อมูลกลับจากฐานข้อมูล');

    await recordAuditEvent({
      action: 'entity.create',
      entityType: 'vendor',
      entityId: data.id,
      actorId: user.id,
      after: vendorAuditFields(vendor),
      metadata: { acknowledgedDuplicates: acknowledgedDuplicatesForAudit(findings) },
    });

    revalidatePath('/admin/master-data/vendors');
    return { ok: true, data };
  } catch (error) {
    return toActionError(error, 'สร้างผู้ขาย');
  }
}

/**
 * แก้ไขผู้ขาย
 *
 * จำเป็นต้องมี ต่างจากแหล่งเงินและโครงการที่มีแค่เพิ่มกับปิดใช้ — เลขประจำตัว
 * ผู้เสียภาษีที่พิมพ์ผิดจะแก้ไม่ได้เลยถ้าไม่มีหน้านี้ และการ "เพิ่มรายใหม่แทน"
 * จะทำให้เอกสารเดิมชี้ไปที่ผู้ขายที่มีเลขผิดค้างอยู่ตลอดไป
 */
export async function updateVendor(input: unknown): Promise<ActionResult<void>> {
  try {
    const user = await requirePermission('masters.manage');

    const parsed = vendorUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    const { acknowledgedDuplicate, vendorId, ...vendor } = parsed.data;

    const existing = await listVendors();
    const current = existing.find((row) => row.id === vendorId);
    if (!current) return { ok: false, error: 'ไม่พบผู้ขายรายนี้ หรือคุณไม่มีสิทธิ์แก้ไข' };

    /*
     * ตัดตัวเองออกก่อนตรวจซ้ำ มิฉะนั้นการกดบันทึกโดยไม่แก้อะไรจะถูกปฏิเสธว่า
     * ซ้ำกับตัวเอง ซึ่งผู้ใช้แก้ตามไม่ได้
     */
    const { rejection, findings } = checkVendorDuplicateRule(
      vendor,
      existing.filter((row) => row.id !== vendorId),
      acknowledgedDuplicate,
    );
    if (rejection) return { ok: false, error: rejection };

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('vendors')
      .update({
        vendor_code: vendor.vendorCode,
        name: vendor.name,
        tax_id: vendor.taxId ?? null,
        branch_no: vendor.branchNo ?? null,
        address: vendorLineToAddress(vendor.address),
        contact_name: vendor.contactName ?? null,
        phone: vendor.phone ?? null,
        email: vendor.email ?? null,
        note: vendor.note ?? null,
        is_active: vendor.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', vendorId)
      .select('id')
      .maybeSingle<{ id: string }>();

    if (error) throw new Error(error.message);
    if (!data) return { ok: false, error: 'ไม่พบผู้ขายรายนี้ หรือคุณไม่มีสิทธิ์แก้ไข' };

    await recordAuditEvent({
      action: 'entity.update',
      entityType: 'vendor',
      entityId: vendorId,
      actorId: user.id,
      before: vendorAuditFields(current),
      after: vendorAuditFields(vendor),
      metadata: { acknowledgedDuplicates: acknowledgedDuplicatesForAudit(findings) },
    });

    revalidatePath('/admin/master-data/vendors');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error, 'แก้ไขผู้ขาย');
  }
}

export async function setVendorActive(id: unknown, isActive: unknown): Promise<ActionResult<void>> {
  return setActiveFlag('vendors', 'vendor', '/admin/master-data/vendors', id, isActive);
}
