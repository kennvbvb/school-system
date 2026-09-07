import { describe, expect, it } from 'vitest';
import {
  NAME_SIMILARITY_THRESHOLD,
  checkVendorDuplicateRule,
  editDistance,
  findDuplicateVendors,
  hasBlockingDuplicate,
  nameSimilarity,
  normalizeVendorName,
} from '@/domain/master-data/vendor';
import type { VendorSummary } from '@/domain/master-data/vendor';

const vendor = (overrides: Partial<VendorSummary> & { name: string }): VendorSummary => ({
  id: 'v1',
  vendorCode: 'V001',
  taxId: null,
  branchNo: null,
  isActive: true,
  ...overrides,
});

describe('editDistance', () => {
  it('คำนวณระยะแก้ไขได้ถูกต้อง', () => {
    expect(editDistance('', '')).toBe(0);
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('สมชาย', 'สมชัย')).toBe(1);
  });
});

describe('normalizeVendorName', () => {
  it('ตัดคำนำหน้านิติบุคคลและช่องว่างออก', () => {
    expect(normalizeVendorName('บริษัท ก ก่อสร้าง จำกัด')).toBe('กก่อสร้าง');
    expect(normalizeVendorName('บ. ก ก่อสร้าง จก.')).toBe('กก่อสร้าง');
    expect(normalizeVendorName('หจก. ข พาณิชย์')).toBe('ขพาณิชย์');
  });

  it('ตัดคำนำหน้าบุคคลออก', () => {
    expect(normalizeVendorName('ร้านสมชาย')).toBe('สมชาย');
    expect(normalizeVendorName('นายสมชาย')).toBe('สมชาย');
  });
});

describe('nameSimilarity', () => {
  it('ชื่อเดียวกันที่เขียนคนละแบบถือว่าเหมือนกัน', () => {
    expect(nameSimilarity('บริษัท ก ก่อสร้าง จำกัด', 'บ. ก ก่อสร้าง จก.')).toBe(1);
  });

  it('ชื่อต่างกันสิ้นเชิงได้คะแนนต่ำ', () => {
    expect(nameSimilarity('ร้านวัสดุก่อสร้าง', 'บริษัท ซอฟต์แวร์ จำกัด')).toBeLessThan(0.5);
  });

  it('พิมพ์ผิดหนึ่งตัวยังถือว่าคล้ายมาก', () => {
    expect(nameSimilarity('ร้านสมชายพาณิชย์', 'ร้านสมชัยพาณิชย์')).toBeGreaterThanOrEqual(
      NAME_SIMILARITY_THRESHOLD,
    );
  });
});

describe('findDuplicateVendors — ระดับ BLOCK', () => {
  it('บล็อกเมื่อเลขผู้เสียภาษีและสาขาซ้ำ', () => {
    const findings = findDuplicateVendors(
      { name: 'ร้านใหม่ไม่เหมือนใคร', taxId: '1234567890123', branchNo: '00000' },
      [vendor({ name: 'ร้านเดิม', taxId: '1234567890123', branchNo: '00000', vendorCode: 'V009' })],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('BLOCK');
    expect(findings[0]?.reasonTh).toContain('V009');
    expect(hasBlockingDuplicate(findings)).toBe(true);
  });

  it('สาขาที่ไม่ระบุถือเป็นสำนักงานใหญ่ จึงซ้ำกับสาขา 00000', () => {
    const findings = findDuplicateVendors({ name: 'ร้าน ก', taxId: '1234567890123' }, [
      vendor({ name: 'ร้าน ข', taxId: '1234567890123', branchNo: '00000' }),
    ]);
    expect(findings[0]?.severity).toBe('BLOCK');
  });

  it('เลขผู้เสียภาษีเดียวกันแต่คนละสาขาไม่ถูกบล็อก', () => {
    const findings = findDuplicateVendors(
      { name: 'ร้าน ก สาขา 2', taxId: '1234567890123', branchNo: '00002' },
      [vendor({ name: 'ร้าน ข', taxId: '1234567890123', branchNo: '00001' })],
    );
    expect(hasBlockingDuplicate(findings)).toBe(false);
  });
});

describe('findDuplicateVendors — ระดับ WARN', () => {
  it('เตือนเมื่อชื่อคล้ายกันมากแต่ยังไม่มีเลขผู้เสียภาษี', () => {
    const findings = findDuplicateVendors({ name: 'ร้านสมชายพาณิชย์' }, [
      vendor({ name: 'ร้านสมชัยพาณิชย์', vendorCode: 'V002' }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('WARN');
    expect(hasBlockingDuplicate(findings)).toBe(false);
  });

  it('ข้อความต่างกันระหว่างชื่อตรงกันเป๊ะกับชื่อคล้าย', () => {
    const exact = findDuplicateVendors({ name: 'ร้านสมชาย' }, [vendor({ name: 'ร้านสมชาย' })]);
    expect(exact[0]?.reasonTh).toContain('ชื่อตรงกับ');

    const similar = findDuplicateVendors({ name: 'ร้านสมชายพาณิชย์' }, [
      vendor({ name: 'ร้านสมชัยพาณิชย์' }),
    ]);
    expect(similar[0]?.reasonTh).toContain('ชื่อคล้ายกับ');
  });

  it('ไม่เตือนเมื่อชื่อต่างกันชัดเจน', () => {
    expect(
      findDuplicateVendors({ name: 'ร้านวัสดุก่อสร้างเจริญทรัพย์' }, [
        vendor({ name: 'บริษัท ซอฟต์แวร์เฮาส์ จำกัด' }),
      ]),
    ).toEqual([]);
  });
});

describe('findDuplicateVendors — การจัดลำดับ', () => {
  it('เรียง BLOCK ก่อน WARN', () => {
    const findings = findDuplicateVendors({ name: 'ร้านสมชาย', taxId: '1234567890123' }, [
      vendor({ id: 'a', name: 'ร้านสมชาย', vendorCode: 'V001' }),
      vendor({ id: 'b', name: 'ร้านอื่น', taxId: '1234567890123', vendorCode: 'V002' }),
    ]);

    expect(findings.map((f) => f.severity)).toEqual(['BLOCK', 'WARN']);
  });

  it('ไม่รายงานผู้ขายรายเดิมซ้ำสองระดับ', () => {
    const findings = findDuplicateVendors({ name: 'ร้านสมชาย', taxId: '1234567890123' }, [
      vendor({ name: 'ร้านสมชาย', taxId: '1234567890123' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('BLOCK');
  });

  it('ไม่มีผู้ขายเดิมเลยก็ไม่พบอะไร', () => {
    expect(findDuplicateVendors({ name: 'ร้านใหม่' }, [])).toEqual([]);
  });
});

describe('checkVendorDuplicateRule — ตัดสินว่าบันทึกได้หรือไม่', () => {
  const HEAD_OFFICE: VendorSummary = {
    id: 'dddddddd-0000-4000-8000-000000000001',
    vendorCode: 'V-100',
    name: 'ร้านวัสดุก่อสร้างสมชาย (ตัวอย่าง)',
    taxId: '1000000000001',
    branchNo: '00000',
    isActive: true,
  };

  it('ไม่ซ้ำเลยก็บันทึกได้โดยไม่ต้องยืนยัน', () => {
    const result = checkVendorDuplicateRule(
      { name: 'ร้านเครื่องเขียนคนละอย่าง (ตัวอย่าง)', taxId: '9000000000009' },
      [HEAD_OFFICE],
      false,
    );

    expect(result.rejection).toBeNull();
    expect(result.findings).toHaveLength(0);
  });

  /*
   * ข้อสำคัญที่สุดของกฎนี้ — คำยืนยันของผู้ใช้ไม่ปลดล็อก BLOCK
   *
   * เลขผู้เสียภาษีและสาขาที่ตรงกันคือนิติบุคคลเดียวกันแน่นอน ไม่ใช่เรื่องดุลพินิจ
   * ถ้ายกเว้นได้ ระบบจะมีผู้ขายรายเดียวกันสองแถว แล้วรายงานยอดซื้อต่อรายจะผิด
   */
  it('BLOCK ยกเว้นไม่ได้แม้ผู้ใช้ยืนยัน', () => {
    const draft = { name: 'ชื่ออื่นไปเลย (ตัวอย่าง)', taxId: '1000000000001', branchNo: '00000' };

    expect(checkVendorDuplicateRule(draft, [HEAD_OFFICE], false).rejection).not.toBeNull();
    expect(checkVendorDuplicateRule(draft, [HEAD_OFFICE], true).rejection).not.toBeNull();
  });

  it('ข้อความของ BLOCK บอกให้ไปแก้ที่รายเดิม ไม่ใช่ให้ลองใหม่', () => {
    const result = checkVendorDuplicateRule(
      { name: 'ชื่ออื่น (ตัวอย่าง)', taxId: '1000000000001' },
      [HEAD_OFFICE],
      false,
    );

    expect(result.rejection).toContain('แก้ที่ผู้ขายรายเดิม');
    expect(result.rejection).toContain(HEAD_OFFICE.vendorCode);
  });

  it('WARN บล็อกไว้ก่อนเมื่อยังไม่ยืนยัน และบอกวิธียืนยัน', () => {
    const result = checkVendorDuplicateRule(
      { name: 'ร้านวัสดุก่อสร้างสมชัย (ตัวอย่าง)', taxId: '2000000000002' },
      [HEAD_OFFICE],
      false,
    );

    expect(result.rejection).toContain('อาจซ้ำ');
    expect(result.rejection).toContain('ยืนยันว่าเป็นผู้ขายคนละราย');
  });

  it('WARN ผ่านได้เมื่อยืนยัน และคืนรายการที่พบไว้ให้บันทึกลง audit', () => {
    const result = checkVendorDuplicateRule(
      { name: 'ร้านวัสดุก่อสร้างสมชัย (ตัวอย่าง)', taxId: '2000000000002' },
      [HEAD_OFFICE],
      true,
    );

    expect(result.rejection).toBeNull();
    expect(result.findings.map((finding) => finding.severity)).toEqual(['WARN']);
    expect(result.findings[0]?.vendor.id).toBe(HEAD_OFFICE.id);
  });

  /*
   * ผู้ขายที่ปิดใช้แล้วยังต้องกันการบันทึกซ้ำ
   *
   * ถ้าไม่นับ ผู้ใช้จะเพิ่มรายเดิมเข้ามาใหม่ได้เพียงเพราะรายเดิมถูกปิดใช้ไว้
   * แล้วไปชนกับ unique index ของฐานข้อมูลอยู่ดี โดยได้ข้อความที่แก้ตามไม่ได้
   */
  it('ผู้ขายที่ปิดใช้แล้วยังกันการบันทึกซ้ำ', () => {
    const result = checkVendorDuplicateRule(
      { name: 'ชื่ออื่น (ตัวอย่าง)', taxId: '1000000000001' },
      [{ ...HEAD_OFFICE, isActive: false }],
      true,
    );

    expect(result.rejection).not.toBeNull();
  });
});
