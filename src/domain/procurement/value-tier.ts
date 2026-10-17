/**
 * ขั้นวงเงินของการจัดซื้อจัดจ้าง — กำหนดว่ากฎของขั้นส่งอนุมัติเข้มแค่ไหน
 *
 * ที่มา (ตรวจจากข้อความต้นฉบับ ไม่ใช่เอกสารรอง):
 *
 * - ไม่เกิน 500,000 บาท ให้ใช้วิธีเฉพาะเจาะจง — กฎกระทรวงกำหนดวงเงินฯ พ.ศ. 2560 ข้อ 1
 * - ไม่เกิน 100,000 บาท ไม่ต้องทำข้อตกลงเป็นหนังสือ และตั้งผู้ตรวจรับคนเดียวได้
 *   — กฎกระทรวงเดียวกัน ข้อ 4 และข้อ 5
 * - **ซื้อ** ไม่เกิน 50,000 บาท รายงานขอซื้อมี 3 รายการ ผู้ซื้อตรวจรับได้ และรายงาน
 *   สรุปผลภายใน 5 วันทำการหลังซื้อ — ข่าวกรมบัญชีกลาง 52/2568 อ้างหนังสือ ว804
 *   ใช้ตั้งแต่ 1 ธ.ค. 2568 (ระดับ B: ยังไม่ได้อ่านตัวหนังสือ ว804 จึงใช้เฉพาะ
 *   "ซื้อ" ตามที่ข่าวระบุ ไม่ขยายไปงานจ้าง)
 * - ซื้อ/จ้างไปก่อนแล้วรายงานตามหลังได้เมื่อเร่งด่วนที่คาดไม่ได้ — ระเบียบ ข้อ 79 วรรคสอง
 *
 * ไฟล์นี้เป็นตรรกะบริสุทธิ์ ห้าม import Supabase หรือ Next.js
 * ค่าในไฟล์นี้ต้องตรงกับ `procurement_check_submit()` ในฐานข้อมูลเสมอ
 */

/** หน่วยสตางค์ (ADR 0005 ห้ามใช้ number กับเงิน) */
export const SIMPLIFIED_PURCHASE_LIMIT_SATANG = 5_000_000n;
export const SMALL_PROCUREMENT_LIMIT_SATANG = 10_000_000n;
export const SPECIFIC_METHOD_LIMIT_SATANG = 50_000_000n;

/** ว804: รายงานสรุปผลการซื้อต้องเสนอภายในกี่วันทำการนับถัดจากวันซื้อ */
export const BUY_FIRST_REPORT_DEADLINE_DAYS = 5;

export const VALUE_TIERS = ['UP_TO_50K', 'UP_TO_100K', 'UP_TO_500K', 'OVER_500K'] as const;
export type ValueTier = (typeof VALUE_TIERS)[number];

/** "ไม่เกิน" หมายถึงเท่ากับวงเงินยังอยู่ในขั้นนั้น */
export function valueTierOf(totalSatang: bigint): ValueTier {
  if (totalSatang <= SIMPLIFIED_PURCHASE_LIMIT_SATANG) return 'UP_TO_50K';
  if (totalSatang <= SMALL_PROCUREMENT_LIMIT_SATANG) return 'UP_TO_100K';
  if (totalSatang <= SPECIFIC_METHOD_LIMIT_SATANG) return 'UP_TO_500K';
  return 'OVER_500K';
}

/**
 * การซื้อที่ใช้ขั้นตอนย่อของ ว804 ได้หรือไม่
 *
 * เฉพาะ "ซื้อ" (GOODS) ไม่เกิน 50,000 บาท งานจ้างต้องทำรายงานเต็มตามข้อ 22
 */
export function isSimplifiedPurchase(
  tier: ValueTier,
  classification: string | null | undefined,
): boolean {
  return tier === 'UP_TO_50K' && classification === 'GOODS';
}

/**
 * ซื้อ/จ้างไปก่อนแล้วรายงานตามหลังได้หรือไม่
 *
 * ได้เมื่อเป็นกรณีเร่งด่วนที่ทำเครื่องหมายไว้ (ข้อ 79 วรรคสอง) หรือเป็นการซื้อ
 * ขั้นตอนย่อ (ว804) นอกนั้นลำดับ "อนุมัติก่อนสั่งซื้อ" ยังเป็นข้อบังคับ
 */
export function isBuyFirstAllowed(
  tier: ValueTier,
  classification: string | null | undefined,
  isEmergency: boolean,
): boolean {
  return isEmergency || isSimplifiedPurchase(tier, classification);
}

function toUtcDay(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000;
}

/**
 * จำนวนวันทำการ (จันทร์–ศุกร์) นับถัดจาก `from` จนถึงและรวม `to`
 *
 * **ไม่รู้วันหยุดราชการ** จึงนับวันหยุดนักขัตฤกษ์เป็นวันทำการ ผลที่ได้มากกว่าหรือเท่ากับ
 * จำนวนวันทำการจริงเสมอ ผู้เรียกจึงต้องใช้ผลนี้ออกเป็น "คำเตือน" ไม่ใช่ข้อบล็อก
 * มิฉะนั้นจะปฏิเสธรายการที่ทำถูกกำหนดเวลาจริงเพราะมีวันหยุดคั่น
 */
export function weekdaysAfter(from: string, to: string): number {
  const start = toUtcDay(from);
  const end = toUtcDay(to);
  let count = 0;
  for (let day = start + 1; day <= end; day += 1) {
    // 1970-01-01 เป็นวันพฤหัสบดี → (day + 3) % 7: 0 = จันทร์ ... 4 = ศุกร์ 5 = เสาร์ 6 = อาทิตย์
    const weekday = (day + 3) % 7;
    if (weekday < 5) count += 1;
  }
  return count;
}
