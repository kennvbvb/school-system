import { formatSatang } from '@/domain/money/money';

export { formatSatang };

/**
 * ร้อยละการใช้งบจากหน่วยหนึ่งในหมื่น
 *
 * คืนขีดกลางเมื่อคิดไม่ได้ (ยังไม่ได้รับงบ) แทนที่จะแสดง 0%
 * ซึ่งอ่านได้ว่า "ได้งบมาแล้วแต่ยังไม่ได้ใช้" ทั้งที่ความจริงคือยังไม่มีงบ
 */
export function formatUtilization(basisPoints: number | null): string {
  if (basisPoints === null) return '—';
  return `${(basisPoints / 100).toFixed(1)}%`;
}

/** สีของแถบแสดงสัดส่วนการใช้งบ — เกิน 100% หมายถึงใช้เกินงบที่ได้รับ */
export function utilizationBarClass(basisPoints: number | null): string {
  if (basisPoints === null) return 'bg-slate-300';
  if (basisPoints > 10_000) return 'bg-rose-600';
  if (basisPoints >= 9_000) return 'bg-amber-500';
  return 'bg-sky-600';
}
