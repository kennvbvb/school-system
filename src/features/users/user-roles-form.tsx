'use client';

import { useState } from 'react';
import { FormError, SubmitButton } from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import { RoleCheckboxes } from './role-checkboxes';
import type { ActionOutcome } from '@/features/forms/use-action-form';
import type { RoleOption } from '@/server/users/repository';

/**
 * แก้บทบาทของผู้ใช้หนึ่งคน
 *
 * ปุ่มบันทึกขึ้นเฉพาะเมื่อมีการเปลี่ยนจริง — หน้าจอนี้มีหลายคนเรียงกัน ถ้าทุกแถวมี
 * ปุ่มที่กดได้ตลอดเวลา ผู้ดูแลจะแยกไม่ออกว่ากำลังแก้แถวไหนอยู่
 *
 * **คำเตือนเรื่องผู้ดูแลคนสุดท้ายไม่ได้อยู่ที่นี่** ฐานข้อมูลเป็นผู้ตัดสิน เพราะต้องนับ
 * ผู้ดูแลที่เหลือทั้งระบบ ณ วินาทีที่บันทึก ซึ่งหน้าจอที่โหลดไว้ก่อนหน้าไม่รู้
 * ที่นี่ทำได้แค่เตือนว่าบทบาทใดให้สิทธิ์จัดการผู้ใช้ (ดู RoleCheckboxes)
 */
export function UserRolesForm({
  userId,
  roles,
  currentRoleCodes,
  onSave,
}: {
  userId: string;
  roles: readonly RoleOption[];
  currentRoleCodes: readonly string[];
  onSave: (input: { userId: string; roleCodes: string[] }) => Promise<ActionOutcome>;
}) {
  const [selected, setSelected] = useState<string[]>([...currentRoleCodes]);
  const form = useActionForm();

  const sortedCurrent = [...currentRoleCodes].sort().join(',');
  const changed = [...selected].sort().join(',') !== sortedCurrent;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await form.submit(() => onSave({ userId, roleCodes: selected }));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <FormError message={form.errorMessage} />

      <RoleCheckboxes roles={roles} selected={selected} onChange={setSelected} />

      {changed ? (
        <div className="flex items-center gap-3">
          <SubmitButton isSubmitting={form.isSubmitting} disabled={selected.length === 0}>
            บันทึกบทบาท
          </SubmitButton>
          <button
            type="button"
            disabled={form.isSubmitting}
            onClick={() => setSelected([...currentRoleCodes])}
            className="text-sm font-medium text-slate-700 underline underline-offset-2 disabled:opacity-60"
          >
            ย้อนกลับ
          </button>
        </div>
      ) : null}
    </form>
  );
}
