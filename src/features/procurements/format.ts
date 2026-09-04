import { formatSatang } from '@/domain/money/money';
import { decimalStringToSatang } from '@/domain/money/money';
import type { ProcurementStatus } from '@/domain/procurement/status';

/** ป้ายสถานะภาษาไทย — ใช้ร่วมกันทุกหน้าเพื่อไม่ให้คำเรียกต่างกันในแต่ละหน้า */
export const STATUS_LABELS_TH: Readonly<Record<ProcurementStatus, string>> = {
  DRAFT: 'ฉบับร่าง',
  PENDING_REVIEW: 'รอตรวจสอบ',
  NEEDS_REVISION: 'ส่งกลับให้แก้',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  ISSUED: 'ออกเอกสารแล้ว',
  PARTIALLY_RECEIVED: 'รับบางส่วน',
  RECEIVED: 'รับครบแล้ว',
  CANCELLED: 'ยกเลิก',
};

/**
 * สีของป้ายสถานะ
 *
 * ไม่ใช้สีเป็นตัวสื่อความหมายเพียงอย่างเดียว — ทุกป้ายมีข้อความกำกับเสมอ
 * เพื่อให้ผู้ที่แยกสีไม่ได้ยังอ่านสถานะได้ (ข้อ 12.4)
 */
export const STATUS_CLASSES: Readonly<Record<ProcurementStatus, string>> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  PENDING_REVIEW: 'bg-amber-100 text-amber-900',
  NEEDS_REVISION: 'bg-orange-100 text-orange-900',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-900',
  APPROVED: 'bg-emerald-100 text-emerald-900',
  REJECTED: 'bg-rose-100 text-rose-900',
  ISSUED: 'bg-sky-100 text-sky-900',
  PARTIALLY_RECEIVED: 'bg-sky-100 text-sky-900',
  RECEIVED: 'bg-emerald-100 text-emerald-900',
  CANCELLED: 'bg-slate-200 text-slate-600',
};

/** แสดงจำนวนเงินจากค่าที่ฐานข้อมูลส่งมาเป็นข้อความทศนิยม */
export function formatBaht(decimal: string): string {
  return formatSatang(decimalStringToSatang(decimal));
}
