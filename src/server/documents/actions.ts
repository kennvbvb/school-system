'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { requireAnyPermission } from '@/server/auth/guard';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import { REQUEST_ID_HEADER, generateRequestId, sanitizeRequestId } from '@/lib/request-id';
import { documentNumberRecordSchema, documentNumberVoidSchema } from '@/domain/documents/schemas';
import type { ActionResult } from '@/server/action-result';

/**
 * Server action ของทะเบียนเลขที่เอกสาร (PR-04b)
 *
 * ทั้งสองตัวเป็นเพียงชั้นบาง ๆ เหนือ RPC ที่เป็นผู้บังคับจริง — สิทธิ์ `documents.issue`
 * ความไม่ซ้ำ และ audit อยู่ในฟังก์ชันฐานข้อมูลทั้งหมด เพื่อให้เส้นทางอื่นที่เรียก
 * ฐานข้อมูลตรงก็ถูกบังคับเหมือนกัน
 *
 * **ไม่เขียน audit ซ้ำที่นี่** RPC เขียนให้แล้วในทรานแซกชันเดียวกับข้อมูล
 * การเขียนอีกครั้งจากที่นี่จะทำให้ผู้ตรวจสอบที่นับจำนวนครั้งได้ตัวเลขสองเท่า
 * (เป็นปัญหาที่ `submitProcurement` ของ PR-03 ยังมีอยู่และยังไม่ได้แก้)
 */

export type { ActionResult } from '@/server/action-result';

/** ส่งต่อเฉพาะข้อความภาษาไทยที่ฟังก์ชันตั้งใจให้ผู้ใช้เห็น ข้อความอื่นถือเป็นความผิดพลาดภายใน */
function fromRpcError(message: string): ActionResult<never> {
  if (/^[฀-๿]/.test(message)) {
    return { ok: false, error: message };
  }
  console.error('[document-number] RPC ล้มเหลว', message);
  return { ok: false, error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' };
}

function toActionError(error: unknown): ActionResult<never> {
  console.error('[document-number] action ล้มเหลว', error);
  return { ok: false, error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' };
}

/** บันทึกเลขที่เอกสารที่โรงเรียนกำหนด หรือบันทึกว่ารายการนี้ไม่มีเลขเพราะอะไร (F-14) */
export async function recordDocumentNumber(input: unknown): Promise<ActionResult<string>> {
  try {
    /*
     * ต้องอ่านรายการจัดซื้อได้เป็นอย่างน้อยจึงจะเรียกได้ ส่วนสิทธิ์ documents.issue
     * ตรวจที่ RPC — ถ้าตรวจซ้ำที่นี่ด้วยจะกลายเป็นกติกาสองที่ที่เลื่อนออกจากกันได้
     */
    await requireAnyPermission('procurement.read.own', 'procurement.read.all');

    const parsed = documentNumberRecordSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message;
      return { ok: false, error: first ?? 'ข้อมูลที่ส่งมาไม่ถูกต้อง' };
    }

    const supabase = await createSupabaseServerClient();
    const headerList = await headers();
    const requestId = sanitizeRequestId(headerList.get(REQUEST_ID_HEADER)) ?? generateRequestId();

    const { data, error } = await supabase.rpc('document_number_record', {
      p_procurement_id: parsed.data.procurementId,
      p_document_kind: parsed.data.documentKind,
      p_status: parsed.data.status,
      p_document_no: parsed.data.documentNo ?? null,
      p_issued_date: parsed.data.issuedDate ?? null,
      p_reason: parsed.data.reason ?? null,
      p_request_id: requestId,
    });

    if (error) return fromRpcError(error.message);

    revalidatePath(`/procurements/${parsed.data.procurementId}`);
    return { ok: true, data: data as string };
  } catch (error) {
    return toActionError(error);
  }
}

/** ยกเลิกเลขที่ออกไปแล้ว — เลขเดิมยังถูกกันไว้ไม่ให้นำกลับมาใช้ */
export async function voidDocumentNumber(
  input: unknown,
  procurementId: string,
): Promise<ActionResult<void>> {
  try {
    await requireAnyPermission('procurement.read.own', 'procurement.read.all');

    const parsed = documentNumberVoidSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message;
      return { ok: false, error: first ?? 'ข้อมูลที่ส่งมาไม่ถูกต้อง' };
    }

    const supabase = await createSupabaseServerClient();
    const headerList = await headers();
    const requestId = sanitizeRequestId(headerList.get(REQUEST_ID_HEADER)) ?? generateRequestId();

    const { error } = await supabase.rpc('document_number_void', {
      p_document_number_id: parsed.data.documentNumberId,
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
