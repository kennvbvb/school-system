import { STOCK_MOVEMENT_TYPE_LABELS_TH } from '@/domain/inventory/movement';
import type { StockMovementType } from '@/domain/inventory/movement';

export { STOCK_MOVEMENT_TYPE_LABELS_TH };

/** แสดงจำนวนจากค่าที่ฐานข้อมูลส่งมาเป็นข้อความทศนิยม พร้อมคั่นหลักพัน */
export function formatQuantity(decimal: string): string {
  const negative = decimal.trim().startsWith('-');
  const abs = negative ? decimal.trim().slice(1) : decimal.trim();
  const [whole = '0', frac = ''] = abs.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = frac ? `${grouped}.${frac}` : grouped;
  return negative ? `-${text}` : text;
}

/**
 * สีของป้ายชนิดรายการ แบ่งตามผลที่มีต่อยอดคงเหลือ (เหตุผลเดียวกับ budget)
 * สีไม่ใช่ตัวสื่อความหมายเพียงอย่างเดียว — ทุกป้ายมีข้อความภาษาไทยกำกับเสมอ
 */
export const STOCK_MOVEMENT_TYPE_CLASSES: Readonly<Record<StockMovementType, string>> = {
  OPENING_BALANCE: 'bg-slate-200 text-slate-800',
  RECEIPT: 'bg-emerald-100 text-emerald-900',
  RETURN: 'bg-emerald-100 text-emerald-900',
  ADJUSTMENT_INCREASE: 'bg-sky-100 text-sky-900',
  ISSUE: 'bg-amber-100 text-amber-900',
  ADJUSTMENT_DECREASE: 'bg-amber-100 text-amber-900',
  REVERSAL: 'bg-rose-100 text-rose-900',
};

export const ITEM_STATUS_LABELS_TH: Readonly<Record<'ACTIVE' | 'INACTIVE', string>> = {
  ACTIVE: 'ใช้งานอยู่',
  INACTIVE: 'ปิดใช้งานแล้ว',
};
