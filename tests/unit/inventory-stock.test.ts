import { describe, expect, it } from 'vitest';
import {
  STOCK_MOVEMENT_TYPES,
  STOCK_MOVEMENT_TYPE_LABELS_TH,
  StockMovementError,
  assertQuantityValid,
  assertStockMovementShapeValid,
  decimalStringToQuantityUnits,
  indexStockMovements,
  isStockMovementType,
  quantityUnitsToDecimalString,
  resolveStockDirection,
} from '@/domain/inventory/movement';
import {
  assertSufficientStock,
  calculateStockBalance,
  stockBalanceAfter,
} from '@/domain/inventory/balance';
import type { StockMovement, StockMovementType } from '@/domain/inventory/movement';

let counter = 0;
const move = (
  type: StockMovementType,
  quantity: string,
  extra: Partial<StockMovement> = {},
): StockMovement => ({
  id: extra.id ?? `m${++counter}`,
  type,
  quantityUnits: decimalStringToQuantityUnits(quantity),
  effectiveDate: '2026-01-15',
  reference: extra.reference ?? 'REF-001',
  ...extra,
});

describe('ชนิดรายการเคลื่อนไหวคลังพัสดุ', () => {
  it('ทุกชนิดมีป้ายภาษาไทย', () => {
    for (const type of STOCK_MOVEMENT_TYPES) {
      expect(STOCK_MOVEMENT_TYPE_LABELS_TH[type]?.trim().length).toBeGreaterThan(0);
    }
  });

  it('รู้จักเฉพาะชนิดที่ประกาศไว้', () => {
    expect(isStockMovementType('RECEIPT')).toBe(true);
    expect(isStockMovementType('SOMETHING_ELSE')).toBe(false);
  });
});

describe('การแปลงจำนวน', () => {
  it('แปลงไปกลับได้ค่าเดิม', () => {
    expect(quantityUnitsToDecimalString(decimalStringToQuantityUnits('12.5'))).toBe('12.500');
    expect(quantityUnitsToDecimalString(decimalStringToQuantityUnits('0.001'))).toBe('0.001');
  });

  it('จำนวนต้องมากกว่าศูนย์', () => {
    expect(() => assertQuantityValid(0n)).toThrow(StockMovementError);
    expect(() => assertQuantityValid(-1n)).toThrow(StockMovementError);
    expect(() => assertQuantityValid(1n)).not.toThrow();
  });
});

describe('ทิศทางของรายการ', () => {
  it('รายการย้อนกลับทิศของรายการต้นทาง ไม่ใช่ลงซ้ำ', () => {
    const receipt = move('RECEIPT', '10', { id: 'rc1' });
    const reversal = move('REVERSAL', '10', { id: 'rv1', reversesMovementId: 'rc1' });
    const byId = indexStockMovements([receipt, reversal]);

    expect(resolveStockDirection(receipt, byId)).toBe('INCREASE');
    expect(resolveStockDirection(reversal, byId)).toBe('DECREASE');
  });

  it('ปฏิเสธรายการย้อนที่ไม่รู้ว่าย้อนอะไร', () => {
    const orphan = move('REVERSAL', '10', { id: 'rv2' });
    expect(() => resolveStockDirection(orphan, indexStockMovements([orphan]))).toThrow(
      StockMovementError,
    );
  });
});

describe('การคิดยอดคงเหลือ', () => {
  it('รับ 7 จ่าย 5 เหลือ 2 — กรณีทดสอบหลักตาม PR-07', () => {
    const balance = calculateStockBalance([move('OPENING_BALANCE', '7'), move('ISSUE', '5')]);

    expect(quantityUnitsToDecimalString(balance)).toBe('2.000');
  });

  it('รับคืนเพิ่มยอด ปรับยอดลดลดยอด', () => {
    const balance = calculateStockBalance([
      move('OPENING_BALANCE', '10'),
      move('ISSUE', '4'),
      move('RETURN', '1'),
      move('ADJUSTMENT_DECREASE', '2'),
    ]);

    expect(quantityUnitsToDecimalString(balance)).toBe('5.000');
  });

  it('ย้อนรายการรับเข้ากลับไปลดยอด', () => {
    const receipt = move('RECEIPT', '20', { id: 'rc9' });
    const balance = calculateStockBalance([
      move('OPENING_BALANCE', '5'),
      receipt,
      move('REVERSAL', '20', { reversesMovementId: 'rc9' }),
    ]);

    expect(quantityUnitsToDecimalString(balance)).toBe('5.000');
  });

  it('ไม่มีรายการเลย ยอดเป็นศูนย์', () => {
    expect(calculateStockBalance([])).toBe(0n);
  });
});

describe('เบิกเกินยอดคงเหลือต้องถูกบล็อก', () => {
  it('เบิกเท่ากับยอดคงเหลือพอดีทำได้', () => {
    const existing = [move('OPENING_BALANCE', '5')];
    expect(() => assertSufficientStock(existing, move('ISSUE', '5'))).not.toThrow();
  });

  it('เบิกเกินยอดคงเหลือถูกปฏิเสธ ไม่มีทางยกเว้น', () => {
    const existing = [move('OPENING_BALANCE', '5')];

    let thrown: unknown;
    try {
      assertSufficientStock(existing, move('ISSUE', '6'));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StockMovementError);
    expect((thrown as StockMovementError).code).toBe('BALANCE_WOULD_GO_NEGATIVE');
  });

  it('ของเดิมไม่ถูกแก้เมื่อเรียก stockBalanceAfter', () => {
    const existing = [move('OPENING_BALANCE', '5')];
    expect(stockBalanceAfter(existing, move('ISSUE', '3'))).toBe(decimalStringToQuantityUnits('2'));
    expect(calculateStockBalance(existing)).toBe(decimalStringToQuantityUnits('5'));
  });
});

describe('รับเข้าครั้งแรกจากศูนย์ (ไม่บังคับยอดยกมา)', () => {
  it('รายการที่ยังไม่มีรายการเลยรับเข้าแล้วเบิกได้ ยอดคิดจากศูนย์', () => {
    const receipt = move('RECEIPT', '7');
    expect(stockBalanceAfter([], receipt)).toBe(decimalStringToQuantityUnits('7'));
    expect(() => assertStockMovementShapeValid(receipt, [])).not.toThrow();
    expect(() => assertSufficientStock([receipt], move('ISSUE', '5'))).not.toThrow();
  });

  it('เบิกจากรายการที่ยังว่างอยู่ถูกปฏิเสธ', () => {
    expect(() => assertSufficientStock([], move('ISSUE', '1'))).toThrow(StockMovementError);
  });
});

describe('ความถูกต้องเชิงรูปแบบของแถว', () => {
  it('จำนวนต้องเป็นบวก', () => {
    expect(() =>
      assertStockMovementShapeValid({ ...move('RECEIPT', '1'), quantityUnits: 0n }),
    ).toThrow(StockMovementError);
  });

  it('ต้องมีเลขที่เอกสารอ้างอิงทุกแถว', () => {
    expect(() => assertStockMovementShapeValid({ ...move('RECEIPT', '1'), reference: '' })).toThrow(
      /เอกสารอ้างอิง/,
    );
  });

  it('ลงยอดยกมาได้เฉพาะครั้งแรก', () => {
    const existing = [move('RECEIPT', '1')];
    expect(() => assertStockMovementShapeValid(move('OPENING_BALANCE', '5'), existing)).toThrow(
      /ยอดยกมา/,
    );
    expect(() => assertStockMovementShapeValid(move('OPENING_BALANCE', '5'), [])).not.toThrow();
  });

  it('เบิกจ่ายต้องมีทั้งผู้เบิกและผู้อนุมัติ', () => {
    expect(() => assertStockMovementShapeValid(move('ISSUE', '1'))).toThrow(/ผู้เบิกและผู้อนุมัติ/);
    expect(() =>
      assertStockMovementShapeValid(move('ISSUE', '1', { requestedBy: 'u1', approvedBy: 'u2' })),
    ).not.toThrow();
  });

  it('ปรับยอดต้องมีเหตุผลและผู้อนุมัติ', () => {
    expect(() => assertStockMovementShapeValid(move('ADJUSTMENT_INCREASE', '1'))).toThrow(
      /เหตุผลและผู้อนุมัติ/,
    );
    expect(() =>
      assertStockMovementShapeValid(
        move('ADJUSTMENT_INCREASE', '1', { reason: 'นับสต็อกพบเกิน', approvedBy: 'u2' }),
      ),
    ).not.toThrow();
  });

  it('ย้อนรายการเดิมซ้ำสองครั้งไม่ได้', () => {
    const receipt = move('RECEIPT', '1', { id: 'a9' });
    const firstReversal = move('REVERSAL', '1', { id: 'r9', reversesMovementId: 'a9' });

    expect(() =>
      assertStockMovementShapeValid(move('REVERSAL', '1', { reversesMovementId: 'a9' }), [
        receipt,
        firstReversal,
      ]),
    ).toThrow(/ถูกย้อนไปแล้ว/);
  });

  it('ย้อนด้วยจำนวนไม่ตรงต้นทางไม่ได้ (ฐานข้อมูลตรวจซ้ำอีกชั้น)', () => {
    const issue = move('ISSUE', '1', { id: 'c1', requestedBy: 'u1', approvedBy: 'u2' });

    expect(() =>
      assertStockMovementShapeValid(move('REVERSAL', '100', { reversesMovementId: 'c1' }), [issue]),
    ).toThrow(/เท่ากับจำนวนของรายการต้นทาง/);
    expect(() =>
      assertStockMovementShapeValid(move('REVERSAL', '1', { reversesMovementId: 'c1' }), [issue]),
    ).not.toThrow();
  });

  it('ย้อนรายการย้อนอีกชั้นไม่ได้', () => {
    const receipt = move('RECEIPT', '1', { id: 'b1' });
    const reversal = move('REVERSAL', '1', { id: 'b2', reversesMovementId: 'b1' });

    expect(() =>
      assertStockMovementShapeValid(move('REVERSAL', '1', { reversesMovementId: 'b2' }), [
        receipt,
        reversal,
      ]),
    ).toThrow(/ย้อนรายการย้อนอีกชั้นไม่ได้/);
  });
});
