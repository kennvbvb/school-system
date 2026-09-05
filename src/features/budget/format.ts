import { formatSatang, decimalStringToSatang } from '@/domain/money/money';
import { MOVEMENT_TYPE_LABELS_TH } from '@/domain/budget/movement';
import type { MovementType } from '@/domain/budget/movement';

export { MOVEMENT_TYPE_LABELS_TH };

/** แสดงจำนวนเงินจากค่าที่ฐานข้อมูลส่งมาเป็นข้อความทศนิยม */
export function formatBaht(decimal: string): string {
  return formatSatang(decimalStringToSatang(decimal));
}

/**
 * สีของป้ายชนิดรายการ แบ่งตามผลที่มีต่อยอดที่ใช้ได้
 *
 * สีไม่ใช่ตัวสื่อความหมายเพียงอย่างเดียว — ทุกป้ายมีข้อความภาษาไทยกำกับเสมอ
 * เพื่อให้ผู้ที่แยกสีไม่ได้ยังอ่านได้ (ข้อ 12.4)
 */
export const MOVEMENT_TYPE_CLASSES: Readonly<Record<MovementType, string>> = {
  ALLOCATION: 'bg-emerald-100 text-emerald-900',
  INCREASE: 'bg-emerald-100 text-emerald-900',
  TRANSFER_IN: 'bg-emerald-100 text-emerald-900',
  RELEASE: 'bg-emerald-100 text-emerald-900',
  DECREASE: 'bg-amber-100 text-amber-900',
  TRANSFER_OUT: 'bg-amber-100 text-amber-900',
  RESERVE: 'bg-sky-100 text-sky-900',
  COMMIT: 'bg-sky-100 text-sky-900',
  ACTUAL: 'bg-slate-200 text-slate-800',
  REVERSAL: 'bg-rose-100 text-rose-900',
};

/** สถานะบัญชีงบ */
export const ACCOUNT_STATUS_LABELS_TH: Readonly<Record<'OPEN' | 'CLOSED', string>> = {
  OPEN: 'เปิดใช้งาน',
  CLOSED: 'ปิดแล้ว',
};
