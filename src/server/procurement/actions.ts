'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/server/auth/guard';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import { recordAuditEvent } from '@/server/audit/audit-log';
import type { ActionResult } from '@/server/action-result';
import { headers } from 'next/headers';
import { REQUEST_ID_HEADER, generateRequestId, sanitizeRequestId } from '@/lib/request-id';
import {
  procurementDraftSchema,
  procurementSubmitSchema,
  procurementUpdateSchema,
} from '@/domain/procurement/schemas';
import {
  ProcurementDraftError,
  assertLinesConsistent,
  isEditable,
} from '@/domain/procurement/draft';
import type { ProcurementDraftInput } from '@/domain/procurement/schemas';

/**
 * Server action ของรายการจัดซื้อ (ขั้น draft)
 *
 * ทุกตัวทำสี่อย่างตามลำดับนี้เสมอ (ข้อ 13):
 *   1. ตรวจสิทธิ์ที่ server — ไม่พึ่งการซ่อนปุ่มฝั่ง browser
 *   2. ตรวจข้อมูลด้วย schema เดียวกับที่ฟอร์มใช้
 *   3. เขียนฐานข้อมูลโดยให้ RLS เป็นชั้นบังคับอีกชั้น
 *   4. บันทึก audit event
 *
 * **ไม่รับยอดเงินจากผู้เรียก** — ตารางไม่มีคอลัมน์ยอดให้เขียน ยอดคำนวณจาก
 * รายการย่อยผ่าน view เสมอ จึงไม่มีทางส่งยอดที่ไม่ตรงกับรายการเข้ามาได้
 */

// นิยามอยู่ที่ src/server/action-result.ts เพื่อให้ทุก action ในระบบใช้รูปเดียวกัน
export type { ActionResult } from '@/server/action-result';

/** แปลง error เป็นข้อความที่ผู้ใช้อ่านแล้วรู้ว่าต้องทำอะไร ไม่เปิดเผยโครงสร้างภายใน */
function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof ProcurementDraftError) {
    return { ok: false, error: error.message };
  }
  console.error('[procurement] action ล้มเหลว', error);
  return { ok: false, error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' };
}

interface ChildRows {
  items: ProcurementDraftInput['items'];
  fundingAllocations: ProcurementDraftInput['fundingAllocations'];
}

/**
 * เขียนรายการย่อยและแหล่งเงินใหม่ทั้งชุด
 *
 * ลบแล้วเขียนใหม่แทนการ diff ทีละแถว เพราะฟอร์มส่งสถานะสุดท้ายมาทั้งชุด
 * การ diff จะซับซ้อนโดยไม่ได้อะไรเพิ่ม และเสี่ยงหลงเหลือแถวที่ผู้ใช้ลบไปแล้ว
 *
 * ข้อแลกเปลี่ยนที่ยอมรับ: id ของแถวย่อยเปลี่ยนทุกครั้งที่บันทึก
 * ยังไม่มีอะไรอ้างถึง id เหล่านี้จากภายนอกในเฟสนี้ เมื่อการตรวจรับ (PR-07)
 * ต้องอ้างถึงบรรทัด จะต้องเปลี่ยนมาใช้ line_no เป็นกุญแจแทน
 */
async function replaceChildren(procurementId: string, rows: ChildRows): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { error: deleteItemsError } = await supabase
    .from('procurement_items')
    .delete()
    .eq('procurement_id', procurementId);
  if (deleteItemsError) throw new Error(deleteItemsError.message);

  const { error: deleteFundingError } = await supabase
    .from('procurement_funding_allocations')
    .delete()
    .eq('procurement_id', procurementId);
  if (deleteFundingError) throw new Error(deleteFundingError.message);

  if (rows.items.length > 0) {
    const { error } = await supabase.from('procurement_items').insert(
      rows.items.map((item) => ({
        procurement_id: procurementId,
        line_no: item.lineNo,
        description: item.description,
        quantity: item.quantity,
        unit_id: item.unitId ?? null,
        unit_price: item.unitPrice,
        discount_amount: item.discountAmount,
        tax_rate: item.taxRate,
        item_category_id: item.itemCategoryId ?? null,
      })),
    );
    if (error) throw new Error(error.message);
  }

  if (rows.fundingAllocations.length > 0) {
    const { error } = await supabase.from('procurement_funding_allocations').insert(
      rows.fundingAllocations.map((row) => ({
        procurement_id: procurementId,
        line_no: row.lineNo,
        budget_account_id: row.budgetAccountId,
        amount: row.amount,
        note: row.note ?? null,
      })),
    );
    if (error) throw new Error(error.message);
  }
}

export async function createProcurementDraft(
  input: unknown,
): Promise<ActionResult<{ id: string; reference: string }>> {
  try {
    const user = await requirePermission('procurement.create');

    const parsed = procurementDraftSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: 'ข้อมูลที่กรอกยังไม่ถูกต้อง',
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    assertLinesConsistent(parsed.data);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('procurements')
      .insert({
        subject: parsed.data.subject,
        purpose: parsed.data.purpose ?? null,
        tax_mode: parsed.data.taxMode,
        fiscal_year_id: parsed.data.fiscalYearId,
        department_id: parsed.data.departmentId ?? null,
        vendor_id: parsed.data.vendorId ?? null,
        request_date: parsed.data.requestDate,
        required_date: parsed.data.requiredDate ?? null,
        report_date: parsed.data.reportDate ?? null,
        approved_date: parsed.data.approvedDate ?? null,
        selection_date: parsed.data.selectionDate ?? null,
        order_or_agreement_date: parsed.data.orderOrAgreementDate ?? null,
        delivery_or_service_date: parsed.data.deliveryOrServiceDate ?? null,
        inspection_date: parsed.data.inspectionDate ?? null,
        sent_to_finance_date: parsed.data.sentToFinanceDate ?? null,
        classification: parsed.data.classification ?? null,
        procurement_method: parsed.data.procurementMethod ?? null,
        method_legal_basis_code: parsed.data.methodLegalBasisCode ?? null,
        is_emergency: parsed.data.isEmergency,
        note: parsed.data.note ?? null,
        created_by: user.id,
      })
      .select('id, reference')
      .single<{ id: string; reference: string }>();

    if (error || !data) throw new Error(error?.message ?? 'ไม่ได้รับข้อมูลกลับจากฐานข้อมูล');

    await replaceChildren(data.id, parsed.data);

    await recordAuditEvent({
      action: 'entity.create',
      entityType: 'procurement',
      entityId: data.id,
      actorId: user.id,
      after: { reference: data.reference, subject: parsed.data.subject },
      metadata: {
        itemCount: parsed.data.items.length,
        fundingLineCount: parsed.data.fundingAllocations.length,
      },
    });

    revalidatePath('/procurements');
    return { ok: true, data };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateProcurementDraft(
  input: unknown,
): Promise<ActionResult<{ version: number }>> {
  try {
    const user = await requirePermission('procurement.edit_draft');

    const parsed = procurementUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: 'ข้อมูลที่กรอกยังไม่ถูกต้อง',
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    assertLinesConsistent(parsed.data);

    const supabase = await createSupabaseServerClient();

    const { data: current } = await supabase
      .from('procurements')
      .select('status, version')
      .eq('id', parsed.data.id)
      .is('deleted_at', null)
      .maybeSingle<{ status: string; version: number }>();

    if (!current) {
      return { ok: false, error: 'ไม่พบรายการนี้ หรือคุณไม่มีสิทธิ์แก้ไข' };
    }

    if (!isEditable(current.status as Parameters<typeof isEditable>[0])) {
      return {
        ok: false,
        error: 'รายการนี้ถูกส่งเข้าสู่ขั้นตอนอนุมัติแล้ว จึงแก้ไขไม่ได้',
      };
    }

    /*
     * เงื่อนไข version ในคำสั่ง update เป็นตัวตัดสินจริง ไม่ใช่การเทียบก่อนหน้านี้
     * เพราะระหว่างที่อ่านกับที่เขียนอาจมีคนอื่นแก้แทรกเข้ามาได้
     */
    const { data: updated, error } = await supabase
      .from('procurements')
      .update({
        subject: parsed.data.subject,
        purpose: parsed.data.purpose ?? null,
        tax_mode: parsed.data.taxMode,
        department_id: parsed.data.departmentId ?? null,
        vendor_id: parsed.data.vendorId ?? null,
        request_date: parsed.data.requestDate,
        required_date: parsed.data.requiredDate ?? null,
        report_date: parsed.data.reportDate ?? null,
        approved_date: parsed.data.approvedDate ?? null,
        selection_date: parsed.data.selectionDate ?? null,
        order_or_agreement_date: parsed.data.orderOrAgreementDate ?? null,
        delivery_or_service_date: parsed.data.deliveryOrServiceDate ?? null,
        inspection_date: parsed.data.inspectionDate ?? null,
        sent_to_finance_date: parsed.data.sentToFinanceDate ?? null,
        classification: parsed.data.classification ?? null,
        procurement_method: parsed.data.procurementMethod ?? null,
        method_legal_basis_code: parsed.data.methodLegalBasisCode ?? null,
        is_emergency: parsed.data.isEmergency,
        note: parsed.data.note ?? null,
        updated_by: user.id,
      })
      .eq('id', parsed.data.id)
      .eq('version', parsed.data.expectedVersion)
      .select('version')
      .maybeSingle<{ version: number }>();

    if (error) throw new Error(error.message);

    if (!updated) {
      return {
        ok: false,
        error:
          'มีผู้อื่นแก้ไขรายการนี้ไปแล้วหลังจากที่คุณเปิดหน้านี้ ' +
          'กรุณาโหลดหน้าใหม่แล้วตรวจการเปลี่ยนแปลงก่อนบันทึกซ้ำ',
      };
    }

    await replaceChildren(parsed.data.id, parsed.data);

    await recordAuditEvent({
      action: 'entity.update',
      entityType: 'procurement',
      entityId: parsed.data.id,
      actorId: user.id,
      before: { version: parsed.data.expectedVersion },
      after: { subject: parsed.data.subject },
      metadata: { itemCount: parsed.data.items.length },
    });

    revalidatePath('/procurements');
    revalidatePath(`/procurements/${parsed.data.id}`);

    // อ่าน version ใหม่อีกครั้ง เพราะการเขียนรายการย่อยเพิ่ม version ต่อจากนี้อีก
    const { data: fresh } = await supabase
      .from('procurements')
      .select('version')
      .eq('id', parsed.data.id)
      .maybeSingle<{ version: number }>();

    return { ok: true, data: { version: fresh?.version ?? updated.version } };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * ส่งรายการเข้าสู่การอนุมัติ
 *
 * **ไม่ตรวจกฎที่นี่** — เรียก RPC `procurement_submit` ซึ่งตรวจครบทั้งชุดใน
 * ทรานแซกชันเดียวกับการเปลี่ยนสถานะ (แผนข้อ 7.2)
 *
 * ถ้าตรวจซ้ำที่นี่แล้วค่อยเรียก RPC จะเกิดช่องว่างระหว่างตรวจกับเขียน และที่แย่กว่า
 * คือจะมีกฎสองชุดที่ต้องดูแลให้ตรงกัน ซึ่งเป็นที่มาของบั๊กที่หายาก
 */
export async function submitProcurement(input: unknown): Promise<ActionResult<void>> {
  try {
    const user = await requirePermission('procurement.submit');

    const parsed = procurementSubmitSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' };
    }

    const supabase = await createSupabaseServerClient();
    const headerList = await headers();
    const requestId = sanitizeRequestId(headerList.get(REQUEST_ID_HEADER)) ?? generateRequestId();

    const { error } = await supabase.rpc('procurement_submit', {
      p_procurement_id: parsed.data.id,
      p_expected_version: parsed.data.expectedVersion,
      p_exception_reason: parsed.data.exceptionReason ?? null,
      p_request_id: requestId,
    });

    if (error) {
      /*
       * ข้อความจาก RPC เป็นภาษาไทยที่ผู้ใช้แก้ตามได้อยู่แล้ว จึงส่งต่อตรง ๆ
       * ส่วนข้อความที่ PostgreSQL สร้างเอง (ภาษาอังกฤษ) ไม่ส่งออกไป
       * เพราะเปิดเผยชื่อ constraint และโครงสร้างภายในโดยไม่จำเป็น
       */
      if (/^[\u0E00-\u0E7F]/.test(error.message)) {
        return { ok: false, error: error.message };
      }
      throw new Error(error.message);
    }

    await recordAuditEvent({
      action: 'procurement.status_change',
      entityType: 'procurement',
      entityId: parsed.data.id,
      actorId: user.id,
      after: { status: 'PENDING_REVIEW' },
      metadata: { via: 'ui' },
    });

    revalidatePath('/procurements');
    revalidatePath(`/procurements/${parsed.data.id}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
