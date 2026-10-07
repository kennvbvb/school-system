import { describe, expect, it } from 'vitest';
import { FORBIDDEN_DRAFT_PAYLOAD_KEYS, toDraftPayload } from '@/domain/procurement/draft-payload';
import { procurementDraftSchema } from '@/domain/procurement/schemas';

const FISCAL_YEAR_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

function draft(overrides: Record<string, unknown> = {}) {
  return procurementDraftSchema.parse({
    subject: 'จัดซื้อวัสดุสำนักงาน (ตัวอย่าง)',
    taxMode: 'EXEMPT',
    fiscalYearId: FISCAL_YEAR_ID,
    requestDate: '2026-01-05',
    items: [
      { lineNo: 1, description: 'กระดาษ A4 (ตัวอย่าง)', quantity: '10', unitPrice: '250' },
      { lineNo: 2, description: 'หมึกพิมพ์ (ตัวอย่าง)', quantity: '1', unitPrice: '1000' },
    ],
    fundingAllocations: [{ lineNo: 1, budgetAccountId: ACCOUNT_ID, amount: '3500.00' }],
    ...overrides,
  });
}

describe('toDraftPayload — payload ของ RPC สร้าง/บันทึกร่าง (F-08)', () => {
  it('แปลงชื่อคีย์เป็น snake_case ตามที่ RPC อ่าน', () => {
    const payload = toDraftPayload(draft({ isEmergency: true, note: 'เร่งด่วน' }));

    expect(payload).toMatchObject({
      subject: 'จัดซื้อวัสดุสำนักงาน (ตัวอย่าง)',
      tax_mode: 'EXEMPT',
      fiscal_year_id: FISCAL_YEAR_ID,
      request_date: '2026-01-05',
      is_emergency: true,
      note: 'เร่งด่วน',
    });
    expect(payload.items).toEqual([
      expect.objectContaining({ line_no: 1, description: 'กระดาษ A4 (ตัวอย่าง)', quantity: '10' }),
      expect.objectContaining({ line_no: 2, unit_price: '1000' }),
    ]);
    expect(payload.funding_allocations).toEqual([
      expect.objectContaining({ line_no: 1, budget_account_id: ACCOUNT_ID, amount: '3500.00' }),
    ]);
  });

  it('ค่าว่างส่งเป็น null ไม่ใช่ undefined (JSON.stringify ทิ้ง undefined ทำให้คีย์หายแทนที่จะล้างค่า)', () => {
    const payload = toDraftPayload(draft());
    const roundTripped = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;

    for (const key of [
      'purpose',
      'department_id',
      'vendor_id',
      'required_date',
      'report_date',
      'classification',
      'procurement_method',
      'method_legal_basis_code',
      'note',
    ]) {
      expect(roundTripped, key).toHaveProperty(key, null);
    }
  });

  it('ไม่มีคีย์ที่ฐานข้อมูลกำหนดเอง (ผู้สร้าง สถานะ version เวลา ข้อยกเว้น ยอดเงิน)', () => {
    // ผู้เรียกพยายามแทรกคีย์ระบบเข้ามาในอินพุต — schema ตัดทิ้งก่อน และ payload ไม่หยิบมา
    const hostile = draft({
      createdBy: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      status: 'APPROVED',
      version: 99,
      grandTotal: '1',
    });
    const payload = toDraftPayload(hostile);
    const keys = Object.keys(payload);

    for (const forbidden of FORBIDDEN_DRAFT_PAYLOAD_KEYS) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
    expect(JSON.stringify(payload)).not.toContain('ffffffff-ffff-4fff-8fff-ffffffffffff');
  });

  it('ไม่มีรายการย่อย/แหล่งเงินก็ได้ส่งเป็นอาร์เรย์ว่าง (บันทึกร่างค้างไว้ได้)', () => {
    const payload = toDraftPayload(draft({ items: [], fundingAllocations: [] }));
    expect(payload.items).toEqual([]);
    expect(payload.funding_allocations).toEqual([]);
  });
});
