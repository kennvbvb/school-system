'use client';

import { useActionForm } from '@/features/forms/use-action-form';
import type { ActionOutcome } from '@/features/forms/use-action-form';

/**
 * ปุ่มเปิด/ปิดการใช้งานของรายการข้อมูลพื้นฐาน
 *
 * ไม่มีปุ่มลบทั้งระบบ — รายการที่เอกสารเก่าอ้างถึงต้องยังอ่านได้ตลอดไป
 * การปิดใช้ทำให้เลือกใหม่ไม่ได้ แต่ของเดิมยังแสดงผลถูกต้อง (FR-MST-008)
 *
 * ไม่ต้องมีเหตุผลกำกับ ต่างจากการปิดปีงบประมาณหรือบัญชีงบ เพราะการปิดใช้ที่นี่
 * ไม่กระทบยอดเงินหรือรายการที่บันทึกไปแล้ว และย้อนกลับได้ทันทีด้วยปุ่มเดียวกัน
 */
export function ActiveToggleButton({
  isActive,
  action,
}: {
  isActive: boolean;
  action: (next: boolean) => Promise<ActionOutcome>;
}) {
  const form = useActionForm();

  async function handleClick() {
    await form.submit(() => action(!isActive));
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={form.isSubmitting}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
      >
        {isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
      </button>
      {form.errorMessage ? (
        <span role="alert" className="block text-sm text-rose-700">
          {form.errorMessage}
        </span>
      ) : null}
    </div>
  );
}
