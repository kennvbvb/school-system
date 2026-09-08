import Link from 'next/link';
import type { ValidationRow } from '@/server/procurement/repository';

/**
 * สรุปผลตรวจกฎที่หน้ารายละเอียด (แผน PR-03 "validation summary ที่หน้า detail")
 *
 * ผลที่แสดงมาจาก RPC ตัวเดียวกับที่ระบบใช้บังคับตอนกดส่ง จึงไม่มีทางที่หน้าจอ
 * จะบอกว่าผ่านแล้ว server ปฏิเสธ
 *
 * แต่ละข้อมีลิงก์กลับไปที่ฟอร์มพร้อม anchor ของช่องที่ผิด ตามเกณฑ์ตรวจรับ
 * "ข้อผิดพลาดแสดงภาษาไทยพร้อม field link"
 */

const SEVERITY_STYLES = {
  ERROR: {
    box: 'border-rose-300 bg-rose-50 text-rose-900',
    labelTh: 'ต้องแก้',
    chip: 'bg-rose-200 text-rose-900',
  },
  WARNING: {
    box: 'border-amber-300 bg-amber-50 text-amber-900',
    labelTh: 'ควรตรวจ',
    chip: 'bg-amber-200 text-amber-900',
  },
  INFO: {
    box: 'border-sky-300 bg-sky-50 text-sky-900',
    labelTh: 'ข้อมูล',
    chip: 'bg-sky-200 text-sky-900',
  },
} as const;

export function ValidationSummary({
  findings,
  procurementId,
  canEdit,
}: {
  findings: readonly ValidationRow[];
  procurementId: string;
  canEdit: boolean;
}) {
  if (findings.length === 0) {
    return (
      <p className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-900">
        ตรวจแล้วไม่พบข้อที่ต้องแก้ — ส่งอนุมัติได้
      </p>
    );
  }

  const errors = findings.filter((finding) => finding.severity === 'ERROR');

  return (
    <div className="space-y-3">
      <p
        role="status"
        className={`rounded-md border px-4 py-3 ${
          errors.length > 0 ? SEVERITY_STYLES.ERROR.box : SEVERITY_STYLES.WARNING.box
        }`}
      >
        {errors.length > 0
          ? `มีข้อที่ต้องแก้ ${errors.length} ข้อก่อนส่งอนุมัติ`
          : 'ไม่มีข้อที่ต้องแก้ แต่มีข้อที่ควรตรวจก่อนส่ง'}
      </p>

      <ul className="space-y-2">
        {findings.map((finding, index) => {
          const style = SEVERITY_STYLES[finding.severity];

          return (
            <li
              key={`${finding.ruleCode}-${finding.field ?? ''}-${index}`}
              className={`rounded-md border px-4 py-3 ${style.box}`}
            >
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${style.chip}`}
                >
                  {style.labelTh}
                </span>
                <span className="flex-1">{finding.message}</span>
              </div>

              {finding.field && canEdit ? (
                <Link
                  href={{ pathname: `/procurements/${procurementId}/edit` }}
                  className="mt-1 inline-block text-sm underline underline-offset-2"
                >
                  ไปที่ช่องที่ต้องแก้
                </Link>
              ) : null}

              {/*
                แสดงรหัสกฎไว้ด้วย เพราะผู้ใช้ที่โทรถามผู้ดูแลจะอ้างรหัสได้ตรงกัน
                และรหัสเป็นสิ่งเดียวกับที่บันทึกไว้ใน procurement_validations
              */}
              <p className="mt-1 font-mono text-xs opacity-70">{finding.ruleCode}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
