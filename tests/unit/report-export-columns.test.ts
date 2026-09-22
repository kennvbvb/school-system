import { describe, expect, it } from 'vitest';
import {
  budgetReportExportDataset,
  documentExceptionExportDataset,
  documentSequenceExportDataset,
  procurementRegisterExportDataset,
} from '@/features/reports/export-columns';
import type { BudgetReport } from '@/domain/budget/report';
import { buildProcurementRegister } from '@/domain/procurement/register';
import type { ProcurementRegisterRow } from '@/domain/procurement/register';
import type { DocumentExceptionRow, DocumentSequenceRow } from '@/domain/documents/sequence-report';

function resolveValues<Row>(
  dataset: {
    columns: readonly { key: string; value: (row: Row) => unknown }[];
    rows: readonly Row[];
  },
  rowIndex: number,
): Record<string, unknown> {
  const row = dataset.rows[rowIndex];
  if (row === undefined) throw new Error(`ไม่มีแถวที่ ${rowIndex}`);
  return Object.fromEntries(dataset.columns.map((column) => [column.key, column.value(row)]));
}

// -----------------------------------------------------------------------------
// รายงานงบประมาณ
// -----------------------------------------------------------------------------

describe('budgetReportExportDataset', () => {
  function sampleReport(): BudgetReport {
    return {
      dimension: 'PROJECT',
      accountCount: 3,
      groups: [
        {
          key: 'p1',
          labelTh: 'โครงการอาหารกลางวัน',
          accountCount: 2,
          amounts: {
            grantedSatang: 100_000n,
            reservedSatang: 20_000n,
            usedSatang: 30_000n,
            availableSatang: 50_000n,
          },
        },
        {
          key: '__UNASSIGNED__',
          labelTh: 'ไม่ได้ผูกกับโครงการ',
          accountCount: 1,
          // ยังไม่ได้รับงบ — utilizationBasisPoints ต้องได้ null ไม่ใช่ 0
          amounts: { grantedSatang: 0n, reservedSatang: 0n, usedSatang: 0n, availableSatang: 0n },
        },
      ],
      total: {
        grantedSatang: 100_000n,
        reservedSatang: 20_000n,
        usedSatang: 30_000n,
        availableSatang: 50_000n,
      },
    };
  }

  it('หัวคอลัมน์แรกใช้ป้ายภาษาไทยของมิติที่เลือก และชื่อชุดข้อมูลอ้างถึงมิติเดียวกัน', () => {
    const dataset = budgetReportExportDataset(sampleReport());
    expect(dataset.columns[0]?.header).toBe('โครงการ');
    expect(dataset.title).toBe('ยอดงบตามโครงการ');
  });

  it('เติมแถวรวมทั้งหมดไว้ท้ายสุด ต่อจากกลุ่มทั้งหมดตามลำดับเดิม', () => {
    const report = sampleReport();
    const dataset = budgetReportExportDataset(report);

    expect(dataset.rows).toHaveLength(3);
    expect(dataset.rows[0]).toBe(report.groups[0]);
    expect(dataset.rows[1]).toBe(report.groups[1]);
    expect(dataset.rows[2]?.labelTh).toBe('รวมทั้งหมด');
    expect(dataset.rows[2]?.accountCount).toBe(report.accountCount);
    expect(dataset.rows[2]?.amounts).toEqual(report.total);
  });

  it('คอลัมน์เงินอ่านค่าจาก satangToDecimalString ไม่ใช่ bigint ตรง ๆ', () => {
    const dataset = budgetReportExportDataset(sampleReport());
    const values = resolveValues(dataset, 0);

    expect(values.granted).toBe('1000.00');
    expect(values.reserved).toBe('200.00');
    expect(values.used).toBe('300.00');
    expect(values.available).toBe('500.00');
    expect(dataset.columns.find((c) => c.key === 'granted')?.type).toBe('money');
  });

  it('คอลัมน์สัดส่วนที่ใช้เป็นชนิด percent และอ่านค่าจาก utilizationBasisPoints', () => {
    const dataset = budgetReportExportDataset(sampleReport());
    const column = dataset.columns.find((c) => c.key === 'utilization');
    expect(column?.type).toBe('percent');

    // แถว 0: granted=100000, reserved+used=50000 -> 5000 หน่วยหนึ่งในหมื่น (50%)
    expect(resolveValues(dataset, 0).utilization).toBe(5_000);
    // แถว 1: ยังไม่ได้รับงบ -> null ไม่ใช่ 0
    expect(resolveValues(dataset, 1).utilization).toBeNull();
  });

  it('คอลัมน์จำนวนบัญชีเป็นชนิด integer', () => {
    const dataset = budgetReportExportDataset(sampleReport());
    expect(dataset.columns.find((c) => c.key === 'accountCount')?.type).toBe('integer');
    expect(resolveValues(dataset, 0).accountCount).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// ทะเบียนจัดซื้อจัดจ้าง
// -----------------------------------------------------------------------------

function baseRegisterRow(overrides: Partial<ProcurementRegisterRow> = {}): ProcurementRegisterRow {
  return {
    procurementId: 'p-1',
    reference: 'RG-0001',
    subject: 'จัดซื้อวัสดุสำนักงาน',
    status: 'ISSUED',
    classification: 'GOODS',
    method: 'SPECIFIC',
    isEmergency: false,
    fiscalYearId: 'fy-1',
    fiscalYearCode: '2569',
    departmentName: 'ฝ่ายบริหารงานทั่วไป',
    vendorName: 'ร้านตัวอย่าง',
    requestDate: '2026-01-10',
    orderDate: '2026-01-15',
    requestMemoNo: 'ศธ04/1/2569',
    requestMemoStatus: 'ISSUED',
    purchaseOrderNo: 'ศธ04/2/2569',
    purchaseOrderStatus: 'ISSUED',
    grandTotalSatang: 150_000n,
    fundingTotalSatang: 150_000n,
    ...overrides,
  };
}

describe('procurementRegisterExportDataset', () => {
  it('ใช้แถวของ register.rows ตรง ๆ ไม่กรองหรือเรียงใหม่ และไม่เติมแถวรวม', () => {
    const rows = [
      baseRegisterRow({ procurementId: 'p-1' }),
      baseRegisterRow({ procurementId: 'p-2' }),
    ];
    const register = buildProcurementRegister(rows);
    const dataset = procurementRegisterExportDataset(register);

    expect(dataset.rows).toBe(register.rows);
    expect(dataset.rows).toHaveLength(2);
  });

  it('กรณีเร่งด่วนแปลงเป็น "ใช่"/"ไม่ใช่" เป็นข้อความเสมอ ไม่ใช่ boolean', () => {
    const withEmergency = buildProcurementRegister([baseRegisterRow({ isEmergency: true })]);
    const withoutEmergency = buildProcurementRegister([baseRegisterRow({ isEmergency: false })]);

    expect(resolveValues(procurementRegisterExportDataset(withEmergency), 0).isEmergency).toBe(
      'ใช่',
    );
    expect(resolveValues(procurementRegisterExportDataset(withoutEmergency), 0).isEmergency).toBe(
      'ไม่ใช่',
    );
  });

  it('ประเภทและวิธีจัดหาเป็นขีดกลางเมื่อเป็น null', () => {
    const register = buildProcurementRegister([
      baseRegisterRow({ classification: null, method: null }),
    ]);
    const values = resolveValues(procurementRegisterExportDataset(register), 0);
    expect(values.classification).toBe('—');
    expect(values.method).toBe('—');
  });

  describe('ข้อความเลขที่เอกสาร', () => {
    it('status เป็น null แปลว่ายังไม่ได้บันทึก', () => {
      const register = buildProcurementRegister([
        baseRegisterRow({ requestMemoNo: null, requestMemoStatus: null }),
      ]);
      expect(resolveValues(procurementRegisterExportDataset(register), 0).requestMemoNo).toBe(
        'ยังไม่ได้บันทึก',
      );
    });

    it('status เป็น ISSUED แสดงเลขที่เอกสารจริง', () => {
      const register = buildProcurementRegister([
        baseRegisterRow({ purchaseOrderNo: 'ศธ04/9/2569', purchaseOrderStatus: 'ISSUED' }),
      ]);
      expect(resolveValues(procurementRegisterExportDataset(register), 0).purchaseOrderNo).toBe(
        'ศธ04/9/2569',
      );
    });

    it('status เป็น PENDING/VOIDED/NOT_REQUIRED แสดงป้ายสถานะ ไม่ใช่เลข', () => {
      for (const status of ['PENDING', 'VOIDED', 'NOT_REQUIRED'] as const) {
        const register = buildProcurementRegister([
          baseRegisterRow({ purchaseOrderNo: null, purchaseOrderStatus: status }),
        ]);
        const values = resolveValues(procurementRegisterExportDataset(register), 0);
        expect(values.purchaseOrderNo).not.toBe('ยังไม่ได้บันทึก');
        expect(typeof values.purchaseOrderNo).toBe('string');
        expect((values.purchaseOrderNo as string).length).toBeGreaterThan(0);
      }
    });
  });

  it('ข้อสังเกตว่างเมื่อไม่มีธง และต่อกันด้วย " / " เมื่อมีหลายธง', () => {
    // สถานะ ISSUED ไม่มีเลขใบสั่งซื้อและยอดเป็นศูนย์ -> ติดสองธงพร้อมกัน
    const flagged = buildProcurementRegister([
      baseRegisterRow({
        purchaseOrderNo: null,
        purchaseOrderStatus: null,
        grandTotalSatang: 0n,
        fundingTotalSatang: 0n,
      }),
    ]);
    const clean = buildProcurementRegister([baseRegisterRow()]);

    const flaggedValue = resolveValues(procurementRegisterExportDataset(flagged), 0)
      .flags as string;
    expect(flaggedValue).toBe('ยังไม่มีเลขที่ใบสั่งซื้อ/ใบสั่งจ้าง / ยังไม่มีจำนวนเงิน');
    expect(resolveValues(procurementRegisterExportDataset(clean), 0).flags).toBe('—');
  });

  it('คอลัมน์เงินอ่านจาก satangToDecimalString', () => {
    const register = buildProcurementRegister([
      baseRegisterRow({ grandTotalSatang: 123_456n, fundingTotalSatang: 100_000n }),
    ]);
    const values = resolveValues(procurementRegisterExportDataset(register), 0);
    expect(values.grandTotal).toBe('1234.56');
    expect(values.fundingTotal).toBe('1000.00');
  });
});

// -----------------------------------------------------------------------------
// รายงานสถานะเอกสาร — ลำดับเลขที่เอกสาร
// -----------------------------------------------------------------------------

function baseSequenceRow(overrides: Partial<DocumentSequenceRow> = {}): DocumentSequenceRow {
  return {
    fiscalYearId: 'fy-1',
    fiscalYearCode: '2569',
    documentKind: 'PURCHASE_ORDER',
    issuedCount: 10,
    voidedCount: 1,
    pendingCount: 0,
    notRequiredCount: 0,
    minRunning: 1,
    maxRunning: 10,
    usedRunningCount: 10,
    missingCount: 0,
    missingSample: [],
    duplicateRunning: [],
    unparsedCount: 0,
    ...overrides,
  };
}

describe('documentSequenceExportDataset', () => {
  it('ไม่มีเลขขาด -> ขีดกลาง', () => {
    const dataset = documentSequenceExportDataset([baseSequenceRow({ missingCount: 0 })]);
    expect(resolveValues(dataset, 0).missingSample).toBe('—');
  });

  it('มีเลขขาดแต่ไม่มีตัวอย่าง (ช่วงกว้างเกินไป) -> บอกจำนวนพร้อมวงเล็บอธิบาย', () => {
    const dataset = documentSequenceExportDataset([
      baseSequenceRow({ missingCount: 9_950, missingSample: [] }),
    ]);
    expect(resolveValues(dataset, 0).missingSample).toBe(
      'ขาด 9950 เลข (ช่วงกว้างเกินกว่าจะไล่รายตัว)',
    );
  });

  it('มีตัวอย่างครบตามจำนวนที่ขาด -> แสดงช่วงอย่างเดียว ไม่มี "รวม N เลข" ต่อท้าย', () => {
    const dataset = documentSequenceExportDataset([
      baseSequenceRow({ missingCount: 3, missingSample: [14, 15, 16] }),
    ]);
    expect(resolveValues(dataset, 0).missingSample).toBe('14–16');
  });

  it('มีตัวอย่างไม่ครบตามจำนวนที่ขาด -> ต่อท้ายด้วย "… รวม N เลข"', () => {
    const dataset = documentSequenceExportDataset([
      baseSequenceRow({ missingCount: 77, missingSample: [14, 15, 16] }),
    ]);
    expect(resolveValues(dataset, 0).missingSample).toBe('14–16 … รวม 77 เลข');
  });

  it('ยุบเลขที่ขาด/ซ้ำติดกันเป็นช่วง และคั่นช่วงที่ไม่ติดกันด้วยจุลภาค', () => {
    const dataset = documentSequenceExportDataset([
      baseSequenceRow({ missingCount: 5, missingSample: [9, 10, 11, 20, 21] }),
    ]);
    expect(resolveValues(dataset, 0).missingSample).toBe('9–11, 20–21');
  });

  it('เลขลำดับซ้ำว่างเปล่า -> ขีดกลาง, มีค่า -> เป็นช่วง', () => {
    const noDup = documentSequenceExportDataset([baseSequenceRow({ duplicateRunning: [] })]);
    const withDup = documentSequenceExportDataset([
      baseSequenceRow({ duplicateRunning: [91, 91] }),
    ]);

    expect(resolveValues(noDup, 0).duplicateRunning).toBe('—');
    expect(resolveValues(withDup, 0).duplicateRunning).toBe('91');
  });

  it('ข้อสังเกตว่างเมื่อไม่มีธง และมีข้อความเมื่อมีธง (เลขขาด)', () => {
    const clean = documentSequenceExportDataset([baseSequenceRow()]);
    const flagged = documentSequenceExportDataset([
      baseSequenceRow({ missingCount: 5, missingSample: [1, 2, 3, 4, 5] }),
    ]);

    expect(resolveValues(clean, 0).flags).toBe('—');
    expect(resolveValues(flagged, 0).flags).toContain('ขาด');
  });

  it('คอลัมน์นับจำนวนเป็นชนิด integer และส่งต่อค่า null ของ min/max ได้', () => {
    const dataset = documentSequenceExportDataset([
      baseSequenceRow({ minRunning: null, maxRunning: null }),
    ]);
    expect(dataset.columns.find((c) => c.key === 'issued')?.type).toBe('integer');
    const values = resolveValues(dataset, 0);
    expect(values.minRunning).toBeNull();
    expect(values.maxRunning).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// รายงานสถานะเอกสาร — รายการยกเว้น
// -----------------------------------------------------------------------------

function baseExceptionRow(overrides: Partial<DocumentExceptionRow> = {}): DocumentExceptionRow {
  return {
    documentNumberId: 'dn-1',
    fiscalYearCode: '2569',
    documentKind: 'PURCHASE_ORDER',
    status: 'PENDING',
    documentNo: null,
    runningNo: null,
    reason: 'รอเลขจากฝ่ายพัสดุ',
    procurementId: 'p-1',
    procurementReference: 'RG-0001',
    procurementSubject: 'จัดซื้อวัสดุสำนักงาน',
    createdAt: '2026-01-10T03:00:00.000Z',
    voidedAt: null,
    ...overrides,
  };
}

describe('documentExceptionExportDataset', () => {
  it('เลขที่เอกสารเดิมและเหตุผลเป็นขีดกลางเมื่อเป็น null', () => {
    const dataset = documentExceptionExportDataset([
      baseExceptionRow({ documentNo: null, reason: null }),
    ]);
    const values = resolveValues(dataset, 0);
    expect(values.documentNo).toBe('—');
    expect(values.reason).toBe('—');
  });

  it('บอกตรง ๆ เมื่อผู้อ่านไม่มีสิทธิ์อ่านรายการต้นทาง แทนที่จะเป็นช่องว่างหรือขีดกลาง', () => {
    const dataset = documentExceptionExportDataset([
      baseExceptionRow({ procurementReference: null, procurementSubject: null }),
    ]);
    const values = resolveValues(dataset, 0);
    expect(values.procurementReference).toBe('(ไม่มีสิทธิ์อ่านรายการต้นทาง)');
    expect(values.procurementSubject).toBe('—');
  });

  it('คอลัมน์บันทึกเมื่อ/ยกเลิกเมื่อเป็นชนิด datetime และส่งต่อค่า ISO ดิบ', () => {
    const dataset = documentExceptionExportDataset([
      baseExceptionRow({
        createdAt: '2026-01-10T03:00:00.000Z',
        voidedAt: '2026-02-01T09:30:00.000Z',
      }),
    ]);
    expect(dataset.columns.find((c) => c.key === 'createdAt')?.type).toBe('datetime');
    const values = resolveValues(dataset, 0);
    expect(values.createdAt).toBe('2026-01-10T03:00:00.000Z');
    expect(values.voidedAt).toBe('2026-02-01T09:30:00.000Z');
  });

  it('เลขลำดับเป็นชนิด integer และส่งต่อ null ได้เมื่อยังไม่มีเลข', () => {
    const dataset = documentExceptionExportDataset([baseExceptionRow({ runningNo: null })]);
    expect(dataset.columns.find((c) => c.key === 'runningNo')?.type).toBe('integer');
    expect(resolveValues(dataset, 0).runningNo).toBeNull();
  });
});
