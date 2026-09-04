/**
 * การแสดงวันที่ไทยและปีพุทธศักราช (ข้อ 9.3)
 *
 * กติกา:
 *  - ฐานข้อมูลเก็บ timestamptz เป็น UTC เสมอ
 *  - การตีความ "วันที่ทางธุรกิจ" ใช้เขตเวลา Asia/Bangkok เท่านั้น
 *  - ห้ามอ่านเขตเวลาจาก browser มาออกเลขเอกสารหรือกำหนดวันที่ทางการ
 *  - ปีงบประมาณเป็น record ในตาราง fiscal_years ไม่ใช่ผลของ year + 543
 *    ฟังก์ชันในไฟล์นี้ใช้ "แสดงผล" เท่านั้น
 */

export const APP_TIME_ZONE = 'Asia/Bangkok';

/** ส่วนต่างระหว่างปีพุทธศักราชกับคริสต์ศักราช ใช้เพื่อการแสดงผลเท่านั้น */
export const BUDDHIST_ERA_OFFSET = 543;

export type EraPreference = 'BE' | 'CE';

const THAI_MONTHS_FULL = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

const THAI_MONTHS_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

export interface BangkokDateParts {
  year: number;
  /** เดือนแบบ 1-12 ไม่ใช่ 0-11 เพื่อลดความผิดพลาดเวลาอ่านโค้ด */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * แตกส่วนของ Date ตามเขตเวลา Asia/Bangkok
 *
 * ใช้ Intl แทนการบวก offset เอง เพื่อให้ถูกต้องแม้กฎเขตเวลาจะเปลี่ยนในอนาคต
 */
export function getBangkokParts(date: Date): BangkokDateParts {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('วันที่ไม่ถูกต้อง');
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const lookup = new Map<string, string>(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  const read = (type: string): number => Number(lookup.get(type) ?? '0');

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // Intl คืน "24" สำหรับเที่ยงคืนในบาง runtime — ปรับให้เป็น 0 ตามที่โค้ดอื่นคาดหวัง
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/** วันที่ทางธุรกิจในรูป YYYY-MM-DD ตามเวลาไทย ใช้เทียบกับคอลัมน์ชนิด date */
export function toBangkokDateString(date: Date): string {
  const { year, month, day } = getBangkokParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function toDisplayYear(gregorianYear: number, era: EraPreference): number {
  return era === 'BE' ? gregorianYear + BUDDHIST_ERA_OFFSET : gregorianYear;
}

export interface ThaiDateOptions {
  era?: EraPreference;
  month?: 'full' | 'short';
}

/** จัดรูปแบบวันที่ไทย เช่น "3 กันยายน 2569" — ใช้ฟังก์ชันนี้ที่เดียวทั้งระบบ */
export function formatThaiDate(date: Date, options: ThaiDateOptions = {}): string {
  const { era = 'BE', month = 'full' } = options;
  const parts = getBangkokParts(date);
  const monthNames = month === 'full' ? THAI_MONTHS_FULL : THAI_MONTHS_SHORT;
  const monthName = monthNames[parts.month - 1] ?? '';

  return `${parts.day} ${monthName} ${toDisplayYear(parts.year, era)}`;
}

/** จัดรูปแบบวันที่พร้อมเวลา เช่น "3 ก.ย. 2569 14:05 น." สำหรับ audit log และหน้ารายการ */
export function formatThaiDateTime(date: Date, options: ThaiDateOptions = {}): string {
  const parts = getBangkokParts(date);
  const datePart = formatThaiDate(date, { month: 'short', ...options });
  return `${datePart} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')} น.`;
}

/**
 * หาปีงบประมาณไทยจากวันที่ (ปีงบประมาณเริ่ม 1 ตุลาคม)
 *
 * ใช้เป็น "ค่าเสนอแนะ" ตอนสร้างรายการเท่านั้น ค่าที่มีผลจริงต้อง resolve
 * จากตาราง fiscal_years ซึ่งเก็บ start_date/end_date และสถานะเปิด-ปิดไว้
 */
export function suggestFiscalYearBE(date: Date): number {
  const { year, month } = getBangkokParts(date);
  const gregorianFiscalYear = month >= 10 ? year + 1 : year;
  return gregorianFiscalYear + BUDDHIST_ERA_OFFSET;
}
