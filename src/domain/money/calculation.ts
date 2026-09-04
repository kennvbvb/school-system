/**
 * กฎการคำนวณยอดของรายการจัดซื้อ/จัดจ้าง (ข้อ 9.1, FR-PR-005, FR-PR-006)
 *
 * ลำดับการคำนวณที่ระบบใช้ (domain function เดียว ห้ามทำซ้ำที่อื่น):
 *   base (ก่อนส่วนลด ไม่รวมภาษี)
 *     → discount
 *       → taxable amount (subtotal)
 *         → tax
 *           → line total
 *
 * ทุกบรรทัดรักษาเอกลักษณ์ lineTotal === lineSubtotal + lineTax เสมอ
 * และยอดรวมทั้งเอกสารเป็นผลบวกของบรรทัด จึงไม่มี rounding drift ระหว่างบรรทัดกับยอดรวม
 */
import {
  MoneyError,
  QUANTITY_SCALE,
  TAX_RATE_SCALE,
  UNIT_PRICE_SCALE,
  assertWithinRange,
  divideRoundHalfUp,
  parseScaled,
} from './money';

export type TaxMode = 'INCLUSIVE' | 'EXCLUSIVE' | 'EXEMPT';

export interface LineInput {
  /** ลำดับบรรทัด เริ่มที่ 1 ใช้อ้างอิงใน error message ให้ผู้ใช้แก้ได้ */
  lineNo: number;
  /** จำนวน — ทศนิยมไม่เกิน 4 ตำแหน่ง และต้องมากกว่า 0 (ข้อ 7.3) */
  quantity: string | number;
  /** ราคาต่อหน่วย — ทศนิยมไม่เกิน 4 ตำแหน่ง และต้องไม่ติดลบ */
  unitPrice: string | number;
  /** ส่วนลดของบรรทัด เป็นบาททศนิยม 2 ตำแหน่ง ตีความตาม taxMode เดียวกับราคา */
  discountAmount?: string | number;
  /** อัตราภาษีเป็นเปอร์เซ็นต์ เช่น "7" คือ 7% */
  taxRate?: string | number;
}

export interface LineAmounts {
  lineNo: number;
  /** ยอดก่อนส่วนลด ไม่รวมภาษี (หน่วยสตางค์) */
  base: bigint;
  /** ส่วนลดที่ปรับเป็นฐานไม่รวมภาษีแล้ว (หน่วยสตางค์) */
  discount: bigint;
  /** ฐานภาษี = base - discount (หน่วยสตางค์) */
  lineSubtotal: bigint;
  lineTax: bigint;
  /** lineSubtotal + lineTax (หน่วยสตางค์) */
  lineTotal: bigint;
}

export interface DocumentAmounts {
  lines: LineAmounts[];
  subtotal: bigint;
  discountTotal: bigint;
  taxTotal: bigint;
  /** subtotal - discountTotal + taxTotal (หน่วยสตางค์) */
  grandTotal: bigint;
}

/** ตัวหารสำหรับแปลง quantity(1e-4) × unitPrice(1e-4) ให้เป็นสตางค์(1e-2) */
const QUANTITY_PRICE_DIVISOR = 10n ** (QUANTITY_SCALE + UNIT_PRICE_SCALE - 2n);
/** 100% แสดงในหน่วย scale ของอัตราภาษี */
const TAX_RATE_ONE_HUNDRED = 100n * 10n ** TAX_RATE_SCALE;

export function calculateLine(input: LineInput, taxMode: TaxMode): LineAmounts {
  const { lineNo } = input;
  const quantity = parseScaled(input.quantity, QUANTITY_SCALE);
  const unitPrice = parseScaled(input.unitPrice, UNIT_PRICE_SCALE);
  const discountInput = parseScaled(input.discountAmount ?? 0, 2n);
  const taxRate = taxMode === 'EXEMPT' ? 0n : parseScaled(input.taxRate ?? 0, TAX_RATE_SCALE);

  if (quantity <= 0n) {
    throw new MoneyError(`บรรทัดที่ ${lineNo}: จำนวนต้องมากกว่า 0`);
  }
  if (unitPrice < 0n) {
    throw new MoneyError(`บรรทัดที่ ${lineNo}: ราคาต่อหน่วยต้องไม่ติดลบ`);
  }
  if (discountInput < 0n) {
    throw new MoneyError(`บรรทัดที่ ${lineNo}: ส่วนลดต้องไม่ติดลบ`);
  }
  if (taxRate < 0n) {
    throw new MoneyError(`บรรทัดที่ ${lineNo}: อัตราภาษีต้องไม่ติดลบ`);
  }

  const gross = divideRoundHalfUp(quantity * unitPrice, QUANTITY_PRICE_DIVISOR);

  if (discountInput > gross) {
    throw new MoneyError(`บรรทัดที่ ${lineNo}: ส่วนลดมากกว่ายอดของบรรทัด`);
  }

  const amounts = applyTax({ lineNo, gross, discount: discountInput, taxRate, taxMode });

  assertWithinRange(amounts.lineTotal, `บรรทัดที่ ${lineNo}`);
  return amounts;
}

function applyTax(args: {
  lineNo: number;
  /** ยอด quantity × unitPrice ตามโหมดที่ผู้ใช้กรอก (INCLUSIVE = รวมภาษีแล้ว) */
  gross: bigint;
  discount: bigint;
  taxRate: bigint;
  taxMode: TaxMode;
}): LineAmounts {
  const { lineNo, gross, discount, taxRate, taxMode } = args;

  if (taxMode === 'EXEMPT' || taxRate === 0n) {
    const lineSubtotal = gross - discount;
    return {
      lineNo,
      base: gross,
      discount,
      lineSubtotal,
      lineTax: 0n,
      lineTotal: lineSubtotal,
    };
  }

  if (taxMode === 'EXCLUSIVE') {
    const lineSubtotal = gross - discount;
    const lineTax = divideRoundHalfUp(lineSubtotal * taxRate, TAX_RATE_ONE_HUNDRED);
    return {
      lineNo,
      base: gross,
      discount,
      lineSubtotal,
      lineTax,
      lineTotal: lineSubtotal + lineTax,
    };
  }

  // INCLUSIVE: ราคาที่กรอกรวมภาษีแล้ว ต้องถอดภาษีออกก่อนจึงได้ฐานภาษี
  const divisor = TAX_RATE_ONE_HUNDRED + taxRate;
  const netInclusive = gross - discount;
  const lineSubtotal = divideRoundHalfUp(netInclusive * TAX_RATE_ONE_HUNDRED, divisor);
  const baseExclusive = divideRoundHalfUp(gross * TAX_RATE_ONE_HUNDRED, divisor);

  return {
    lineNo,
    base: baseExclusive,
    // หาย้อนกลับเพื่อให้ base - discount === lineSubtotal เสมอ ไม่เกิดเศษหลุด
    discount: baseExclusive - lineSubtotal,
    lineSubtotal,
    lineTax: netInclusive - lineSubtotal,
    lineTotal: netInclusive,
  };
}

export function calculateDocument(lines: LineInput[], taxMode: TaxMode): DocumentAmounts {
  if (lines.length === 0) {
    throw new MoneyError('ต้องมีรายการอย่างน้อย 1 บรรทัด');
  }

  const calculated = lines.map((line) => calculateLine(line, taxMode));

  const subtotal = calculated.reduce((sum, line) => sum + line.base, 0n);
  const discountTotal = calculated.reduce((sum, line) => sum + line.discount, 0n);
  const taxTotal = calculated.reduce((sum, line) => sum + line.lineTax, 0n);
  const grandTotal = subtotal - discountTotal + taxTotal;

  assertWithinRange(grandTotal, 'ยอดรวมทั้งเอกสาร');

  return { lines: calculated, subtotal, discountTotal, taxTotal, grandTotal };
}
