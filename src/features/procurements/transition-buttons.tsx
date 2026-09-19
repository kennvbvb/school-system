'use client';

import { useState } from 'react';
import { FormError, SubmitButton, TextAreaField } from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import { budgetEffectOf, findTransition } from '@/domain/procurement/status';
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
/**
 * คำเตือนของแต่ละผลที่ปุ่มมีต่อเงิน
 *
 * เรียงตามลำดับที่ต้องการให้อ่าน ไม่ใช่ตามลำดับที่พบในปุ่ม — ผู้ใช้ที่เห็น
 * สองข้อพร้อมกันควรอ่านข้อที่เกิดก่อนในเวลาจริงก่อน
 */
const BUDGET_EFFECT_NOTES: readonly { effect: 'RESERVE' | 'COMMIT' | 'RELEASE'; text: string }[] = [
  {
    effect: 'RESERVE',
    text: 'การอนุมัติจะกันยอดงบตามแหล่งเงินที่ระบุทันที ถ้ายอดคงเหลือไม่พอ การอนุมัติจะไม่สำเร็จ',
  },
  {
    effect: 'COMMIT',
    /* ยอดที่ใช้ได้ไม่ขยับ จึงต้องบอกให้ชัดว่านี่ไม่ใช่การกันยอดเพิ่ม */
    text: 'การออกใบสั่งซื้อจะเปลี่ยนยอดที่กันไว้เป็นยอดผูกพัน ยอดงบคงเหลือไม่เปลี่ยน',
  },
  { effect: 'RELEASE', text: 'การยกเลิกจะคืนยอดงบที่ถือไว้ให้บัญชีเดิม' },
];

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

  /*
   * บอกล่วงหน้าว่าปุ่มใดแตะเงิน
   *
   * การอนุมัติกันยอดงบทันทีในทรานแซกชันเดียวกับการเปลี่ยนสถานะ ถ้างบไม่พอ
   * ทั้งชุดจะล้ม ผู้ใช้ควรรู้ก่อนกดว่าปุ่มนี้ไม่ได้แค่เปลี่ยนสถานะ
   *
   * ใช้ `budgetEffectOf` จากชั้นโดเมน ไม่เขียนรายการสถานะซ้ำที่นี่ — มี parity test
   * ที่ยืนยันว่ารายการนั้นตรงกับที่ฐานข้อมูลใช้จริง
   */
  const budgetEffects = new Set(
    actions
      .map((action) => {
        const rule = findTransition(status, action);
        return rule ? budgetEffectOf(status, rule.to) : null;
      })
      .filter((effect): effect is 'RESERVE' | 'COMMIT' | 'RELEASE' => effect !== null),
  );

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
      ) : null}

      {pending === null && budgetEffects.size > 0 ? (
        <p className="text-sm text-slate-600">
          {BUDGET_EFFECT_NOTES.filter((note) => budgetEffects.has(note.effect))
            .map((note) => note.text)
            .join(' · ')}
        </p>
      ) : null}

      {pending !== null ? (
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
      ) : null}
    </div>
  );
}
