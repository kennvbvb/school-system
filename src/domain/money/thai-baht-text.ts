/**
 * แปลงจำนวนเงินเป็นตัวอักษรภาษาไทย (FR-PR-007, ข้อ 9.2)
 *
 * เป็น pure function รับหน่วยสตางค์เท่านั้น ค่าใน PDF ต้องสร้างจากยอดสุทธิที่บันทึกไว้
 * ห้ามรับข้อความที่ผู้ใช้พิมพ์เอง เว้นแต่เป็น override ที่เก็บเหตุผลไว้แล้ว
 *
 * ข้อความที่ผลิตต้องให้เจ้าหน้าที่พัสดุของโรงเรียนรับรองก่อนใช้จริง
 * ดู docs/assumptions.md หัวข้อ "จำนวนเงินภาษาไทย" สำหรับกรณีที่ยังต้องยืนยัน
 */
import { MAX_SATANG, MoneyError } from './money';

const THAI_DIGITS = [
  'ศูนย์',
  'หนึ่ง',
  'สอง',
  'สาม',
  'สี่',
  'ห้า',
  'หก',
  'เจ็ด',
  'แปด',
  'เก้า',
] as const;

/** ชื่อหลักภายในกลุ่ม 6 หลัก โดย index 0 คือหลักหน่วย */
const THAI_PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'] as const;

/**
 * อ่านกลุ่มตัวเลขไม่เกิน 6 หลัก
 *
 * @param hasHigherDigits มีหลักที่สูงกว่ากลุ่มนี้ซึ่งไม่เป็นศูนย์หรือไม่
 *   ใช้ตัดสินว่าหลักหน่วยที่เป็น 1 ต้องอ่านว่า "เอ็ด" (เช่น 101 = หนึ่งร้อยเอ็ด)
 */
function readGroup(group: string, hasHigherDigits: boolean): string {
  let out = '';
  const length = group.length;

  for (let index = 0; index < length; index += 1) {
    const digit = Number(group[index]);
    const place = length - index - 1;

    if (digit === 0) continue;

    if (place === 0) {
      out += digit === 1 && (hasHigherDigits || out !== '') ? 'เอ็ด' : THAI_DIGITS[digit];
    } else if (place === 1) {
      if (digit === 1) out += 'สิบ';
      else if (digit === 2) out += 'ยี่สิบ';
      else out += `${THAI_DIGITS[digit]}สิบ`;
    } else {
      out += `${THAI_DIGITS[digit]}${THAI_PLACES[place]}`;
    }
  }

  return out;
}

/** อ่านจำนวนเต็มบวกที่อยู่ในรูปข้อความตัวเลข โดยรองรับ "ล้าน" ซ้อนหลายชั้น */
function readInteger(digits: string): string {
  const normalized = digits.replace(/^0+(?=\d)/, '');

  if (normalized === '0') return THAI_DIGITS[0];
  if (normalized.length <= 6) return readGroup(normalized, false);

  const head = normalized.slice(0, normalized.length - 6);
  const tail = normalized.slice(normalized.length - 6);

  return `${readInteger(head)}ล้าน${readGroup(tail, true)}`;
}

/**
 * แปลงจำนวนเงินหน่วยสตางค์เป็นข้อความภาษาไทย
 *
 * ตัวอย่าง:
 *   0        -> "ศูนย์บาทถ้วน"
 *   100      -> "หนึ่งบาทถ้วน"
 *   2125     -> "ยี่สิบเอ็ดบาทยี่สิบห้าสตางค์"
 *   -50      -> "ลบศูนย์บาทห้าสิบสตางค์"
 */
export function satangToThaiBahtText(satang: bigint): string {
  const abs = satang < 0n ? -satang : satang;

  if (abs > MAX_SATANG) {
    throw new MoneyError('จำนวนเงินเกินเพดานที่ระบบแปลงเป็นตัวอักษรได้');
  }

  const baht = abs / 100n;
  const remainder = abs % 100n;

  const bahtText = `${readInteger(baht.toString())}บาท`;
  const satangText =
    remainder === 0n ? 'ถ้วน' : `${readGroup(remainder.toString().padStart(2, '0'), false)}สตางค์`;

  return `${satang < 0n ? 'ลบ' : ''}${bahtText}${satangText}`;
}
