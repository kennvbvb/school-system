import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PROCUREMENT_STATUSES,
  STATUSES_HOLDING_RESERVATION,
  budgetEffectOf,
  statusHoldsReservation,
} from '@/domain/procurement/status';
import type { ProcurementStatus } from '@/domain/procurement/status';

/**
 * "สถานะใดถือยอดงบที่กันไว้" อยู่สองที่โดยจำเป็น
 *
 *   - `STATUSES_HOLDING_RESERVATION` ในชั้นโดเมน — ให้หน้าจอบอกผู้ใช้ล่วงหน้าว่า
 *     ปุ่มนี้แตะเงิน
 *   - `status_holds_reservation()` ใน migration 0017 — เป็นผู้ตัดสินจริงว่าจะลง
 *     `RESERVE` หรือ `RELEASE`
 *
 * ถ้าสองที่ไม่ตรงกัน หน้าจอจะบอกว่า "อนุมัติแล้วจะกันยอด" แต่ฐานข้อมูลไม่กัน
 * หรือกลับกัน ซึ่งเป็นความคลาดเคลื่อนที่ไม่มีใครเห็นจนกว่างบจะติดลบ
 */
const MIGRATION = 'supabase/migrations/20260911000200_transition_reserves_budget.sql';

function statusesInSql(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('create or replace function public.status_holds_reservation');
  expect(start, `ไม่พบ status_holds_reservation ใน ${MIGRATION}`).toBeGreaterThan(-1);

  const body = sql.slice(start, sql.indexOf('$$;', start));
  return [...body.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1] as string);
}

describe('สถานะที่ถือยอดงบตรงกันระหว่างโดเมนกับฐานข้อมูล', () => {
  it('รายการเหมือนกันทุกข้อ', () => {
    expect([...statusesInSql()].sort()).toEqual([...STATUSES_HOLDING_RESERVATION].sort());
  });

  it('ทุกสถานะใน SQL เป็นสถานะที่โดเมนรู้จัก', () => {
    for (const status of statusesInSql()) {
      expect(PROCUREMENT_STATUSES).toContain(status);
    }
  });

  /*
   * สถานะก่อนอนุมัติต้องไม่ถือยอด
   *
   * ถ้าเผลอใส่ `PENDING_APPROVAL` เข้าไป ระบบจะกันยอดตั้งแต่ยังไม่มีใครอนุมัติ
   * งบจะถูกล็อกด้วยคำขอที่อาจถูกปฏิเสธ และไม่มีเส้นทางใดคืนให้ เพราะการปฏิเสธ
   * ไปสถานะ REJECTED ซึ่งก็ไม่ถือยอดเหมือนกัน — ยอดจะค้างอยู่ตลอดไป
   */
  it.each<ProcurementStatus>([
    'DRAFT',
    'PENDING_REVIEW',
    'NEEDS_REVISION',
    'PENDING_APPROVAL',
    'REJECTED',
    'CANCELLED',
  ])('%s ต้องไม่ถือยอดงบ', (status) => {
    expect(statusHoldsReservation(status)).toBe(false);
    expect(statusesInSql()).not.toContain(status);
  });
});

describe('budgetEffectOf', () => {
  it('อนุมัติแล้วกันยอด', () => {
    expect(budgetEffectOf('PENDING_APPROVAL', 'APPROVED')).toBe('RESERVE');
  });

  it('ยกเลิกรายการที่อนุมัติแล้วคืนยอด', () => {
    expect(budgetEffectOf('APPROVED', 'CANCELLED')).toBe('RELEASE');
    expect(budgetEffectOf('ISSUED', 'CANCELLED')).toBe('RELEASE');
    expect(budgetEffectOf('PARTIALLY_RECEIVED', 'CANCELLED')).toBe('RELEASE');
  });

  /*
   * การเดินหน้าภายในกลุ่มที่ถือยอดต้องไม่แตะเงินซ้ำ
   *
   * ถ้า `issue` กันยอดอีกรอบ รายการเดียวจะกินงบสองเท่า และการยกเลิกจะคืนไม่ครบ
   */
  it.each([
    ['APPROVED', 'ISSUED'],
    ['ISSUED', 'PARTIALLY_RECEIVED'],
    ['PARTIALLY_RECEIVED', 'PARTIALLY_RECEIVED'],
    ['ISSUED', 'RECEIVED'],
    ['PARTIALLY_RECEIVED', 'RECEIVED'],
  ] as const)('%s -> %s ไม่แตะยอดงบ', (from, to) => {
    expect(budgetEffectOf(from, to)).toBeNull();
  });

  /* การปฏิเสธและส่งกลับเกิดก่อนอนุมัติ จึงยังไม่มียอดให้คืน */
  it.each([
    ['PENDING_APPROVAL', 'REJECTED'],
    ['PENDING_APPROVAL', 'NEEDS_REVISION'],
    ['PENDING_REVIEW', 'CANCELLED'],
    ['DRAFT', 'CANCELLED'],
  ] as const)('%s -> %s ไม่แตะยอดงบ', (from, to) => {
    expect(budgetEffectOf(from, to)).toBeNull();
  });
});
