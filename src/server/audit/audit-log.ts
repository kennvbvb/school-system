import 'server-only';
import { headers } from 'next/headers';
import { createHash } from 'node:crypto';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import { REQUEST_ID_HEADER, generateRequestId, sanitizeRequestId } from '@/lib/request-id';
import { redactSensitive } from '@/lib/redact';

/**
 * การบันทึก audit event (FR-AUD-001..004)
 *
 * กติกา:
 *   * mutation สำคัญทุกครั้งต้องมี audit event
 *   * ห้ามบันทึกรหัสผ่าน token หรือ secret (FR-AUD-004) — redactSensitive (src/lib/redact.ts) ตัดให้
 *   * ตารางเป็น append-only ทั้งฝั่ง policy และ table privilege
 *   * การเขียน audit ควรอยู่ใน transaction เดียวกับข้อมูลที่มันบันทึกถึง
 *     Phase 1 ยังเป็นการเขียนแยก และจะย้ายเข้า RPC เดียวกันใน Phase 3
 *     เมื่อมี domain service ที่ทำหลายตารางพร้อมกัน (ดู docs/assumptions.md)
 *
 * **การเขียนตรงถูกปิดแล้ว (PR-S01, migration 20260928000100)** — ตาราง
 * `audit_events` ไม่มี policy/privilege insert ให้ authenticated/anon เลย
 * ทางเดียวที่เขียนได้คือ RPC `record_audit_event()` ซึ่ง**กำหนด `actor_id` จาก
 * `auth.uid()` ของผู้เรียกเองเสมอ ไม่รับค่าจาก client** — ก่อนหน้านี้ policy
 * insert เดิมตรวจแค่ "บัญชี active" ไม่ได้ตรวจว่า `actor_id` ที่ส่งมาตรงกับ
 * ผู้เรียกจริงหรือไม่ ผู้ใช้ที่มี valid session จึงเรียก Supabase REST API ตรง
 * (ข้าม Next.js ทั้งหมด) แล้วปลอม `actor_id` เป็นคนอื่นได้ ทำลายความน่าเชื่อถือ
 * ของ audit log ทั้งระบบซึ่งเป็นหลักฐานที่แก้ไม่ได้อยู่แล้ว — จึงลบพารามิเตอร์
 * `actorId` ออกจาก `AuditEventInput` ผู้เรียกทุกจุดจึงไม่ต้องส่งมาอีกต่อไป
 */

export type AuditAction =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'entity.create'
  | 'entity.update'
  | 'entity.delete'
  | 'procurement.status_change'
  | 'document.issue'
  | 'document.print'
  | 'report.export'
  /*
   * การเปลี่ยนสิทธิ์แยกรหัสของตัวเอง ไม่ยุบรวมเป็น entity.update
   *
   * ผู้ตรวจสอบต้องกรอง "ใครเปลี่ยนสิทธิ์ใคร" ออกมาได้โดยไม่ต้องไล่อ่านทุกการแก้ไข
   * โปรไฟล์ — การเปลี่ยนนามสกุลกับการเพิ่มสิทธิ์อนุมัติไม่ใช่เรื่องระดับเดียวกัน
   *
   * สองรหัสหลังถูกเขียนโดย `user_set_roles()` / `user_set_active()` ในฐานข้อมูล
   * ที่นี่ประกาศไว้ให้ฝั่ง TypeScript อ้างถึงรหัสเดียวกันได้
   */
  | 'user.invite'
  | 'user.roles_change'
  | 'user.active_change'
  /*
   * การเบิกจ่ายแยกรหัสของตัวเองด้วยเหตุผลเดียวกัน — เป็นจุดที่เงินออกจากงบจริง
   * ทั้งสองรหัสถูกเขียนโดย `procurement_disburse()` /
   * `procurement_disbursement_void()` ในฐานข้อมูล (migration 0019)
   */
  | 'procurement.disburse'
  | 'procurement.disburse_void'
  | 'admin.action';

export interface AuditEventInput {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * เก็บ IP เป็น hash ไม่เก็บค่าดิบ (ข้อ 14.2 data minimization)
 * ยังใช้ตรวจ pattern การเข้าถึงผิดปกติได้ แต่ย้อนกลับเป็นตัวตนไม่ได้ตรง ๆ
 */
function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

export interface RecordAuditEventResult {
  /** false = insert ล้มเหลว — ผู้เรียกที่ต้อง fail closed (เช่น export) ต้องตรวจค่านี้ */
  ok: boolean;
}

export async function recordAuditEvent(input: AuditEventInput): Promise<RecordAuditEventResult> {
  const headerList = await headers();
  const requestId = sanitizeRequestId(headerList.get(REQUEST_ID_HEADER)) ?? generateRequestId();
  const forwardedFor = headerList.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() ?? null;

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc('record_audit_event', {
    p_request_id: requestId,
    p_action: input.action,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId ?? null,
    p_before_json: input.before === undefined ? null : redactSensitive(input.before),
    p_after_json: input.after === undefined ? null : redactSensitive(input.after),
    p_metadata_json: input.metadata ? redactSensitive(input.metadata) : null,
    p_ip_hash: hashIp(ip),
    p_user_agent: headerList.get('user-agent')?.slice(0, 512) ?? null,
  });

  if (error) {
    /*
     * audit ที่เขียนไม่ลงคือปัญหาด้านการกำกับดูแล ต้องเห็นใน error monitoring
     * ผู้เรียกส่วนใหญ่ (การสร้าง/แก้ไข/อนุมัติต่าง ๆ) ไม่ควรทำให้การกระทำที่
     * สำเร็จแล้วของผู้ใช้ล้มตาม จึงยังคง log แล้วคืนค่าว่าไม่สำเร็จแทนการ throw —
     * แต่ผู้เรียกที่ policy บังคับว่าต้องมี audit เสมอ (เช่นการส่งออกไฟล์ข้อมูล
     * ออกนอกระบบใน src/app/(dashboard)/reports/*\/export/route.ts) ต้องตรวจ
     * ค่า ok ที่คืนแล้ว fail closed เอง — ปฏิเสธการกระทำแทนที่จะปล่อยผ่านเงียบ ๆ
     */
    console.error('[audit] บันทึก audit event ไม่สำเร็จ', {
      requestId,
      action: input.action,
      entityType: input.entityType,
      message: error.message,
    });
    return { ok: false };
  }

  return { ok: true };
}
