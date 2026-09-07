import { describe, expect, it } from 'vitest';
import { vendorCreateSchema, vendorSchema, vendorUpdateSchema } from '@/domain/master-data/schemas';
import { vendorAddressToLine, vendorLineToAddress } from '@/domain/master-data/vendor';

const VENDOR_ID = 'cccccccc-0000-4000-8000-000000000001';

/** ผู้ขายที่กรอกครบ — แต่ละ test แก้เฉพาะจุดที่ต้องการทดสอบ */
function validVendor(overrides: Record<string, unknown> = {}) {
  return {
    vendorCode: 'V-001',
    name: 'ร้านวัสดุ (ตัวอย่าง)',
    taxId: '0000000000000',
    branchNo: '00000',
    address: '123 หมู่ 1 (ตัวอย่าง)',
    contactName: 'ผู้ติดต่อ (ตัวอย่าง)',
    phone: '000-000-0000',
    email: 'Shop@Example.Test',
    note: 'หมายเหตุ (ตัวอย่าง)',
    isActive: true,
    ...overrides,
  };
}

describe('vendorCreateSchema', () => {
  it('รับผู้ขายที่กรอกครบ และแปลงอีเมลเป็นตัวพิมพ์เล็กตาม constraint ของฐานข้อมูล', () => {
    const parsed = vendorCreateSchema.parse(validVendor());

    expect(parsed.email).toBe('shop@example.test');
    expect(parsed.vendorCode).toBe('V-001');
  });

  /*
   * ฟอร์ม HTML ส่งช่องที่เว้นว่างมาเป็น '' ไม่ใช่ undefined
   *
   * ถ้า schema ไม่แปลงให้ก่อน ผู้ใช้ที่ไม่กรอกอีเมล — ซึ่งเป็นช่องไม่บังคับ —
   * จะได้ข้อความว่า "รูปแบบอีเมลไม่ถูกต้อง" และไม่มีทางแก้ให้ผ่านนอกจากพิมพ์อีเมลปลอม
   */
  it.each(['email', 'taxId', 'branchNo', 'address', 'contactName', 'phone', 'note'])(
    'ช่อง %s ที่เว้นว่างไม่ถือเป็นข้อผิดพลาด',
    (field) => {
      const result = vendorCreateSchema.safeParse(validVendor({ [field]: '' }));

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[field as 'email']).toBeUndefined();
      }
    },
  );

  it('ยังไม่ถือว่ายืนยันเมื่อผู้เรียกไม่ได้ส่งค่ามา', () => {
    expect(vendorCreateSchema.parse(validVendor()).acknowledgedDuplicate).toBe(false);
  });

  it('รับคำยืนยันเมื่อส่งมาชัดเจน', () => {
    expect(
      vendorCreateSchema.parse(validVendor({ acknowledgedDuplicate: true })).acknowledgedDuplicate,
    ).toBe(true);
  });

  it.each([
    ['12345', 'เลขผู้เสียภาษีสั้นเกินไป'],
    ['00000000000000', 'เลขผู้เสียภาษียาวเกินไป'],
    ['000000000000ก', 'เลขผู้เสียภาษีมีตัวอักษร'],
  ])('ปฏิเสธ %s', (taxId) => {
    expect(vendorCreateSchema.safeParse(validVendor({ taxId })).success).toBe(false);
  });

  it('ปฏิเสธรหัสสาขาที่ไม่ใช่ตัวเลข', () => {
    expect(vendorCreateSchema.safeParse(validVendor({ branchNo: 'สาขา1' })).success).toBe(false);
  });

  it('ปฏิเสธชื่อที่ว่างเปล่า', () => {
    expect(vendorCreateSchema.safeParse(validVendor({ name: '   ' })).success).toBe(false);
  });

  /*
   * รหัสผู้ขายไปอยู่ในเลขเอกสารและใช้ค้นหา จึงจำกัดอักขระไว้ที่ schema เดียวกับ
   * ที่ฐานข้อมูลบังคับ ไม่ใช่ปล่อยให้ insert ล้มแล้วค่อยแปลข้อความทีหลัง
   */
  it('ปฏิเสธรหัสผู้ขายที่มีอักขระนอกเหนือจากที่อนุญาต', () => {
    expect(vendorCreateSchema.safeParse(validVendor({ vendorCode: 'ผู้ขาย 1' })).success).toBe(
      false,
    );
  });
});

describe('vendorUpdateSchema', () => {
  it('ต้องมีรหัสผู้ขายที่เป็น uuid', () => {
    expect(vendorUpdateSchema.safeParse(validVendor()).success).toBe(false);
    expect(vendorUpdateSchema.safeParse(validVendor({ vendorId: 'ไม่ใช่ uuid' })).success).toBe(
      false,
    );
    expect(vendorUpdateSchema.safeParse(validVendor({ vendorId: VENDOR_ID })).success).toBe(true);
  });

  it('ใช้กติกาเดียวกับตอนสร้างทุกช่อง', () => {
    expect(
      vendorUpdateSchema.safeParse(validVendor({ vendorId: VENDOR_ID, taxId: '1' })).success,
    ).toBe(false);
  });
});

describe('vendorSchema กับ vendorCreateSchema ต่างกันเฉพาะคำยืนยัน', () => {
  it('vendorSchema ไม่มีช่องคำยืนยัน จึงใช้ตรวจข้อมูลผู้ขายล้วน ๆ ได้', () => {
    expect(vendorSchema.parse(validVendor())).not.toHaveProperty('acknowledgedDuplicate');
  });
});

describe('ที่อยู่ผู้ขายใน jsonb', () => {
  it('เขียนแล้วอ่านกลับได้ค่าเดิม', () => {
    const stored = vendorLineToAddress('123 หมู่ 1 (ตัวอย่าง)');

    expect(vendorAddressToLine(stored)).toBe('123 หมู่ 1 (ตัวอย่าง)');
  });

  it('ตัดช่องว่างหัวท้ายก่อนเก็บ', () => {
    expect(vendorLineToAddress('  123 (ตัวอย่าง)  ')).toEqual({ line: '123 (ตัวอย่าง)' });
  });

  it('ที่อยู่ว่างเก็บเป็น null ไม่ใช่ออบเจ็กต์ว่าง', () => {
    expect(vendorLineToAddress('')).toBeNull();
    expect(vendorLineToAddress('   ')).toBeNull();
    expect(vendorLineToAddress(null)).toBeNull();
    expect(vendorLineToAddress(undefined)).toBeNull();
  });

  /*
   * jsonb เก็บอะไรก็ได้ แถวที่แก้ด้วย SQL หรือ import เข้ามาอาจไม่ได้อยู่ในรูปนี้
   * หน้าจอต้องแสดง "—" ไม่ใช่พังทั้งหน้าเพราะแถวเดียว
   */
  it.each([null, undefined, 'ข้อความดิบ', 42, [], {}, { line: 123 }, { line: '  ' }])(
    'อ่านค่าที่ไม่ได้อยู่ในรูปที่คาดไว้ (%s) เป็น null',
    (value) => {
      expect(vendorAddressToLine(value)).toBeNull();
    },
  );
});
