/**
 * ชนิดของรายการเคลื่อนไหวคลังพัสดุ และผลที่แต่ละชนิดมีต่อยอดคงเหลือ
 *
 * ออกแบบตาม docs/CONTINUATION_PLAN.md ข้อ 6.8 — ledger เป็น append-only
 * ยอดคงเหลือเป็นผลของแถวล่าสุด ไม่ใช่คอลัมน์ที่ update ทับได้ เหตุผลเดียวกับ
 * budget ledger (ข้อค้นพบ F-01): คอลัมน์ที่แก้ได้โดยไม่มีร่องรอยตรวจสอบไม่ได้
 *
 * ต่างจากงบประมาณตรงที่ยอดคงเหลือติดลบไม่ได้เลยไม่ว่าจะมีสิทธิ์ใด — ของจริง
 * ที่ไม่มีอยู่เบิกออกไปไม่ได้จริง ไม่ใช่ข้อจำกัดเชิงนโยบายที่ override ได้แบบยอดงบ
 *
 * ไฟล์นี้เป็นตรรกะบริสุทธิ์ ห้าม import Supabase หรือ Next.js
 */
import { MoneyError, parseScaled } from '@/domain/money/money';

/** ทศนิยม 3 ตำแหน่ง ตรงกับ numeric(18,3) ของ stock_movements.quantity */
export const QUANTITY_SCALE = 3n;

/** เพดานจำนวนที่ระบบรองรับต่อแถว กันตัวเลขหลุดขอบเขตจากการกรอกผิด */
export const MAX_QUANTITY_UNITS = 999_999_999_999n * 1000n;

export const STOCK_MOVEMENT_TYPES = [
  /** ยอดยกมา — ลงได้ครั้งเดียวก่อนมีรายการเคลื่อนไหวอื่นของรายการนั้น */
  'OPENING_BALANCE',
  /** รับเข้า เช่น รับจากการจัดซื้อ */
  'RECEIPT',
  /** เบิกจ่ายออก ต้องมีผู้เบิกและผู้อนุมัติเสมอ */
  'ISSUE',
  /** รับคืน เช่น เบิกไปแล้วไม่ได้ใช้ */
  'RETURN',
  /** ปรับยอดเพิ่ม เช่น นับสต็อกแล้วได้มากกว่าบัญชี */
  'ADJUSTMENT_INCREASE',
  /** ปรับยอดลด เช่น นับสต็อกแล้วได้น้อยกว่าบัญชี ของชำรุด/สูญหาย */
  'ADJUSTMENT_DECREASE',
  /** ย้อนรายการที่ลงผิด — ห้าม update หรือ delete แถวเดิม */
  'REVERSAL',
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_TYPE_LABELS_TH: Readonly<Record<StockMovementType, string>> = {
  OPENING_BALANCE: 'ยอดยกมา',
  RECEIPT: 'รับเข้า',
  ISSUE: 'เบิกจ่าย',
  RETURN: 'รับคืน',
  ADJUSTMENT_INCREASE: 'ปรับยอดเพิ่ม',
  ADJUSTMENT_DECREASE: 'ปรับยอดลด',
  REVERSAL: 'ย้อนรายการ',
};

/**
 * ทิศทางของแต่ละชนิดที่มีต่อยอดคงเหลือ
 *
 * เพิ่ม = ทำให้ยอดคงเหลือมากขึ้น · ลด = ทำให้น้อยลง
 *
 * REVERSAL ไม่มีทิศทางของตัวเอง ทิศทางขึ้นกับแถวที่มันย้อน จึงต้องอ่านจาก
 * reversesMovementId เสมอ (resolveDirection ด้านล่าง)
 */
export type StockMovementDirection = 'INCREASE' | 'DECREASE';

const DIRECTIONS: Readonly<Record<Exclude<StockMovementType, 'REVERSAL'>, StockMovementDirection>> =
  {
    OPENING_BALANCE: 'INCREASE',
    RECEIPT: 'INCREASE',
    RETURN: 'INCREASE',
    ADJUSTMENT_INCREASE: 'INCREASE',
    ISSUE: 'DECREASE',
    ADJUSTMENT_DECREASE: 'DECREASE',
  };

export function isStockMovementType(value: string): value is StockMovementType {
  return (STOCK_MOVEMENT_TYPES as readonly string[]).includes(value);
}

export class StockMovementError extends Error {
  readonly code:
    | 'QUANTITY_NOT_POSITIVE'
    | 'QUANTITY_OUT_OF_RANGE'
    | 'REFERENCE_REQUIRED'
    | 'REVERSAL_TARGET_REQUIRED'
    | 'REVERSAL_TARGET_UNKNOWN'
    | 'REVERSAL_OF_REVERSAL'
    | 'REVERSAL_ALREADY_DONE'
    | 'ISSUE_ACTORS_REQUIRED'
    | 'ADJUSTMENT_REASON_REQUIRED'
    | 'OPENING_BALANCE_NOT_FIRST'
    | 'BALANCE_WOULD_GO_NEGATIVE';

  constructor(code: StockMovementError['code'], message: string) {
    super(message);
    this.name = 'StockMovementError';
    this.code = code;
  }
}

/** แปลงข้อความจำนวน (จาก numeric(18,3) ของฐานข้อมูล หรือฟอร์ม) เป็นหน่วยที่ 3 ตำแหน่งทศนิยม */
export function decimalStringToQuantityUnits(value: string | number): bigint {
  return parseScaled(value, QUANTITY_SCALE);
}

/** แปลงจำนวนเต็มหน่วย 3 ตำแหน่งทศนิยมกลับเป็นข้อความ เช่น 1500n -> "1.500" */
export function quantityUnitsToDecimalString(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const scale = 10n ** QUANTITY_SCALE;
  const whole = abs / scale;
  const remainder = abs % scale;
  const text = `${whole}.${remainder.toString().padStart(Number(QUANTITY_SCALE), '0')}`;
  return negative ? `-${text}` : text;
}

export function assertQuantityValid(units: bigint, label = 'จำนวน'): void {
  if (units <= 0n) {
    throw new StockMovementError('QUANTITY_NOT_POSITIVE', `${label}ต้องมากกว่าศูนย์`);
  }
  if (units > MAX_QUANTITY_UNITS) {
    throw new MoneyError(`${label}เกินช่วงที่ระบบรองรับ`);
  }
}

/** แถวหนึ่งใน ledger — ใช้ในการตรวจรูปแบบและคิดยอดฝั่งโดเมน (ไม่ใช่ชนิดที่เก็บในฐานข้อมูลตรง ๆ) */
export interface StockMovement {
  id: string;
  type: StockMovementType;
  /** หน่วยที่ 3 ตำแหน่งทศนิยม เป็นบวกเสมอ */
  quantityUnits: bigint;
  effectiveDate: string;
  reference: string;
  reason?: string | null;
  requestedBy?: string | null;
  approvedBy?: string | null;
  reversesMovementId?: string | null;
}

/** ทำ index จาก id เพื่อให้ resolveDirection ไล่ REVERSAL ได้ */
export function indexStockMovements(
  movements: readonly StockMovement[],
): ReadonlyMap<string, StockMovement> {
  return new Map(movements.map((movement) => [movement.id, movement]));
}

/**
 * ทิศทางที่แท้จริงของแถวหนึ่ง โดยไล่ตาม REVERSAL ไปยังแถวต้นทาง
 */
export function resolveStockDirection(
  movement: StockMovement,
  byId: ReadonlyMap<string, StockMovement>,
): StockMovementDirection {
  if (movement.type !== 'REVERSAL') {
    return DIRECTIONS[movement.type];
  }

  if (!movement.reversesMovementId) {
    throw new StockMovementError('REVERSAL_TARGET_REQUIRED', 'รายการย้อนต้องระบุว่าย้อนรายการใด');
  }

  const target = byId.get(movement.reversesMovementId);
  if (!target) {
    throw new StockMovementError(
      'REVERSAL_TARGET_UNKNOWN',
      'ไม่พบรายการต้นทางที่รายการย้อนอ้างถึง',
    );
  }

  if (target.type === 'REVERSAL') {
    throw new StockMovementError('REVERSAL_OF_REVERSAL', 'ย้อนรายการย้อนอีกชั้นไม่ได้');
  }

  return DIRECTIONS[target.type] === 'INCREASE' ? 'DECREASE' : 'INCREASE';
}

/** ผลของแถวหนึ่งต่อยอดคงเหลือ เป็นจำนวนมีเครื่องหมาย */
export function signedStockEffect(
  movement: StockMovement,
  byId: ReadonlyMap<string, StockMovement>,
): bigint {
  return resolveStockDirection(movement, byId) === 'INCREASE'
    ? movement.quantityUnits
    : -movement.quantityUnits;
}

/**
 * ตรวจความถูกต้องเชิงรูปแบบของแถวเดียว ก่อนนำไปคิดยอด
 *
 * แยกจากการตรวจยอดคงเหลือ (balance.ts) เพราะคนละเรื่องกัน: ที่นี่ถามว่า
 * "แถวนี้เขียนถูกไหม" ไม่ใช่ "ลงแถวนี้แล้วยอดคงเหลือติดลบไหม"
 */
export function assertStockMovementShapeValid(
  movement: StockMovement,
  existing: readonly StockMovement[] = [],
): void {
  assertQuantityValid(movement.quantityUnits);

  if (!movement.reference || movement.reference.trim() === '') {
    throw new StockMovementError('REFERENCE_REQUIRED', 'ต้องระบุเลขที่เอกสารอ้างอิงทุกครั้ง');
  }

  if (movement.type === 'OPENING_BALANCE' && existing.length > 0) {
    throw new StockMovementError(
      'OPENING_BALANCE_NOT_FIRST',
      'ลงยอดยกมาได้เฉพาะครั้งแรกก่อนมีรายการเคลื่อนไหวอื่น',
    );
  }

  if (movement.type === 'ISSUE' && (!movement.requestedBy || !movement.approvedBy)) {
    throw new StockMovementError(
      'ISSUE_ACTORS_REQUIRED',
      'การเบิกจ่ายต้องระบุทั้งผู้เบิกและผู้อนุมัติ',
    );
  }

  if (
    (movement.type === 'ADJUSTMENT_INCREASE' || movement.type === 'ADJUSTMENT_DECREASE') &&
    (!movement.reason || movement.reason.trim() === '' || !movement.approvedBy)
  ) {
    throw new StockMovementError(
      'ADJUSTMENT_REASON_REQUIRED',
      'การปรับยอดต้องระบุเหตุผลและผู้อนุมัติเสมอ',
    );
  }

  if (movement.type === 'REVERSAL') {
    if (!movement.reversesMovementId) {
      throw new StockMovementError('REVERSAL_TARGET_REQUIRED', 'รายการย้อนต้องระบุว่าย้อนรายการใด');
    }

    const target = existing.find((row) => row.id === movement.reversesMovementId);
    if (target && target.type === 'REVERSAL') {
      throw new StockMovementError('REVERSAL_OF_REVERSAL', 'ย้อนรายการย้อนอีกชั้นไม่ได้');
    }

    const alreadyReversed = existing.some(
      (row) => row.type === 'REVERSAL' && row.reversesMovementId === movement.reversesMovementId,
    );
    if (alreadyReversed) {
      throw new StockMovementError(
        'REVERSAL_ALREADY_DONE',
        'รายการนี้ถูกย้อนไปแล้ว ย้อนซ้ำจะทำให้ยอดคลาดเคลื่อน',
      );
    }
  }
}
