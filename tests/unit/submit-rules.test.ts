import { describe, expect, it } from 'vitest';
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
    ['purpose', 'เหตุผลความจำเป็น'],
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
    const report = checkSubmitRules(validDraft({ purpose: undefined }), context());

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
