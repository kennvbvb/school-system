'use client';

import { useId } from 'react';
import type { RoleOption } from '@/server/users/repository';

/**
 * ช่องเลือกบทบาท
 *
 * ใช้ checkbox ไม่ใช่ multi-select เพราะบทบาทมีแปดรายการและแต่ละรายการต้องมี
 * คำอธิบายกำกับ — ผู้ดูแลที่ไม่ได้ใช้ระบบทุกวันต้องอ่านได้ว่าบทบาทไหนทำอะไรได้
 * ก่อนติ๊ก ไม่ใช่ต้องจำจากรหัส
 *
 * บทบาทที่ถือสิทธิ์จัดการผู้ใช้ถูกทำเครื่องหมายไว้ เพราะเป็นบทบาทที่ให้แล้ว
 * ผู้รับจะแก้สิทธิ์ของคนอื่นได้ทั้งระบบ รวมถึงถอดสิทธิ์ของผู้ให้เอง
 */
export function RoleCheckboxes({
  roles,
  selected,
  onChange,
  disabled = false,
}: {
  roles: readonly RoleOption[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const groupId = useId();

  function toggle(code: string, checked: boolean) {
    onChange(checked ? [...selected, code] : selected.filter((value) => value !== code));
  }

  return (
    <fieldset className="space-y-2" aria-describedby={`${groupId}-hint`}>
      <legend className="mb-1 text-sm font-medium">
        บทบาท<span className="text-rose-700"> *</span>
      </legend>
      <p id={`${groupId}-hint`} className="text-sm text-slate-600">
        ผู้ใช้ต้องมีอย่างน้อยหนึ่งบทบาท มิฉะนั้นเข้าระบบไปก็ทำอะไรไม่ได้
      </p>

      <ul className="space-y-1.5">
        {roles.map((role) => {
          const id = `${groupId}-${role.code}`;
          const checked = selected.includes(role.code);

          return (
            <li key={role.code} className="flex gap-2.5 rounded-md border border-slate-200 p-3">
              <input
                id={id}
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(event) => toggle(role.code, event.target.checked)}
                className="mt-1 size-4 shrink-0"
              />
              <label htmlFor={id} className="text-sm">
                <span className="font-medium">{role.nameTh}</span>
                {role.managesUsers ? (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                    จัดการผู้ใช้และสิทธิ์ได้
                  </span>
                ) : null}
                {role.descriptionTh ? (
                  <span className="block text-slate-600">{role.descriptionTh}</span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
