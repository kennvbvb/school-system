/**
 * การอ่าน audit log ให้คนอ่านรู้เรื่อง (FR-AUD-001, FR-AUD-003, ข้อ 12)
 *
 * ตาราง `audit_events` เก็บข้อมูลดิบไว้ครบเพื่อการตรวจสอบ แต่ข้อมูลดิบอ่านยาก
 * สำหรับผู้ตรวจสอบภายในที่ไม่ได้อ่านโค้ด — `entity.update` กับ jsonb สองก้อน
 * ไม่ได้บอกว่า "ใครเปลี่ยนวงเงินโครงการจากเท่าไรเป็นเท่าไร"
 *
 * ไฟล์นี้แปลงข้อมูลดิบเป็นสิ่งที่อ่านได้ **โดยไม่แตะข้อมูลต้นทาง** ถ้าแปลงไม่ได้
 * ต้องแสดงข้อมูลดิบให้เห็น ไม่ใช่ซ่อน — ประวัติที่อ่านไม่ออกยังดีกว่าประวัติที่หายไป
 *
 * ไฟล์นี้เป็นตรรกะบริสุทธิ์ ห้าม import Supabase หรือ Next.js
 */
import type { AuditAction } from '@/server/audit/audit-log';

/**
 * ป้ายภาษาไทยของทุก action
 *
 * เป็น Record ที่ครบทุกค่าของ union โดยเจตนา — ถ้ามีใครเพิ่ม action ใหม่แล้วลืม
 * ใส่ป้าย TypeScript จะฟ้องตอน build ไม่ใช่ปล่อยให้ผู้ตรวจสอบเห็นรหัสดิบบนหน้าจอ
 */
export const AUDIT_ACTION_LABELS_TH: Record<AuditAction, string> = {
  'auth.login': 'เข้าสู่ระบบ',
  'auth.login_failed': 'เข้าสู่ระบบไม่สำเร็จ',
  'auth.logout': 'ออกจากระบบ',
  'entity.create': 'สร้างข้อมูล',
  'entity.update': 'แก้ไขข้อมูล',
  'entity.delete': 'ลบข้อมูล',
  'procurement.status_change': 'เปลี่ยนสถานะรายการจัดซื้อ',
  'procurement.disburse': 'บันทึกการเบิกจ่าย',
  'procurement.disburse_void': 'ยกเลิกการเบิกจ่าย',
  'document.issue': 'ออกเอกสาร',
  'document.print': 'พิมพ์เอกสาร',
  'report.export': 'ส่งออกรายงาน',
  'user.invite': 'เชิญผู้ใช้ใหม่',
  'user.roles_change': 'เปลี่ยนบทบาทผู้ใช้',
  'user.active_change': 'เปิด/ปิดบัญชีผู้ใช้',
  'admin.action': 'การกระทำของผู้ดูแลระบบ',
};

/**
 * กลุ่มของ action สำหรับตัวกรอง
 *
 * ผู้ตรวจสอบมักถามเป็นหัวข้อ ("ใครแตะสิทธิ์บ้างเดือนนี้") ไม่ใช่เป็นรหัสทีละตัว
 * การให้เลือกทีละรหัสจาก 16 ตัวทำให้พลาดตัวที่เกี่ยวข้องได้ง่าย
 */
export const AUDIT_GROUPS = ['ALL', 'SECURITY', 'MONEY', 'DOCUMENT', 'DATA'] as const;

export type AuditGroup = (typeof AUDIT_GROUPS)[number];

export const AUDIT_GROUP_LABELS_TH: Record<AuditGroup, string> = {
  ALL: 'ทุกประเภท',
  SECURITY: 'สิทธิ์และการเข้าระบบ',
  MONEY: 'เงินและการอนุมัติ',
  DOCUMENT: 'เอกสารและรายงาน',
  DATA: 'ข้อมูลพื้นฐาน',
};

const GROUP_MEMBERS: Record<Exclude<AuditGroup, 'ALL'>, readonly AuditAction[]> = {
  SECURITY: [
    'auth.login',
    'auth.login_failed',
    'auth.logout',
    'user.invite',
    'user.roles_change',
    'user.active_change',
    'admin.action',
  ],
  MONEY: ['procurement.status_change', 'procurement.disburse', 'procurement.disburse_void'],
  DOCUMENT: ['document.issue', 'document.print', 'report.export'],
  DATA: ['entity.create', 'entity.update', 'entity.delete'],
};

/** action ทั้งหมดในกลุ่มหนึ่ง — `ALL` คืนรายการว่างแปลว่า "ไม่ต้องกรอง" */
export function actionsInGroup(group: AuditGroup): readonly AuditAction[] {
  return group === 'ALL' ? [] : GROUP_MEMBERS[group];
}

/**
 * ทุก action ต้องอยู่ในกลุ่มใดกลุ่มหนึ่งพอดี
 *
 * ใช้ใน test เพื่อกันไม่ให้ action ใหม่ตกหล่นจากตัวกรองอย่างเงียบ ๆ — ถ้าตกหล่น
 * ผู้ตรวจสอบที่กรองตามกลุ่มจะไม่เห็นเหตุการณ์นั้นเลย และไม่มีอะไรบอกว่าหายไป
 */
export function actionsMissingFromGroups(): AuditAction[] {
  const grouped = new Set(Object.values(GROUP_MEMBERS).flat());

  return (Object.keys(AUDIT_ACTION_LABELS_TH) as AuditAction[]).filter(
    (action) => !grouped.has(action),
  );
}

export interface AuditFieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

const MAX_VALUE_LENGTH = 200;

function toDisplayValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, MAX_VALUE_LENGTH);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  return JSON.stringify(value).slice(0, MAX_VALUE_LENGTH);
}

/**
 * สรุปว่าอะไรเปลี่ยนจากอะไรเป็นอะไร
 *
 * เทียบเฉพาะคีย์ระดับบนสุด ไม่ไล่ลงไปในโครงสร้างซ้อน — ค่าซ้อนถูกแสดงเป็น JSON
 * ย่อแทน เพราะการไล่ลงลึกทำให้รายการยาวจนอ่านไม่ออก ซึ่งแย่กว่าการเห็น JSON ก้อนเดียว
 *
 * **คีย์ที่มีอยู่ฝั่งเดียวก็ถือว่าเปลี่ยน** — การเพิ่มหรือลบช่องเป็นการเปลี่ยนแปลง
 * ที่ผู้ตรวจสอบต้องเห็น ไม่ใช่สิ่งที่ละไว้ได้
 */
export function summarizeChanges(before: unknown, after: unknown): AuditFieldChange[] {
  const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

  if (!isObject(before) && !isObject(after)) return [];

  const beforeObject = isObject(before) ? before : {};
  const afterObject = isObject(after) ? after : {};
  const keys = [...new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)])].sort();

  const changes: AuditFieldChange[] = [];

  for (const field of keys) {
    const previous = toDisplayValue(beforeObject[field]);
    const next = toDisplayValue(afterObject[field]);

    if (previous !== next) changes.push({ field, before: previous, after: next });
  }

  return changes;
}
