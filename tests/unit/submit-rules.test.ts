import { describe, expect, it } from 'vitest';
import { weekdaysAfter } from '@/domain/procurement/value-tier';
import { checkSubmitRules } from '@/domain/procurement/submit-rules';
import { procurementDraftSchema } from '@/domain/procurement/schemas';
import type { SubmitContext } from '@/domain/procurement/submit-rules';

const FISCAL_YEAR_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const ACCOUNT_A = 'bbbbbbbb-0000-4000-8000-000000000001';
const ACCOUNT_B = 'bbbbbbbb-0000-4000-8000-000000000002';

const FY = {
  code: 'FY2569',
  startDate: '2025-10-01',
  endDate: '2026-09-30',
  status: 'OPEN' as const,
};

/** ร่างที่ผ่านทุกกฎ — แต่ละ test แก้เฉพาะจุดที่ต้องการทดสอบ */
function validDraft(overrides: Record<string, unknown> = {}) {
  return procurementDraftSchema.parse({
    subject: 'จัดซื้อวัสดุสำนักงาน (ตัวอย่าง)',
    purpose: 'ใช้ในงานสำนักงานประจำภาคเรียน',
    taxMode: 'EXEMPT',
    fiscalYearId: FISCAL_YEAR_ID,
    requestDate: '2026-01-05',
    reportDate: '2026-01-06',
    classification: 'GOODS',
    procurementMethod: 'SPECIFIC',
    items: [{ lineNo: 1, description: 'กระดาษ A4 (ตัวอย่าง)', quantity: '10', unitPrice: '250' }],
    fundingAllocations: [{ lineNo: 1, budgetAccountId: ACCOUNT_A, amount: '2500.00' }],
    ...overrides,
  });
}

function context(overrides: Partial<SubmitContext> = {}): SubmitContext {
  return {
    fiscalYear: FY,
    availableByAccount: new Map([[ACCOUNT_A, 500_000n]]),
    ...overrides,
  };
}

describe('checkSubmitRules — ร่างที่ครบถ้วน', () => {
  it('ผ่านโดยไม่ต้องใช้สิทธิ์ยกเว้น', () => {
    const report = checkSubmitRules(validDraft(), context());

    expect(report.findings).toHaveLength(0);
    expect(report.canProceed(false)).toBe(true);
    expect(report.requiresOverrideReason(false)).toBe(false);
  });
});

describe('ช่องบังคับของรายงานขอซื้อ/ขอจ้าง', () => {
  it.each([
    ['classification', 'ประเภทงาน'],
    ['procurementMethod', 'วิธีจัดหา'],
    ['reportDate', 'วันที่รายงานขอซื้อ/ขอจ้าง'],
  ])('ขาด %s แล้วถูกปฏิเสธ', (field, label) => {
    const report = checkSubmitRules(validDraft({ [field]: undefined }), context());

    const finding = report.findings.find((item) => item.field === field);
    expect(finding?.code).toBe('REQUIRED_REPORT_FIELD_MISSING');
    expect(finding?.message).toContain(label);
  });

  it('ไม่มีรายการพัสดุเลยก็ถูกปฏิเสธ', () => {
    const report = checkSubmitRules(validDraft({ items: [], fundingAllocations: [] }), context());

    expect(report.findings.some((item) => item.field === 'items')).toBe(true);
  });

  it('REQUIRED_REPORT_FIELD_MISSING ยกเว้นไม่ได้', () => {
    const report = checkSubmitRules(validDraft({ classification: undefined }), context());

    expect(report.canProceed(true)).toBe(false);
  });
});

describe('FUNDING_TOTAL_MISMATCH (F-02)', () => {
  it('ยอดแหล่งเงินไม่เท่ายอดรวมถูกปฏิเสธ พร้อมบอกส่วนต่าง', () => {
    const report = checkSubmitRules(
      validDraft({
        fundingAllocations: [{ lineNo: 1, budgetAccountId: ACCOUNT_A, amount: '2000.00' }],
      }),
      context(),
    );

    const finding = report.findings.find((item) => item.code === 'FUNDING_TOTAL_MISMATCH');
    expect(finding).toBeDefined();
    expect(finding?.message).toContain('ขาดอีก');
    expect(finding?.message).toContain('500.00');
  });

  it('ยกเว้นไม่ได้ เพราะเป็นเรื่องเลขคณิต ไม่ใช่ดุลพินิจ', () => {
    const report = checkSubmitRules(
      validDraft({
        fundingAllocations: [{ lineNo: 1, budgetAccountId: ACCOUNT_A, amount: '2000.00' }],
      }),
      context(),
    );

    expect(report.canProceed(true)).toBe(false);
  });
});

describe('BUDGET_INSUFFICIENT', () => {
  it('งบไม่พอถูกปฏิเสธ', () => {
    const report = checkSubmitRules(
      validDraft(),
      context({ availableByAccount: new Map([[ACCOUNT_A, 100_000n]]) }),
    );

    expect(report.findings.some((item) => item.code === 'BUDGET_INSUFFICIENT')).toBe(true);
  });

  /*
   * รายการเดียวอ้างบัญชีเดิมได้หลายบรรทัด — ต้องรวมยอดก่อนเทียบ
   * ถ้าเทียบทีละบรรทัด สองบรรทัดละ 2,000 บนงบ 3,000 จะผ่านทั้งที่รวมแล้วเกิน
   */
  it('รวมยอดต่อบัญชีก่อนเทียบ ไม่เทียบทีละบรรทัด', () => {
    const report = checkSubmitRules(
      validDraft({
        items: [{ lineNo: 1, description: 'ของ (ตัวอย่าง)', quantity: '1', unitPrice: '4000' }],
        fundingAllocations: [
          { lineNo: 1, budgetAccountId: ACCOUNT_A, amount: '2000.00' },
          { lineNo: 2, budgetAccountId: ACCOUNT_B, amount: '2000.00' },
        ],
      }),
      context({
        availableByAccount: new Map([
          [ACCOUNT_A, 300_000n],
          [ACCOUNT_B, 100_000n],
        ]),
      }),
    );

    const insufficient = report.findings.filter((item) => item.code === 'BUDGET_INSUFFICIENT');
    expect(insufficient).toHaveLength(1);
  });

  it('ยกเว้นได้เมื่อมีสิทธิ์ ตามที่แผนข้อ 7.2 กำหนด', () => {
    const report = checkSubmitRules(
      validDraft(),
      context({ availableByAccount: new Map([[ACCOUNT_A, 100_000n]]) }),
    );

    expect(report.canProceed(false)).toBe(false);
    expect(report.canProceed(true)).toBe(true);
  });
});

describe('ปีงบประมาณ', () => {
  it('ปีที่ปิดแล้วส่งอนุมัติไม่ได้', () => {
    const report = checkSubmitRules(
      validDraft(),
      context({ fiscalYear: { ...FY, status: 'CLOSED' } }),
    );

    expect(report.findings.some((item) => item.code === 'FISCAL_YEAR_MISMATCH')).toBe(true);
  });

  it('วันที่นอกช่วงปีถูกปฏิเสธ', () => {
    const report = checkSubmitRules(
      validDraft({ requestDate: '2026-10-05', reportDate: '2026-10-06' }),
      context(),
    );

    expect(report.findings.filter((item) => item.code === 'FISCAL_YEAR_MISMATCH').length).toBe(2);
  });
});

describe('ผู้ขาย', () => {
  it('ข้อมูลผู้ขายไม่ครบเป็นคำเตือน ไม่บล็อกการส่งอนุมัติ', () => {
    const report = checkSubmitRules(validDraft(), context({ vendorComplete: false }));

    expect(report.warnings.map((item) => item.code)).toContain('VENDOR_INCOMPLETE');
    expect(report.hasErrors).toBe(false);
    expect(report.canProceed(false)).toBe(true);
  });
});

describe('การรวมกฎ', () => {
  it('รายงานทุกข้อพร้อมกัน ผู้ใช้แก้ได้ครบในรอบเดียว', () => {
    const report = checkSubmitRules(
      validDraft({
        purpose: undefined,
        classification: undefined,
        deliveryOrServiceDate: '2025-12-01',
        fundingAllocations: [{ lineNo: 1, budgetAccountId: ACCOUNT_A, amount: '1.00' }],
      }),
      context(),
    );

    const codes = new Set(report.findings.map((item) => item.code));
    expect(codes.has('REQUIRED_REPORT_FIELD_MISSING')).toBe(true);
    expect(codes.has('FUNDING_TOTAL_MISMATCH')).toBe(true);
    expect(codes.has('DATE_REQUEST_AFTER_DELIVERY')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// กฎตามวงเงิน (กฎกระทรวงวงเงินฯ 2560, ระเบียบ ข้อ 22 และข้อ 79 วรรคสอง, ว804)
// -----------------------------------------------------------------------------

/** ร่างที่มีวงเงินตามที่ต้องการ: 1 รายการ จำนวน 1 หน่วย ราคาเท่ายอดที่ระบุ */
function draftOfAmount(amount: string, overrides: Record<string, unknown> = {}) {
  return validDraft({
    items: [{ lineNo: 1, description: 'พัสดุ (ตัวอย่าง)', quantity: '1', unitPrice: amount }],
    fundingAllocations: [{ lineNo: 1, budgetAccountId: ACCOUNT_A, amount }],
    ...overrides,
  });
}

function bigContext() {
  return context({ availableByAccount: new Map([[ACCOUNT_A, 900_000_000n]]) });
}

function codesOf(report: ReturnType<typeof checkSubmitRules>): string[] {
  return report.findings.map((finding) => finding.code);
}

describe('ซื้อไม่เกิน 50,000 บาท ใช้รายงาน 3 รายการ (ว804)', () => {
  it('ไม่บังคับเหตุผลความจำเป็นและกำหนดเวลาใช้พัสดุ', () => {
    const report = checkSubmitRules(
      draftOfAmount('50000.00', { purpose: undefined, requiredDate: undefined }),
      bigContext(),
    );

    expect(report.findings).toHaveLength(0);
  });

  it('เกิน 50,000 บาทแม้เพียงหนึ่งสตางค์ ต้องมีเหตุผลและกำหนดเวลาใช้พัสดุ', () => {
    const report = checkSubmitRules(
      draftOfAmount('50000.01', { purpose: undefined, requiredDate: undefined }),
      bigContext(),
    );

    expect(report.findings.filter((f) => f.field === 'purpose')).toHaveLength(1);
    expect(report.findings.filter((f) => f.field === 'requiredDate')).toHaveLength(1);
  });

  it('งานจ้างไม่ได้ใช้ขั้นตอนย่อ แม้วงเงินไม่เกิน 50,000 บาท', () => {
    const report = checkSubmitRules(
      draftOfAmount('10000.00', {
        classification: 'SERVICE',
        purpose: undefined,
        requiredDate: undefined,
      }),
      bigContext(),
    );

    expect(report.findings.map((f) => f.field)).toEqual(
      expect.arrayContaining(['purpose', 'requiredDate']),
    );
  });

  it('กรณีฉุกเฉินต้องมีเหตุผลเสมอ แต่ตัดกำหนดเวลาใช้พัสดุได้ (ข้อ 22 วรรคสอง)', () => {
    const report = checkSubmitRules(
      draftOfAmount('120000.00', {
        isEmergency: true,
        purpose: undefined,
        requiredDate: undefined,
      }),
      bigContext(),
    );

    expect(report.findings.filter((f) => f.field === 'purpose')).toHaveLength(1);
    expect(report.findings.filter((f) => f.field === 'requiredDate')).toHaveLength(0);
  });
});

describe('วิธีเฉพาะเจาะจงกับวงเงิน 500,000 บาท', () => {
  it('500,000.00 พอดียังใช้เฉพาะเจาะจงได้', () => {
    const report = checkSubmitRules(
      draftOfAmount('500000.00', { requiredDate: '2026-02-01' }),
      bigContext(),
    );

    expect(codesOf(report)).not.toContain('METHOD_EXCEEDS_LIMIT');
  });

  it('เกิน 500,000 บาทแล้วใช้เฉพาะเจาะจงถูกปฏิเสธ และยกเว้นไม่ได้', () => {
    const report = checkSubmitRules(
      draftOfAmount('500000.01', { requiredDate: '2026-02-01' }),
      bigContext(),
    );

    expect(codesOf(report)).toContain('METHOD_EXCEEDS_LIMIT');
    expect(report.canProceed(true)).toBe(false);
  });

  it('เกิน 500,000 บาทแต่ฉุกเฉิน หรือระบุฐานกฎหมาย ผ่านข้อนี้ได้', () => {
    const emergency = checkSubmitRules(
      draftOfAmount('900000.00', { isEmergency: true }),
      bigContext(),
    );
    const withBasis = checkSubmitRules(
      draftOfAmount('900000.00', {
        requiredDate: '2026-02-01',
        methodLegalBasisCode: 'ม.56(2)(ซ)',
      }),
      bigContext(),
    );

    expect(codesOf(emergency)).not.toContain('METHOD_EXCEEDS_LIMIT');
    expect(codesOf(withBasis)).not.toContain('METHOD_EXCEEDS_LIMIT');
  });

  it('วิธีอื่นที่วงเงินไม่เกิน 500,000 บาท เตือนแต่ไม่บล็อก', () => {
    const report = checkSubmitRules(
      draftOfAmount('200000.00', { procurementMethod: 'SELECTION', requiredDate: '2026-02-01' }),
      bigContext(),
    );

    const finding = report.findings.find((f) => f.code === 'METHOD_NOT_SPECIFIC_FOR_SMALL');
    expect(finding?.severity).toBe('WARNING');
    expect(report.canProceed(false)).toBe(true);
  });
});

describe('ซื้อก่อนรายงานตามหลัง', () => {
  // 2026-01-05 จันทร์ ซื้อ → 2026-01-12 จันทร์ = 5 วันทำการ
  const purchaseFirst = {
    requestDate: '2026-01-05',
    orderOrAgreementDate: '2026-01-05',
    deliveryOrServiceDate: '2026-01-05',
    inspectionDate: '2026-01-05',
  };

  it('ซื้อไม่เกิน 50,000 บาท รายงานภายใน 5 วันทำการ ผ่านพร้อมข้อความแจ้ง', () => {
    const report = checkSubmitRules(
      draftOfAmount('20000.00', { ...purchaseFirst, reportDate: '2026-01-12' }),
      bigContext(),
    );

    expect(report.hasErrors).toBe(false);
    const notice = report.findings.find((f) => f.code === 'BUY_FIRST_REPORT_DEADLINE');
    expect(notice?.severity).toBe('INFO');
  });

  it('รายงานเกิน 5 วันทำการ เป็นคำเตือน ไม่บล็อก', () => {
    const report = checkSubmitRules(
      draftOfAmount('20000.00', { ...purchaseFirst, reportDate: '2026-01-13' }),
      bigContext(),
    );

    expect(report.hasErrors).toBe(false);
    const notice = report.findings.find((f) => f.code === 'BUY_FIRST_REPORT_DEADLINE');
    expect(notice?.severity).toBe('WARNING');
  });

  it('งานจ้างไม่เร่งด่วน ซื้อก่อนรายงานยังเป็นข้อผิดลำดับเวลาเหมือนเดิม', () => {
    const report = checkSubmitRules(
      draftOfAmount('20000.00', {
        ...purchaseFirst,
        classification: 'SERVICE',
        requiredDate: '2026-02-01',
        reportDate: '2026-01-12',
      }),
      bigContext(),
    );

    expect(codesOf(report)).toContain('DATE_OUT_OF_ORDER');
  });

  it('วงเงินเกิน 50,000 บาทและไม่ฉุกเฉิน ซื้อก่อนรายงานไม่ได้', () => {
    const report = checkSubmitRules(
      draftOfAmount('80000.00', {
        ...purchaseFirst,
        requiredDate: '2026-02-01',
        reportDate: '2026-01-12',
      }),
      bigContext(),
    );

    expect(report.hasErrors).toBe(true);
  });

  it('กรณีฉุกเฉิน ซื้อก่อนรายงานได้ ไม่กำหนดจำนวนวัน (ข้อ 79 วรรคสอง ไม่ระบุ)', () => {
    const report = checkSubmitRules(
      draftOfAmount('80000.00', {
        ...purchaseFirst,
        isEmergency: true,
        reportDate: '2026-02-20',
      }),
      bigContext(),
    );

    // วันที่รายงาน 20 ก.พ. ยังอยู่ในปีงบประมาณ — ไม่มี ERROR และไม่มี WARNING เรื่องกำหนดวัน
    expect(report.hasErrors).toBe(false);
    expect(report.findings.find((f) => f.code === 'BUY_FIRST_REPORT_DEADLINE')?.severity).toBe(
      'INFO',
    );
  });

  it('ผ่อนเฉพาะขั้นเอกสาร ตรวจรับก่อนส่งมอบยังผิดเสมอ', () => {
    const report = checkSubmitRules(
      draftOfAmount('20000.00', {
        ...purchaseFirst,
        deliveryOrServiceDate: '2026-01-06',
        inspectionDate: '2026-01-05',
        reportDate: '2026-01-07',
      }),
      bigContext(),
    );

    expect(report.hasErrors).toBe(true);
  });
});

describe('weekdaysAfter', () => {
  it('นับเฉพาะจันทร์–ศุกร์ นับถัดจากวันเริ่ม รวมวันสิ้นสุด', () => {
    expect(weekdaysAfter('2026-01-05', '2026-01-05')).toBe(0);
    expect(weekdaysAfter('2026-01-05', '2026-01-09')).toBe(4);
    // ศุกร์ 9 → จันทร์ 12 ข้ามเสาร์อาทิตย์
    expect(weekdaysAfter('2026-01-09', '2026-01-12')).toBe(1);
    expect(weekdaysAfter('2026-01-05', '2026-01-12')).toBe(5);
    expect(weekdaysAfter('2026-01-05', '2026-01-13')).toBe(6);
  });
});
