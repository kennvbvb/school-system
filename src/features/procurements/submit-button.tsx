'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormError, SubmitButton, TextAreaField } from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import type { ActionOutcome } from '@/features/forms/use-action-form';

/**
 * ปุ่มส่งอนุมัติ
 *
 * ขอเหตุผลก่อนส่งเฉพาะเมื่อยังมีข้อที่ต้องแก้เหลืออยู่ **และ** ผู้ใช้มีสิทธิ์
 * ยกเว้น — สองเงื่อนไขนี้ตัดสินที่ server อีกครั้ง ที่นี่เป็นเพียงการถามล่วงหน้า
 * เพื่อไม่ให้ผู้ใช้กดแล้วโดนปฏิเสธโดยไม่รู้ว่าต้องกรอกอะไรเพิ่ม
 *
 * ผู้ที่ไม่มีสิทธิ์ยกเว้นจะไม่เห็นช่องเหตุผลเลย เพราะกรอกไปก็ส่งไม่ผ่านอยู่ดี
 * การแสดงช่องให้กรอกทั้งที่ใช้ไม่ได้ทำให้เข้าใจผิดว่าเหตุผลคือทางออก
 */
export function ProcurementSubmitButton({
  procurementId,
  version,
  hasBlockingErrors,
  hasOverridableErrors,
  canOverride,
  action,
}: {
  procurementId: string;
  version: number;
  /** มีข้อที่ยกเว้นไม่ได้เหลืออยู่ — ส่งไม่ได้ไม่ว่าจะมีสิทธิ์อะไร */
  hasBlockingErrors: boolean;
  /** มีข้อที่ยกเว้นได้เหลืออยู่ */
  hasOverridableErrors: boolean;
  canOverride: boolean;
  action: (input: {
    id: string;
    expectedVersion: number;
    exceptionReason?: string;
  }) => Promise<ActionOutcome>;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const form = useActionForm({ onSuccess: () => router.refresh() });

  const needsReason = hasOverridableErrors && canOverride;

  if (hasBlockingErrors) {
    return (
      <p className="rounded-md border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        ยังส่งอนุมัติไม่ได้ ต้องแก้ข้อที่ระบุไว้ด้านบนก่อน
      </p>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await form.submit(() =>
      action({
        id: procurementId,
        expectedVersion: version,
        ...(needsReason ? { exceptionReason: reason } : {}),
      }),
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <FormError message={form.errorMessage} />

      {needsReason ? (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            ยังมีข้อที่ต้องแก้เหลืออยู่ แต่คุณมีสิทธิ์อนุมัติข้อยกเว้น —
            ต้องระบุเหตุผลและจะถูกบันทึกไว้ให้ผู้ตรวจสอบอ่านย้อนหลังได้
          </p>
          <TextAreaField
            label="เหตุผลของข้อยกเว้น"
            required
            rows={2}
            value={reason}
            onChange={setReason}
          />
        </div>
      ) : null}

      <SubmitButton isSubmitting={form.isSubmitting}>ส่งอนุมัติ</SubmitButton>
    </form>
  );
}
