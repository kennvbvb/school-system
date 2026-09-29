'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { requirePermission } from '@/server/auth/guard';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import { recordAuditEvent } from '@/server/audit/audit-log';
import { INVALID_INPUT_MESSAGE, toFieldErrors } from '@/server/action-result';
import { REQUEST_ID_HEADER, generateRequestId, sanitizeRequestId } from '@/lib/request-id';
import {
  inventoryItemSchema,
  stockAdjustmentSchema,
  stockIssueSchema,
  stockReceiveSchema,
  stockReversalSchema,
} from '@/domain/inventory/schemas';
import type { ActionResult } from '@/server/action-result';

/**
 * Server action ของคลังพัสดุ
 *
 * **การลงรายการเคลื่อนไหวทุกชนิดผ่าน RPC เท่านั้น ไม่ insert ตรง**
 *
 * เหตุผลเดียวกับ budget: ตาราง stock_movements ไม่มี policy `insert` เลย
 * และ RPC เป็นที่เดียวที่ล็อกแถวรายการพัสดุก่อนอ่านยอด ซึ่งกันไม่ให้สองคำขอ
 * พร้อมกันลงจนยอดติดลบ — audit event ของรายการเคลื่อนไหวถูกเขียนใน RPC เดียวกัน
 * จึงอยู่ในทรานแซกชันเดียว ที่นี่จึงไม่เขียนซ้ำ
 */

async function currentRequestId(): Promise<string> {
  const headerList = await headers();
  return sanitizeRequestId(headerList.get(REQUEST_ID_HEADER)) ?? generateRequestId();
}

/**
 * ข้อความจาก RPC เป็นภาษาไทยที่ผู้ใช้แก้ตามได้อยู่แล้ว จึงส่งต่อตรง ๆ
 * (เหตุผลเดียวกับ describeRpcError ของ budget — ดูคำอธิบายที่นั่น)
 */
function describeRpcError(message: string): string | null {
  if (message.includes('inventory_items_code_key')) return 'มีรหัสพัสดุนี้อยู่แล้วในระบบ';
  if (message.includes('stock_movements_single_reversal'))
    return 'รายการนี้ถูกย้อนไปแล้ว ย้อนซ้ำจะทำให้ยอดคลาดเคลื่อน';
  if (message.includes('row-level security')) return 'คุณไม่มีสิทธิ์ดำเนินการนี้';

  if (/^[฀-๿]/.test(message)) return message;

  return null;
}

function toActionError(error: unknown, context: string): ActionResult<never> {
  if (error instanceof Error) {
    const friendly = describeRpcError(error.message);
    if (friendly) return { ok: false, error: friendly };
  }

  console.error(`[inventory] ${context} ล้มเหลว`, error);
  return { ok: false, error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' };
}

function revalidateItem(itemId?: string): void {
  revalidatePath('/inventory/items');
  if (itemId) revalidatePath(`/inventory/items/${itemId}`);
}

// -----------------------------------------------------------------------------
// รายการพัสดุ
// -----------------------------------------------------------------------------

export async function createInventoryItem(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('inventory.adjust');

    const parsed = inventoryItemSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('inventory_items')
      .insert({
        code: parsed.data.code,
        name_th: parsed.data.nameTh,
        item_category_id: parsed.data.itemCategoryId ?? null,
        unit_id: parsed.data.unitId,
        location_id: parsed.data.locationId ?? null,
        minimum_quantity: parsed.data.minimumQuantity,
        note: parsed.data.note ?? null,
        created_by: user.id,
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !data) throw new Error(error?.message ?? 'ไม่ได้รับข้อมูลกลับจากฐานข้อมูล');

    await recordAuditEvent({
      action: 'entity.create',
      entityType: 'inventory_item',
      entityId: data.id,
      after: { code: parsed.data.code, nameTh: parsed.data.nameTh },
    });

    revalidateItem(data.id);
    return { ok: true, data };
  } catch (error) {
    return toActionError(error, 'สร้างรายการพัสดุ');
  }
}

/**
 * ปิดใช้งานรายการพัสดุ — ไม่มีการเปิดกลับในหน้าจอเดียวกันโดยตั้งใจ
 *
 * รายการที่ปิดแล้วหมายถึง "เลิกใช้ชนิดนี้แล้ว" ถ้าจะใช้ต่อให้เปิดผ่านหน้าจอ
 * เดิม (เหตุผลเดียวกับ closeBudgetAccount — เป็นข้อสรุปเชิงบัญชี ไม่ใช่สวิตช์)
 */
export async function setInventoryItemStatus(input: {
  itemId: string;
  status: 'ACTIVE' | 'INACTIVE';
  reason: string;
}): Promise<ActionResult<void>> {
  try {
    await requirePermission('inventory.adjust');

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('inventory_items')
      .update({ status: input.status })
      .eq('id', input.itemId)
      .select('id, code')
      .maybeSingle<{ id: string; code: string }>();

    if (error) throw new Error(error.message);
    if (!data) return { ok: false, error: 'ไม่พบรายการพัสดุนี้' };

    await recordAuditEvent({
      action: 'admin.action',
      entityType: 'inventory_item',
      entityId: data.id,
      after: { status: input.status },
      metadata: { code: data.code, reason: input.reason },
    });

    revalidateItem(data.id);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error, 'เปลี่ยนสถานะรายการพัสดุ');
  }
}

// -----------------------------------------------------------------------------
// รับเข้า / รับคืน / ยอดยกมา
// -----------------------------------------------------------------------------

export async function receiveStock(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requirePermission('inventory.receive');

    const parsed = stockReceiveSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('stock_post_movement', {
      p_item_id: parsed.data.itemId,
      p_type: parsed.data.type,
      p_quantity: parsed.data.quantity,
      p_effective_date: parsed.data.effectiveDate,
      p_reference: parsed.data.reference,
      p_reason: parsed.data.reason ?? null,
      p_source_type: 'MANUAL',
      p_request_id: await currentRequestId(),
    });

    if (error) throw new Error(error.message);

    revalidateItem(parsed.data.itemId);
    return { ok: true, data: { id: data as string } };
  } catch (error) {
    return toActionError(error, 'รับเข้าพัสดุ');
  }
}

// -----------------------------------------------------------------------------
// เบิกจ่าย
// -----------------------------------------------------------------------------

export async function issueStock(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requirePermission('inventory.issue');

    const parsed = stockIssueSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('stock_post_movement', {
      p_item_id: parsed.data.itemId,
      p_type: 'ISSUE',
      p_quantity: parsed.data.quantity,
      p_effective_date: parsed.data.effectiveDate,
      p_reference: parsed.data.reference,
      p_reason: parsed.data.reason ?? null,
      p_source_type: 'MANUAL',
      p_requested_by: parsed.data.requestedBy,
      p_approved_by: parsed.data.approvedBy,
      p_request_id: await currentRequestId(),
    });

    if (error) throw new Error(error.message);

    revalidateItem(parsed.data.itemId);
    return { ok: true, data: { id: data as string } };
  } catch (error) {
    return toActionError(error, 'เบิกจ่ายพัสดุ');
  }
}

// -----------------------------------------------------------------------------
// ปรับยอด
// -----------------------------------------------------------------------------

export async function adjustStock(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requirePermission('inventory.adjust');

    const parsed = stockAdjustmentSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('stock_post_movement', {
      p_item_id: parsed.data.itemId,
      p_type: parsed.data.type,
      p_quantity: parsed.data.quantity,
      p_effective_date: parsed.data.effectiveDate,
      p_reference: parsed.data.reference,
      p_reason: parsed.data.reason,
      p_source_type: 'MANUAL',
      p_approved_by: parsed.data.approvedBy,
      p_request_id: await currentRequestId(),
    });

    if (error) throw new Error(error.message);

    revalidateItem(parsed.data.itemId);
    return { ok: true, data: { id: data as string } };
  } catch (error) {
    return toActionError(error, 'ปรับยอดพัสดุ');
  }
}

// -----------------------------------------------------------------------------
// ย้อนรายการ
// -----------------------------------------------------------------------------

export async function reverseStockMovement(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requirePermission('inventory.adjust');

    const parsed = stockReversalSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: INVALID_INPUT_MESSAGE, fieldErrors: toFieldErrors(parsed.error) };
    }

    const supabase = await createSupabaseServerClient();

    /*
     * อ่านแถวต้นทางเพื่อให้ได้รายการพัสดุและจำนวนที่ต้องย้อน
     *
     * ไม่ให้ผู้เรียกส่งจำนวนมาเอง เหตุผลเดียวกับ reverseBudgetMovement:
     * การย้อนด้วยจำนวนที่ไม่เท่าของเดิมคือ "แก้ตัวเลข" ไม่ใช่การย้อน
     */
    const { data: target, error: readError } = await supabase
      .from('stock_movements')
      .select('id, item_id, quantity, movement_type, reference')
      .eq('id', parsed.data.movementId)
      .maybeSingle<{
        id: string;
        item_id: string;
        quantity: string;
        movement_type: string;
        reference: string;
      }>();

    if (readError) throw new Error(readError.message);
    if (!target) return { ok: false, error: 'ไม่พบรายการที่ต้องการย้อน' };

    if (target.movement_type === 'REVERSAL') {
      return { ok: false, error: 'ย้อนรายการย้อนอีกชั้นไม่ได้' };
    }

    const { data, error } = await supabase.rpc('stock_post_movement', {
      p_item_id: target.item_id,
      p_type: 'REVERSAL',
      p_quantity: target.quantity,
      p_effective_date: parsed.data.effectiveDate,
      p_reference: target.reference,
      p_reason: parsed.data.reason,
      p_source_type: 'MANUAL',
      p_reverses_movement_id: target.id,
      p_request_id: await currentRequestId(),
    });

    if (error) throw new Error(error.message);

    revalidateItem(target.item_id);
    return { ok: true, data: { id: data as string } };
  } catch (error) {
    return toActionError(error, 'ย้อนรายการเคลื่อนไหวพัสดุ');
  }
}
