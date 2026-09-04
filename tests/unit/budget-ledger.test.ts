import { describe, expect, it } from 'vitest';
import {
  BudgetMovementError,
  MOVEMENT_TYPES,
  MOVEMENT_TYPE_LABELS_TH,
  assertMovementShapeValid,
  isMovementType,
  isReversible,
  resolveDirection,
  indexMovements,
} from '@/domain/budget/movement';
import { availableAfter, calculateAvailable, summarize } from '@/domain/budget/availability';
import {
  BudgetRuleError,
  BudgetTransferError,
  assertCanPostMovement,
  assertTransferPairValid,
} from '@/domain/budget/rules';
import type { BudgetMovement, MovementType } from '@/domain/budget/movement';
import type { FiscalYear } from '@/domain/master-data/fiscal-year';
import { decimalStringToSatang } from '@/domain/money/money';

let counter = 0;
const move = (
  type: MovementType,
  baht: string,
  extra: Partial<BudgetMovement> = {},
): BudgetMovement => ({
  id: extra.id ?? `m${++counter}`,
  type,
  amountSatang: decimalStringToSatang(baht),
  effectiveDate: '2026-01-15',
  ...extra,
});

const openYear: FiscalYear = {
  id: 'fy1',
  code: 'FY2569',
  yearBE: 2569,
  startDate: '2025-10-01',
  endDate: '2026-09-30',
  status: 'OPEN',
};

describe('ชนิดรายการเคลื่อนไหว', () => {
  it('ทุกชนิดมีป้ายภาษาไทย', () => {
    for (const type of MOVEMENT_TYPES) {
      expect(MOVEMENT_TYPE_LABELS_TH[type]?.trim().length).toBeGreaterThan(0);
    }
  });

  it('รู้จักเฉพาะชนิดที่ประกาศไว้', () => {
    expect(isMovementType('ALLOCATION')).toBe(true);
    expect(isMovementType('SOMETHING_ELSE')).toBe(false);
  });

  it('ย้อนรายการย้อนอีกชั้นไม่ได้', () => {
    expect(isReversible('ALLOCATION')).toBe(true);
    expect(isReversible('REVERSAL')).toBe(false);
  });
});

describe('ทิศทางของรายการ', () => {
  it('รายการย้อนกลับทิศของรายการต้นทาง ไม่ใช่ลงซ้ำ', () => {
    const allocation = move('ALLOCATION', '1000.00', { id: 'a1' });
    const reversal = move('REVERSAL', '1000.00', { id: 'r1', reversesMovementId: 'a1' });
    const byId = indexMovements([allocation, reversal]);

    expect(resolveDirection(allocation, byId)).toBe('CREDIT');
    expect(resolveDirection(reversal, byId)).toBe('DEBIT');
  });

  it('ปฏิเสธรายการย้อนที่ไม่รู้ว่าย้อนอะไร', () => {
    const orphan = move('REVERSAL', '100.00', { id: 'r2' });
    expect(() => resolveDirection(orphan, indexMovements([orphan]))).toThrow(BudgetMovementError);
  });
});

describe('การคิดยอด', () => {
  it('จัดสรรแล้วยอดที่ใช้ได้เท่ากับที่จัดสรร', () => {
    expect(calculateAvailable([move('ALLOCATION', '6000.00')])).toBe(
      decimalStringToSatang('6000.00'),
    );
  });

  it('การกันยอดลดยอดที่ใช้ได้ แต่ไม่ลดงบที่ได้รับ', () => {
    const summary = summarize([move('ALLOCATION', '6000.00'), move('RESERVE', '2000.00')]);

    expect(summary.grantedSatang).toBe(decimalStringToSatang('6000.00'));
    expect(summary.reservedSatang).toBe(decimalStringToSatang('2000.00'));
    expect(summary.availableSatang).toBe(decimalStringToSatang('4000.00'));
  });

  it('การคืนยอดทำให้ยอดที่กันไว้กลับมาใช้ได้', () => {
    const reserve = move('RESERVE', '2000.00', { id: 'res1' });
    const summary = summarize([
      move('ALLOCATION', '6000.00'),
      reserve,
      move('RELEASE', '2000.00', { releasesMovementId: 'res1' }),
    ]);

    expect(summary.reservedSatang).toBe(0n);
    expect(summary.availableSatang).toBe(decimalStringToSatang('6000.00'));
  });

  it('การย้อนการกันยอดไปคืนที่ยอดกัน ไม่ใช่ไปลดงบที่ได้รับ', () => {
    // ถ้าจัดกลุ่มผิด สรุปจะบอกว่างบที่ได้รับลดลง ทั้งที่ความจริงคือยกเลิกการกันยอด
    const reserve = move('RESERVE', '500.00', { id: 'res2' });
    const summary = summarize([
      move('ALLOCATION', '1000.00'),
      reserve,
      move('REVERSAL', '500.00', { reversesMovementId: 'res2' }),
    ]);

    expect(summary.grantedSatang).toBe(decimalStringToSatang('1000.00'));
    expect(summary.reservedSatang).toBe(0n);
    expect(summary.availableSatang).toBe(decimalStringToSatang('1000.00'));
  });

  it('โอนออกลดงบที่ได้รับ รับโอนเพิ่มงบที่ได้รับ', () => {
    expect(
      summarize([
        move('ALLOCATION', '5000.00'),
        move('TRANSFER_OUT', '1000.00', { pairedMovementId: 'x' }),
      ]).grantedSatang,
    ).toBe(decimalStringToSatang('4000.00'));

    expect(
      summarize([move('TRANSFER_IN', '1000.00', { pairedMovementId: 'y' })]).grantedSatang,
    ).toBe(decimalStringToSatang('1000.00'));
  });

  it('ผูกพันและจ่ายจริงนับเป็นยอดที่ใช้ไปแล้ว', () => {
    const summary = summarize([
      move('ALLOCATION', '10000.00'),
      move('COMMIT', '3000.00'),
      move('ACTUAL', '2000.00'),
    ]);

    expect(summary.usedSatang).toBe(decimalStringToSatang('5000.00'));
    expect(summary.availableSatang).toBe(decimalStringToSatang('5000.00'));
  });

  it('ไม่มีรายการเลย ยอดเป็นศูนย์ทุกช่อง', () => {
    expect(summarize([])).toEqual({
      grantedSatang: 0n,
      reservedSatang: 0n,
      usedSatang: 0n,
      availableSatang: 0n,
    });
  });
});

describe('ความถูกต้องเชิงรูปแบบของแถว', () => {
  it('จำนวนเงินต้องเป็นบวก เพราะทิศทางมาจากชนิดรายการ', () => {
    expect(() => assertMovementShapeValid(move('ALLOCATION', '0.00'))).toThrow(BudgetMovementError);
    expect(() =>
      assertMovementShapeValid({ ...move('ALLOCATION', '100.00'), amountSatang: -1n }),
    ).toThrow(BudgetMovementError);
  });

  it('การโอนต้องมีคู่เสมอ', () => {
    expect(() => assertMovementShapeValid(move('TRANSFER_OUT', '100.00'))).toThrow(
      /ต้องเกิดเป็นคู่/,
    );
    expect(() =>
      assertMovementShapeValid(move('TRANSFER_IN', '100.00', { pairedMovementId: 'p1' })),
    ).not.toThrow();
  });

  it('ย้อนรายการเดิมซ้ำสองครั้งไม่ได้', () => {
    const allocation = move('ALLOCATION', '100.00', { id: 'a9' });
    const firstReversal = move('REVERSAL', '100.00', { id: 'r9', reversesMovementId: 'a9' });

    expect(() =>
      assertMovementShapeValid(move('REVERSAL', '100.00', { reversesMovementId: 'a9' }), [
        allocation,
        firstReversal,
      ]),
    ).toThrow(/ถูกย้อนไปแล้ว/);
  });

  it('คืนยอดได้เฉพาะรายการที่เป็นการกันยอด', () => {
    const commit = move('COMMIT', '100.00', { id: 'c1' });
    expect(() =>
      assertMovementShapeValid(move('RELEASE', '100.00', { releasesMovementId: 'c1' }), [commit]),
    ).toThrow(/เฉพาะรายการที่เป็นการกันยอด/);
  });

  it('คืนยอดเกินจำนวนที่กันไว้ไม่ได้', () => {
    const reserve = move('RESERVE', '100.00', { id: 'res9' });
    const partial = move('RELEASE', '60.00', { id: 'rel1', releasesMovementId: 'res9' });

    expect(() =>
      assertMovementShapeValid(move('RELEASE', '50.00', { releasesMovementId: 'res9' }), [
        reserve,
        partial,
      ]),
    ).toThrow(/เกินจำนวนที่กันไว้/);

    expect(() =>
      assertMovementShapeValid(move('RELEASE', '40.00', { releasesMovementId: 'res9' }), [
        reserve,
        partial,
      ]),
    ).not.toThrow();
  });
});

describe('กฎการลงรายการ — จำลองข้อค้นพบ F-01', () => {
  const base = { fiscalYear: openYear, accountStatus: 'OPEN' as const };

  it('จัดสรร 6,000 แล้วกันยอด 6,199 ต้องถูกบล็อก', () => {
    const existing = [move('ALLOCATION', '6000.00')];

    let thrown: unknown;
    try {
      assertCanPostMovement(move('RESERVE', '6199.00'), { ...base, existing });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BudgetRuleError);
    expect((thrown as BudgetRuleError).code).toBe('BUDGET_INSUFFICIENT');
    // ข้อความต้องบอกว่าขาดเท่าไร ไม่ใช่แค่บอกว่าไม่พอ
    expect((thrown as BudgetRuleError).message).toContain('199.00');
  });

  it('ใช้พอดีกับยอดที่มีทำได้', () => {
    expect(() =>
      assertCanPostMovement(move('RESERVE', '6000.00'), {
        ...base,
        existing: [move('ALLOCATION', '6000.00')],
      }),
    ).not.toThrow();
  });

  it('ผู้มีสิทธิ์ยกเว้นลงเกินยอดได้ และกฎนี้ระบุว่ายกเว้นได้', () => {
    const existing = [move('ALLOCATION', '6000.00')];

    expect(() =>
      assertCanPostMovement(move('RESERVE', '6199.00'), { ...base, existing, canOverdraw: true }),
    ).not.toThrow();

    try {
      assertCanPostMovement(move('RESERVE', '6199.00'), { ...base, existing });
    } catch (error) {
      expect((error as BudgetRuleError).overridable).toBe(true);
    }
  });

  it('ปีงบที่ปิดแล้วปฏิเสธรายการใหม่', () => {
    const closed: FiscalYear = { ...openYear, status: 'CLOSED' };
    try {
      assertCanPostMovement(move('ALLOCATION', '100.00'), {
        ...base,
        fiscalYear: closed,
        existing: [],
      });
      throw new Error('ควรถูกปฏิเสธ');
    } catch (error) {
      expect((error as BudgetRuleError).code).toBe('FISCAL_YEAR_CLOSED');
    }
  });

  it('วันที่นอกช่วงปีงบถูกปฏิเสธ และบอกสาเหตุที่ถูกต้อง ไม่ใช่บอกว่าเงินไม่พอ', () => {
    try {
      assertCanPostMovement(move('RESERVE', '999999.00', { effectiveDate: '2027-01-15' }), {
        ...base,
        existing: [],
      });
      throw new Error('ควรถูกปฏิเสธ');
    } catch (error) {
      expect((error as BudgetRuleError).code).toBe('FISCAL_YEAR_MISMATCH');
    }
  });

  it('บัญชีงบที่ปิดแล้วลงรายการไม่ได้ และยกเว้นไม่ได้', () => {
    try {
      assertCanPostMovement(move('ALLOCATION', '100.00'), {
        ...base,
        accountStatus: 'CLOSED',
        existing: [],
      });
      throw new Error('ควรถูกปฏิเสธ');
    } catch (error) {
      expect((error as BudgetRuleError).code).toBe('BUDGET_ACCOUNT_CLOSED');
      expect((error as BudgetRuleError).overridable).toBe(false);
    }
  });
});

describe('การโอนงบ', () => {
  const pair = () => {
    const out = move('TRANSFER_OUT', '1000.00', { id: 'out1', pairedMovementId: 'in1' });
    const inbound = move('TRANSFER_IN', '1000.00', { id: 'in1', pairedMovementId: 'out1' });
    return { out, in: inbound };
  };

  it('คู่ที่ถูกต้องผ่าน และยอดสุทธิของการโอนเป็นศูนย์', () => {
    const p = pair();
    expect(() => assertTransferPairValid(p, 'acc-a', 'acc-b')).not.toThrow();

    const net =
      calculateAvailable([move('ALLOCATION', '5000.00'), p.out]) + calculateAvailable([p.in]);
    expect(net).toBe(decimalStringToSatang('5000.00'));
  });

  it('ยอดสองข้างไม่เท่ากันถูกปฏิเสธ', () => {
    const p = pair();
    p.in.amountSatang = decimalStringToSatang('900.00');
    expect(() => assertTransferPairValid(p, 'acc-a', 'acc-b')).toThrow(BudgetTransferError);
  });

  it('โอนเข้าบัญชีเดียวกันไม่ได้', () => {
    expect(() => assertTransferPairValid(pair(), 'acc-a', 'acc-a')).toThrow(/บัญชีเดียวกัน/);
  });

  it('คู่ที่ไม่ได้ชี้หากันถูกปฏิเสธ', () => {
    const p = pair();
    p.in.pairedMovementId = 'someone-else';
    expect(() => assertTransferPairValid(p, 'acc-a', 'acc-b')).toThrow(/ชี้หากัน/);
  });

  it('วันที่มีผลคนละวันถูกปฏิเสธ', () => {
    const p = pair();
    p.in.effectiveDate = '2026-02-01';
    expect(() => assertTransferPairValid(p, 'acc-a', 'acc-b')).toThrow(/วันเดียวกัน/);
  });
});

describe('availableAfter', () => {
  it('ตอบได้ว่าถ้าลงรายการนี้แล้วยอดจะเหลือเท่าไร โดยยังไม่ลงจริง', () => {
    const existing = [move('ALLOCATION', '1000.00')];
    expect(availableAfter(existing, move('RESERVE', '300.00'))).toBe(
      decimalStringToSatang('700.00'),
    );
    // ของเดิมต้องไม่ถูกแก้
    expect(calculateAvailable(existing)).toBe(decimalStringToSatang('1000.00'));
  });
});
