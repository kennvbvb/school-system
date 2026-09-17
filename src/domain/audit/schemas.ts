/**
 * Zod schema ของตัวกรอง audit log (ข้อ 10.1)
 *
 * ค่าทั้งหมดมาจาก query string จึงเป็น string หรือ undefined เสมอ และอาจถูก
 * ผู้ใช้พิมพ์มาเองในแถบที่อยู่ — schema นี้จึงเป็นด่านที่ทำให้ค่าที่พิมพ์มั่ว
 * กลายเป็นค่าเริ่มต้นที่ปลอดภัย แทนที่จะพังทั้งหน้า
 */
import { z } from 'zod';
import { AUDIT_GROUPS } from './audit-view';

/** ค่าที่มากเกินไปทำให้หน้าช้าและดึงข้อมูลส่วนบุคคลออกมาเกินจำเป็นในคราวเดียว */
export const AUDIT_PAGE_SIZE = 50;

/*
 * ช่องที่ไม่บังคับ — ใช้ preprocess แทน transform ด้วยเหตุผลเดียวกับ schema อื่น
 * (transform ทำให้ key กลายเป็น "บังคับแต่เป็น undefined ได้" ในชนิดผลลัพธ์)
 */
const optionalTrimmed = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional(),
  );

const optionalDate = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.iso.date().optional(),
);

/**
 * ตัวกรองทั้งชุด
 *
 * **ค่าที่ผิดรูปแบบถูกปัดทิ้ง ไม่ใช่ทำให้ทั้งหน้าล้ม** — ผู้ตรวจสอบที่แก้ URL เอง
 * แล้วเจอหน้า error จะไม่รู้ว่าต้องแก้อะไร ส่วนการเห็นรายการทั้งหมดโดยไม่มีตัวกรอง
 * เป็นสถานะที่เข้าใจได้และแก้ต่อได้จากหน้าจอ
 */
export const auditFilterSchema = z.object({
  group: z.enum(AUDIT_GROUPS).catch('ALL'),
  actorId: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.uuid().optional().catch(undefined),
  ),
  entityType: optionalTrimmed(64),
  entityId: optionalTrimmed(128),
  from: optionalDate.catch(undefined),
  to: optionalDate.catch(undefined),
  /** cursor ของหน้าถัดไป — เป็น created_at ของแถวสุดท้ายที่แสดงไปแล้ว */
  before: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().optional().catch(undefined),
  ),
});

export type AuditFilter = z.infer<typeof auditFilterSchema>;

/** อ่านตัวกรองจาก searchParams ของ Next.js ซึ่งค่าอาจเป็น array ได้ */
export function parseAuditFilter(
  params: Record<string, string | string[] | undefined>,
): AuditFilter {
  const first = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  return auditFilterSchema.parse({
    group: first('group'),
    actorId: first('actorId'),
    entityType: first('entityType'),
    entityId: first('entityId'),
    from: first('from'),
    to: first('to'),
    before: first('before'),
  });
}

/**
 * ตัวกรองนี้แคบกว่า "ดูทั้งหมด" หรือไม่
 *
 * ใช้ตัดสินว่าจะแสดงปุ่มล้างตัวกรอง — ปุ่มที่ขึ้นตลอดเวลาทำให้ผู้ใช้ไม่รู้ว่า
 * ตอนนี้กำลังกรองอยู่หรือเปล่า
 */
export function hasActiveFilter(filter: AuditFilter): boolean {
  return (
    filter.group !== 'ALL' ||
    filter.actorId !== undefined ||
    filter.entityType !== undefined ||
    filter.entityId !== undefined ||
    filter.from !== undefined ||
    filter.to !== undefined
  );
}
