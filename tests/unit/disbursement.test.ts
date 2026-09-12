import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DISBURSEMENT_MESSAGES_TH,
  STATUSES_ALLOWING_DISBURSEMENT,
  checkDisbursement,
  splitProRata,
  statusAllowsDisbursement,
  totalOutstanding,
} from '@/domain/procurement/disbursement';
import { PROCUREMENT_STATUSES } from '@/domain/procurement/status';
import { disbursementSchema, disbursementVoidSchema } from '@/domain/procurement/schemas';

/**
 * กติกาการเบิกจ่ายอยู่สองที่โดยจำเป็น
 *
 *   - ที่นี่ — ให้หน้าจอบอกผู้ใช้ล่วงหน้าว่าทำไม่ได้และเพราะอะไร
 *   - `procurement_disburse()` ใน migration 0019 — เป็นผู้บังคับจริง
 *
 * ถ้าสองที่ไม่ตรงกัน จะเกิดกรณีที่หน้าจอยอมแล้ว server ปฏิเสธ หรือแย่กว่านั้นคือ
 * หน้าจอเสนอการแบ่งยอดแบบหนึ่ง แต่ ledger บันทึกอีกแบบหนึ่ง
 */
const MIGRATION = 'supabase/migrations/20260913000100_procurement_disbursement.sql';

const acc = (id: string, satang: bigint) => ({ budgetAccountId: id, amountSatang: satang });

describe('statusAllowsDisbursement', () => {
  it('จ่ายได้เฉพาะเมื่อรับของแล้ว', () => {
    expect(statusAllowsDisbursement('RECEIVED')).toBe(true);
    expect(statusAllowsDisbursement('PARTIALLY_RECEIVED')).toBe(true);
  });

  /*
   * ระบุทุกสถานะที่เหลือ ไม่ใช่แค่ตัวอย่างสองสามตัว
   *
   * ถ้ามีคนเพิ่มสถานะใหม่เข้า PROCUREMENT_STATUSES แล้วเผลอใส่ไว้ในชุดที่
   * เบิกจ่ายได้ test นี้จะฟ้องทันที แทนที่จะเงียบจนกว่าจะมีคนจ่ายเงินผิด
   */
  it('สถานะอื่นทั้งหมดจ่ายไม่ได้', () => {
    const disallowed = PROCUREMENT_STATUSES.filter(
      (status) => !STATUSES_ALLOWING_DISBURSEMENT.includes(status),
    );

    expect(disallowed).toEqual([
      'DRAFT',
      'PENDING_REVIEW',
      'NEEDS_REVISION',
      'PENDING_APPROVAL',
      'APPROVED',
      'REJECTED',
      'ISSUED',
      'CANCELLED',
    ]);

    for (const status of disallowed) {
      expect(statusAllowsDisbursement(status), status).toBe(false);
    }
  });
});

describe('checkDisbursement', () => {
  const outstanding = [acc('a', 200000n), acc('b', 100000n)];

  it('ยอมเมื่อจ่ายไม่เกินยอดที่กันไว้', () => {
    expect(
      checkDisbursement({ status: 'RECEIVED', amountSatang: 300000n, outstanding }),
    ).toBeNull();
  });

  it('ปฏิเสธเมื่อยังไม่รับของ', () => {
    expect(checkDisbursement({ status: 'APPROVED', amountSatang: 1n, outstanding })).toBe(
      'STATUS_NOT_ALLOWED',
    );
  });

  it('ปฏิเสธจำนวนเงินที่ไม่เป็นบวก', () => {
    expect(checkDisbursement({ status: 'RECEIVED', amountSatang: 0n, outstanding })).toBe(
      'AMOUNT_NOT_POSITIVE',
    );
  });

  it('ปฏิเสธเมื่อไม่เหลือยอดที่กันไว้', () => {
    expect(checkDisbursement({ status: 'RECEIVED', amountSatang: 1n, outstanding: [] })).toBe(
      'NOTHING_RESERVED',
    );
  });

  /* เกินแม้แค่หนึ่งสตางค์ก็ไม่ได้ — ส่วนต่างที่ไม่มีใครอนุมัติคือสิ่งที่ผู้ตรวจสอบตามหา */
  it('ปฏิเสธเมื่อจ่ายเกินยอดที่กันไว้แม้แค่หนึ่งสตางค์', () => {
    expect(checkDisbursement({ status: 'RECEIVED', amountSatang: 300001n, outstanding })).toBe(
      'EXCEEDS_RESERVED',
    );
  });

  it('ทุกรหัสปฏิเสธมีข้อความภาษาไทย', () => {
    for (const message of Object.values(DISBURSEMENT_MESSAGES_TH)) {
      expect(message.trim()).not.toBe('');
    }
  });
});

describe('splitProRata', () => {
  it('แบ่งตามสัดส่วน 2:1', () => {
    expect(splitProRata([acc('a', 200000n), acc('b', 100000n)], 150000n)).toEqual([
      { budgetAccountId: 'a', amountSatang: 100000n },
      { budgetAccountId: 'b', amountSatang: 50000n },
    ]);
  });

  /*
   * ข้อที่สำคัญที่สุดของฟังก์ชันนี้
   *
   * ผลรวมต้องเท่ากับยอดที่จ่ายเป๊ะ ๆ ทุกกรณี ถ้าเศษหายหรืองอกแม้สตางค์เดียว
   * ยอดใน ledger จะไม่ตรงกับใบสำคัญจ่าย และไม่มีใครรู้จนกว่าจะปิดงบ
   */
  it('ผลรวมเท่ากับยอดที่จ่ายเสมอ แม้หารไม่ลงตัว', () => {
    const outstanding = [acc('a', 100000n), acc('b', 33333n), acc('c', 1n)];

    for (const amount of [1n, 2n, 7n, 99999n, 100000n, 133333n, 133334n]) {
      const lines = splitProRata(outstanding, amount);
      const sum = lines.reduce((total, line) => total + line.amountSatang, 0n);

      expect(sum, `จ่าย ${amount} สตางค์`).toBe(amount);
    }
  });

  it('ไม่คืนบรรทัดที่ได้ศูนย์ — แถวศูนย์บาทลง ledger ไม่ได้', () => {
    const lines = splitProRata([acc('a', 100000n), acc('b', 50000n)], 1n);

    expect(lines).toEqual([{ budgetAccountId: 'a', amountSatang: 1n }]);
  });

  /*
   * เศษไปบรรทัดใหญ่สุด ไม่ใช่บรรทัดแรกและไม่ใช่ id ที่มาก่อนตามตัวอักษร
   *
   * ตั้งใจให้ id เรียงสวนทางกับขนาด — 'a' มาก่อน 'z' ตามตัวอักษร แต่ 'z'
   * กันไว้มากกว่า ถ้าใช้ชื่อที่เรียงตรงกับขนาด test จะผ่านแม้เกณฑ์ขนาดถูกถอดออก
   */
  it('เศษไปบรรทัดที่กันไว้มากที่สุด ไม่ใช่บรรทัดแรกและไม่ใช่ id ที่มาก่อน', () => {
    expect(splitProRata([acc('a', 1n), acc('z', 99999n)], 1n)).toEqual([
      { budgetAccountId: 'z', amountSatang: 1n },
    ]);

    /* สลับลำดับที่ส่งเข้ามาแล้วต้องได้ผลเดิม — ลำดับที่กรอกไม่มีความหมายทางบัญชี */
    expect(splitProRata([acc('z', 99999n), acc('a', 1n)], 1n)).toEqual([
      { budgetAccountId: 'z', amountSatang: 1n },
    ]);
  });

  it('ยอดเท่ากันตัดสินด้วย id เพื่อให้ผลลัพธ์เหมือนเดิมทุกครั้ง', () => {
    const first = splitProRata([acc('b', 100n), acc('a', 100n)], 1n);
    const second = splitProRata([acc('a', 100n), acc('b', 100n)], 1n);

    expect(first).toEqual([{ budgetAccountId: 'a', amountSatang: 1n }]);
    expect(second).toEqual(first);
  });

  it('ไม่มีอะไรให้แบ่งก็คืนรายการว่าง', () => {
    expect(splitProRata([], 100n)).toEqual([]);
    expect(splitProRata([acc('a', 100n)], 0n)).toEqual([]);
  });

  it('totalOutstanding รวมทุกบรรทัด', () => {
    expect(totalOutstanding([acc('a', 100n), acc('b', 250n)])).toBe(350n);
  });
});

describe('schema ของการเบิกจ่าย', () => {
  const base = {
    procurementId: '00000000-0000-4000-8000-000000000001',
    amount: '1500.00',
    paidOn: '2026-02-01',
  };

  it('รับข้อมูลที่ครบถ้วน', () => {
    expect(disbursementSchema.parse(base).amount).toBe('1500.00');
  });

  it('ปฏิเสธจำนวนเงินที่เป็นศูนย์หรือติดลบ', () => {
    expect(disbursementSchema.safeParse({ ...base, amount: '0' }).success).toBe(false);
    expect(disbursementSchema.safeParse({ ...base, amount: '-5' }).success).toBe(false);
  });

  it('ปฏิเสธทศนิยมเกินสองตำแหน่ง — ต่ำกว่าสตางค์ไม่มีอยู่จริง', () => {
    expect(disbursementSchema.safeParse({ ...base, amount: '1.005' }).success).toBe(false);
  });

  it('ช่องที่ไม่บังคับรับค่าว่างจากฟอร์ม HTML ได้', () => {
    const parsed = disbursementSchema.parse({ ...base, documentNo: '', payeeName: '', note: '' });

    expect(parsed.documentNo).toBeUndefined();
    expect(parsed.payeeName).toBeUndefined();
  });

  it('การยกเลิกต้องมีเหตุผล', () => {
    const input = { disbursementId: '00000000-0000-4000-8000-000000000002' };

    expect(disbursementVoidSchema.safeParse({ ...input, reason: '   ' }).success).toBe(false);
    expect(disbursementVoidSchema.safeParse({ ...input, reason: 'บันทึกผิดใบ' }).success).toBe(
      true,
    );
  });
});

describe('กติกาการเบิกจ่ายตรงกันระหว่างโดเมนกับฐานข้อมูล', () => {
  /*
   * ตัดคอมเมนต์ `--` ออกก่อนเทียบ
   *
   * ไฟล์ migration มีคอมเมนต์ภาษาไทยอธิบายกฎอยู่มาก ถ้าเทียบกับข้อความดิบ
   * การ "ปิดโค้ดทิ้งไว้เป็นคอมเมนต์" จะยังทำให้ assertion ผ่าน ซึ่งจับ regression ไม่ได้จริง
   */
  const sql = readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

  it('SQL ยอมรับสถานะชุดเดียวกับโดเมน', () => {
    expect(sql).toContain("select p_status in ('PARTIALLY_RECEIVED', 'RECEIVED');");
  });

  it('ทั้งสองฟังก์ชันที่แตะเงินตรวจ procurement.disburse ก่อนเสมอ', () => {
    for (const fn of ['procurement_disburse', 'procurement_disbursement_void']) {
      const start = sql.indexOf(`create or replace function public.${fn}`);
      expect(start, `ไม่พบฟังก์ชัน ${fn}`).toBeGreaterThan(-1);

      const body = sql.slice(start, sql.indexOf('$$;', start));
      expect(body, `${fn} ไม่ได้ตรวจสิทธิ์`).toContain("has_permission('procurement.disburse')");
    }
  });

  /*
   * RELEASE กับ ACTUAL ต้องลงคู่กันในลูปเดียว
   *
   * ถ้าแยกเป็นสองลูปหรือสองฟังก์ชัน จะมีจังหวะที่ยอดถูกนับซ้ำหรือหายทั้งก้อน
   * ซึ่งเป็นทั้งเหตุผลของ PR นี้และสิ่งที่พังได้ง่ายที่สุดตอนแก้ภายหลัง
   */
  it('SQL ลง RELEASE คู่กับ ACTUAL ในลูปเดียวกัน', () => {
    const start = sql.indexOf('create or replace function public.procurement_disburse');
    const body = sql.slice(start, sql.indexOf('$$;', start));
    const loop = body.slice(body.indexOf('loop'), body.indexOf('end loop'));

    expect(loop).toContain("'RELEASE'");
    expect(loop).toContain("'ACTUAL'");
  });

  it('SQL หารด้วยตัวแปร bigint ไม่ใช่ผลของ sum() ที่เป็น numeric', () => {
    expect(sql).toContain('(b.os * v_amount_satang) / v_total_satang');
    expect(sql).not.toContain('/ (select sum(os) from base)');
  });

  it('การกันยอดนับเฉพาะรายการคืนยอดที่ยังไม่ถูกย้อน', () => {
    const start = sql.indexOf('create or replace function public.budget_post_movement');
    expect(start, 'migration 0019 ต้องออก budget_post_movement ใหม่').toBeGreaterThan(-1);

    const body = sql.slice(start, sql.indexOf('$$;', start));
    expect(body).toContain('rr.reverses_movement_id = r.id');
  });
});
