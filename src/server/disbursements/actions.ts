'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { requireAnyPermission } from '@/server/auth/guard';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import { REQUEST_ID_HEADER, generateRequestId, sanitizeRequestId } from '@/lib/request-id';
import { disbursementSchema, disbursementVoidSchema } from '@/domain/procurement/schemas';
import type { ActionResult } from '@/server/action-result';

/**
 * Server action ของการเบิกจ่าย (PR-04d)
 *
 * เป็นชั้นบาง ๆ เหนือ RPC ที่เป็นผู้บังคับจริง — สิทธิ์ `procurement.disburse`
 * กติกาสถานะ การแบ่งยอดตามสัดส่วน การลง RELEASE คู่กับ ACTUAL และ audit
 * อยู่ในฟังก์ชันฐานข้อมูลทั้งหมด เพื่อให้เส้นทางอื่นที่เรียกฐานข้อมูลตรง
 * ถูกบังคับเหมือนกัน
 *
 * **ไม่เขียน audit ซ้ำที่นี่** RPC เขียนให้แล้วในทรานแซกชันเดียวกับข้อมูล
 */

export type { ActionResult } from '@/server/action-result';

/** ส่งต่อเฉพาะข้อความภาษาไทยที่ฟังก์ชันตั้งใจให้ผู้ใช้เห็น ข้อความอื่นถือเป็นความผิดพลาดภายใน */
function fromRpcError(message: string): ActionResult<never> {
  if (/^[฀-๿]/.test(message)) {
    return { ok: false, error: message };
  }
  console.error('[disbursement] RPC ล้มเหลว', message);
  return { ok: false, error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' };
}

function toActionError(error: unknown): ActionResult<never> {
  console.error('[disbursement] action ล้มเหลว', error);
  return { ok: false, error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' };
}

/** บันทึกการเบิกจ่ายหนึ่งครั้ง — คืนยอดที่กันไว้และลงค่าใช้จ่ายจริงในทรานแซกชันเดียว */
export async function recordDisbursement(input: unknown): Promise<ActionResult<string>> {
  try {
    /*
     * ต้องอ่านรายการจัดซื้อได้เป็นอย่างน้อยจึงจะเรียกได้ ส่วนสิทธิ์ procurement.disburse
     * ตรวจที่ RPC — ถ้าตรวจซ้ำที่นี่ด้วยจะกลายเป็นกติกาสองที่ที่เลื่อนออกจากกันได้
     */
    await requireAnyPermission('procurement.read.own', 'procurement.read.all');

    const parsed = disbursementSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message;
      return { ok: false, error: first ?? 'ข้อมูลที่ส่งมาไม่ถูกต้อง' };
    }

    const supabase = await createSupabaseServerClient();
    const headerList = await headers();
    const requestId = sanitizeRequestId(headerList.get(REQUEST_ID_HEADER)) ?? generateRequestId();

    const { data, error } = await supabase.rpc('procurement_disburse', {
      p_procurement_id: parsed.data.procurementId,
      p_amount: parsed.data.amount,
      p_paid_on: parsed.data.paidOn,
      p_document_no: parsed.data.documentNo ?? null,
      p_payee_name: parsed.data.payeeName ?? null,
      p_note: parsed.data.note ?? null,
      p_request_id: requestId,
    });

    if (error) return fromRpcError(error.message);

    revalidatePath(`/procurements/${parsed.data.procurementId}`);
    return { ok: true, data: data as string };
  } catch (error) {
    return toActionError(error);
  }
}

/** ยกเลิกการเบิกจ่ายที่บันทึกผิด — ย้อนด้วย REVERSAL ไม่ลบแถวเดิม */
export async function voidDisbursement(
  input: unknown,
  procurementId: string,
): Promise<ActionResult<void>> {
  try {
    await requireAnyPermission('procurement.read.own', 'procurement.read.all');

    const parsed = disbursementVoidSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message;
      return { ok: false, error: first ?? 'ข้อมูลที่ส่งมาไม่ถูกต้อง' };
    }

    const supabase = await createSupabaseServerClient();
    const headerList = await headers();
    const requestId = sanitizeRequestId(headerList.get(REQUEST_ID_HEADER)) ?? generateRequestId();

    const { error } = await supabase.rpc('procurement_disbursement_void', {
      p_disbursement_id: parsed.data.disbursementId,
      p_reason: parsed.data.reason,
      p_request_id: requestId,
    });

    if (error) return fromRpcError(error.message);

    revalidatePath(`/procurements/${procurementId}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
