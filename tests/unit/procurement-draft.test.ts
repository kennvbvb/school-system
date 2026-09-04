import { describe, expect, it } from 'vitest';
import {
  EDITABLE_STATUSES,
  ProcurementDraftError,
  assertEditable,
  assertLinesConsistent,
  assertReadyToSubmit,
  cloneDraft,
  fundingTotal,
  isEditable,
  totalOfDraft,
} from '@/domain/procurement/draft';
import {
  TAX_MODES,
  TAX_MODE_LABELS_TH,
  procurementDraftSchema,
  procurementItemSchema,
  procurementUpdateSchema,
} from '@/domain/procurement/schemas';
import type { ProcurementDraftInput } from '@/domain/procurement/schemas';
import { PROCUREMENT_STATUSES } from '@/domain/procurement/status';
import { decimalStringToSatang } from '@/domain/money/money';

const baseDraft = (overrides: Partial<ProcurementDraftInput> = {}): ProcurementDraftInput =>
  procurementDraftSchema.parse({
    subject: 'ซื้อวัสดุสำนักงาน',
    taxMode: 'EXEMPT',
    fiscalYearId: '11111111-1111-4111-8111-111111111111',
    requestDate: '2026-01-15',
    items: [{ lineNo: 1, description: 'กระดาษ A4', quantity: '3', unitPrice: '250.50' }],
    ...overrides,
  });

describe('สถานะที่แก้ไขได้', () => {
  it('แก้ได้เฉพาะฉบับร่างและรายการที่ถูกส่งกลับให้แก้', () => {
    expect(EDITABLE_STATUSES).toEqual(['DRAFT', 'NEEDS_REVISION']);
    for (const status of PROCUREMENT_STATUSES) {
      expect(isEditable(status)).toBe(status === 'DRAFT' || status === 'NEEDS_REVISION');
    }
  });

  it('ข้อความบอกสาเหตุที่ผู้ใช้เข้าใจ ไม่ใช่ศัพท์เทคนิค', () => {
    expect(() => assertEditable('PENDING_APPROVAL')).toThrow(/ส่งเข้าสู่ขั้นตอนอนุมัติแล้ว/);
    expect(() => assertEditable('DRAFT')).not.toThrow();
  });
});

describe('schema ของรายการย่อย', () => {
  const item = {
    lineNo: 1,
    description: 'กระดาษ',
    quantity: '1',
    unitPrice: '100',
  };

  it('รับค่าปกติ และเติมค่าเริ่มต้นให้ส่วนลดกับอัตราภาษี', () => {
    const parsed = procurementItemSchema.parse(item);
    expect(parsed.discountAmount).toBe('0');
    expect(parsed.taxRate).toBe('0');
  });

  it('ปฏิเสธจำนวนที่เป็นศูนย์หรือติดลบ', () => {
    expect(procurementItemSchema.safeParse({ ...item, quantity: '0' }).success).toBe(false);
    expect(procurementItemSchema.safeParse({ ...item, quantity: '-1' }).success).toBe(false);
  });

  it('ปฏิเสธทศนิยมเกินความละเอียดที่ฐานข้อมูลเก็บได้', () => {
    // quantity เก็บเป็น numeric(18,4) ถ้ารับ 5 ตำแหน่งจะถูกปัดเงียบ ๆ ตอน insert
    expect(procurementItemSchema.safeParse({ ...item, quantity: '1.12345' }).success).toBe(false);
    expect(procurementItemSchema.safeParse({ ...item, quantity: '1.1234' }).success).toBe(true);
  });

  it('ปฏิเสธส่วนลดที่เกินมูลค่าบรรทัด และชี้ที่ช่องส่วนลด', () => {
    const result = procurementItemSchema.safeParse({
      ...item,
      quantity: '1',
      unitPrice: '100',
      discountAmount: '150',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['discountAmount']);
    }
  });

  it('ส่วนลดเท่ากับมูลค่าบรรทัดพอดีทำได้ (แจกฟรี)', () => {
    expect(procurementItemSchema.safeParse({ ...item, discountAmount: '100' }).success).toBe(true);
  });

  it('ปฏิเสธอัตราภาษีเกิน 100', () => {
    expect(procurementItemSchema.safeParse({ ...item, taxRate: '101' }).success).toBe(false);
    expect(procurementItemSchema.safeParse({ ...item, taxRate: '100' }).success).toBe(true);
  });
});

describe('วิธีคิดภาษี', () => {
  it('ทุกโหมดมีป้ายภาษาไทย', () => {
    for (const mode of TAX_MODES) {
      expect(TAX_MODE_LABELS_TH[mode]?.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('ยอดรวมและแหล่งเงิน', () => {
  it('ยอดรวมคำนวณจากรายการย่อย', () => {
    expect(totalOfDraft(baseDraft())).toBe(decimalStringToSatang('751.50'));
  });

  it('ผลรวมแหล่งเงินบวกทีละบรรทัดในหน่วยสตางค์ ไม่ผ่าน floating point', () => {
    const allocations = [
      { lineNo: 1, budgetAccountId: '11111111-1111-4111-8111-111111111111', amount: '0.10' },
      { lineNo: 2, budgetAccountId: '22222222-2222-4222-8222-222222222222', amount: '0.20' },
    ];
    // 0.1 + 0.2 ใน floating point ได้ 0.30000000000000004
    expect(fundingTotal(allocations)).toBe(30n);
  });
});

describe('ความพร้อมก่อนส่งอนุมัติ', () => {
  it('ต้องมีรายการพัสดุอย่างน้อยหนึ่งรายการ', () => {
    try {
      assertReadyToSubmit(baseDraft({ items: [] }));
      throw new Error('ควรถูกปฏิเสธ');
    } catch (error) {
      expect(error).toBeInstanceOf(ProcurementDraftError);
      expect((error as ProcurementDraftError).code).toBe('NO_ITEMS');
    }
  });

  it('ยอดแหล่งเงินไม่ตรงกับยอดรวมถูกปฏิเสธ พร้อมบอกว่าขาดเท่าไร', () => {
    const draft = baseDraft({
      fundingAllocations: [
        { lineNo: 1, budgetAccountId: '11111111-1111-4111-8111-111111111111', amount: '700.00' },
      ],
    });

    try {
      assertReadyToSubmit(draft);
      throw new Error('ควรถูกปฏิเสธ');
    } catch (error) {
      expect(error).toBeInstanceOf(ProcurementDraftError);
      const err = error as ProcurementDraftError;
      expect(err.code).toBe('FUNDING_TOTAL_MISMATCH');
      expect(err.message).toContain('ขาดอีก');
      expect(err.message).toContain('51.50');
    }
  });

  it('ยอดแหล่งเงินเกินก็ถูกปฏิเสธ และบอกว่าเกินมา', () => {
    const draft = baseDraft({
      fundingAllocations: [
        { lineNo: 1, budgetAccountId: '11111111-1111-4111-8111-111111111111', amount: '800.00' },
      ],
    });

    try {
      assertReadyToSubmit(draft);
      throw new Error('ควรถูกปฏิเสธ');
    } catch (error) {
      expect((error as ProcurementDraftError).message).toContain('เกินมา');
    }
  });

  it('แหล่งเงินหลายบรรทัดที่รวมแล้วตรงพอดีผ่าน (F-02)', () => {
    const draft = baseDraft({
      fundingAllocations: [
        { lineNo: 1, budgetAccountId: '11111111-1111-4111-8111-111111111111', amount: '500.00' },
        { lineNo: 2, budgetAccountId: '22222222-2222-4222-8222-222222222222', amount: '251.50' },
      ],
    });

    expect(() => assertReadyToSubmit(draft)).not.toThrow();
  });

  it('บัญชีงบเดียวกันซ้ำสองบรรทัดถูกปฏิเสธก่อนถึงฐานข้อมูล', () => {
    const draft = baseDraft({
      fundingAllocations: [
        { lineNo: 1, budgetAccountId: '11111111-1111-4111-8111-111111111111', amount: '400.00' },
        { lineNo: 2, budgetAccountId: '11111111-1111-4111-8111-111111111111', amount: '351.50' },
      ],
    });

    try {
      assertLinesConsistent(draft);
      throw new Error('ควรถูกปฏิเสธ');
    } catch (error) {
      expect(error).toBeInstanceOf(ProcurementDraftError);
      expect((error as ProcurementDraftError).code).toBe('DUPLICATE_BUDGET_ACCOUNT');
    }
  });

  it('เลขบรรทัดซ้ำถูกปฏิเสธพร้อมบอกว่าบรรทัดไหน', () => {
    const draft = baseDraft({
      items: [
        {
          lineNo: 1,
          description: 'ก',
          quantity: '1',
          unitPrice: '1',
          discountAmount: '0',
          taxRate: '0',
        },
        {
          lineNo: 1,
          description: 'ข',
          quantity: '1',
          unitPrice: '1',
          discountAmount: '0',
          taxRate: '0',
        },
      ],
    });

    expect(() => assertLinesConsistent(draft)).toThrow(/เลขบรรทัด 1 ซ้ำ/);
  });
});

describe('การทำสำเนา', () => {
  const source = baseDraft({
    requiredDate: '2026-02-01',
    fundingAllocations: [
      { lineNo: 1, budgetAccountId: '11111111-1111-4111-8111-111111111111', amount: '751.50' },
    ],
  });

  it('คัดลอกเนื้อหาที่ใช้ซ้ำได้', () => {
    const { draft } = cloneDraft(source);
    expect(draft.subject).toBe(source.subject);
    expect(draft.items).toHaveLength(1);
    expect(draft.taxMode).toBe(source.taxMode);
  });

  it('ไม่พาวันที่ติดไปกับสำเนา (กันเอกสารลงวันที่ย้อนหลังโดยไม่ตั้งใจ F-04)', () => {
    const { draft, clearedFields } = cloneDraft(source);
    expect(draft).not.toHaveProperty('requestDate');
    expect(draft).not.toHaveProperty('requiredDate');
    expect(clearedFields).toContain('requestDate');
  });

  it('ไม่พาแหล่งเงินติดไป เพราะการกันยอดงบต้องตัดสินใจใหม่เสมอ', () => {
    expect(cloneDraft(source).draft.fundingAllocations).toEqual([]);
  });

  it('ไม่พาเลขอ้างอิงและสถานะติดไป', () => {
    const { clearedFields } = cloneDraft(source);
    expect(clearedFields).toContain('reference');
    expect(clearedFields).toContain('status');
  });

  it('แก้สำเนาแล้วต้นฉบับไม่เปลี่ยน', () => {
    const { draft } = cloneDraft(source);
    const firstItem = draft.items[0];
    if (firstItem) firstItem.description = 'เปลี่ยนในสำเนา';

    expect(source.items[0]?.description).toBe('กระดาษ A4');
  });
});

describe('schema ของการแก้ไข', () => {
  it('บังคับให้ส่ง version ที่อ่านมา', () => {
    const withoutVersion = {
      id: '11111111-1111-4111-8111-111111111111',
      subject: 'x',
      fiscalYearId: '11111111-1111-4111-8111-111111111111',
      requestDate: '2026-01-15',
    };

    expect(procurementUpdateSchema.safeParse(withoutVersion).success).toBe(false);
    expect(
      procurementUpdateSchema.safeParse({ ...withoutVersion, expectedVersion: 1 }).success,
    ).toBe(true);
  });
});
