import { describe, expect, it } from 'vitest';
import {
  MANUAL_MOVEMENT_TYPES,
  budgetAccountSchema,
  budgetMovementSchema,
  budgetReversalSchema,
  budgetTransferSchema,
  isManualMovementType,
} from '@/domain/budget/schemas';
import { MOVEMENT_TYPES } from '@/domain/budget/movement';

const FISCAL_YEAR_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const PROJECT_ID = 'cccccccc-0000-4000-8000-000000000001';
const ACCOUNT_A = 'bbbbbbbb-0000-4000-8000-000000000001';
const ACCOUNT_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const MOVEMENT_ID = 'dddddddd-0000-4000-8000-000000000001';

describe('budgetAccountSchema', () => {
  it('ปฏิเสธบัญชีที่ไม่ผูกกับ scope ใดเลย', () => {
    const result = budgetAccountSchema.safeParse({
      code: 'ACC-01',
      fiscalYearId: FISCAL_YEAR_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('อย่างน้อยหนึ่งอย่าง');
    }
  });

  it.each([
    ['โครงการ', { projectId: PROJECT_ID }],
    ['แหล่งเงิน', { fundingSourceId: PROJECT_ID }],
    ['หน่วยงาน', { departmentId: PROJECT_ID }],
  ])('ยอมรับเมื่อผูกกับ%sอย่างเดียว', (_label, scope) => {
    const result = budgetAccountSchema.safeParse({
      code: 'ACC-01',
      fiscalYearId: FISCAL_YEAR_ID,
      ...scope,
    });

    expect(result.success).toBe(true);
  });

  it('ปฏิเสธรหัสที่มีอักขระนอกเหนือจากที่กำหนด', () => {
    const result = budgetAccountSchema.safeParse({
      code: 'ACC 01',
      fiscalYearId: FISCAL_YEAR_ID,
      projectId: PROJECT_ID,
    });

    expect(result.success).toBe(false);
  });

  /*
   * ช่องที่ไม่บังคับต้อง "ละไว้ได้" จริง ไม่ใช่ "บังคับแต่เป็น undefined ได้"
   * ข้อนี้เคยพลาดมาแล้วตอน PR-02 เพราะใช้ transform แทน preprocess
   */
  it('หมายเหตุที่เป็นค่าว่างกลายเป็นละไว้ ไม่ใช่ข้อความว่าง', () => {
    const result = budgetAccountSchema.safeParse({
      code: 'ACC-01',
      fiscalYearId: FISCAL_YEAR_ID,
      projectId: PROJECT_ID,
      note: '   ',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.note).toBeUndefined();
  });
});

describe('ชนิดรายการที่ลงเองได้', () => {
  it('มีเฉพาะการจัดสรร เพิ่ม และลดงบ', () => {
    expect([...MANUAL_MOVEMENT_TYPES]).toEqual(['ALLOCATION', 'INCREASE', 'DECREASE']);
  });

  /*
   * ชนิดที่เหลือต้องมาจากขั้นตอนอื่นเสมอ ถ้ามีการเพิ่มชนิดใหม่เข้า MOVEMENT_TYPES
   * แล้วเผลอเปิดให้ลงเองได้ test นี้จะไม่จับ — แต่ test ด้านล่างจับได้ว่าชนิดที่
   * ห้ามลงเองยังห้ามอยู่
   */
  it.each(MOVEMENT_TYPES.filter((type) => !isManualMovementType(type)))(
    'ปฏิเสธการลง %s จากฟอร์ม',
    (type) => {
      const result = budgetMovementSchema.safeParse({
        accountId: ACCOUNT_A,
        type,
        amount: '100.00',
        effectiveDate: '2026-01-15',
      });

      expect(result.success).toBe(false);
    },
  );
});

describe('budgetMovementSchema', () => {
  const base = {
    accountId: ACCOUNT_A,
    type: 'ALLOCATION' as const,
    effectiveDate: '2026-01-15',
  };

  it.each(['0', '0.00', '-5.00', '1.234', 'abc', ''])('ปฏิเสธจำนวนเงิน %s', (amount) => {
    expect(budgetMovementSchema.safeParse({ ...base, amount }).success).toBe(false);
  });

  it.each(['0.01', '100', '1234.56'])('ยอมรับจำนวนเงิน %s', (amount) => {
    expect(budgetMovementSchema.safeParse({ ...base, amount }).success).toBe(true);
  });

  it('ปฏิเสธวันที่ที่ไม่มีอยู่จริงในปฏิทิน', () => {
    const result = budgetMovementSchema.safeParse({
      ...base,
      amount: '100',
      effectiveDate: '2026-02-30',
    });

    expect(result.success).toBe(false);
  });
});

describe('budgetTransferSchema', () => {
  const base = {
    fromAccountId: ACCOUNT_A,
    toAccountId: ACCOUNT_B,
    amount: '1000.00',
    effectiveDate: '2026-01-15',
    reason: 'โอนตามบันทึกข้อความ',
  };

  it('ยอมรับการโอนที่ครบถ้วน', () => {
    expect(budgetTransferSchema.safeParse(base).success).toBe(true);
  });

  it('ปฏิเสธการโอนเข้าบัญชีเดียวกัน', () => {
    const result = budgetTransferSchema.safeParse({ ...base, toAccountId: ACCOUNT_A });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['toAccountId']);
    }
  });

  it.each([undefined, '', '   '])('ปฏิเสธการโอนที่ไม่มีเหตุผล (%s)', (reason) => {
    expect(budgetTransferSchema.safeParse({ ...base, reason }).success).toBe(false);
  });
});

describe('budgetReversalSchema', () => {
  it('บังคับเหตุผลเสมอ', () => {
    const withoutReason = budgetReversalSchema.safeParse({
      movementId: MOVEMENT_ID,
      effectiveDate: '2026-01-15',
      reason: '',
    });

    expect(withoutReason.success).toBe(false);

    const withReason = budgetReversalSchema.safeParse({
      movementId: MOVEMENT_ID,
      effectiveDate: '2026-01-15',
      reason: 'ลงจำนวนผิด',
    });

    expect(withReason.success).toBe(true);
  });

  /*
   * schema ไม่รับจำนวนเงิน โดยเจตนา
   *
   * การย้อนต้องใช้ยอดของแถวเดิมเสมอ ถ้ารับจากผู้เรียกได้ การ "ย้อน" ด้วยยอดอื่น
   * จะกลายเป็นการแก้ตัวเลขที่ไม่มีรายการรองรับ
   */
  it('ไม่รับจำนวนเงินจากผู้เรียก', () => {
    const result = budgetReversalSchema.safeParse({
      movementId: MOVEMENT_ID,
      effectiveDate: '2026-01-15',
      reason: 'ลงจำนวนผิด',
      amount: '999999',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).not.toContain('amount');
    }
  });
});
