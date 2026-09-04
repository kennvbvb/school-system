import { describe, expect, it } from 'vitest';
import {
  NAME_SIMILARITY_THRESHOLD,
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
