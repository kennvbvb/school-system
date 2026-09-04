/**
 * ชนิดของรายการเคลื่อนไหวงบประมาณ และผลที่แต่ละชนิดมีต่อยอดที่ใช้ได้
 *
 * ออกแบบตาม ADR 0008 — ledger เป็น append-only ยอดคงเหลือเป็นผลรวมของแถว
 * ไม่ใช่คอลัมน์ที่ update ทับได้ เหตุผลมาจากข้อค้นพบ F-01 (งบโครงการติดลบ)
 * ซึ่งเกิดได้เพราะยอดคงเหลือในสเปรดชีตเป็นผลลัพธ์ของสูตร ไม่ใช่เงื่อนไขที่ต้องผ่าน
 *
 * ไฟล์นี้เป็นตรรกะบริสุทธิ์ ห้าม import Supabase หรือ Next.js
 */
import { MAX_SATANG, MoneyError } from '@/domain/money/money';

export const MOVEMENT_TYPES = [
  /** จัดสรรงบตั้งต้นให้บัญชีงบ */
  'ALLOCATION',
  /** เพิ่มงบระหว่างปี เช่น ได้รับจัดสรรเพิ่ม */
  'INCREASE',
  /** ลดงบระหว่างปี เช่น ถูกเรียกคืน */
  'DECREASE',
  /** รับโอนจากบัญชีงบอื่น — ต้องเกิดคู่กับ TRANSFER_OUT เสมอ */
  'TRANSFER_IN',
  /** โอนออกไปบัญชีงบอื่น — ต้องเกิดคู่กับ TRANSFER_IN เสมอ */
  'TRANSFER_OUT',
  /** กันยอดไว้ระหว่างที่รายการรออนุมัติ */
  'RESERVE',
  /** คืนยอดที่กันไว้ เมื่อรายการถูกยกเลิกหรือเปลี่ยนเป็นยอดผูกพันจริง */
  'RELEASE',
  /** ผูกพันงบเมื่อออกใบสั่งซื้อ/สั่งจ้าง */
  'COMMIT',
  /** จ่ายจริง */
  'ACTUAL',
  /** ย้อนรายการที่ลงผิด — ห้าม update หรือ delete แถวเดิม */
  'REVERSAL',
] as const;

export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS_TH: Readonly<Record<MovementType, string>> = {
  ALLOCATION: 'จัดสรรงบ',
  INCREASE: 'เพิ่มงบ',
  DECREASE: 'ลดงบ',
  TRANSFER_IN: 'รับโอนงบ',
  TRANSFER_OUT: 'โอนงบออก',
  RESERVE: 'กันยอด',
  RELEASE: 'คืนยอดที่กันไว้',
  COMMIT: 'ผูกพันงบ',
  ACTUAL: 'จ่ายจริง',
  REVERSAL: 'ย้อนรายการ',
};

/**
 * ทิศทางของแต่ละชนิดที่มีต่อ "ยอดที่ใช้ได้"
 *
 * CREDIT = ทำให้ยอดที่ใช้ได้เพิ่มขึ้น · DEBIT = ทำให้ลดลง
 *
 * REVERSAL ไม่มีทิศทางของตัวเอง เพราะทิศทางขึ้นกับแถวที่มันย้อน
 * จึงต้องอ่านจาก reversesMovementId เสมอ
 */
export type MovementDirection = 'CREDIT' | 'DEBIT';

const DIRECTIONS: Readonly<Record<Exclude<MovementType, 'REVERSAL'>, MovementDirection>> = {
  ALLOCATION: 'CREDIT',
  INCREASE: 'CREDIT',
  TRANSFER_IN: 'CREDIT',
  RELEASE: 'CREDIT',
  DECREASE: 'DEBIT',
  TRANSFER_OUT: 'DEBIT',
  RESERVE: 'DEBIT',
  COMMIT: 'DEBIT',
  ACTUAL: 'DEBIT',
};

export function isMovementType(value: string): value is MovementType {
  return (MOVEMENT_TYPES as readonly string[]).includes(value);
}

/** ชนิดที่ย้อนได้ — REVERSAL ย้อนซ้อนตัวเองไม่ได้ เพราะจะไล่ต้นทางไม่จบ */
export function isReversible(type: MovementType): boolean {
  return type !== 'REVERSAL';
}

/**
 * แถวหนึ่งใน ledger
 *
 * `amount` เป็นจำนวนบวกเสมอในหน่วยสตางค์ ทิศทางมาจาก `type`
 * ไม่ใช่จากเครื่องหมายของตัวเลข เพราะจำนวนติดลบทำให้ constraint ตรวจได้ยาก
 * และคนอ่านรายงานตีความผิดง่าย
 */
export interface BudgetMovement {
  id: string;
  type: MovementType;
  /** หน่วยสตางค์ เป็นบวกเสมอ */
  amountSatang: bigint;
  /** วันที่มีผลทางบัญชี รูปแบบ YYYY-MM-DD ตามเวลาไทย */
  effectiveDate: string;
  /** แถวที่รายการนี้ย้อน — บังคับเมื่อ type เป็น REVERSAL */
  reversesMovementId?: string | null;
  /** คู่ของการโอน — บังคับเมื่อ type เป็น TRANSFER_IN หรือ TRANSFER_OUT */
  pairedMovementId?: string | null;
  /** แถว RESERVE ที่รายการนี้คืนยอดให้ — บังคับเมื่อ type เป็น RELEASE */
  releasesMovementId?: string | null;
}

export class BudgetMovementError extends Error {
  readonly code:
    | 'AMOUNT_NOT_POSITIVE'
    | 'AMOUNT_OUT_OF_RANGE'
    | 'REVERSAL_TARGET_REQUIRED'
    | 'REVERSAL_TARGET_UNKNOWN'
    | 'REVERSAL_OF_REVERSAL'
    | 'REVERSAL_ALREADY_DONE'
    | 'TRANSFER_PAIR_REQUIRED'
    | 'RELEASE_TARGET_REQUIRED'
    | 'RELEASE_TARGET_NOT_RESERVE'
    | 'RELEASE_EXCEEDS_RESERVED';

  constructor(code: BudgetMovementError['code'], message: string) {
    super(message);
    this.name = 'BudgetMovementError';
    this.code = code;
  }
}

/**
 * ทิศทางที่แท้จริงของแถวหนึ่ง โดยไล่ตาม REVERSAL ไปยังแถวต้นทาง
 *
 * รับ index ของทุกแถวเข้ามา เพราะการหาทิศทางของ REVERSAL ต้องรู้ว่าย้อนอะไร
 */
export function resolveDirection(
  movement: BudgetMovement,
  byId: ReadonlyMap<string, BudgetMovement>,
): MovementDirection {
  if (movement.type !== 'REVERSAL') {
    return DIRECTIONS[movement.type];
  }

  if (!movement.reversesMovementId) {
    throw new BudgetMovementError('REVERSAL_TARGET_REQUIRED', 'รายการย้อนต้องระบุว่าย้อนรายการใด');
  }

  const target = byId.get(movement.reversesMovementId);
  if (!target) {
    throw new BudgetMovementError(
      'REVERSAL_TARGET_UNKNOWN',
      'ไม่พบรายการต้นทางที่รายการย้อนอ้างถึง',
    );
  }

  if (target.type === 'REVERSAL') {
    throw new BudgetMovementError('REVERSAL_OF_REVERSAL', 'ย้อนรายการย้อนอีกชั้นไม่ได้');
  }

  // ย้อนคือการกลับทิศ ไม่ใช่การลงซ้ำ
  return DIRECTIONS[target.type] === 'CREDIT' ? 'DEBIT' : 'CREDIT';
}

/** ผลของแถวหนึ่งต่อยอดที่ใช้ได้ เป็นจำนวนมีเครื่องหมาย */
export function signedEffect(
  movement: BudgetMovement,
  byId: ReadonlyMap<string, BudgetMovement>,
): bigint {
  return resolveDirection(movement, byId) === 'CREDIT'
    ? movement.amountSatang
    : -movement.amountSatang;
}

/** ทำ index จาก id เพื่อให้ resolveDirection ไล่ REVERSAL ได้ */
export function indexMovements(
  movements: readonly BudgetMovement[],
): ReadonlyMap<string, BudgetMovement> {
  return new Map(movements.map((movement) => [movement.id, movement]));
}

/**
 * ตรวจความถูกต้องเชิงรูปแบบของแถวเดียว ก่อนนำไปคิดยอด
 *
 * แยกจากการตรวจยอดคงเหลือ (rules.ts) เพราะคนละเรื่องกัน:
 * ที่นี่ถามว่า "แถวนี้เขียนถูกไหม" ไม่ใช่ "ลงแถวนี้แล้วเงินพอไหม"
 */
export function assertMovementShapeValid(
  movement: BudgetMovement,
  existing: readonly BudgetMovement[] = [],
): void {
  if (movement.amountSatang <= 0n) {
    throw new BudgetMovementError(
      'AMOUNT_NOT_POSITIVE',
      'จำนวนเงินของรายการเคลื่อนไหวต้องมากกว่าศูนย์ ทิศทางมาจากชนิดรายการ',
    );
  }

  if (movement.amountSatang > MAX_SATANG) {
    throw new MoneyError('จำนวนเงินเกินช่วงที่ระบบรองรับ');
  }

  if (movement.type === 'TRANSFER_IN' || movement.type === 'TRANSFER_OUT') {
    if (!movement.pairedMovementId) {
      throw new BudgetMovementError(
        'TRANSFER_PAIR_REQUIRED',
        'การโอนงบต้องเกิดเป็นคู่ ถ้าลงได้ข้างเดียวเงินจะหายหรืองอกจากระบบ',
      );
    }
  }

  if (movement.type === 'REVERSAL') {
    if (!movement.reversesMovementId) {
      throw new BudgetMovementError(
        'REVERSAL_TARGET_REQUIRED',
        'รายการย้อนต้องระบุว่าย้อนรายการใด',
      );
    }

    const target = existing.find((row) => row.id === movement.reversesMovementId);
    if (target && target.type === 'REVERSAL') {
      throw new BudgetMovementError('REVERSAL_OF_REVERSAL', 'ย้อนรายการย้อนอีกชั้นไม่ได้');
    }

    const alreadyReversed = existing.some(
      (row) => row.type === 'REVERSAL' && row.reversesMovementId === movement.reversesMovementId,
    );
    if (alreadyReversed) {
      throw new BudgetMovementError(
        'REVERSAL_ALREADY_DONE',
        'รายการนี้ถูกย้อนไปแล้ว ย้อนซ้ำจะทำให้ยอดคลาดเคลื่อน',
      );
    }
  }

  if (movement.type === 'RELEASE') {
    if (!movement.releasesMovementId) {
      throw new BudgetMovementError(
        'RELEASE_TARGET_REQUIRED',
        'การคืนยอดต้องระบุว่าคืนให้รายการกันยอดใด',
      );
    }

    const target = existing.find((row) => row.id === movement.releasesMovementId);
    if (target && target.type !== 'RESERVE') {
      throw new BudgetMovementError(
        'RELEASE_TARGET_NOT_RESERVE',
        'คืนยอดได้เฉพาะรายการที่เป็นการกันยอดเท่านั้น',
      );
    }

    if (target) {
      const releasedSoFar = existing
        .filter((row) => row.type === 'RELEASE' && row.releasesMovementId === target.id)
        .reduce((sum, row) => sum + row.amountSatang, 0n);

      if (releasedSoFar + movement.amountSatang > target.amountSatang) {
        throw new BudgetMovementError('RELEASE_EXCEEDS_RESERVED', 'คืนยอดเกินจำนวนที่กันไว้ไม่ได้');
      }
    }
  }
}
