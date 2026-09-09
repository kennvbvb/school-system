'use client';

import { useState } from 'react';
import { FormError, SubmitButton, TextAreaField } from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import { findTransition } from '@/domain/procurement/status';
import { ACTION_LABELS_TH } from './format';
import type { ActionOutcome } from '@/features/forms/use-action-form';
import type { ProcurementAction, ProcurementStatus } from '@/domain/procurement/status';

/**
 * ปุ่มดำเนินการตามสายอนุมัติ (PR-04a)
 *
 * ปุ่มที่แสดงมาจาก `availableActions()` ซึ่งใช้ตารางกติกาชุดเดียวกับที่ฐานข้อมูล
 * ใช้บังคับจริง **การซ่อนปุ่มเป็นเรื่อง UX เท่านั้น** — server ตรวจซ้ำทุกครั้ง
 * และเป็นผู้ตัดสิน (ข้อ 4.2)
 *
 * การกระทำที่ต้องมีเหตุผลจะกางช่องกรอกออกมาก่อน แล้วจึงยืนยัน ไม่ใช่กดแล้วส่งเลย
 * เพราะการบังคับเหตุผลหลังกดจะทำให้ผู้ใช้เจอ error ทั้งที่ยังไม่มีโอกาสกรอก
 */
export function TransitionButtons({
  status,
  actions,
  expectedVersion,
  onAct,
}: {
  status: ProcurementStatus;
  actions: readonly ProcurementAction[];
  expectedVersion: number;
  onAct: (input: {
    action: ProcurementAction;
    expectedVersion: number;
    reason: string;
  }) => Promise<ActionOutcome>;
}) {
  const [pending, setPending] = useState<ProcurementAction | null>(null);
  const [reason, setReason] = useState('');

  const form = useActionForm({
    onSuccess: () => {
      setPending(null);
      setReason('');
    },
  });

  if (actions.length === 0) return null;

  async function run(action: ProcurementAction) {
    await form.submit(() => onAct({ action, expectedVersion, reason }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) await run(pending);
  }

  const pendingLabel = pending ? ACTION_LABELS_TH[pending] : '';

  return (
    <div className="space-y-3">
      <FormError message={form.errorMessage} />

      {pending === null ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => {
            const rule = findTransition(status, action);
            const destructive = action === 'reject' || action === 'cancel';

            return (
              <button
                key={action}
                type="button"
                disabled={form.isSubmitting}
                onClick={() => {
                  if (rule?.requiresReason) {
                    setPending(action);
                    setReason('');
                  } else {
                    void run(action);
                  }
                }}
                className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 ${
                  destructive
                    ? 'border border-rose-300 text-rose-800 hover:bg-rose-50'
                    : 'bg-slate-900 text-white hover:bg-slate-700'
                }`}
              >
                {ACTION_LABELS_TH[action]}
              </button>
            );
          })}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-md border border-slate-300 p-4">
          <p className="text-sm font-medium">ยืนยันการ{pendingLabel}</p>
          <TextAreaField
            label="เหตุผล"
            required
            value={reason}
            onChange={setReason}
            hint="ผู้ขอจะเห็นเหตุผลนี้ และระบบบันทึกไว้ในประวัติอย่างถาวร"
          />
          <div className="flex gap-2">
            <SubmitButton
              isSubmitting={form.isSubmitting}
              variant={pending === 'reject' || pending === 'cancel' ? 'danger' : 'primary'}
              disabled={reason.trim() === ''}
            >
              ยืนยัน{pendingLabel}
            </SubmitButton>
            <button
              type="button"
              disabled={form.isSubmitting}
              onClick={() => {
                setPending(null);
                setReason('');
              }}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
            >
              ยกเลิก
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
