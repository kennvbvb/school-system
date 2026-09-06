import { describe, expect, it } from 'vitest';
import { checkChronology, checkFiscalYearRange } from '@/domain/procurement/chronology';
import { businessDateSchema } from '@/domain/master-data/schemas';
import { isOverridableRule } from '@/domain/validation/rules';

const FY2569 = {
  code: 'FY2569',
  startDate: '2025-10-01',
  endDate: '2026-09-30',
  status: 'OPEN' as const,
};

describe('F-03 — วันที่ที่ไม่มีอยู่จริงในปฏิทิน', () => {
  /*
   * ข้อค้นพบ F-03 คือ 31/09/2568 ในทะเบียนใบสั่งจ้าง 3 แถว
   *
   * ปิดที่ขอบเขตข้อมูล ไม่ใช่ที่กฎลำดับเวลา — ค่าแบบนี้ต้องเข้าระบบไม่ได้เลย
   * ตั้งแต่แรก ไม่ใช่เข้ามาได้แล้วค่อยเตือน
   */
  it.each(['2025-09-31', '2026-02-30', '2026-13-01', '2568-09-31'])('ปฏิเสธวันที่ %s', (value) => {
    expect(businessDateSchema.safeParse(value).success).toBe(false);
  });

  it('ยอมรับวันสุดท้ายของเดือนที่มีจริง', () => {
    expect(businessDateSchema.safeParse('2025-09-30').success).toBe(true);
    expect(businessDateSchema.safeParse('2024-02-29').success).toBe(true);
  });

  it('DATE_INVALID ยกเว้นไม่ได้', () => {
    expect(isOverridableRule('DATE_INVALID')).toBe(false);
  });
});

describe('F-04 — วันส่งมอบเกิดก่อนวันขออนุมัติ', () => {
  /*
   * เคสจากไฟล์จริง: วันใช้บริการ 31 ม.ค. 2569 แต่วันขอ 2 ก.พ. 2569
   * (ปี ค.ศ. คือ 2026 เพราะปีงบประมาณ 2569 ครอบ ต.ค. 2025 – ก.ย. 2026)
   */
  const realCase = { requestDate: '2026-02-02', deliveryOrServiceDate: '2026-01-31' };

  it('ตรวจพบและใช้รหัสกฎที่ตรงกับเหตุการณ์', () => {
    const report = checkChronology(realCase);

    expect(report.hasErrors).toBe(true);
    expect(report.findings.map((finding) => finding.code)).toContain('DATE_REQUEST_AFTER_DELIVERY');
  });

  it('ข้อความบอกทั้งสองวันเป็นภาษาไทย ไม่ใช่ชื่อช่องดิบ', () => {
    const [finding] = checkChronology(realCase).findings;

    expect(finding?.message).toContain('วันที่ส่งมอบ/ใช้บริการ');
    expect(finding?.message).toContain('วันที่ขอซื้อ/ขอจ้าง');
    expect(finding?.message).not.toContain('requestDate');
  });

  it('ชี้ไปที่ช่องที่ต้องแก้', () => {
    expect(checkChronology(realCase).findings[0]?.field).toBe('deliveryOrServiceDate');
  });

  it('ยกเว้นได้เมื่อมีสิทธิ์ เพราะการบันทึกย้อนหลังเกิดขึ้นจริงในงานธุรการ', () => {
    const report = checkChronology(realCase);

    expect(report.canProceed(false)).toBe(false);
    expect(report.canProceed(true)).toBe(true);
    expect(report.requiresOverrideReason(true)).toBe(true);
  });
});

describe('checkChronology', () => {
  it('ไม่มีข้อผิดพลาดเมื่อลำดับถูกต้อง', () => {
    const report = checkChronology({
      requestDate: '2026-01-05',
      reportDate: '2026-01-06',
      approvedDate: '2026-01-08',
      orderOrAgreementDate: '2026-01-10',
      deliveryOrServiceDate: '2026-01-20',
      inspectionDate: '2026-01-22',
      sentToFinanceDate: '2026-01-25',
    });

    expect(report.findings).toHaveLength(0);
  });

  it('วันเดียวกันถือว่าผ่าน — งานเล็กเกิดขึ้นวันเดียวได้จริง', () => {
    const report = checkChronology({
      requestDate: '2026-01-05',
      approvedDate: '2026-01-05',
      orderOrAgreementDate: '2026-01-05',
      deliveryOrServiceDate: '2026-01-05',
    });

    expect(report.findings).toHaveLength(0);
  });

  /*
   * จุดที่สำคัญที่สุดของการเทียบ "ทุกคู่" ไม่ใช่ "คู่ที่ติดกัน"
   *
   * เคส F-04 จริงมีแค่วันขอกับวันส่งมอบ ขั้นกลางว่างหมด ถ้าเทียบเฉพาะขั้นติดกัน
   * จะไม่เจออะไรเลย
   */
  it('จับได้แม้ขั้นกลางจะว่าง', () => {
    const report = checkChronology({
      requestDate: '2026-02-02',
      sentToFinanceDate: '2026-01-01',
    });

    expect(report.hasErrors).toBe(true);
    expect(report.findings[0]?.code).toBe('DATE_OUT_OF_ORDER');
  });

  it('ใช้รหัสเฉพาะสำหรับอนุมัติหลังสั่งซื้อ', () => {
    const report = checkChronology({
      requestDate: '2026-01-01',
      approvedDate: '2026-01-20',
      orderOrAgreementDate: '2026-01-10',
    });

    expect(report.findings.map((f) => f.code)).toContain('DATE_APPROVAL_AFTER_ORDER');
  });

  it('ใช้รหัสเฉพาะสำหรับสั่งซื้อหลังส่งมอบ', () => {
    const report = checkChronology({
      requestDate: '2026-01-01',
      orderOrAgreementDate: '2026-01-20',
      deliveryOrServiceDate: '2026-01-10',
    });

    expect(report.findings.map((f) => f.code)).toContain('DATE_ORDER_AFTER_DELIVERY');
  });

  it('รายงานทุกข้อที่ผิดในรอบเดียว ไม่หยุดที่ข้อแรก', () => {
    const report = checkChronology({
      requestDate: '2026-03-01',
      approvedDate: '2026-02-01',
      orderOrAgreementDate: '2026-01-15',
    });

    // ทุกคู่ที่สลับกัน: request>approved, request>order, approved>order
    expect(report.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('ช่องว่างไม่ถูกนับเป็นความผิด', () => {
    expect(checkChronology({ requestDate: '2026-01-05' }).findings).toHaveLength(0);
    expect(
      checkChronology({ requestDate: '2026-01-05', approvedDate: null, inspectionDate: undefined })
        .findings,
    ).toHaveLength(0);
  });
});

describe('checkFiscalYearRange', () => {
  it('ยอมรับวันแรกและวันสุดท้ายของปีงบประมาณ', () => {
    const report = checkFiscalYearRange(
      { requestDate: '2025-10-01', sentToFinanceDate: '2026-09-30' },
      FY2569,
    );

    expect(report.findings).toHaveLength(0);
  });

  it('ปฏิเสธวันก่อนเริ่มปีและหลังสิ้นปี', () => {
    const before = checkFiscalYearRange({ requestDate: '2025-09-30' }, FY2569);
    const after = checkFiscalYearRange({ requestDate: '2026-10-01' }, FY2569);

    expect(before.findings[0]?.code).toBe('FISCAL_YEAR_MISMATCH');
    expect(after.findings[0]?.code).toBe('FISCAL_YEAR_MISMATCH');
  });

  it('FISCAL_YEAR_MISMATCH ยกเว้นไม่ได้', () => {
    expect(isOverridableRule('FISCAL_YEAR_MISMATCH')).toBe(false);
  });
});
