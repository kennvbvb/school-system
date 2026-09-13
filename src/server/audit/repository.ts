import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import { AUDIT_PAGE_SIZE } from '@/domain/audit/schemas';
import { actionsInGroup } from '@/domain/audit/audit-view';
import type { AuditFilter } from '@/domain/audit/schemas';
import type { AuditAction } from './audit-log';

/**
 * การอ่าน audit log (PR-05b)
 *
 * query ผ่าน client ของผู้ใช้ ไม่ใช่ service-role — policy `audit_events_select`
 * ที่บังคับสิทธิ์ `audit.read` เป็นตัวกรองจริง (ADR 0003, 0004) เงื่อนไข where
 * ที่นี่เป็นเรื่องการแสดงผลล้วน ๆ ถ้าใช้ service-role ที่นี่ การลืมตรวจสิทธิ์
 * ในชั้นแอปจะกลายเป็นการเปิดประวัติทั้งระบบให้ทุกคนอ่าน
 */

export interface AuditEventRow {
  id: string;
  requestId: string;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  actorName: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: string;
}

interface RawRow {
  id: string;
  request_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_id: string | null;
  before_json: unknown;
  after_json: unknown;
  metadata_json: unknown;
  created_at: string;
  actor: { first_name_th: string | null; last_name_th: string | null } | null;
}

/*
 * ไม่ดึง ip_hash และ user_agent มาแสดง
 *
 * ทั้งคู่มีไว้ให้สืบสวนเหตุผิดปกติเป็นรายกรณี ไม่ใช่ข้อมูลที่ควรไหลผ่านหน้าจอ
 * ที่เปิดดูทุกวัน การดึงมาแล้วไม่แสดงยังทำให้ข้อมูลอยู่ใน payload ของหน้า
 * ซึ่งเป็นการกระจายข้อมูลเกินจำเป็น (ข้อ 14.2)
 */
const COLUMNS =
  'id, request_id, action, entity_type, entity_id, actor_id, before_json, after_json, metadata_json, created_at, actor:profiles!audit_events_actor_id_fkey(first_name_th, last_name_th)';

function toRow(raw: RawRow): AuditEventRow {
  const name = [raw.actor?.first_name_th, raw.actor?.last_name_th].filter(Boolean).join(' ');

  return {
    id: raw.id,
    requestId: raw.request_id,
    action: raw.action as AuditAction,
    entityType: raw.entity_type,
    entityId: raw.entity_id,
    actorId: raw.actor_id,
    actorName: name === '' ? null : name,
    before: raw.before_json,
    after: raw.after_json,
    metadata: raw.metadata_json,
    createdAt: raw.created_at,
  };
}

export interface AuditPage {
  rows: AuditEventRow[];
  /** cursor ของหน้าถัดไป — null แปลว่าหมดแล้ว */
  nextCursor: string | null;
}

const CURSOR_SEPARATOR = '|';

/**
 * cursor เป็นคู่ `created_at|id` ไม่ใช่ created_at อย่างเดียว
 *
 * **`created_at` ไม่ unique** — `now()` ใน PostgreSQL คืนเวลาเริ่มทรานแซกชัน
 * แถวที่ถูกเขียนในทรานแซกชันเดียวกันจึงมีเวลาเท่ากันเป๊ะ ถ้าใช้เวลาอย่างเดียว
 * เป็น cursor แล้วขอบหน้าไปตกกลางกลุ่มที่เวลาเท่ากัน แถวที่เหลือในกลุ่มนั้น
 * จะถูกข้ามไปเงียบ ๆ — เป็นการทำประวัติหายซึ่งยอมไม่ได้สำหรับงานตรวจสอบ
 */
function encodeCursor(row: { created_at: string; id: string }): string {
  return `${row.created_at}${CURSOR_SEPARATOR}${row.id}`;
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  const index = cursor.lastIndexOf(CURSOR_SEPARATOR);
  if (index <= 0) return null;

  const createdAt = cursor.slice(0, index);
  const id = cursor.slice(index + 1);

  return createdAt && id ? { createdAt, id } : null;
}

/**
 * อ่านหนึ่งหน้า เรียงจากใหม่ไปเก่า
 *
 * **ใช้ keyset ไม่ใช่ offset** — ตารางนี้มีแถวเพิ่มตลอดเวลา offset จะทำให้แถว
 * เลื่อนข้ามหน้าไปมา ผู้ตรวจสอบที่กดหน้าถัดไปจะเห็นบางแถวซ้ำและบางแถวหายไป
 * ซึ่งเป็นสิ่งที่ยอมไม่ได้สำหรับงานตรวจสอบ
 */
export async function listAuditEvents(filter: AuditFilter): Promise<AuditPage> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from('audit_events')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    /* ขอเกินมาหนึ่งแถวเพื่อรู้ว่ายังมีหน้าถัดไปไหม โดยไม่ต้อง count ทั้งตาราง */
    .limit(AUDIT_PAGE_SIZE + 1);

  const actions = actionsInGroup(filter.group);
  if (actions.length > 0) query = query.in('action', actions as string[]);

  if (filter.actorId) query = query.eq('actor_id', filter.actorId);
  if (filter.entityType) query = query.eq('entity_type', filter.entityType);
  if (filter.entityId) query = query.eq('entity_id', filter.entityId);

  if (filter.from) query = query.gte('created_at', `${filter.from}T00:00:00Z`);
  /* ถึงสิ้นวันที่เลือก ไม่ใช่เที่ยงคืนต้นวัน มิฉะนั้นวันสุดท้ายจะหายไปทั้งวัน */
  if (filter.to) query = query.lte('created_at', `${filter.to}T23:59:59.999Z`);

  /*
   * keyset แบบคู่ — "เก่ากว่าเวลานี้ หรือเวลาเท่ากันแต่ id เล็กกว่า"
   *
   * cursor ที่ผิดรูปแบบถูกละทิ้ง ไม่ทำให้ทั้งหน้าล้ม ด้วยเหตุผลเดียวกับตัวกรองอื่น
   */
  const cursor = filter.before ? decodeCursor(filter.before) : null;
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;

  if (error) throw new Error(`อ่าน audit log ไม่สำเร็จ: ${error.message}`);

  const raw = data as unknown as RawRow[];
  const hasMore = raw.length > AUDIT_PAGE_SIZE;
  const page = hasMore ? raw.slice(0, AUDIT_PAGE_SIZE) : raw;

  const last = page.at(-1);

  return {
    rows: page.map(toRow),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}

/** รายชื่อผู้กระทำที่ปรากฏใน log สำหรับเป็นตัวเลือกของตัวกรอง */
export async function listAuditActors(): Promise<{ id: string; name: string }[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name_th, last_name_th')
    .order('first_name_th', { ascending: true });

  if (error) throw new Error(`อ่านรายชื่อผู้ใช้ไม่สำเร็จ: ${error.message}`);

  return (data as { id: string; first_name_th: string | null; last_name_th: string | null }[]).map(
    (row) => ({
      id: row.id,
      name: [row.first_name_th, row.last_name_th].filter(Boolean).join(' ') || row.id,
    }),
  );
}
