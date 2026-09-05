import { describe, expect, it } from 'vitest';
import {
  budgetAmountSchema,
  businessDateSchema,
  fiscalYearSchema,
  fiscalYearStatusChangeSchema,
  itemCategorySchema,
  projectSchema,
  schoolSettingsSchema,
  thaiTaxIdSchema,
  unitSchema,
  vendorSchema,
} from '@/domain/master-data/schemas';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('thaiTaxIdSchema', () => {
  it('ยอมรับเลข 13 หลัก', () => {
    expect(thaiTaxIdSchema.parse('1234567890123')).toBe('1234567890123');
  });

  it('ปฏิเสธความยาวผิดและอักขระที่ไม่ใช่ตัวเลข', () => {
    for (const invalid of ['123', '12345678901234', '123456789012x', '']) {
      expect(thaiTaxIdSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe('businessDateSchema', () => {
  it('ยอมรับรูปแบบ YYYY-MM-DD', () => {
    expect(businessDateSchema.parse('2026-09-30')).toBe('2026-09-30');
  });

  it('ปฏิเสธรูปแบบที่ไม่ใช่ YYYY-MM-DD', () => {
    for (const invalid of ['30/09/2026', '2026-9-30', '26-09-30', '2026/09/30', '']) {
      expect(businessDateSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('ปฏิเสธวันที่ที่ไม่มีอยู่จริงในปฏิทิน', () => {
    // Date.parse ปัดค่าพวกนี้ให้เงียบ ๆ เช่น 2026-02-30 กลายเป็น 2 มีนาคม
    // schema ต้องปฏิเสธ ไม่ใช่รับแล้วเปลี่ยนค่าให้ผู้ใช้โดยไม่บอก
    for (const invalid of ['2026-13-01', '2026-00-10', '2026-02-30', '2026-04-31', '2026-02-29']) {
      expect(businessDateSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('ยอมรับ 29 กุมภาพันธ์ ในปีอธิกสุรทิน', () => {
    expect(businessDateSchema.parse('2024-02-29')).toBe('2024-02-29');
  });
});

describe('budgetAmountSchema', () => {
  it('รับเป็นข้อความเพื่อไม่ให้ผ่าน floating point (ADR 0005)', () => {
    expect(budgetAmountSchema.parse('1234.56')).toBe('1234.56');
    expect(budgetAmountSchema.parse('0')).toBe('0');
  });

  it('ปฏิเสธค่าติดลบ ทศนิยมเกิน 2 ตำแหน่ง และเครื่องหมายคั่นหลักพัน', () => {
    for (const invalid of ['-1', '1.234', '1,000', '1e5', '']) {
      expect(budgetAmountSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe('schoolSettingsSchema', () => {
  const valid = {
    nameTh: 'โรงเรียนทดสอบ',
    addressTh: 'เลขที่ 1 ถนนทดสอบ',
    effectiveFrom: '2026-01-01',
  };

  it('ผ่านเมื่อข้อมูลบังคับครบ', () => {
    expect(schoolSettingsSchema.parse(valid).nameTh).toBe('โรงเรียนทดสอบ');
  });

  it('ปฏิเสธชื่อและที่อยู่ที่เป็นช่องว่างล้วน', () => {
    expect(schoolSettingsSchema.safeParse({ ...valid, nameTh: '   ' }).success).toBe(false);
    expect(schoolSettingsSchema.safeParse({ ...valid, addressTh: '  ' }).success).toBe(false);
  });

  it('แปลงอีเมลเป็นตัวพิมพ์เล็กให้ตรงกับ constraint ในฐานข้อมูล', () => {
    const parsed = schoolSettingsSchema.parse({ ...valid, email: 'Admin@School.AC.TH' });
    expect(parsed.email).toBe('admin@school.ac.th');
  });

  it('ปฏิเสธวันสิ้นสุดที่มาก่อนวันเริ่มมีผล', () => {
    const result = schoolSettingsSchema.safeParse({
      ...valid,
      effectiveFrom: '2026-06-01',
      effectiveTo: '2026-05-31',
    });
    expect(result.success).toBe(false);
  });

  it('ยอมให้วันสิ้นสุดเท่ากับวันเริ่ม (มีผลวันเดียว)', () => {
    expect(
      schoolSettingsSchema.safeParse({
        ...valid,
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-06-01',
      }).success,
    ).toBe(true);
  });
});

describe('fiscalYearSchema', () => {
  const valid = { code: 'FY2569', yearBE: 2569, startDate: '2025-10-01', endDate: '2026-09-30' };

  it('ผ่านเมื่อข้อมูลถูกต้อง', () => {
    expect(fiscalYearSchema.parse(valid).yearBE).toBe(2569);
  });

  it('ปฏิเสธปี ค.ศ. ที่กรอกผิดช่อง', () => {
    const result = fiscalYearSchema.safeParse({ ...valid, yearBE: 2026 });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('พุทธศักราช');
  });

  it('ปฏิเสธวันสิ้นสุดที่ไม่อยู่หลังวันเริ่ม', () => {
    expect(fiscalYearSchema.safeParse({ ...valid, endDate: '2025-10-01' }).success).toBe(false);
  });

  it('ปฏิเสธรหัสที่มีอักขระต้องห้าม', () => {
    for (const code of ['FY 2569', 'FY/2569', 'ปีงบ2569', '']) {
      expect(fiscalYearSchema.safeParse({ ...valid, code }).success).toBe(false);
    }
  });
});

describe('vendorSchema', () => {
  const valid = { vendorCode: 'V001', name: 'ร้านทดสอบ' };

  it('ผ่านเมื่อกรอกเฉพาะข้อมูลบังคับ และตั้ง isActive เป็น true ให้', () => {
    expect(vendorSchema.parse(valid)).toMatchObject({ vendorCode: 'V001', isActive: true });
  });

  it('ตัดช่องว่างหัวท้ายของชื่อ', () => {
    expect(vendorSchema.parse({ ...valid, name: '  ร้านทดสอบ  ' }).name).toBe('ร้านทดสอบ');
  });

  it('ปฏิเสธรหัสสาขาที่ไม่ใช่ตัวเลข', () => {
    expect(vendorSchema.safeParse({ ...valid, branchNo: 'abc' }).success).toBe(false);
    expect(vendorSchema.safeParse({ ...valid, branchNo: '123456' }).success).toBe(false);
    expect(vendorSchema.safeParse({ ...valid, branchNo: '00001' }).success).toBe(true);
  });

  it('ไม่มีช่องสำหรับข้อมูลบัญชีธนาคาร (ข้อ 14.2)', () => {
    expect(Object.keys(vendorSchema.shape)).not.toContain('bankAccount');
    expect(Object.keys(vendorSchema.shape)).not.toContain('bankData');
  });
});

describe('projectSchema', () => {
  const valid = { code: 'P001', nameTh: 'โครงการทดสอบ', fiscalYearId: UUID };

  it('ตั้งวงเงินเริ่มต้นเป็น 0 เมื่อไม่ระบุ', () => {
    expect(projectSchema.parse(valid).budgetAmount).toBe('0');
  });

  it('ปฏิเสธ fiscalYearId ที่ไม่ใช่ UUID', () => {
    expect(projectSchema.safeParse({ ...valid, fiscalYearId: 'not-a-uuid' }).success).toBe(false);
  });

  it('ปฏิเสธวงเงินติดลบ', () => {
    expect(projectSchema.safeParse({ ...valid, budgetAmount: '-100' }).success).toBe(false);
  });
});

describe('unitSchema และ itemCategorySchema', () => {
  it('หน่วยนับต้องมีรหัสและชื่อ', () => {
    expect(unitSchema.parse({ code: 'EA', nameTh: 'ชิ้น' }).isActive).toBe(true);
    expect(unitSchema.safeParse({ code: 'EA', nameTh: '' }).success).toBe(false);
  });

  it('หมวดพัสดุรับเฉพาะ SUPPLY หรือ ASSET', () => {
    const valid = { code: 'C01', nameTh: 'วัสดุสำนักงาน', kind: 'SUPPLY' as const };
    expect(itemCategorySchema.parse(valid).kind).toBe('SUPPLY');
    expect(itemCategorySchema.safeParse({ ...valid, kind: 'OTHER' }).success).toBe(false);
  });
});

describe('fiscalYearStatusChangeSchema', () => {
  const fiscalYearId = 'aaaaaaaa-0000-4000-8000-000000000001';

  /*
   * เหตุผลบังคับทั้งตอนปิดและตอนเปิดใหม่
   *
   * การเปิดปีที่ปิดไปแล้วกลับมาโดยไม่มีเหตุผลกำกับ ทำให้ผู้ตรวจสอบแยกไม่ออก
   * ระหว่าง "ปิดผิดแล้วแก้" กับ "เปิดกลับมาเพื่อแก้ตัวเลข"
   */
  it.each([undefined, '', '   '])('ปฏิเสธเมื่อไม่มีเหตุผล (%s)', (reason) => {
    expect(fiscalYearStatusChangeSchema.safeParse({ fiscalYearId, reason }).success).toBe(false);
  });

  it('ยอมรับเมื่อมีเหตุผล', () => {
    const result = fiscalYearStatusChangeSchema.safeParse({
      fiscalYearId,
      reason: 'ปิดปีตามหนังสือสั่งการ',
    });

    expect(result.success).toBe(true);
  });

  it('ปฏิเสธ id ที่ไม่ใช่ uuid', () => {
    expect(
      fiscalYearStatusChangeSchema.safeParse({ fiscalYearId: 'x', reason: 'เหตุผล' }).success,
    ).toBe(false);
  });
});
