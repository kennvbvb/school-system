import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermissionForPage } from '@/server/auth/guard';
import { listAuditActors, listAuditEvents } from '@/server/audit/repository';
import { parseAuditFilter } from '@/domain/audit/schemas';
import { AuditFilters } from '@/features/audit/audit-filters';
import { AuditEventList } from '@/features/audit/audit-event-list';

export const metadata: Metadata = { title: 'Audit log' };

/**
 * หน้าดูประวัติการใช้งาน (FR-AUD-001, FR-AUD-003)
 *
 * ก่อนมีหน้านี้ ระบบเขียน audit ครบทุก mutation แต่ไม่มีใครอ่านได้นอกจากเข้า
 * ฐานข้อมูลตรง — ประวัติที่ไม่มีใครอ่านได้ไม่ต่างจากไม่มีประวัติ ผู้ตรวจสอบภายใน
 * มีสิทธิ์ `audit.read` มาตั้งแต่ต้นแต่ใช้ประโยชน์ไม่ได้เลย
 *
 * **หน้านี้อ่านอย่างเดียว ไม่มีการแก้ไขใด ๆ** ตาราง `audit_events` เป็น append-only
 * ทั้ง policy และ table privilege (FR-AUD-002) การเพิ่มปุ่มแก้ที่นี่จะขัดกับ
 * เหตุผลทั้งหมดของการมีตารางนี้
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermissionForPage('/admin/audit-log', 'audit.read');

  const filter = parseAuditFilter(await searchParams);
  const [page, actors] = await Promise.all([listAuditEvents(filter), listAuditActors()]);

  /*
   * ลิงก์หน้าถัดไปพา cursor ไปพร้อมตัวกรองเดิม
   *
   * สร้างจาก filter ที่ผ่าน schema แล้ว ไม่ใช่จาก searchParams ดิบ — ค่าที่ถูก
   * schema ปัดทิ้งเพราะผิดรูปแบบจะได้ไม่ถูกส่งต่อไปหน้าถัดไปด้วย
   */
  const nextParams = new URLSearchParams();
  if (filter.group !== 'ALL') nextParams.set('group', filter.group);
  if (filter.actorId) nextParams.set('actorId', filter.actorId);
  if (filter.entityType) nextParams.set('entityType', filter.entityType);
  if (filter.entityId) nextParams.set('entityId', filter.entityId);
  if (filter.from) nextParams.set('from', filter.from);
  if (filter.to) nextParams.set('to', filter.to);
  if (page.nextCursor) nextParams.set('before', page.nextCursor);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-slate-600">
          ประวัติการกระทำทั้งหมดในระบบ เรียงจากใหม่ไปเก่า
          รายการที่บันทึกแล้วแก้หรือลบไม่ได้ทั้งจากหน้าจอและจากฐานข้อมูล
        </p>
      </header>

      <AuditFilters filter={filter} actors={actors} />

      <section aria-labelledby="events-heading" className="space-y-3">
        <h2 id="events-heading" className="text-lg font-semibold">
          เหตุการณ์
        </h2>

        <AuditEventList rows={page.rows} />

        {/*
          ไม่แสดงจำนวนทั้งหมดและไม่มีเลขหน้า

          ตารางนี้โตตลอดเวลา การนับทั้งตารางทุกครั้งที่เปิดหน้าเป็นงานหนักที่
          ให้ตัวเลขซึ่งล้าสมัยทันทีที่แสดงผล ปุ่ม "เก่ากว่านี้" ใช้ cursor
          จึงไม่มีแถวซ้ำหรือแถวหายเมื่อมีเหตุการณ์ใหม่เข้ามาระหว่างที่อ่านอยู่
        */}
        {page.nextCursor ? (
          <Link
            href={`/admin/audit-log?${nextParams}`}
            className="inline-block rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ดูเหตุการณ์ที่เก่ากว่านี้
          </Link>
        ) : null}
      </section>
    </div>
  );
}
