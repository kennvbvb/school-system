'use client';

import { useState } from 'react';
import { FormError, SelectField, SubmitButton, TextField } from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import { RoleCheckboxes } from './role-checkboxes';
import type { ActionOutcome } from '@/features/forms/use-action-form';
import type { RoleOption, UserFormOptions } from '@/server/users/repository';

/**
 * เชิญผู้ใช้ใหม่ (FR-AUTH-002)
 *
 * **ไม่มีช่องรหัสผ่าน** ระบบส่งคำเชิญไปที่อีเมล แล้วให้เจ้าของบัญชีตั้งรหัสผ่านเอง
 * ผู้ดูแลจึงไม่เคยรู้รหัสผ่านของใคร และไม่มีรหัสผ่านผ่านระบบนี้ให้หลุดลง log ได้เลย
 *
 * อีเมลเป็นกุญแจเข้าระบบ จึงแก้ทีหลังจากหน้าจอนี้ไม่ได้ — ต้องกรอกให้ถูกตั้งแต่แรก
 */
export function UserInviteForm({
  roles,
  options,
  onInvite,
}: {
  roles: readonly RoleOption[];
  options: UserFormOptions;
  onInvite: (input: {
    email: string;
    titleTh: string;
    firstNameTh: string;
    lastNameTh: string;
    employeeCode: string;
    positionId: string;
    departmentId: string;
    roleCodes: string[];
  }) => Promise<ActionOutcome>;
}) {
  const [email, setEmail] = useState('');
  const [titleTh, setTitleTh] = useState('');
  const [firstNameTh, setFirstNameTh] = useState('');
  const [lastNameTh, setLastNameTh] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [positionId, setPositionId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [roleCodes, setRoleCodes] = useState<string[]>([]);

  const form = useActionForm({
    onSuccess: () => {
      setEmail('');
      setTitleTh('');
      setFirstNameTh('');
      setLastNameTh('');
      setEmployeeCode('');
      setPositionId('');
      setDepartmentId('');
      setRoleCodes([]);
    },
  });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await form.submit(() =>
      onInvite({
        email,
        titleTh,
        firstNameTh,
        lastNameTh,
        employeeCode,
        positionId,
        departmentId,
        roleCodes,
      }),
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormError message={form.errorMessage} />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="อีเมล"
          required
          value={email}
          onChange={setEmail}
          hint="ใช้เป็นชื่อผู้ใช้ และเป็นที่อยู่ที่ระบบส่งคำเชิญไป — แก้ทีหลังไม่ได้"
        />
        <TextField
          label="รหัสบุคลากร"
          value={employeeCode}
          onChange={setEmployeeCode}
          hint="ไม่บังคับ"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="คำนำหน้า" value={titleTh} onChange={setTitleTh} />
        <TextField label="ชื่อ" required value={firstNameTh} onChange={setFirstNameTh} />
        <TextField label="นามสกุล" required value={lastNameTh} onChange={setLastNameTh} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="ตำแหน่ง"
          value={positionId}
          onChange={setPositionId}
          options={options.positions.map((row) => ({ id: row.id, label: row.label }))}
        />
        <SelectField
          label="หน่วยงาน"
          value={departmentId}
          onChange={setDepartmentId}
          options={options.departments.map((row) => ({ id: row.id, label: row.label }))}
        />
      </div>

      <RoleCheckboxes roles={roles} selected={roleCodes} onChange={setRoleCodes} />

      <SubmitButton isSubmitting={form.isSubmitting} disabled={roleCodes.length === 0}>
        ส่งคำเชิญ
      </SubmitButton>
    </form>
  );
}
