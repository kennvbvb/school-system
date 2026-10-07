import { describe, expect, it } from 'vitest';
import {
  inventoryItemSchema,
  stockAdjustmentSchema,
  stockIssueSchema,
  stockReceiveSchema,
  stockReversalSchema,
} from '@/domain/inventory/schemas';

const ITEM_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const UNIT_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const USER_A = 'cccccccc-0000-4000-8000-000000000001';
const USER_B = 'cccccccc-0000-4000-8000-000000000002';
const MOVEMENT_ID = 'dddddddd-0000-4000-8000-000000000001';

describe('inventoryItemSchema', () => {
  it('ยอมรับข้อมูลครบถ้วน', () => {
    const result = inventoryItemSchema.safeParse({
      code: 'ITM-001',
      nameTh: 'กระดาษ A4',
      unitId: UNIT_ID,
      minimumQuantity: '10',
      note: '',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.note).toBeUndefined();
  });

  it('ปฏิเสธรหัสที่มีอักขระนอกเหนือจากที่กำหนด', () => {
    expect(
      inventoryItemSchema.safeParse({
        code: 'ITM 001',
        nameTh: 'กระดาษ A4',
        unitId: UNIT_ID,
        minimumQuantity: '0',
      }).success,
    ).toBe(false);
  });

  it('ปฏิเสธเมื่อไม่เลือกหน่วยนับ', () => {
    expect(
      inventoryItemSchema.safeParse({
        code: 'ITM-001',
        nameTh: 'กระดาษ A4',
        unitId: '',
        minimumQuantity: '0',
      }).success,
    ).toBe(false);
  });

  it('จุดสั่งซื้อซ้ำที่ว่างกลายเป็นศูนย์', () => {
    const result = inventoryItemSchema.safeParse({
      code: 'ITM-001',
      nameTh: 'กระดาษ A4',
      unitId: UNIT_ID,
      minimumQuantity: '',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.minimumQuantity).toBe('0');
  });
});

describe('stockReceiveSchema', () => {
  const base = {
    itemId: ITEM_ID,
    type: 'RECEIPT' as const,
    effectiveDate: '2026-01-15',
    reference: 'GR-2569-001',
  };

  it.each(['0', '0.000', '-1', '1.2345', 'abc', ''])('ปฏิเสธจำนวน %s', (quantity) => {
    expect(stockReceiveSchema.safeParse({ ...base, quantity }).success).toBe(false);
  });

  it.each(['0.001', '10', '1234.567'])('ยอมรับจำนวน %s', (quantity) => {
    expect(stockReceiveSchema.safeParse({ ...base, quantity }).success).toBe(true);
  });

  it('บังคับเลขที่เอกสารอ้างอิงเสมอ', () => {
    expect(stockReceiveSchema.safeParse({ ...base, quantity: '1', reference: '' }).success).toBe(
      false,
    );
  });

  it('ปฏิเสธชนิดที่ไม่ใช่รับเข้า/รับคืน/ยอดยกมา', () => {
    expect(stockReceiveSchema.safeParse({ ...base, quantity: '1', type: 'ISSUE' }).success).toBe(
      false,
    );
  });
});

describe('stockIssueSchema', () => {
  it('ต้องมีทั้งผู้เบิกและผู้อนุมัติ', () => {
    const base = {
      itemId: ITEM_ID,
      quantity: '1',
      effectiveDate: '2026-01-15',
      reference: 'REQ-001',
    };

    expect(stockIssueSchema.safeParse(base).success).toBe(false);
    expect(
      stockIssueSchema.safeParse({ ...base, requestedBy: USER_A, approvedBy: USER_B }).success,
    ).toBe(true);
  });

  it('ผู้เบิกกับผู้อนุมัติเป็นคนเดียวกันไม่ได้', () => {
    const result = stockIssueSchema.safeParse({
      itemId: ITEM_ID,
      quantity: '1',
      effectiveDate: '2026-01-15',
      reference: 'REQ-001',
      requestedBy: USER_A,
      approvedBy: USER_A,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['approvedBy']);
  });
});

describe('stockAdjustmentSchema', () => {
  const base = {
    itemId: ITEM_ID,
    type: 'ADJUSTMENT_INCREASE' as const,
    quantity: '1',
    effectiveDate: '2026-01-15',
    reference: 'ADJ-001',
    approvedBy: USER_A,
  };

  it.each([undefined, '', '   '])('บังคับเหตุผลเสมอ (%s)', (reason) => {
    expect(stockAdjustmentSchema.safeParse({ ...base, reason }).success).toBe(false);
  });

  it('ยอมรับเมื่อมีเหตุผล', () => {
    expect(
      stockAdjustmentSchema.safeParse({ ...base, reason: 'นับสต็อกพบเกิน 1 หน่วย' }).success,
    ).toBe(true);
  });
});

describe('stockReversalSchema', () => {
  it('บังคับเหตุผลเสมอ', () => {
    expect(
      stockReversalSchema.safeParse({
        movementId: MOVEMENT_ID,
        effectiveDate: '2026-01-15',
        reason: '',
      }).success,
    ).toBe(false);
  });

  /*
   * schema ไม่รับจำนวนจากผู้เรียก โดยเจตนา — เหตุผลเดียวกับ budgetReversalSchema:
   * การย้อนต้องใช้จำนวนของแถวเดิมเสมอ ไม่ใช่ให้ผู้เรียกกำหนดเอง
   */
  it('ไม่รับจำนวนจากผู้เรียก', () => {
    const result = stockReversalSchema.safeParse({
      movementId: MOVEMENT_ID,
      effectiveDate: '2026-01-15',
      reason: 'ลงจำนวนผิด',
      quantity: '999',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(Object.keys(result.data)).not.toContain('quantity');
  });
});
