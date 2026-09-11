import { formatThaiDateTime } from '@/lib/format/thai-date';
import { ACTION_LABELS_TH, STATUS_LABELS_TH } from './format';
import type { ApprovalStep } from '@/server/procurement/repository';

/**
 * ประวัติการดำเนินการตามสายอนุมัติ
 *
 * แสดงชื่อ บทบาท และตำแหน่งจากค่าที่บันทึกไว้ ณ เวลาที่กด ไม่ใช่ค่าปัจจุบันของผู้ใช้
 * — ครูที่ย้ายไปเป็นรองผู้อำนวยการต้องยังปรากฏเป็น "ครู" ในเอกสารที่อนุมัติตอนนั้น
 */
export function ApprovalHistory({ steps }: { steps: readonly ApprovalStep[] }) {
  if (steps.length === 0) {
    return <p className="text-slate-600">ยังไม่มีการดำเนินการ</p>;
  }

  return (
    <ol className="space-y-3">
      {steps.map((step) => (
        <li key={step.stepNo} className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="font-medium">
              {step.stepNo}. {ACTION_LABELS_TH[step.action]}
              <span className="ml-2 font-normal text-slate-600">
                {STATUS_LABELS_TH[step.fromStatus]} → {STATUS_LABELS_TH[step.toStatus]}
              </span>
            </p>
            <p className="text-slate-600">
              <time dateTime={step.actedAt}>{formatThaiDateTime(new Date(step.actedAt))}</time>
            </p>
          </div>

          <p className="mt-1 text-slate-700">
            {step.actorNameTh}
            {step.actorPositionTh ? ` — ${step.actorPositionTh}` : null}
            <span className="ml-2 font-mono text-xs text-slate-500">{step.actorRoleCode}</span>
          </p>

          {step.reason ? (
            <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 whitespace-pre-line text-slate-800">
              {step.reason}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
