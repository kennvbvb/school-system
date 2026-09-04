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
  | 'admin.action';

export interface AuditEventInput {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  actorId?: string | null;
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

export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  const headerList = await headers();
  const requestId = sanitizeRequestId(headerList.get(REQUEST_ID_HEADER)) ?? generateRequestId();
  const forwardedFor = headerList.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() ?? null;

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from('audit_events').insert({
    request_id: requestId,
    actor_id: input.actorId ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    before_json: input.before === undefined ? null : redactSensitive(input.before),
    after_json: input.after === undefined ? null : redactSensitive(input.after),
    metadata_json: input.metadata ? redactSensitive(input.metadata) : null,
    ip_hash: hashIp(ip),
    user_agent: headerList.get('user-agent')?.slice(0, 512) ?? null,
  });

  if (error) {
    // audit ที่เขียนไม่ลงคือปัญหาด้านการกำกับดูแล ต้องเห็นใน error monitoring
    // แต่ไม่ควรทำให้การกระทำที่สำเร็จแล้วของผู้ใช้ล้มตาม จึงบันทึกไว้แล้วปล่อยผ่าน
    console.error('[audit] บันทึก audit event ไม่สำเร็จ', {
      requestId,
      action: input.action,
      entityType: input.entityType,
      message: error.message,
    });
  }
}
