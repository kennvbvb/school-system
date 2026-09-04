/**
 * โมดูลกลางสำหรับจำนวนเงิน (ข้อ 9.1)
 *
 * กติกาที่ใช้ทั้งระบบ:
 *  - จำนวนเงินทุกค่าในโดเมนเป็น "จำนวนเต็มหน่วยสตางค์" (satang) เท่านั้น
 *  - การคำนวณระหว่างทางใช้ BigInt ทั้งหมด ไม่ใช้ floating point
 *  - ฐานข้อมูลเก็บเป็น numeric(18,2) และแปลงที่ขอบเขต repository เท่านั้น
 *  - ห้ามมี logic คำนวณเงินซ้ำที่อื่น ทั้งหน้าจอ, PDF และรายงานต้องเรียกจากที่นี่
 */

/** ความละเอียดของจำนวน (quantity) = 4 ตำแหน่งทศนิยม ตาม numeric(18,4) */
export const QUANTITY_SCALE = 4n;
/** ความละเอียดของราคาต่อหน่วย = 4 ตำแหน่งทศนิยม ตาม numeric(18,4) */
export const UNIT_PRICE_SCALE = 4n;
/** ความละเอียดของอัตราภาษี (เปอร์เซ็นต์) = 4 ตำแหน่งทศนิยม ตาม numeric(7,4) */
export const TAX_RATE_SCALE = 4n;

/** เพดานจำนวนเงินที่ระบบรองรับ = 999,999,999,999.99 บาท (หน่วยสตางค์) */
export const MAX_SATANG = 99_999_999_999_999n;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * ปัดเศษแบบครึ่งขึ้นออกจากศูนย์ (HALF_UP away from zero) สำหรับการหาร BigInt
 *
 * ตัวอย่าง: 2.5 -> 3, -2.5 -> -3
 * กฎนี้เป็นกฎเดียวของระบบ หากโรงเรียนใช้กฎอื่นต้องแก้ที่ฟังก์ชันนี้จุดเดียว
 * และรันชุดทดสอบใหม่ทั้งหมด (ดู docs/assumptions.md ข้อการปัดเศษ)
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new MoneyError('หารด้วยศูนย์ไม่ได้');
  }

  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}

/**
 * แปลงข้อความตัวเลขทศนิยมเป็นจำนวนเต็มที่ scale แล้ว โดยไม่ผ่าน floating point
 *
 * รับได้ทั้ง string และ number แต่ string เป็นทางที่ปลอดภัยกว่าเสมอ
 * ทศนิยมที่เกิน scale ที่กำหนดถือเป็นข้อมูลผิด ไม่ปัดให้เงียบ ๆ
 */
export function parseScaled(value: string | number, scale: bigint): bigint {
  const raw = typeof value === 'number' ? numberToDecimalString(value) : value.trim();

  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new MoneyError(`รูปแบบตัวเลขไม่ถูกต้อง: ${raw}`);
  }

  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [intPart = '0', fracPart = ''] = unsigned.split('.');
  const scaleNumber = Number(scale);

  if (fracPart.length > scaleNumber) {
    throw new MoneyError(
      `ทศนิยมเกิน ${scaleNumber} ตำแหน่งที่ระบบรองรับ: ${raw} — กรุณาปัดเศษก่อนส่งเข้าระบบ`,
    );
  }

  const padded = fracPart.padEnd(scaleNumber, '0');
  const magnitude = BigInt(intPart + padded);

  return negative ? -magnitude : magnitude;
}

function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new MoneyError('ตัวเลขต้องเป็นค่าจำกัด');
  }
  // ป้องกัน exponential notation เช่น 1e-7 ที่ regex ด้านบนจะปฏิเสธ
  return value.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

/** แปลงจำนวนเต็มหน่วยสตางค์เป็นข้อความบาททศนิยม 2 ตำแหน่ง เช่น 123456n -> "1234.56" */
export function satangToDecimalString(satang: bigint): string {
  const negative = satang < 0n;
  const abs = negative ? -satang : satang;
  const baht = abs / 100n;
  const remainder = abs % 100n;
  const text = `${baht}.${remainder.toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/** แปลงข้อความบาท (จาก numeric(18,2) ของฐานข้อมูล) เป็นจำนวนเต็มหน่วยสตางค์ */
export function decimalStringToSatang(value: string | number): bigint {
  return parseScaled(value, 2n);
}

/** จัดรูปแบบเงินสำหรับแสดงผลและใส่ใน PDF — ต้องใช้ฟังก์ชันนี้ที่เดียวทั้งระบบ */
export function formatSatang(satang: bigint): string {
  const negative = satang < 0n;
  const abs = negative ? -satang : satang;
  const baht = abs / 100n;
  const remainder = abs % 100n;
  const grouped = baht.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${remainder.toString().padStart(2, '0')}`;
}

export function assertWithinRange(satang: bigint, label: string): void {
  const abs = satang < 0n ? -satang : satang;
  if (abs > MAX_SATANG) {
    throw new MoneyError(`${label} เกินเพดานจำนวนเงินที่ระบบรองรับ`);
  }
}
