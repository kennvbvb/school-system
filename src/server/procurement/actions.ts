'use server';

import { revalidatePath } from 'next/cache';
import { requireAnyPermission, requirePermission } from '@/server/auth/guard';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import type { ActionResult } from '@/server/action-result';
import { headers } from 'next/headers';
import { REQUEST_ID_HEADER, generateRequestId, sanitizeRequestId } from '@/lib/request-id';
import {
  procurementDraftSchema,
  procurementSubmitSchema,
  procurementTransitionSchema,
  procurementUpdateSchema,
} from '@/domain/procurement/schemas';
import { ProcurementDraftError, assertLinesConsistent } from '@/domain/procurement/draft';
import { toDraftPayload } from '@/domain/procurement/draft-payload';

/**
 * Server action ของรายการจัดซื้อ (ขั้น draft)
 *
 * ทุกตัวทำตามลำดับนี้เสมอ (ข้อ 13):
 *   1. ตรวจสิทธิ์ที่ server — ไม่พึ่งการซ่อนปุ่มฝั่ง browser
 *   2. ตรวจข้อมูลด้วย schema เดียวกับที่ฟอร์มใช้
 *   3. เขียนผ่าน RPC ของฐานข้อมูลเท่านั้น (F-08): ตรวจสิทธิ์/สถานะ/version ซ้ำที่ฐานข้อมูล
 *      เขียนแม่+ลูก+audit ใน transaction เดียว — ตารางไม่เปิดให้เขียนตรงจาก client อีกแล้ว
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

/**
 * ข้อความจาก RPC เป็นภาษาไทยที่ผู้ใช้แก้ตามได้อยู่แล้ว (สิทธิ์/สถานะ/version ขัดแย้ง) จึงส่งต่อตรง ๆ
 * ข้อความที่ PostgreSQL สร้างเอง (ภาษาอังกฤษ ชื่อ constraint) ไม่ส่งออกไปเพราะเปิดเผยโครงสร้างภายใน
 */
function rpcMessageOrThrow(message: string): ActionResult<never> {
  if (/^[\u0E00-\u0E7F]/.test(message)) return { ok: false, error: message };
  throw new Error(message);
}

/** request id เดียวกับที่หน้าจอแสดงตอนเกิด error — ผูก audit ที่ RPC เขียนเข้ากับคำขอนี้ */
async function currentRequestId(): Promise<string> {
  const headerList = await headers();
  return sanitizeRequestId(headerList.get(REQUEST_ID_HEADER)) ?? generateRequestId();
}

export async function createProcurementDraft(
  input: unknown,
): Promise<ActionResult<{ id: string; reference: string }>> {
  try {
    await requirePermission('procurement.create');

    const parsed = procurementDraftSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: 'ข้อมูลที่กรอกยังไม่ถูกต้อง',
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    assertLinesConsistent(parsed.data);

    /*
     * สร้างแม่ + รายการย่อย + แหล่งเงิน + audit ใน transaction เดียว (RPC — F-08)
     * ล้มตรงไหนฐานข้อมูล rollback ทั้งหมด ไม่ทิ้งร่างครึ่งเดียวหรือ audit ค้าง
     * ผู้สร้างมาจาก session ที่ฐานข้อมูล ไม่ได้ส่งจากที่นี่
     */
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('procurement_create_draft', {
      p_payload: toDraftPayload(parsed.data),
      p_request_id: await currentRequestId(),
    });

    if (error) return rpcMessageOrThrow(error.message);

    const created = data as { id?: string; reference?: string } | null;
    if (!created?.id || !created.reference) {
      throw new Error('ไม่ได้รับข้อมูลกลับจากฐานข้อมูล');
    }

    revalidatePath('/procurements');
    return { ok: true, data: { id: created.id, reference: created.reference } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateProcurementDraft(
  input: unknown,
): Promise<ActionResult<{ version: number }>> {
  try {
    await requirePermission('procurement.edit_draft');

    const parsed = procurementUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: 'ข้อมูลที่กรอกยังไม่ถูกต้อง',
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    assertLinesConsistent(parsed.data);

    /*
     * ตรวจสิทธิ์ สถานะ และ version ใน RPC หลังล็อกแถวแม่ — ไม่มีช่องว่างระหว่างตรวจกับเขียน
     * (เดิมอ่านก่อนแล้วค่อยเขียนหลายคำขอ) เขียนแม่ + รายการย่อย + แหล่งเงิน + audit ใน transaction เดียว
     * และคืน version ใหม่ให้เลย (บันทึกหนึ่งครั้ง = เพิ่ม version หนึ่งครั้ง)
     */
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('procurement_save_draft', {
      p_procurement_id: parsed.data.id,
      p_expected_version: parsed.data.expectedVersion,
      p_payload: toDraftPayload(parsed.data),
      p_request_id: await currentRequestId(),
    });

    if (error) return rpcMessageOrThrow(error.message);

    const saved = data as { version?: number } | null;
    if (typeof saved?.version !== 'number') {
      throw new Error('ไม่ได้รับ version ใหม่กลับจากฐานข้อมูล');
    }

    revalidatePath('/procurements');
    revalidatePath(`/procurements/${parsed.data.id}`);

    return { ok: true, data: { version: saved.version } };
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
    await requirePermission('procurement.submit');

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

    // audit ของการเปลี่ยนสถานะเขียนใน RPC procurement_submit แล้ว (DB_TRUSTED) — ไม่เขียนซ้ำจากที่นี่

    revalidatePath('/procurements');
    revalidatePath(`/procurements/${parsed.data.id}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * ดำเนินการตามสายอนุมัติ (PR-04a)
 *
 * ตรวจสิทธิ์ที่นี่ไม่ได้ด้วย `requirePermission` ตัวเดียว เพราะสิทธิ์ที่ต้องใช้
 * ขึ้นกับ action และสถานะปัจจุบัน — `procurement_transition()` จึงเป็นผู้ตรวจ
 * โดยดูจากตารางกติกาชุดเดียวกับที่หน้าจอใช้ตัดสินว่าจะแสดงปุ่มใด
 *
 * **ไม่เขียน audit ซ้ำจากฝั่งแอป** — RPC เขียนไว้แล้วในทรานแซกชันเดียวกับการ
 * เปลี่ยนสถานะ ซึ่งเป็นหลักประกันที่แข็งแรงกว่า การเขียนอีกครั้งที่นี่จะทำให้
 * ผู้ตรวจสอบที่นับจำนวนการเปลี่ยนสถานะได้ตัวเลขเป็นสองเท่า
 */
export async function transitionProcurement(input: unknown): Promise<ActionResult<void>> {
  try {
    /*
     * ต้องอ่านรายการได้เป็นอย่างน้อยจึงจะเรียกได้ ส่วนสิทธิ์ของ action นั้น ๆ
     * ตรวจที่ RPC — ถ้าตรวจซ้ำที่นี่ด้วยจะกลายเป็นกติกาสองที่ที่เลื่อนออกจากกันได้
     */
    await requireAnyPermission('procurement.read.own', 'procurement.read.all');

    const parsed = procurementTransitionSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message;
      return { ok: false, error: first ?? 'ข้อมูลที่ส่งมาไม่ถูกต้อง' };
    }

    const supabase = await createSupabaseServerClient();
    const headerList = await headers();
    const requestId = sanitizeRequestId(headerList.get(REQUEST_ID_HEADER)) ?? generateRequestId();

    const { error } = await supabase.rpc('procurement_transition', {
      p_procurement_id: parsed.data.id,
      p_action: parsed.data.action,
      p_expected_version: parsed.data.expectedVersion,
      p_reason: parsed.data.reason ?? null,
      p_request_id: requestId,
    });

    if (error) {
      // เหตุผลเดียวกับ submitProcurement — ส่งต่อเฉพาะข้อความภาษาไทยที่ตั้งใจให้ผู้ใช้เห็น
      if (/^[฀-๿]/.test(error.message)) {
        return { ok: false, error: error.message };
      }
      throw new Error(error.message);
    }

    revalidatePath('/procurements');
    revalidatePath('/approvals/inbox');
    revalidatePath(`/procurements/${parsed.data.id}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
