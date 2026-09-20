import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PROCUREMENT_STATUSES,
  STATUSES_HOLDING_COMMITMENT,
  STATUSES_HOLDING_RESERVATION,
  budgetEffectOf,
  heldBudgetKindOf,
  statusHoldsCommitment,
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
const MIGRATIONS_DIR = 'supabase/migrations';

/**
 * อ่านนิยาม **ล่าสุด** ของฟังก์ชันจาก migration ทั้งหมด
 *
 * ฟังก์ชันถูกออกใหม่ด้วย `create or replace` ได้หลายครั้ง นิยามที่มีผลจริงคือ
 * ครั้งสุดท้ายตามลำดับชื่อไฟล์ ถ้า test อ่านไฟล์เดียวแบบตรึงชื่อไว้ มันจะเทียบกับ
 * นิยามเก่าที่ถูกแทนที่ไปแล้ว แล้วผ่านหรือล้มด้วยเหตุผลที่ไม่ตรงกับความจริง
 * — ซึ่งเกิดขึ้นจริงตอนทำ PR-04e ที่ออก `status_holds_reservation` ใหม่
 */
function statusesIn(functionName: string): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  let body: string | null = null;
  for (const file of files) {
    const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');
    const start = sql.indexOf(`create or replace function public.${functionName}`);
    if (start > -1) body = sql.slice(start, sql.indexOf('$$;', start));
  }

  expect(body, `ไม่พบ ${functionName} ใน migration ใดเลย`).not.toBeNull();
  /* ตัดคอมเมนต์ `--` ออกก่อน มิฉะนั้นสถานะที่ถูก comment ทิ้งไว้จะถูกนับด้วย */
  const stripped = (body as string)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

  return [...stripped.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1] as string);
}

const statusesInSql = (): string[] => statusesIn('status_holds_reservation');
const commitmentStatusesInSql = (): string[] => statusesIn('status_holds_commitment');

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

describe('สถานะที่ถือยอดผูกพันตรงกันระหว่างโดเมนกับฐานข้อมูล', () => {
  it('รายการเหมือนกันทุกข้อ', () => {
    expect([...commitmentStatusesInSql()].sort()).toEqual([...STATUSES_HOLDING_COMMITMENT].sort());
  });

  /*
   * **ข้อที่สำคัญที่สุดของไฟล์นี้**
   *
   * สถานะที่อยู่ทั้งสองรายการจะทำให้รายการเดียวถือยอดสองก้อนพร้อมกัน
   * — กันไว้ด้วย ผูกพันด้วย — งบจะถูกกินสองเท่าโดยที่ทุกหน้าจอดูปกติ
   * และการยกเลิกจะคืนได้ก้อนเดียว อีกก้อนค้างตลอดกาล
   */
  it('ไม่มีสถานะใดถือทั้งยอดที่กันไว้และยอดผูกพันพร้อมกัน', () => {
    for (const status of PROCUREMENT_STATUSES) {
      expect(statusHoldsReservation(status) && statusHoldsCommitment(status), status).toBe(false);
    }

    const overlap = statusesInSql().filter((status) => commitmentStatusesInSql().includes(status));
    expect(overlap, 'SQL ก็ต้องไม่ซ้อนทับเช่นกัน').toEqual([]);
  });

  it('ทุกสถานะที่ถือยอดมีชนิดเดียวที่ตรงกับรายการ', () => {
    expect(heldBudgetKindOf('APPROVED')).toBe('RESERVE');
    expect(heldBudgetKindOf('ISSUED')).toBe('COMMIT');
    expect(heldBudgetKindOf('RECEIVED')).toBe('COMMIT');
    expect(heldBudgetKindOf('DRAFT')).toBeNull();
    expect(heldBudgetKindOf('CANCELLED')).toBeNull();
  });

  /*
   * รับของแล้วยังผูกพันอยู่ เพราะยังไม่ได้จ่ายเงิน
   *
   * ถ้าถอด RECEIVED ออก การรับของจะกลายเป็นการคืนยอดทั้งก้อน แล้วเงินที่ยังต้องจ่าย
   * ให้ผู้ขายจะกลับไปอยู่ในงบที่ใช้ได้ จนถูกเอาไปใช้กับรายการอื่นได้
   */
  it('รับของครบแล้วยังผูกพันงบอยู่', () => {
    expect(statusHoldsCommitment('RECEIVED')).toBe(true);
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
   * ออกใบสั่งซื้อแล้วแปลงยอดที่กันไว้เป็นยอดผูกพัน (PR-04e)
   *
   * **ไม่ใช่การกันยอดเพิ่ม** — ยอดที่ใช้ได้ต้องไม่ขยับ มี SQL test ยืนยันด้วยตัวเลขจริง
   * ที่นี่ยืนยันเพียงว่าหน้าจอจะบอกผู้ใช้ว่าปุ่มนี้แตะเงิน
   */
  it('ออกใบสั่งซื้อแล้วผูกพันงบ', () => {
    expect(budgetEffectOf('APPROVED', 'ISSUED')).toBe('COMMIT');
  });

  /*
   * การเดินหน้าภายในกลุ่มที่ถือยอดชนิดเดียวกันต้องไม่แตะเงินซ้ำ
   *
   * ถ้า `receive_all` ผูกพันอีกรอบ รายการเดียวจะกินงบสองเท่า และการยกเลิกจะคืนไม่ครบ
   */
  it.each([
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
