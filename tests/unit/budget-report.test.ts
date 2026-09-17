import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BUDGET_REPORT_DIMENSIONS,
  BUDGET_REPORT_DIMENSION_LABELS_TH,
  UNASSIGNED_GROUP_KEY,
  availableOf,
  buildBudgetReport,
  overdrawnRows,
  utilizationBasisPoints,
} from '@/domain/budget/report';
import {
  hasActiveBudgetReportFilter,
  parseBudgetReportFilter,
} from '@/domain/budget/report-schemas';
import { MOVEMENT_TYPES } from '@/domain/budget/movement';
import type { BudgetReportRow } from '@/domain/budget/report';

const MIGRATION = 'supabase/migrations/20260917000100_budget_report.sql';

/** แถวตั้งต้นที่ทุกช่องมีค่า เพื่อให้แต่ละ test เขียนเฉพาะช่องที่สนใจ */
function row(overrides: Partial<BudgetReportRow> = {}): BudgetReportRow {
  return {
    accountId: 'acc-1',
    accountCode: 'ACC-001',
    status: 'OPEN',
    fiscalYearId: 'fy-1',
    fiscalYearCode: 'FY2569',
    projectId: 'prj-1',
    projectName: 'โครงการหนึ่ง',
    fundingSourceId: 'fund-1',
    fundingSourceName: 'เงินอุดหนุน',
    departmentId: 'dept-1',
    departmentName: 'ฝ่ายหนึ่ง',
    grantedSatang: 0n,
    reservedSatang: 0n,
    usedSatang: 0n,
    ...overrides,
  };
}

describe('การจัดกลุ่มและยอดรวม', () => {
  /*
   * ข้อที่สำคัญที่สุดของไฟล์นี้
   *
   * รายงานที่ยอดรวมไม่เท่ากับผลรวมของรายละเอียดคือรายงานที่อันตรายกว่าไม่มีเลย
   * เพราะผู้อ่านเชื่อตัวเลขที่เห็นไปแล้ว — ทดสอบกับชุดที่มีทั้งค่าว่าง
   * บัญชีที่ยอดเป็นศูนย์ และหลายบัญชีในกลุ่มเดียวกันปนอยู่ด้วย
   */
  const mixed: BudgetReportRow[] = [
    row({ accountId: 'a1', accountCode: 'A1', grantedSatang: 100_000n, usedSatang: 30_000n }),
    row({
      accountId: 'a2',
      accountCode: 'A2',
      grantedSatang: 50_000n,
      reservedSatang: 20_000n,
    }),
    row({
      accountId: 'a3',
      accountCode: 'A3',
      projectId: 'prj-2',
      projectName: 'โครงการสอง',
      grantedSatang: 70_000n,
    }),
    row({
      accountId: 'a4',
      accountCode: 'A4',
      projectId: null,
      projectName: null,
      grantedSatang: 25_000n,
      usedSatang: 5_000n,
    }),
    row({ accountId: 'a5', accountCode: 'A5', projectId: null, projectName: null }),
  ];

  it('ทุกแถวลงกลุ่มเดียว จำนวนบัญชีรวมจึงเท่ากับจำนวนแถว', () => {
    for (const dimension of BUDGET_REPORT_DIMENSIONS) {
      const report = buildBudgetReport(mixed, dimension);
      const summed = report.groups.reduce((total, group) => total + group.accountCount, 0);

      expect(summed, dimension).toBe(mixed.length);
      expect(report.accountCount, dimension).toBe(mixed.length);
    }
  });

  it('ยอดรวมทั้งหมดเท่ากับผลรวมของทุกกลุ่ม ในทุกมิติ', () => {
    for (const dimension of BUDGET_REPORT_DIMENSIONS) {
      const report = buildBudgetReport(mixed, dimension);

      const granted = report.groups.reduce((sum, g) => sum + g.amounts.grantedSatang, 0n);
      const reserved = report.groups.reduce((sum, g) => sum + g.amounts.reservedSatang, 0n);
      const used = report.groups.reduce((sum, g) => sum + g.amounts.usedSatang, 0n);
      const available = report.groups.reduce((sum, g) => sum + g.amounts.availableSatang, 0n);

      expect(granted, dimension).toBe(report.total.grantedSatang);
      expect(reserved, dimension).toBe(report.total.reservedSatang);
      expect(used, dimension).toBe(report.total.usedSatang);
      expect(available, dimension).toBe(report.total.availableSatang);
    }
  });

  it('ยอดรวมเท่ากับผลบวกของแถวดิบ ไม่ใช่แค่สอดคล้องกันเองภายใน', () => {
    const report = buildBudgetReport(mixed, 'PROJECT');

    expect(report.total.grantedSatang).toBe(245_000n);
    expect(report.total.reservedSatang).toBe(20_000n);
    expect(report.total.usedSatang).toBe(35_000n);
    expect(report.total.availableSatang).toBe(190_000n);
  });

  it('หลายบัญชีในโครงการเดียวกันถูกรวมเป็นกลุ่มเดียว', () => {
    const report = buildBudgetReport(mixed, 'PROJECT');
    const group = report.groups.find((item) => item.key === 'prj-1');

    expect(group?.accountCount).toBe(2);
    expect(group?.amounts.grantedSatang).toBe(150_000n);
  });

  /*
   * บัญชีงบผูกครบทั้งสาม scope ไม่ได้เสมอไป บัญชีที่ผูกกับแหล่งเงินอย่างเดียว
   * ต้องยังปรากฏในรายงานตามโครงการ มิฉะนั้นยอดรวมจะน้อยกว่าความจริงโดยที่
   * หน้าจอดูปกติทุกอย่าง
   */
  it('แถวที่ไม่ได้ผูกกับมิติที่เลือกไปอยู่กลุ่มรวม ไม่หายไป', () => {
    const report = buildBudgetReport(mixed, 'PROJECT');
    const group = report.groups.find((item) => item.key === UNASSIGNED_GROUP_KEY);

    expect(group?.accountCount).toBe(2);
    expect(group?.amounts.grantedSatang).toBe(25_000n);
    expect(group?.labelTh).toBe(`ไม่ได้ผูกกับ${BUDGET_REPORT_DIMENSION_LABELS_TH.PROJECT}`);
  });

  it('กลุ่มรวมอยู่ท้ายสุดเสมอ แม้ชื่อจะเรียงมาก่อน', () => {
    const report = buildBudgetReport(mixed, 'PROJECT');

    expect(report.groups.at(-1)?.key).toBe(UNASSIGNED_GROUP_KEY);
  });

  it('กลุ่มที่เหลือเรียงตามชื่อภาษาไทย', () => {
    const report = buildBudgetReport(
      [
        row({ accountId: 'x', projectId: 'p-z', projectName: 'ฮอ' }),
        row({ accountId: 'y', projectId: 'p-a', projectName: 'กอ' }),
      ],
      'PROJECT',
    );

    expect(report.groups.map((group) => group.labelTh)).toEqual(['กอ', 'ฮอ']);
  });

  /*
   * ชื่อว่างเกิดได้เมื่อผู้อ่านไม่มีสิทธิ์เห็นตาราง master data ที่ join มา
   * แถวนั้นต้องยังนับอยู่ในยอด ไม่ใช่ถูกยุบรวมเข้ากลุ่ม "ไม่ได้ผูก"
   * ซึ่งจะทำให้ผู้อ่านเข้าใจว่าเงินก้อนนั้นไม่ได้อยู่ในโครงการใดเลย
   */
  it('แถวที่มี id แต่ไม่มีชื่อ ยังแยกเป็นกลุ่มของตัวเอง', () => {
    const report = buildBudgetReport(
      [row({ projectId: 'prj-9', projectName: null, grantedSatang: 1_000n })],
      'PROJECT',
    );

    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]?.key).toBe('prj-9');
    expect(report.groups[0]?.labelTh).toContain('prj-9');
    expect(report.total.grantedSatang).toBe(1_000n);
  });

  it('ชุดว่างได้รายงานว่างที่ยอดรวมเป็นศูนย์ ไม่ใช่ error', () => {
    const report = buildBudgetReport([], 'PROJECT');

    expect(report.groups).toEqual([]);
    expect(report.accountCount).toBe(0);
    expect(report.total.grantedSatang).toBe(0n);
    expect(report.total.availableSatang).toBe(0n);
  });
});

describe('ยอดที่ใช้ได้และสัดส่วนการใช้งบ', () => {
  it('ยอดที่ใช้ได้คือ granted − reserved − used', () => {
    expect(availableOf({ grantedSatang: 100n, reservedSatang: 30n, usedSatang: 20n })).toBe(50n);
  });

  it('ยอดที่ใช้ได้ติดลบได้ ไม่ถูกปัดเป็นศูนย์ (ข้อค้นพบ F-01)', () => {
    expect(availableOf({ grantedSatang: 600_000n, reservedSatang: 0n, usedSatang: 619_900n })).toBe(
      -19_900n,
    );
  });

  it('สัดส่วนนับทั้งยอดที่กันไว้และยอดที่ใช้จริง', () => {
    expect(
      utilizationBasisPoints({
        grantedSatang: 100_000n,
        reservedSatang: 20_000n,
        usedSatang: 30_000n,
        availableSatang: 50_000n,
      }),
    ).toBe(5_000);
  });

  it('สัดส่วนเกินหนึ่งหมื่นเมื่อใช้เกินงบที่ได้รับ', () => {
    const basisPoints = utilizationBasisPoints({
      grantedSatang: 100_000n,
      reservedSatang: 0n,
      usedSatang: 120_000n,
      availableSatang: -20_000n,
    });

    expect(basisPoints).toBeGreaterThan(10_000);
  });

  /*
   * การแสดง 0% เมื่อยังไม่มีงบ ทำให้ผู้อ่านเข้าใจว่าได้งบมาแล้วแต่ยังไม่ได้ใช้
   * ซึ่งตรงข้ามกับความจริง
   */
  it('คืน null เมื่อยังไม่ได้รับงบ แทนที่จะเป็นศูนย์หรือหารด้วยศูนย์', () => {
    expect(
      utilizationBasisPoints({
        grantedSatang: 0n,
        reservedSatang: 0n,
        usedSatang: 5_000n,
        availableSatang: -5_000n,
      }),
    ).toBeNull();
  });
});

describe('บัญชีที่ใช้งบเกิน', () => {
  const rows = [
    row({ accountId: 'a', accountCode: 'ACC-A', grantedSatang: 100n, usedSatang: 300n }),
    row({ accountId: 'b', accountCode: 'ACC-B', grantedSatang: 100n, usedSatang: 100n }),
    row({ accountId: 'c', accountCode: 'ACC-C', grantedSatang: 100n, usedSatang: 900n }),
    row({ accountId: 'd', accountCode: 'ACC-D', grantedSatang: 100n, usedSatang: 300n }),
  ];

  it('คัดเฉพาะบัญชีที่ติดลบ ยอดศูนย์พอดีไม่นับ', () => {
    expect(overdrawnRows(rows).map((item) => item.accountCode)).not.toContain('ACC-B');
    expect(overdrawnRows(rows)).toHaveLength(3);
  });

  it('เรียงจากติดลบมากที่สุด แล้วจึงตามรหัสบัญชี', () => {
    expect(overdrawnRows(rows).map((item) => item.accountCode)).toEqual([
      'ACC-C',
      'ACC-A',
      'ACC-D',
    ]);
  });
});

describe('ตัวกรองจาก query string', () => {
  it('ค่าที่ผิดรูปแบบถูกปัดทิ้ง ไม่ทำให้ทั้งหน้าล้ม', () => {
    const filter = parseBudgetReportFilter({
      fiscalYearId: 'ไม่ใช่ uuid',
      dimension: 'BY_MOON_PHASE',
      asOf: '31/09/2568',
    });

    expect(filter.fiscalYearId).toBeUndefined();
    expect(filter.dimension).toBe('PROJECT');
    expect(filter.asOf).toBeUndefined();
  });

  it('รับค่าที่ถูกต้องตามที่ส่งมา', () => {
    const filter = parseBudgetReportFilter({
      fiscalYearId: '11111111-1111-4111-8111-111111111111',
      dimension: 'FUNDING_SOURCE',
      asOf: '2026-09-30',
      onlyOpen: '1',
    });

    expect(filter.fiscalYearId).toBe('11111111-1111-4111-8111-111111111111');
    expect(filter.dimension).toBe('FUNDING_SOURCE');
    expect(filter.asOf).toBe('2026-09-30');
    expect(filter.onlyOpen).toBe(true);
  });

  it('อ่านค่าแรกเมื่อ query string ส่งมาเป็น array', () => {
    const filter = parseBudgetReportFilter({ dimension: ['DEPARTMENT', 'PROJECT'] });

    expect(filter.dimension).toBe('DEPARTMENT');
  });

  /*
   * ค่าเริ่มต้นต้องเป็นค่าที่ไม่ซ่อนข้อมูลใดไว้ — บัญชีที่ปิดแล้วยังถือยอดที่ใช้ไป
   * ของปีนั้น การซ่อนเป็นค่าเริ่มต้นทำให้ยอดรวมน้อยกว่าความจริงโดยไม่มีใครรู้
   */
  it('ค่าเริ่มต้นนับบัญชีที่ปิดแล้วด้วย', () => {
    expect(parseBudgetReportFilter({}).onlyOpen).toBe(false);
    expect(parseBudgetReportFilter({ onlyOpen: 'ใช่' }).onlyOpen).toBe(false);
  });

  it('การเปลี่ยนมิติไม่นับเป็นการกรอง เพราะไม่ได้ตัดข้อมูลออกจากยอดรวม', () => {
    expect(hasActiveBudgetReportFilter(parseBudgetReportFilter({ dimension: 'DEPARTMENT' }))).toBe(
      false,
    );
    expect(hasActiveBudgetReportFilter(parseBudgetReportFilter({ asOf: '2026-09-30' }))).toBe(true);
    expect(hasActiveBudgetReportFilter(parseBudgetReportFilter({ onlyOpen: '1' }))).toBe(true);
  });
});

/**
 * ตัดคอมเมนต์ `--` ออกก่อนเทียบ
 *
 * มิฉะนั้นโค้ดที่ถูก comment ทิ้งไว้จะทำให้ข้อความยืนยันเป็นจริงทั้งที่ของจริง
 * ไม่ทำงานแล้ว — เคยเกิดขึ้นจริงกับ parity test ของ PR-05a
 */
function strippedSql(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

describe('ความสอดคล้องระหว่างโดเมนกับ SQL', () => {
  /*
   * **ข้อที่ปิดความเงียบที่อันตรายที่สุดของรายงานนี้**
   *
   * ถ้ามีใครเพิ่มชนิดรายการใหม่ใน MOVEMENT_TYPES แล้วไม่ได้เพิ่มลงใน case ของ
   * ฟังก์ชันรายงาน เงินของชนิดนั้นจะตกลง `else 0` แล้วหายไปจากยอดเงียบ ๆ
   * ต่างจาก availability.ts ที่ถือชนิดที่ไม่รู้จักเป็นการให้งบโดยปริยาย
   * ทั้งสองฝั่งจึงจะตอบไม่ตรงกันโดยไม่มีอะไรฟ้อง
   */
  it('ทุกชนิดรายการยกเว้น REVERSAL ปรากฏในฟังก์ชันรายงาน', () => {
    const sql = strippedSql(readFileSync(MIGRATION, 'utf8'));
    const body = sql.slice(sql.indexOf('create or replace function public.budget_report_rows'));

    for (const type of MOVEMENT_TYPES) {
      if (type === 'REVERSAL') continue;
      expect(body, `ชนิด ${type} ไม่ถูกจัดกลุ่มในฟังก์ชันรายงาน`).toContain(`'${type}'`);
    }
  });

  /*
   * REVERSAL ต้องไม่อยู่ในกลุ่มใดกลุ่มหนึ่งของ case
   *
   * ทิศทางของมันขึ้นกับแถวที่มันย้อน ไม่ใช่ตัวมันเอง การใส่ลงกลุ่มตรง ๆ
   * จะทำให้การย้อนการกันยอดไปลดยอดงบที่ได้รับแทนที่จะคืนยอดที่กันไว้
   */
  it("ฟังก์ชันไม่จัดกลุ่ม effective_type ว่าเป็น 'REVERSAL'", () => {
    const sql = strippedSql(readFileSync(MIGRATION, 'utf8'));

    expect(sql).not.toContain("e.effective_type = 'REVERSAL'");
    expect(sql).not.toContain("e.effective_type in ('REVERSAL'");
  });

  /*
   * ยอดที่ใช้ได้ต้องมีนิยามเดียวในระบบ — คือการลบที่ availableOf()
   * ถ้าฟังก์ชันคืนมาเป็นคอลัมน์ที่สี่ด้วย จะมีสูตรสองชุดของเลขเดียวกัน
   * ที่วันหนึ่งจะเพี้ยนจากกันโดยไม่มีใครรู้ว่าชุดไหนถูก
   */
  it('ฟังก์ชันไม่คืนยอดที่ใช้ได้มาเป็นคอลัมน์ของตัวเอง', () => {
    const sql = strippedSql(readFileSync(MIGRATION, 'utf8'));

    expect(sql).not.toContain('available_amount');
  });
});

describe('รายงานอ่านอย่างเดียว', () => {
  /*
   * รายงานที่เขียนข้อมูลได้คือรายงานที่เปลี่ยนสิ่งที่ตัวเองรายงาน
   * ตรวจที่ไฟล์ตรง ๆ เพราะไม่มี type ใดห้ามไว้
   */
  it('repository ไม่มีคำสั่งเขียนใด ๆ', () => {
    const source = readFileSync('src/server/reports/repository.ts', 'utf8');

    for (const call of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      expect(source, `พบคำสั่งเขียน ${call} ในรายงาน`).not.toContain(call);
    }
  });

  /*
   * ยอดงบทั้งโรงเรียนรวมอยู่ในคำตอบเดียว ถ้าอ่านด้วย service-role
   * การลืมตรวจสิทธิ์ในชั้นแอปจะเปิดตัวเลขทั้งหมดให้ทุกคนอ่านทันที
   */
  it('repository ไม่ใช้ service-role client', () => {
    const source = readFileSync('src/server/reports/repository.ts', 'utf8');

    expect(source).not.toContain('admin-client');
    expect(source).toContain('createSupabaseServerClient');
  });

  it('หน้ารายงานตรวจสิทธิ์ก่อนเสมอ', () => {
    const source = readFileSync('src/app/(dashboard)/reports/budget/page.tsx', 'utf8');

    expect(source).toContain('requireAnyPermissionForPage');
    expect(source).toContain("'budget.read'");
  });
});
