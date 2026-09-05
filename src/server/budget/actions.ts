'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { requirePermission } from '@/server/auth/guard';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import { recordAuditEvent } from '@/server/audit/audit-log';
import { INVALID_INPUT_MESSAGE, toFieldErrors } from '@/server/action-result';
import { REQUEST_ID_HEADER, generateRequestId, sanitizeRequestId } from '@/lib/request-id';
import {
  budgetAccountCloseSchema,
  budgetAccountSchema,
  budgetMovementSchema,
  budgetReversalSchema,
  budgetTransferSchema,
} from '@/domain/budget/schemas';
import type { ActionResult } from '@/server/action-result';

/**
 * Server action ของบัญชีงบ
 *
 * **การลงรายการทุกชนิดผ่าน RPC เท่านั้น ไม่ insert ตรง**
 *
 * เหตุผลไม่ใช่แค่ความสะดวก: ตาราง budget_movements ไม่มี policy `insert` เลย
 * การ insert ตรงจึงถูกปฏิเสธอยู่แล้ว และ RPC เป็นที่เดียวที่ล็อกแถวบัญชีก่อน
 * อ่านยอด ซึ่งเป็นสิ่งที่กันไม่ให้สองคำขอพร้อมกันลงจนยอดติดลบ (ข้อค้นพบ F-01)
 *
 * audit event ของรายการเคลื่อนไหวถูกเขียนใน RPC เดียวกันจึงอยู่ในทรานแซกชันเดียว
 * ที่นี่จึงไม่เขียนซ้ำ — เขียน audit เฉพาะสิ่งที่ RPC ไม่ได้เขียนให้
 */

/** ส่ง request id เดียวกับที่ audit ฝั่งแอปใช้ เพื่อให้ตามรอยข้ามชั้นได้ */
async function currentRequestId(): Promise<string> {
  const headerList = await headers();
  return sanitizeRequestId(headerList.get(REQUEST_ID_HEADER)) ?? generateRequestId();
}

/**
 * ข้อความจาก RPC เป็นภาษาไทยที่ผู้ใช้แก้ตามได้อยู่แล้ว จึงส่งต่อตรง ๆ
 *
 * แต่ต้องกรองเฉพาะข้อความที่ตั้งใจให้ผู้ใช้เห็น ข้อความจาก PostgreSQL เอง
 * (เช่นชื่อ constraint) ไม่ควรหลุดออกไปเพราะเปิดเผยโครงสร้างภายใน
 */
function describeRpcError(message: string): string | null {
  if (message.includes('budget_accounts_scope_unique'))
    return 'มีบัญชีงบของโครงการ แหล่งเงิน และหน่วยงานชุดนี้อยู่แล้วในปีงบประมาณเดียวกัน';
  if (message.includes('budget_accounts_fiscal_year_id_code_key'))
    return 'มีรหัสบัญชีงบนี้อยู่แล้วในปีงบประมาณเดียวกัน';
  if (message.includes('budget_movements_single_reversal'))
    return 'รายการนี้ถูกย้อนไปแล้ว ย้อนซ้ำจะทำให้ยอดคลาดเคลื่อน';
  if (message.includes('row-level security')) return 'คุณไม่มีสิทธิ์ดำเนินการนี้';

  /*
   * ข้อความที่ตั้งใจส่งถึงผู้ใช้ขึ้นต้นด้วยอักษรไทยเสมอ
   *
   * ทุก raise exception ใน migration 0005, 0006 และ 0009 เขียนเป็นภาษาไทย
   * ส่วนข้อความที่ PostgreSQL สร้างเอง (ชื่อ constraint ชื่อคอลัมน์ ชนิดข้อมูล)
   * เป็นภาษาอังกฤษทั้งหมด การแยกด้วยอักษรตัวแรกจึงแยกสองกลุ่มนี้ออกจากกันได้
   * โดยไม่ต้องไล่ระบุข้อความทีละอัน
   */
  if (/^[\u0E00-\u0E7F]/.test(message)) return message;

  return null;
}

function toActionError(error: unknown, context: string): ActionResult<never> {
  if (error instanceof Error) {
    const friendly = describeRpcError(error.message);
    if (friendly) return { ok: false, error: friendly };
  }

  console.error(`[budget] ${context} ล้มเหลว`, error);
  return { ok: false, error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' };
}

function revalidateAccount(accountId?: string): void {
  revalidatePath('/budget/accounts');
  if (accountId) revalidatePath(`/budget/accounts/${accountId}`);
}

// -----------------------------------------------------------------------------
// บัญชีงบ
// -----------------------------------------------------------------------------

export async function createBudgetAccount(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('budget.manage');

    const parsed = budgetAccountSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    const supabase = await createSupabaseServerClient();

    /*
     * โครงการต้องอยู่ในปีงบประมาณเดียวกับบัญชี
     *
     * ฐานข้อมูลไม่ได้บังคับข้อนี้ (foreign key ทั้งสองอันแยกกัน) ถ้าไม่ตรวจ
     * ยอดของปีหนึ่งจะไปผูกกับโครงการของอีกปี แล้วรายงานรายปีจะรวมยอดผิด
     * โดยไม่มีอะไรฟ้อง
     */
    if (parsed.data.projectId) {
      const { data: project } = await supabase
        .from('projects')
        .select('fiscal_year_id')
        .eq('id', parsed.data.projectId)
        .maybeSingle<{ fiscal_year_id: string }>();

      if (!project) {
        return { ok: false, error: 'ไม่พบโครงการที่เลือก' };
      }

      if (project.fiscal_year_id !== parsed.data.fiscalYearId) {
        return {
          ok: false,
          error: 'โครงการที่เลือกอยู่คนละปีงบประมาณกับบัญชีงบนี้',
          fieldErrors: { projectId: ['โครงการที่เลือกอยู่คนละปีงบประมาณ'] },
        };
      }
    }

    const { data, error } = await supabase
      .from('budget_accounts')
      .insert({
        code: parsed.data.code,
        fiscal_year_id: parsed.data.fiscalYearId,
        project_id: parsed.data.projectId ?? null,
        funding_source_id: parsed.data.fundingSourceId ?? null,
        department_id: parsed.data.departmentId ?? null,
        note: parsed.data.note ?? null,
        created_by: user.id,
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !data) throw new Error(error?.message ?? 'ไม่ได้รับข้อมูลกลับจากฐานข้อมูล');

    await recordAuditEvent({
      action: 'entity.create',
      entityType: 'budget_account',
      entityId: data.id,
      actorId: user.id,
      after: { code: parsed.data.code, fiscalYearId: parsed.data.fiscalYearId },
    });

    revalidateAccount(data.id);
    return { ok: true, data };
  } catch (error) {
    return toActionError(error, 'สร้างบัญชีงบ');
  }
}

/**
 * ปิดบัญชีงบ
 *
 * ไม่มีการเปิดกลับใน action นี้ ต่างจากปีงบประมาณ เพราะบัญชีที่ปิดแล้วหมายถึง
 * "งบก้อนนี้จบแล้ว" ซึ่งเป็นข้อสรุปทางบัญชี ถ้าต้องใช้งบเพิ่มให้สร้างบัญชีใหม่
 * หรือโอนงบเข้าบัญชีอื่น การเปิดบัญชีที่สรุปยอดไปแล้วกลับมาทำให้รายงานที่ออกไป
 * ก่อนหน้ากลายเป็นข้อมูลที่ไม่ตรงกับระบบ
 */
export async function closeBudgetAccount(input: unknown): Promise<ActionResult<void>> {
  try {
    const user = await requirePermission('budget.manage');

    const parsed = budgetAccountCloseSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase
      .from('budget_accounts')
      .update({ status: 'CLOSED', closed_at: new Date().toISOString(), closed_by: user.id })
      .eq('id', parsed.data.accountId)
      .eq('status', 'OPEN')
      .select('id, code')
      .maybeSingle<{ id: string; code: string }>();

    if (error) throw new Error(error.message);
    if (!data) {
      return { ok: false, error: 'ไม่พบบัญชีงบนี้ หรือบัญชีถูกปิดไปแล้ว' };
    }

    await recordAuditEvent({
      action: 'admin.action',
      entityType: 'budget_account',
      entityId: data.id,
      actorId: user.id,
      before: { status: 'OPEN' },
      after: { status: 'CLOSED' },
      metadata: { code: data.code, reason: parsed.data.reason },
    });

    revalidateAccount(data.id);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error, 'ปิดบัญชีงบ');
  }
}

// -----------------------------------------------------------------------------
// รายการเคลื่อนไหว
// -----------------------------------------------------------------------------

export async function postBudgetMovement(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requirePermission('budget.manage');

    const parsed = budgetMovementSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('budget_post_movement', {
      p_account_id: parsed.data.accountId,
      p_type: parsed.data.type,
      p_amount: parsed.data.amount,
      p_effective_date: parsed.data.effectiveDate,
      p_reason: parsed.data.reason ?? null,
      p_source_type: 'MANUAL',
      p_approval_reference: parsed.data.approvalReference ?? null,
      p_request_id: await currentRequestId(),
    });

    if (error) throw new Error(error.message);

    revalidateAccount(parsed.data.accountId);
    return { ok: true, data: { id: data as string } };
  } catch (error) {
    return toActionError(error, 'ลงรายการเคลื่อนไหวงบ');
  }
}

export async function reverseBudgetMovement(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requirePermission('budget.manage');

    const parsed = budgetReversalSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    const supabase = await createSupabaseServerClient();

    /*
     * อ่านแถวต้นทางเพื่อให้ได้บัญชีและยอดที่ต้องย้อน
     *
     * ไม่ให้ผู้เรียกส่งยอดมาเอง เพราะการย้อนด้วยยอดที่ไม่เท่าของเดิมคือการ
     * "แก้ตัวเลข" ไม่ใช่การย้อน และจะทำให้ยอดคงเหลือเปลี่ยนโดยไม่มีรายการรองรับ
     */
    const { data: target, error: readError } = await supabase
      .from('budget_movements')
      .select('id, budget_account_id, amount, movement_type')
      .eq('id', parsed.data.movementId)
      .maybeSingle<{
        id: string;
        budget_account_id: string;
        amount: string;
        movement_type: string;
      }>();

    if (readError) throw new Error(readError.message);
    if (!target) return { ok: false, error: 'ไม่พบรายการที่ต้องการย้อน' };

    if (target.movement_type === 'REVERSAL') {
      return { ok: false, error: 'ย้อนรายการย้อนอีกชั้นไม่ได้' };
    }

    const { data, error } = await supabase.rpc('budget_post_movement', {
      p_account_id: target.budget_account_id,
      p_type: 'REVERSAL',
      p_amount: target.amount,
      p_effective_date: parsed.data.effectiveDate,
      p_reason: parsed.data.reason,
      p_source_type: 'MANUAL',
      p_reverses_movement_id: target.id,
      p_request_id: await currentRequestId(),
    });

    if (error) throw new Error(error.message);

    revalidateAccount(target.budget_account_id);
    return { ok: true, data: { id: data as string } };
  } catch (error) {
    return toActionError(error, 'ย้อนรายการเคลื่อนไหวงบ');
  }
}

export async function transferBudget(input: unknown): Promise<ActionResult<void>> {
  try {
    await requirePermission('budget.manage');

    const parsed = budgetTransferSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc('budget_transfer', {
      p_from_account_id: parsed.data.fromAccountId,
      p_to_account_id: parsed.data.toAccountId,
      p_amount: parsed.data.amount,
      p_effective_date: parsed.data.effectiveDate,
      p_reason: parsed.data.reason,
      p_approval_reference: parsed.data.approvalReference ?? null,
      p_request_id: await currentRequestId(),
    });

    if (error) throw new Error(error.message);

    revalidateAccount(parsed.data.fromAccountId);
    revalidatePath(`/budget/accounts/${parsed.data.toAccountId}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error, 'โอนงบ');
  }
}
