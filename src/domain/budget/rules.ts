/**
 * กฎที่ตัดสินว่ารายการเคลื่อนไหวงบลงได้หรือไม่
 *
 * แยกจาก movement.ts (ตรวจว่า "แถวเขียนถูกไหม") และ availability.ts (คิดยอด)
 * ที่นี่ตอบคำถามเดียว: "ลงแถวนี้ตอนนี้ได้หรือไม่"
 *
 * กฎเหล่านี้ถูกบังคับซ้ำที่ฐานข้อมูลด้วย (migration 0005) เพราะการเรียก API ตรง
 * ต้องถูกปฏิเสธเช่นเดียวกับการกดผ่านหน้าจอ (ข้อ 4.2)
 */
import { assertMovementShapeValid } from './movement';
import { availableAfter } from './availability';
import type { BudgetMovement } from './movement';
import type { FiscalYear } from '@/domain/master-data/fiscal-year';
import { coversDate } from '@/domain/master-data/fiscal-year';
import { formatSatang } from '@/domain/money/money';

export type BudgetRuleCode =
  'BUDGET_INSUFFICIENT' | 'FISCAL_YEAR_CLOSED' | 'FISCAL_YEAR_MISMATCH' | 'BUDGET_ACCOUNT_CLOSED';

export class BudgetRuleError extends Error {
  readonly code: BudgetRuleCode;
  /** true = กฎนี้ยกเว้นได้ด้วยสิทธิ์และเหตุผล · false = ห้ามยกเว้นเด็ดขาด */
  readonly overridable: boolean;

  constructor(code: BudgetRuleCode, message: string, overridable: boolean) {
    super(message);
    this.name = 'BudgetRuleError';
    this.code = code;
    this.overridable = overridable;
  }
}

export type BudgetAccountStatus = 'OPEN' | 'CLOSED';

export interface PostMovementContext {
  /** รายการเคลื่อนไหวทั้งหมดของบัญชีงบนี้ที่มีอยู่แล้ว */
  existing: readonly BudgetMovement[];
  fiscalYear: FiscalYear;
  accountStatus: BudgetAccountStatus;
  /**
   * ผู้ลงรายการมีสิทธิ์ budget.override หรือไม่
   *
   * ค่าเริ่มต้นคือไม่มี — การยอมให้ยอดติดลบเป็นค่าเริ่มต้นคือสิ่งที่ทำให้
   * งบติดลบเกิดขึ้นได้ตั้งแต่แรก (ข้อค้นพบ F-01)
   */
  canOverdraw?: boolean;
  /** เหตุผลของการใช้สิทธิ์ยกเว้น — บังคับเมื่อ canOverdraw ถูกใช้จริง */
  overrideReason?: string | null;
}

/**
 * ตรวจว่าลงรายการนี้ได้หรือไม่ โยน BudgetRuleError เมื่อไม่ได้
 *
 * ลำดับการตรวจสำคัญ: ตรวจเรื่องที่เป็น "ปิดรับแล้ว" ก่อนเรื่องยอดเงิน
 * เพื่อให้ข้อความบอกสาเหตุที่ผู้ใช้แก้ได้จริง แทนที่จะบอกว่าเงินไม่พอ
 * ทั้งที่ปัญหาคือปีงบปิดไปแล้ว
 */
export function assertCanPostMovement(
  candidate: BudgetMovement,
  context: PostMovementContext,
): void {
  assertMovementShapeValid(candidate, context.existing);

  if (context.accountStatus === 'CLOSED') {
    throw new BudgetRuleError(
      'BUDGET_ACCOUNT_CLOSED',
      'บัญชีงบนี้ปิดแล้ว ลงรายการเพิ่มไม่ได้',
      false,
    );
  }

  if (!coversDate(context.fiscalYear, candidate.effectiveDate)) {
    throw new BudgetRuleError(
      'FISCAL_YEAR_MISMATCH',
      `วันที่มีผล ${candidate.effectiveDate} อยู่นอกช่วงปีงบประมาณ ${context.fiscalYear.code}`,
      false,
    );
  }

  if (context.fiscalYear.status === 'CLOSED') {
    throw new BudgetRuleError(
      'FISCAL_YEAR_CLOSED',
      `ปีงบประมาณ ${context.fiscalYear.code} ปิดแล้ว ลงรายการย้อนหลังไม่ได้`,
      true,
    );
  }

  const projected = availableAfter(context.existing, candidate);

  if (projected < 0n && !context.canOverdraw) {
    throw new BudgetRuleError(
      'BUDGET_INSUFFICIENT',
      `ยอดงบคงเหลือไม่พอ ขาดอีก ${formatSatang(-projected)} บาท`,
      true,
    );
  }
}

/**
 * คู่ของรายการโอนงบ
 *
 * ต้องเกิดพร้อมกันในทรานแซกชันเดียว ผลรวมสุทธิของการโอนหนึ่งครั้งจึงเป็นศูนย์เสมอ
 * ถ้าครึ่งหนึ่งสำเร็จอีกครึ่งล้ม เงินจะหายหรืองอกจากระบบ (ADR 0008)
 */
export interface TransferPair {
  out: BudgetMovement;
  in: BudgetMovement;
}

export class BudgetTransferError extends Error {
  readonly code: 'AMOUNT_MISMATCH' | 'SAME_ACCOUNT' | 'NOT_PAIRED' | 'DATE_MISMATCH';

  constructor(code: BudgetTransferError['code'], message: string) {
    super(message);
    this.name = 'BudgetTransferError';
    this.code = code;
  }
}

/**
 * ตรวจว่าคู่โอนถูกต้อง — ยอดเท่ากัน วันเดียวกัน ชี้หากัน และคนละบัญชี
 *
 * รับ id ของบัญชีต้นทาง/ปลายทางแยกมา เพราะแถว movement เองไม่ได้เก็บ
 * บัญชีของมันไว้ในโครงสร้างนี้ (อยู่ที่ระดับตารางในฐานข้อมูล)
 */
export function assertTransferPairValid(
  pair: TransferPair,
  fromAccountId: string,
  toAccountId: string,
): void {
  if (fromAccountId === toAccountId) {
    throw new BudgetTransferError('SAME_ACCOUNT', 'โอนงบไปบัญชีเดียวกันไม่ได้');
  }

  if (pair.out.amountSatang !== pair.in.amountSatang) {
    throw new BudgetTransferError(
      'AMOUNT_MISMATCH',
      'ยอดโอนออกและยอดรับโอนต้องเท่ากัน มิฉะนั้นเงินจะหายหรืองอกจากระบบ',
    );
  }

  if (pair.out.effectiveDate !== pair.in.effectiveDate) {
    throw new BudgetTransferError(
      'DATE_MISMATCH',
      'วันที่มีผลของการโอนออกและรับโอนต้องเป็นวันเดียวกัน',
    );
  }

  if (pair.out.pairedMovementId !== pair.in.id || pair.in.pairedMovementId !== pair.out.id) {
    throw new BudgetTransferError('NOT_PAIRED', 'รายการโอนออกและรับโอนต้องชี้หากัน');
  }
}
