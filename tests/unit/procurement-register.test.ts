import { describe, expect, it } from 'vitest';
import {
  buildProcurementRegister,
  expectsCompleteData,
  registerFlagsOf,
  REGISTER_FLAGS,
  REGISTER_FLAG_LABELS_TH,
} from '@/domain/procurement/register';
import type { ProcurementRegisterRow } from '@/domain/procurement/register';
import { PROCUREMENT_STATUSES } from '@/domain/procurement/status';
import type { ProcurementStatus } from '@/domain/procurement/status';
import {
  hasActiveRegisterFilter,
  hasReversedDateRange,
  parseProcurementRegisterFilter,
} from '@/domain/procurement/register-schemas';

/**
 * แถวตั้งต้นที่ "ครบถ้วน" — ออกใบสั่งซื้อแล้ว มีเลข มียอด และแหล่งเงินตรงยอด
 *
 * ทุก test ที่ตรวจข้อสังเกตแก้เพียงช่องเดียวจากแถวนี้ ผลที่ต่างออกไปจึงมาจาก
 * ช่องนั้นเท่านั้น ไม่ใช่จากการประกอบแถวใหม่ที่ต่างกันหลายจุดโดยไม่ตั้งใจ
 */
function completeRow(overrides: Partial<ProcurementRegisterRow> = {}): ProcurementRegisterRow {
  return {
    procurementId: '11111111-1111-4111-8111-111111111111',
    reference: 'D-000001',
    subject: 'จัดซื้อวัสดุสำนักงาน (ตัวอย่าง)',
    status: 'ISSUED',
    classification: 'GOODS',
    method: 'SPECIFIC',
    isEmergency: false,
    fiscalYearId: '22222222-2222-4222-8222-222222222222',
    fiscalYearCode: 'FY2569',
    departmentName: 'ฝ่ายบริหารงานทั่วไป (ตัวอย่าง)',
    vendorName: 'ร้านตัวอย่าง',
    requestDate: '2026-02-01',
    orderDate: '2026-02-10',
    requestMemoNo: '1/2569',
    requestMemoStatus: 'ISSUED',
    purchaseOrderNo: '5/2569',
    purchaseOrderStatus: 'ISSUED',
    grandTotalSatang: 100_000n,
    fundingTotalSatang: 100_000n,
    ...overrides,
  };
}

describe('expectsCompleteData', () => {
  it('ตรวจเฉพาะสถานะที่ออกเอกสารไปหาผู้ขายแล้ว', () => {
    expect(expectsCompleteData('ISSUED')).toBe(true);
    expect(expectsCompleteData('PARTIALLY_RECEIVED')).toBe(true);
    expect(expectsCompleteData('RECEIVED')).toBe(true);
  });

  it('ไม่ตรวจรายการที่ยังอยู่ระหว่างจัดทำ', () => {
    expect(expectsCompleteData('DRAFT')).toBe(false);
    expect(expectsCompleteData('PENDING_REVIEW')).toBe(false);
    expect(expectsCompleteData('NEEDS_REVISION')).toBe(false);
    expect(expectsCompleteData('PENDING_APPROVAL')).toBe(false);
  });

  /*
   * APPROVED ยังไม่ต้องมีเลขใบสั่งซื้อ
   *
   * ถ้ารวม APPROVED เข้าไปด้วย ทุกรายการที่เพิ่งอนุมัติจะติดธง "ยังไม่มีเลข"
   * ทันทีทั้งที่ขั้นตอนถัดไปคือการออกใบสั่งซื้อซึ่งยังไม่ถึงเวลา
   */
  it('ไม่ตรวจรายการที่เพิ่งอนุมัติ เพราะเลขใบสั่งซื้อเกิดตอนออกใบสั่งซื้อ', () => {
    expect(expectsCompleteData('APPROVED')).toBe(false);
  });

  it('ไม่ตรวจรายการที่จบไปแล้วโดยไม่มีใครต้องกลับไปแก้', () => {
    expect(expectsCompleteData('REJECTED')).toBe(false);
    expect(expectsCompleteData('CANCELLED')).toBe(false);
  });

  it('ครอบคลุมทุกสถานะใน state machine', () => {
    for (const status of PROCUREMENT_STATUSES) {
      expect(typeof expectsCompleteData(status)).toBe('boolean');
    }
  });
});

describe('registerFlagsOf', () => {
  it('แถวที่ครบถ้วนไม่มีข้อสังเกต', () => {
    expect(registerFlagsOf(completeRow())).toEqual([]);
  });

  it('ไม่มีแถวเลขที่เอกสารเลย = ยังไม่มีเลข (F-14)', () => {
    const flags = registerFlagsOf(
      completeRow({ purchaseOrderNo: null, purchaseOrderStatus: null }),
    );
    expect(flags).toEqual(['NO_DOCUMENT_NUMBER']);
  });

  /*
   * NOT_REQUIRED คือคำตอบที่บันทึกไว้แล้ว ไม่ใช่ช่องว่าง
   *
   * นี่คือหัวใจของกลไกที่ปิด F-14 — ไฟล์จริงมี 12 แถวที่ไม่มีเลข ซึ่ง "บางรายการ
   * อาจไม่ต้องมีเลขจริง" ถ้าทะเบียนยังทวงเลขจากแถวเหล่านี้ ผู้ใช้จะกรอกเลขปลอม
   * เพื่อให้ธงหาย ซึ่งแย่กว่าการบันทึกความจริงว่าไม่ต้องมีเลขเพราะอะไร
   */
  it('สถานะ "ไม่ต้องมีเลข" ไม่ถือเป็นข้อสังเกต', () => {
    expect(
      registerFlagsOf(completeRow({ purchaseOrderNo: null, purchaseOrderStatus: 'NOT_REQUIRED' })),
    ).toEqual([]);
  });

  it('สถานะ "ยังไม่ได้เลข" ยังถือว่ายังไม่มีเลข', () => {
    expect(
      registerFlagsOf(completeRow({ purchaseOrderNo: null, purchaseOrderStatus: 'PENDING' })),
    ).toEqual(['NO_DOCUMENT_NUMBER']);
  });

  /* เลขที่ยกเลิกแล้วห้ามนำกลับมาใช้ (migration 0014) รายการจึงยังไม่มีเลขที่ใช้ได้ */
  it('เลขที่ถูกยกเลิกแล้วไม่นับว่ามีเลข', () => {
    expect(
      registerFlagsOf(completeRow({ purchaseOrderNo: '5/2569', purchaseOrderStatus: 'VOIDED' })),
    ).toEqual(['NO_DOCUMENT_NUMBER']);
  });

  /* ดูเฉพาะใบสั่งซื้อ ไม่ใช่บันทึกขออนุมัติ — ตรวจว่าไม่ได้สลับสองช่องกัน */
  it('บันทึกขออนุมัติที่ยังไม่มีเลขไม่ทำให้ติดธง', () => {
    expect(registerFlagsOf(completeRow({ requestMemoNo: null, requestMemoStatus: null }))).toEqual(
      [],
    );
  });

  it('ยอดเงินเป็นศูนย์ = ยังไม่มีจำนวนเงิน (F-15)', () => {
    const flags = registerFlagsOf(completeRow({ grandTotalSatang: 0n, fundingTotalSatang: 0n }));
    expect(flags).toEqual(['ZERO_AMOUNT']);
  });

  it('แหล่งเงินรวมไม่เท่ากับยอดของรายการ = ข้อสังเกต (F-02)', () => {
    expect(registerFlagsOf(completeRow({ fundingTotalSatang: 60_000n }))).toEqual([
      'FUNDING_MISMATCH',
    ]);
  });

  it('แหล่งเงินที่ยังไม่ได้ผูกเลยก็ถือว่าไม่ตรง', () => {
    expect(registerFlagsOf(completeRow({ fundingTotalSatang: 0n }))).toEqual(['FUNDING_MISMATCH']);
  });

  it('ข้อสังเกตหลายข้อเรียงตามลำดับใน REGISTER_FLAGS เสมอ', () => {
    const flags = registerFlagsOf(
      completeRow({
        purchaseOrderNo: null,
        purchaseOrderStatus: null,
        grandTotalSatang: 0n,
        fundingTotalSatang: 500n,
      }),
    );
    expect(flags).toEqual(['NO_DOCUMENT_NUMBER', 'ZERO_AMOUNT', 'FUNDING_MISMATCH']);
  });

  it('รายการที่ยังเป็นฉบับร่างไม่ติดธงแม้ข้อมูลจะไม่ครบเลย', () => {
    const flags = registerFlagsOf(
      completeRow({
        status: 'DRAFT',
        purchaseOrderNo: null,
        purchaseOrderStatus: null,
        grandTotalSatang: 0n,
        fundingTotalSatang: 0n,
      }),
    );
    expect(flags).toEqual([]);
  });

  it('รายการที่ยกเลิกแล้วไม่ติดธง', () => {
    expect(
      registerFlagsOf(
        completeRow({ status: 'CANCELLED', purchaseOrderNo: null, purchaseOrderStatus: null }),
      ),
    ).toEqual([]);
  });

  it('รับของแล้วยังถูกตรวจอยู่', () => {
    expect(
      registerFlagsOf(
        completeRow({ status: 'RECEIVED', purchaseOrderNo: null, purchaseOrderStatus: null }),
      ),
    ).toEqual(['NO_DOCUMENT_NUMBER']);
    expect(
      registerFlagsOf(
        completeRow({
          status: 'PARTIALLY_RECEIVED',
          purchaseOrderNo: null,
          purchaseOrderStatus: null,
        }),
      ),
    ).toEqual(['NO_DOCUMENT_NUMBER']);
  });

  it('ทุกข้อสังเกตมีป้ายภาษาไทย', () => {
    for (const flag of REGISTER_FLAGS) {
      expect(REGISTER_FLAG_LABELS_TH[flag]).toBeTruthy();
    }
  });
});

describe('buildProcurementRegister', () => {
  function rowsOfStatuses(
    entries: readonly { status: ProcurementStatus; amount: bigint; reference: string }[],
  ): ProcurementRegisterRow[] {
    return entries.map((entry, index) =>
      completeRow({
        procurementId: `3333333${index}-3333-4333-8333-333333333333`,
        reference: entry.reference,
        status: entry.status,
        grandTotalSatang: entry.amount,
        fundingTotalSatang: entry.amount,
      }),
    );
  }

  it('ไม่มีแถวเลยก็ยังตอบได้ ไม่ใช่โยน error', () => {
    const register = buildProcurementRegister([]);
    expect(register.count).toBe(0);
    expect(register.grandTotalSatang).toBe(0n);
    expect(register.byStatus).toEqual([]);
    expect(register.flagged).toEqual([]);
    expect(register.rows).toEqual([]);
  });

  /*
   * คุณสมบัติที่ทำให้รายงานนี้เชื่อถือได้
   *
   * ยอดรวมและยอดรายสถานะมาจากแถวชุดเดียวกัน ผลรวมจึงต้องเท่ากันเสมอ
   * ถ้าวันหนึ่งมีใครเปลี่ยนไปนับยอดรวมจาก query อีกชุด ข้อนี้จะล้มทันที
   */
  it('ผลรวมของทุกสถานะเท่ากับยอดรวมและจำนวนรวมพอดี', () => {
    const register = buildProcurementRegister(
      rowsOfStatuses([
        { status: 'DRAFT', amount: 1_000n, reference: 'D-000001' },
        { status: 'ISSUED', amount: 2_500n, reference: 'D-000002' },
        { status: 'ISSUED', amount: 500n, reference: 'D-000003' },
        { status: 'CANCELLED', amount: 700n, reference: 'D-000004' },
      ]),
    );

    const summedCount = register.byStatus.reduce((total, group) => total + group.count, 0);
    const summedAmount = register.byStatus.reduce(
      (total, group) => total + group.grandTotalSatang,
      0n,
    );

    expect(summedCount).toBe(register.count);
    expect(summedCount).toBe(4);
    expect(summedAmount).toBe(register.grandTotalSatang);
    expect(summedAmount).toBe(4_700n);
  });

  /*
   * ลำดับตาม state machine ไม่ใช่ลำดับที่แถวเข้ามา
   *
   * ข้อมูลตั้งใจให้แถวแรกเป็น CANCELLED ซึ่งอยู่ท้ายสุดของ state machine
   * ถ้าเรียงตามลำดับที่พบ CANCELLED จะขึ้นก่อน DRAFT
   */
  it('เรียงกลุ่มตามลำดับของ state machine ไม่ใช่ตามลำดับที่พบ', () => {
    const register = buildProcurementRegister(
      rowsOfStatuses([
        { status: 'CANCELLED', amount: 100n, reference: 'D-000001' },
        { status: 'RECEIVED', amount: 100n, reference: 'D-000002' },
        { status: 'DRAFT', amount: 100n, reference: 'D-000003' },
        { status: 'APPROVED', amount: 100n, reference: 'D-000004' },
      ]),
    );

    expect(register.byStatus.map((group) => group.status)).toEqual([
      'DRAFT',
      'APPROVED',
      'RECEIVED',
      'CANCELLED',
    ]);
  });

  /* กลุ่มที่มีแถวมากที่สุดต้องไม่ถูกดันขึ้นมาก่อน — ตรวจว่าไม่ได้เรียงตามจำนวน */
  it('ไม่เรียงกลุ่มตามจำนวนรายการ', () => {
    const register = buildProcurementRegister(
      rowsOfStatuses([
        { status: 'CANCELLED', amount: 100n, reference: 'D-000001' },
        { status: 'CANCELLED', amount: 100n, reference: 'D-000002' },
        { status: 'CANCELLED', amount: 100n, reference: 'D-000003' },
        { status: 'DRAFT', amount: 100n, reference: 'D-000004' },
      ]),
    );

    expect(register.byStatus[0]?.status).toBe('DRAFT');
  });

  it('เก็บเฉพาะสถานะที่มีแถวจริง ไม่ใส่กลุ่มที่เป็นศูนย์', () => {
    const register = buildProcurementRegister(
      rowsOfStatuses([{ status: 'ISSUED', amount: 100n, reference: 'D-000001' }]),
    );
    expect(register.byStatus).toHaveLength(1);
    expect(register.byStatus[0]?.status).toBe('ISSUED');
  });

  it('รายการที่มีข้อสังเกตเรียงจากวันที่ขอเก่าที่สุดก่อน', () => {
    const register = buildProcurementRegister([
      completeRow({
        procurementId: 'a1',
        reference: 'D-000003',
        requestDate: '2026-03-01',
        purchaseOrderStatus: null,
        purchaseOrderNo: null,
      }),
      completeRow({
        procurementId: 'a2',
        reference: 'D-000001',
        requestDate: '2026-01-01',
        purchaseOrderStatus: null,
        purchaseOrderNo: null,
      }),
      completeRow({
        procurementId: 'a3',
        reference: 'D-000002',
        requestDate: '2026-02-01',
        purchaseOrderStatus: null,
        purchaseOrderNo: null,
      }),
    ]);

    expect(register.flagged.map((entry) => entry.row.reference)).toEqual([
      'D-000001',
      'D-000002',
      'D-000003',
    ]);
  });

  it('วันที่เท่ากันตัดสินด้วยเลขอ้างอิง จึงได้ลำดับเดียวเสมอ', () => {
    const register = buildProcurementRegister([
      completeRow({
        procurementId: 'b1',
        reference: 'D-000009',
        requestDate: '2026-01-01',
        grandTotalSatang: 0n,
        fundingTotalSatang: 0n,
      }),
      completeRow({
        procurementId: 'b2',
        reference: 'D-000002',
        requestDate: '2026-01-01',
        grandTotalSatang: 0n,
        fundingTotalSatang: 0n,
      }),
    ]);

    expect(register.flagged.map((entry) => entry.row.reference)).toEqual(['D-000002', 'D-000009']);
  });

  it('แถวที่ไม่มีข้อสังเกตไม่อยู่ในรายการที่ยกขึ้นมา', () => {
    const register = buildProcurementRegister([
      completeRow({ procurementId: 'c1', reference: 'D-000001' }),
      completeRow({ procurementId: 'c2', reference: 'D-000002', purchaseOrderStatus: null }),
    ]);

    expect(register.flagged).toHaveLength(1);
    expect(register.flagged[0]?.row.reference).toBe('D-000002');
    expect(register.flagged[0]?.flags).toEqual(['NO_DOCUMENT_NUMBER']);
  });

  it('คืนแถวทั้งหมดครบตามที่รับมา และไม่ใช่ตัวเดียวกับ array ที่ส่งเข้ามา', () => {
    const input = [completeRow({ procurementId: 'd1' })];
    const register = buildProcurementRegister(input);

    expect(register.rows).toEqual(input);
    expect(register.rows).not.toBe(input);
  });
});

describe('parseProcurementRegisterFilter', () => {
  it('ไม่มีค่าอะไรเลย = ไม่กรองอะไรเลย', () => {
    const filter = parseProcurementRegisterFilter({});
    expect(filter).toEqual({
      fiscalYearId: undefined,
      classification: undefined,
      status: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(hasActiveRegisterFilter(filter)).toBe(false);
  });

  it('อ่านค่าที่ถูกต้องได้ครบ', () => {
    const filter = parseProcurementRegisterFilter({
      fiscalYearId: '44444444-4444-4444-8444-444444444444',
      classification: 'SERVICE',
      status: 'ISSUED',
      dateFrom: '2026-01-01',
      dateTo: '2026-09-30',
    });

    expect(filter.fiscalYearId).toBe('44444444-4444-4444-8444-444444444444');
    expect(filter.classification).toBe('SERVICE');
    expect(filter.status).toBe('ISSUED');
    expect(filter.dateFrom).toBe('2026-01-01');
    expect(filter.dateTo).toBe('2026-09-30');
    expect(hasActiveRegisterFilter(filter)).toBe(true);
  });

  /*
   * ค่าที่พิมพ์มั่วต้องกลายเป็น "ไม่กรอง" ไม่ใช่ทำให้ทั้งหน้าล้ม
   *
   * ผู้ที่แก้ URL เองแล้วเจอหน้า error จะไม่รู้ว่าต้องแก้อะไรกลับ
   */
  it('ค่าที่ไม่ถูกต้องกลายเป็นไม่กรอง ไม่ใช่โยน error', () => {
    const filter = parseProcurementRegisterFilter({
      fiscalYearId: 'ไม่ใช่ uuid',
      classification: 'GHOST',
      status: 'NOT_A_STATUS',
      dateFrom: '31/09/2568',
      dateTo: '2026-13-45',
    });

    expect(filter.fiscalYearId).toBeUndefined();
    expect(filter.classification).toBeUndefined();
    expect(filter.status).toBeUndefined();
    expect(filter.dateFrom).toBeUndefined();
    expect(filter.dateTo).toBeUndefined();
  });

  it('ค่าว่างถือว่าไม่ได้เลือก', () => {
    const filter = parseProcurementRegisterFilter({
      fiscalYearId: '',
      dateFrom: '   ',
    });
    expect(filter.fiscalYearId).toBeUndefined();
    expect(filter.dateFrom).toBeUndefined();
  });

  it('ค่าที่ซ้ำกันหลายตัวใน query string ใช้ตัวแรก', () => {
    const filter = parseProcurementRegisterFilter({ status: ['ISSUED', 'DRAFT'] });
    expect(filter.status).toBe('ISSUED');
  });
});

describe('hasReversedDateRange', () => {
  it('เริ่มหลังสิ้นสุด = กลับด้าน', () => {
    const filter = parseProcurementRegisterFilter({
      dateFrom: '2026-09-30',
      dateTo: '2026-01-01',
    });
    expect(hasReversedDateRange(filter)).toBe(true);
  });

  it('ช่วงที่ถูกต้องไม่ถือว่ากลับด้าน', () => {
    const filter = parseProcurementRegisterFilter({
      dateFrom: '2026-01-01',
      dateTo: '2026-09-30',
    });
    expect(hasReversedDateRange(filter)).toBe(false);
  });

  it('วันเดียวกันไม่ถือว่ากลับด้าน', () => {
    const filter = parseProcurementRegisterFilter({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-01',
    });
    expect(hasReversedDateRange(filter)).toBe(false);
  });

  it('กรอกด้านเดียวไม่ถือว่ากลับด้าน', () => {
    expect(hasReversedDateRange(parseProcurementRegisterFilter({ dateFrom: '2026-09-30' }))).toBe(
      false,
    );
    expect(hasReversedDateRange(parseProcurementRegisterFilter({ dateTo: '2026-01-01' }))).toBe(
      false,
    );
  });
});

describe('hasActiveRegisterFilter', () => {
  it('ทุกช่องนับเป็นการกรอง', () => {
    const cases: Record<string, string>[] = [
      { fiscalYearId: '55555555-5555-4555-8555-555555555555' },
      { classification: 'GOODS' },
      { status: 'DRAFT' },
      { dateFrom: '2026-01-01' },
      { dateTo: '2026-01-01' },
    ];

    for (const params of cases) {
      expect(hasActiveRegisterFilter(parseProcurementRegisterFilter(params))).toBe(true);
    }
  });
});
