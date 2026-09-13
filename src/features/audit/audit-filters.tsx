'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { SelectField, TextField } from '@/features/forms/fields';
import { AUDIT_GROUPS, AUDIT_GROUP_LABELS_TH } from '@/domain/audit/audit-view';
import type { AuditFilter } from '@/domain/audit/schemas';
import type { AuditGroup } from '@/domain/audit/audit-view';

/**
 * ตัวกรอง audit log (PR-05b)
 *
 * เก็บสถานะไว้ใน query string ไม่ใช่ใน component — ผู้ตรวจสอบต้องส่งลิงก์
 * ของสิ่งที่ตัวเองเห็นให้คนอื่นดูได้ และกดปุ่มย้อนกลับของเบราว์เซอร์แล้วได้
 * ผลเดิม ซึ่งสถานะที่อยู่ใน component ทำไม่ได้ทั้งสองอย่าง
 */
export function AuditFilters({
  filter,
  actors,
}: {
  filter: AuditFilter;
  actors: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [group, setGroup] = useState<AuditGroup>(filter.group);
  const [actorId, setActorId] = useState(filter.actorId ?? '');
  const [entityType, setEntityType] = useState(filter.entityType ?? '');
  const [from, setFrom] = useState(filter.from ?? '');
  const [to, setTo] = useState(filter.to ?? '');

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const next = new URLSearchParams();
    if (group !== 'ALL') next.set('group', group);
    if (actorId) next.set('actorId', actorId);
    if (entityType.trim()) next.set('entityType', entityType.trim());
    if (from) next.set('from', from);
    if (to) next.set('to', to);

    /* ไม่ส่ง before ต่อ — เปลี่ยนตัวกรองแล้วต้องกลับไปหน้าแรกเสมอ
       มิฉะนั้น cursor ของชุดเดิมจะพาไปอยู่กลางชุดใหม่ */
    router.push(`/admin/audit-log${next.size > 0 ? `?${next}` : ''}`);
  }

  const hasQuery = params.size > 0;

  return (
    <form
      onSubmit={apply}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
      aria-label="ตัวกรองประวัติการใช้งาน"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SelectField
          label="ประเภทเหตุการณ์"
          value={group}
          onChange={(value) => setGroup(value as AuditGroup)}
          options={AUDIT_GROUPS.map((value) => ({
            id: value,
            label: AUDIT_GROUP_LABELS_TH[value],
          }))}
        />
        <SelectField
          label="ผู้กระทำ"
          value={actorId}
          onChange={setActorId}
          placeholder="— ทุกคน —"
          options={actors.map((actor) => ({ id: actor.id, label: actor.name }))}
        />
        <TextField label="ชนิดข้อมูล" value={entityType} onChange={setEntityType} />
        <TextField label="ตั้งแต่วันที่" type="date" value={from} onChange={setFrom} />
        <TextField label="ถึงวันที่" type="date" value={to} onChange={setTo} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800"
        >
          กรอง
        </button>
        {hasQuery ? (
          <button
            type="button"
            onClick={() => router.push('/admin/audit-log')}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ล้างตัวกรอง
          </button>
        ) : null}
      </div>
    </form>
  );
}
