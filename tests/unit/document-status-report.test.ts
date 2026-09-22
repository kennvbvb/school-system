import { describe, expect, it } from 'vitest';
import {
  buildDocumentStatusReport,
  sequenceFlagsOf,
  SEQUENCE_FLAGS,
  SEQUENCE_FLAG_LABELS_TH,
  toNumberRanges,
} from '@/domain/documents/sequence-report';
import type { DocumentSequenceRow } from '@/domain/documents/sequence-report';
import {
  hasActiveDocumentStatusFilter,
  parseDocumentStatusFilter,
} from '@/domain/documents/sequence-report-schemas';

/**
 * ลำดับตั้งต้นที่ "สะอาด" — ออกเลข 1–3 ครบ ไม่ขาด ไม่ซ้ำ ไม่มีอะไรค้าง
 *
 * ทุก test ที่ตรวจข้อสังเกตแก้เพียงช่องเดียวจากแถวนี้ ผลที่ต่างออกไปจึงมาจาก
 * ช่องนั้นเท่านั้น
 */
function cleanRow(overrides: Partial<DocumentSequenceRow> = {}): DocumentSequenceRow {
  return {
    fiscalYearId: '11111111-1111-4111-8111-111111111111',
    fiscalYearCode: 'FY2569',
    documentKind: 'PURCHASE_ORDER',
    issuedCount: 3,
    voidedCount: 0,
    pendingCount: 0,
    notRequiredCount: 0,
    minRunning: 1,
    maxRunning: 3,
    usedRunningCount: 3,
    missingCount: 0,
    missingSample: [],
    duplicateRunning: [],
    unparsedCount: 0,
    ...overrides,
  };
}

describe('toNumberRanges', () => {
  it('ไม่มีเลขเลยได้ช่วงว่าง', () => {
    expect(toNumberRanges([])).toEqual([]);
  });

  it('เลขเดียวเป็นช่วงที่ต้นกับปลายเท่ากัน', () => {
    expect(toNumberRanges([7])).toEqual([{ from: 7, to: 7 }]);
  });

  it('เลขต่อเนื่องยุบเป็นช่วงเดียว', () => {
    expect(toNumberRanges([14, 15, 16])).toEqual([{ from: 14, to: 16 }]);
  });

  it('เลขที่ขาดตอนแยกเป็นคนละช่วง', () => {
    expect(toNumberRanges([14, 15, 16, 20])).toEqual([
      { from: 14, to: 16 },
      { from: 20, to: 20 },
    ]);
  });

  /* ถ้าเชื่อว่าผู้เรียกส่งมาเรียงแล้ว ข้อนี้จะได้ช่วงย่อย ๆ ที่ไม่ยุบ */
  it('เรียงให้เองไม่ว่าจะรับมาเรียงหรือไม่', () => {
    expect(toNumberRanges([16, 14, 15])).toEqual([{ from: 14, to: 16 }]);
  });

  /* ค่าซ้ำเกิดได้จากข้อมูลที่ยังไม่สะอาด การไม่ตัดออกจะทำให้ช่วงขาดตอนผิด ๆ */
  it('ตัดค่าซ้ำออกก่อนยุบเป็นช่วง', () => {
    expect(toNumberRanges([14, 14, 15])).toEqual([{ from: 14, to: 15 }]);
  });

  /*
   * เรียงด้วยค่า ไม่ใช่ด้วยข้อความ
   *
   * เลขที่จำนวนหลักเท่ากันเรียงแบบข้อความแล้วได้ลำดับเดียวกับเรียงแบบตัวเลข
   * ข้อทดสอบอื่นจึงแยกสองแบบนี้ไม่ออก ต้องใช้เลขที่ข้ามหลัก — `.sort()`
   * เปล่า ๆ จะได้ 10, 11, 9 แล้วยุบเป็นสองช่วงแทนที่จะเป็นช่วงเดียว
   */
  it('เรียงด้วยค่าของตัวเลข ไม่ใช่ด้วยข้อความ', () => {
    expect(toNumberRanges([9, 10, 11])).toEqual([{ from: 9, to: 11 }]);
  });

  /*
   * รูปร่างของ F-13 ตามที่พบในไฟล์จริง — 13 แล้วกระโดดไป 91, 92
   * ช่วงที่ขาดคือ 14–90 ซึ่งต้องยุบเป็นช่วงเดียว ไม่ใช่ 77 บรรทัด
   */
  it('ยุบช่วงที่ขาดยาวของ F-13 เป็นช่วงเดียว', () => {
    const missing = Array.from({ length: 77 }, (_, index) => 14 + index);
    expect(toNumberRanges(missing)).toEqual([{ from: 14, to: 90 }]);
  });

  it('ไม่แก้ไขอาร์เรย์ที่รับเข้ามา', () => {
    const input = [3, 1, 2];
    toNumberRanges(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('sequenceFlagsOf', () => {
  it('ลำดับที่สะอาดไม่มีข้อสังเกต', () => {
    expect(sequenceFlagsOf(cleanRow())).toEqual([]);
  });

  it('มีเลขขาด = ข้อสังเกต (F-13)', () => {
    expect(sequenceFlagsOf(cleanRow({ missingCount: 77, missingSample: [14] }))).toEqual([
      'HAS_GAPS',
    ]);
  });

  /*
   * นับจาก missingCount ไม่ใช่จากความยาวของ missingSample
   *
   * เมื่อช่วงกว้างเกินกว่าจะไล่รายตัว ฐานข้อมูลคืนตัวอย่างเป็นอาร์เรย์ว่าง
   * แต่จำนวนยังถูกต้อง ถ้าธงดูจากตัวอย่าง ลำดับที่พังที่สุดจะไม่ติดธงเลย
   */
  it('ช่วงกว้างเกินจนไม่มีตัวอย่างก็ยังติดธง', () => {
    expect(sequenceFlagsOf(cleanRow({ missingCount: 20_000, missingSample: [] }))).toEqual([
      'HAS_GAPS',
    ]);
  });

  it('มีเลขลำดับซ้ำ = ข้อสังเกต (F-12)', () => {
    expect(sequenceFlagsOf(cleanRow({ duplicateRunning: [91] }))).toEqual(['DUPLICATE_RUNNING']);
  });

  it('มีเอกสารรอออกเลข = ข้อสังเกต (F-14)', () => {
    expect(sequenceFlagsOf(cleanRow({ pendingCount: 2 }))).toEqual(['HAS_PENDING']);
  });

  it('มีเลขที่แยกลำดับไม่ได้ = ข้อสังเกต', () => {
    expect(sequenceFlagsOf(cleanRow({ unparsedCount: 1 }))).toEqual(['HAS_UNPARSED']);
  });

  /* เอกสารที่บันทึกว่าไม่ต้องมีเลขคือคำตอบที่จบแล้ว ไม่ใช่งานค้าง */
  it('เอกสารที่ไม่ต้องมีเลขไม่ถือเป็นข้อสังเกต', () => {
    expect(sequenceFlagsOf(cleanRow({ notRequiredCount: 5 }))).toEqual([]);
  });

  /* เลขที่ยกเลิกแล้วยังกินที่ในลำดับ จึงไม่ใช่ปัญหาในตัวมันเอง */
  it('เลขที่ยกเลิกแล้วไม่ถือเป็นข้อสังเกต', () => {
    expect(sequenceFlagsOf(cleanRow({ voidedCount: 2 }))).toEqual([]);
  });

  it('ข้อสังเกตหลายข้อเรียงตามลำดับใน SEQUENCE_FLAGS เสมอ', () => {
    const flags = sequenceFlagsOf(
      cleanRow({
        missingCount: 3,
        missingSample: [4, 5, 6],
        duplicateRunning: [2],
        pendingCount: 1,
        unparsedCount: 1,
      }),
    );
    expect(flags).toEqual(['HAS_GAPS', 'DUPLICATE_RUNNING', 'HAS_PENDING', 'HAS_UNPARSED']);
  });

  it('ทุกข้อสังเกตมีป้ายภาษาไทย', () => {
    for (const flag of SEQUENCE_FLAGS) {
      expect(SEQUENCE_FLAG_LABELS_TH[flag]).toBeTruthy();
    }
  });
});

describe('buildDocumentStatusReport', () => {
  it('ไม่มีลำดับเลยก็ยังตอบได้ ไม่ใช่โยน error', () => {
    const report = buildDocumentStatusReport([]);
    expect(report.rows).toEqual([]);
    expect(report.flagged).toEqual([]);
    expect(report.totals.sequenceCount).toBe(0);
    expect(report.totals.missingCount).toBe(0);
  });

  /*
   * คุณสมบัติที่ทำให้รายงานนี้เชื่อถือได้
   *
   * ยอดรวมทุกช่องมาจากแถวชุดเดียวกับที่แสดง ถ้าวันหนึ่งมีใครเปลี่ยนไปนับจาก
   * query อีกชุด ข้อนี้จะล้มทันที
   */
  it('ยอดรวมทุกช่องเท่ากับผลรวมของแถว', () => {
    const report = buildDocumentStatusReport([
      cleanRow({
        documentKind: 'REQUEST_MEMO',
        issuedCount: 3,
        voidedCount: 1,
        pendingCount: 2,
        notRequiredCount: 4,
        missingCount: 5,
        missingSample: [10],
        duplicateRunning: [2, 3],
      }),
      cleanRow({
        documentKind: 'PURCHASE_ORDER',
        issuedCount: 7,
        voidedCount: 2,
        pendingCount: 1,
        notRequiredCount: 0,
        missingCount: 6,
        missingSample: [20],
        duplicateRunning: [9],
      }),
    ]);

    expect(report.totals).toEqual({
      sequenceCount: 2,
      issuedCount: 10,
      voidedCount: 3,
      pendingCount: 3,
      notRequiredCount: 4,
      missingCount: 11,
      duplicateCount: 3,
    });
  });

  /*
   * เรียงตามลำดับการใช้งานจริง ไม่ใช่ตามตัวอักษร
   *
   * ข้อมูลตั้งใจให้ใส่มาแบบสลับ และถ้าเรียงตามตัวอักษรไทย/อังกฤษจะได้คนละลำดับ
   * ผู้อ่านไล่ตามเส้นทางของงาน (ขออนุมัติ → สั่งซื้อ → ตรวจรับ → เบิกจ่าย)
   */
  it('เรียงชนิดเอกสารตามลำดับการใช้งานจริง', () => {
    const report = buildDocumentStatusReport([
      cleanRow({ documentKind: 'DISBURSEMENT' }),
      cleanRow({ documentKind: 'REQUEST_MEMO' }),
      cleanRow({ documentKind: 'INSPECTION_REPORT' }),
      cleanRow({ documentKind: 'PURCHASE_ORDER' }),
    ]);

    expect(report.rows.map((row) => row.documentKind)).toEqual([
      'REQUEST_MEMO',
      'PURCHASE_ORDER',
      'INSPECTION_REPORT',
      'DISBURSEMENT',
    ]);
  });

  it('ปีงบใหม่ขึ้นก่อนปีงบเก่า', () => {
    const report = buildDocumentStatusReport([
      cleanRow({ fiscalYearId: 'a', fiscalYearCode: 'FY2568' }),
      cleanRow({ fiscalYearId: 'b', fiscalYearCode: 'FY2570' }),
      cleanRow({ fiscalYearId: 'c', fiscalYearCode: 'FY2569' }),
    ]);

    expect(report.rows.map((row) => row.fiscalYearCode)).toEqual(['FY2570', 'FY2569', 'FY2568']);
  });

  it('เฉพาะลำดับที่มีข้อสังเกตอยู่ในรายการที่ยกขึ้นมา', () => {
    const report = buildDocumentStatusReport([
      cleanRow({ documentKind: 'REQUEST_MEMO' }),
      cleanRow({ documentKind: 'PURCHASE_ORDER', pendingCount: 1 }),
    ]);

    expect(report.flagged).toHaveLength(1);
    expect(report.flagged[0]?.row.documentKind).toBe('PURCHASE_ORDER');
    expect(report.flagged[0]?.flags).toEqual(['HAS_PENDING']);
  });

  it('ไม่แก้ไขอาร์เรย์ที่รับเข้ามา และคืนอาร์เรย์คนละตัว', () => {
    const input = [cleanRow({ documentKind: 'DISBURSEMENT' }), cleanRow()];
    const report = buildDocumentStatusReport(input);

    expect(report.rows).not.toBe(input);
    expect(input[0]?.documentKind).toBe('DISBURSEMENT');
  });
});

describe('parseDocumentStatusFilter', () => {
  it('ไม่มีค่าอะไรเลย = ไม่กรองอะไรเลย', () => {
    const filter = parseDocumentStatusFilter({});
    expect(filter).toEqual({
      fiscalYearId: undefined,
      documentKind: undefined,
      exceptionStatus: undefined,
    });
    expect(hasActiveDocumentStatusFilter(filter)).toBe(false);
  });

  it('อ่านค่าที่ถูกต้องได้ครบ', () => {
    const filter = parseDocumentStatusFilter({
      fiscalYearId: '44444444-4444-4444-8444-444444444444',
      documentKind: 'PURCHASE_ORDER',
      exceptionStatus: 'PENDING',
    });

    expect(filter.fiscalYearId).toBe('44444444-4444-4444-8444-444444444444');
    expect(filter.documentKind).toBe('PURCHASE_ORDER');
    expect(filter.exceptionStatus).toBe('PENDING');
    expect(hasActiveDocumentStatusFilter(filter)).toBe(true);
  });

  it('ค่าที่ไม่ถูกต้องกลายเป็นไม่กรอง ไม่ใช่โยน error', () => {
    const filter = parseDocumentStatusFilter({
      fiscalYearId: 'ไม่ใช่ uuid',
      documentKind: 'GHOST_KIND',
      exceptionStatus: 'NOT_A_STATUS',
    });

    expect(filter.fiscalYearId).toBeUndefined();
    expect(filter.documentKind).toBeUndefined();
    expect(filter.exceptionStatus).toBeUndefined();
  });

  /*
   * ISSUED ไม่ใช่ข้อยกเว้น จึงต้องไม่ผ่าน schema
   *
   * ถ้าผ่านได้ ผู้ใช้จะเลือกแล้วได้ศูนย์แถวเสมอ เพราะฟังก์ชันกรอง ISSUED ออก
   * อยู่แล้ว — หน้าจอที่ให้เลือกตัวเลือกที่ไม่มีวันมีผลลัพธ์คือหน้าจอที่โกหก
   */
  it('ISSUED ไม่ใช่สถานะของข้อยกเว้น', () => {
    expect(
      parseDocumentStatusFilter({ exceptionStatus: 'ISSUED' }).exceptionStatus,
    ).toBeUndefined();
  });

  it('ค่าว่างถือว่าไม่ได้เลือก', () => {
    expect(parseDocumentStatusFilter({ fiscalYearId: '   ' }).fiscalYearId).toBeUndefined();
  });

  it('ค่าที่ซ้ำกันหลายตัวใน query string ใช้ตัวแรก', () => {
    const filter = parseDocumentStatusFilter({ documentKind: ['PURCHASE_ORDER', 'REQUEST_MEMO'] });
    expect(filter.documentKind).toBe('PURCHASE_ORDER');
  });
});

describe('hasActiveDocumentStatusFilter', () => {
  it('ทุกช่องนับเป็นการกรอง', () => {
    const cases: Record<string, string>[] = [
      { fiscalYearId: '55555555-5555-4555-8555-555555555555' },
      { documentKind: 'OTHER' },
      { exceptionStatus: 'VOIDED' },
    ];

    for (const params of cases) {
      expect(hasActiveDocumentStatusFilter(parseDocumentStatusFilter(params))).toBe(true);
    }
  });
});
