import { describe, expect, it } from 'vitest';
import {
  checkDocumentNumberRule,
  extractRunningNumber,
  normalizeDocumentNumber,
  requiresReason,
  suggestNextDocumentNumber,
} from '@/domain/documents/document-register';
import type { DocumentNumberRecord } from '@/domain/documents/document-register';

/**
 * กรณีทดสอบส่วนใหญ่มาจากเลขที่พบในไฟล์จริง ไม่ใช่จากที่คิดขึ้นเอง
 *
 * ทะเบียนใบสั่งจ้างใช้เลขไทย (`๑๓/๒๕๖๙`) ซึ่งเป็นเหตุผลทั้งหมดที่ต้อง normalize
 * ก่อนเทียบซ้ำ — ถ้าเทียบข้อความตรง ๆ `13/2569` กับ `๑๓/๒๕๖๙` จะเป็นคนละเลข
 */

const record = (over: Partial<DocumentNumberRecord> = {}): DocumentNumberRecord => ({
  id: over.id ?? crypto.randomUUID(),
  documentKind: over.documentKind ?? 'REQUEST_MEMO',
  status: over.status ?? 'ISSUED',
  documentNo: over.documentNo ?? null,
  runningNo: over.runningNo ?? null,
});

describe('normalizeDocumentNumber', () => {
  it('แปลงเลขไทยเป็นอารบิก', () => {
    expect(normalizeDocumentNumber('๑๓/๒๕๖๙')).toBe('13/2569');
  });

  it('ตัดช่องว่างออกทั้งหมด', () => {
    expect(normalizeDocumentNumber(' 13 / 2569 ')).toBe('13/2569');
  });

  it('เลขไทยกับอารบิกที่ค่าเท่ากันกลายเป็นข้อความเดียวกัน', () => {
    expect(normalizeDocumentNumber('๑๓/๒๕๖๙')).toBe(normalizeDocumentNumber('13/2569'));
  });

  /*
   * ตัวคั่นคนละแบบต้องยังเป็นคนละเลข
   *
   * การยุบ `/` กับ `-` ให้เหมือนกันจะบล็อกเอกสารคนละชุดที่ใช้ตัวคั่นต่างกันโดยตั้งใจ
   * ซึ่งเป็นความผิดพลาดที่ผู้ใช้แก้ตามไม่ได้ แย่กว่าการมีเลขที่ดูคล้ายกันสองเลข
   */
  it('ตัวคั่นต่างกันยังเป็นคนละเลข', () => {
    expect(normalizeDocumentNumber('13/2569')).not.toBe(normalizeDocumentNumber('13-2569'));
  });
});

describe('extractRunningNumber (F-13)', () => {
  it('แยกเลขลำดับจากเลขไทยได้', () => {
    expect(extractRunningNumber('๑๓/๒๕๖๙')).toBe(13);
  });

  /* ถ้าเอากลุ่มตัวเลขแรกจะได้ 04 ซึ่งเป็นส่วนของคำนำหน้า ไม่ใช่เลขลำดับ */
  it('ข้ามตัวเลขในคำนำหน้า', () => {
    expect(extractRunningNumber('ศธ04/0007/2569')).toBe(7);
  });

  it('รองรับรูปแบบที่ปีขึ้นก่อน', () => {
    expect(extractRunningNumber('2569/13')).toBe(13);
  });

  it('รองรับรูปแบบที่ไม่มีปี', () => {
    expect(extractRunningNumber('PO-FIN-00007')).toBe(7);
  });

  it('คืนค่าว่างเมื่อไม่มีตัวเลขเลย', () => {
    expect(extractRunningNumber('ไม่มีเลข')).toBeNull();
  });
});

describe('suggestNextDocumentNumber', () => {
  /*
   * ข้อที่สำคัญที่สุด — ระบบต้องไม่คิดรูปแบบขึ้นเอง
   *
   * Q3 ตอบว่าโรงเรียนกำหนดเลขเอง การเดารูปแบบให้ตอนที่ยังไม่มีตัวอย่างเลย
   * คือการสร้างแหล่งความจริงที่สองที่ขัดกับเลขที่โรงเรียนใช้จริง
   */
  it('ไม่เสนออะไรเมื่อยังไม่มีเลขในชนิดนั้นเลย', () => {
    expect(suggestNextDocumentNumber([], 'REQUEST_MEMO')).toBeNull();
  });

  it('ต่อจากรูปแบบเดิมโดยคงส่วนอื่นไว้', () => {
    const existing = [record({ documentNo: '13/2569', runningNo: 13 })];
    expect(suggestNextDocumentNumber(existing, 'REQUEST_MEMO')).toBe('14/2569');
  });

  it('คงจำนวนหลักที่เติมศูนย์ไว้', () => {
    const existing = [record({ documentNo: 'ศธ04/0007/2569', runningNo: 7 })];
    expect(suggestNextDocumentNumber(existing, 'REQUEST_MEMO')).toBe('ศธ04/0008/2569');
  });

  it('เสนอเป็นเลขไทยถ้าของเดิมเป็นเลขไทย', () => {
    const existing = [record({ documentNo: '๑๓/๒๕๖๙', runningNo: 13 })];
    expect(suggestNextDocumentNumber(existing, 'REQUEST_MEMO')).toBe('๑๔/๒๕๖๙');
  });

  it('ต่อจากเลขสูงสุด ไม่ใช่เลขล่าสุดที่บันทึก', () => {
    const existing = [
      record({ documentNo: '20/2569', runningNo: 20 }),
      record({ documentNo: '13/2569', runningNo: 13 }),
    ];
    expect(suggestNextDocumentNumber(existing, 'REQUEST_MEMO')).toBe('21/2569');
  });

  /*
   * ถ้าไม่นับแถวที่ยกเลิกแล้ว ระบบจะเสนอเลขที่ตัวเองจะปฏิเสธในวินาทีถัดไป
   * เพราะ unique index ไม่ได้กรอง VOIDED ออก
   */
  it('นับเลขที่ยกเลิกแล้วด้วย', () => {
    const existing = [
      record({ documentNo: '20/2569', runningNo: 20, status: 'VOIDED' }),
      record({ documentNo: '13/2569', runningNo: 13 }),
    ];
    expect(suggestNextDocumentNumber(existing, 'REQUEST_MEMO')).toBe('21/2569');
  });

  it('ไม่ข้ามชนิดเอกสาร', () => {
    const existing = [
      record({ documentKind: 'PURCHASE_ORDER', documentNo: '99/2569', runningNo: 99 }),
    ];
    expect(suggestNextDocumentNumber(existing, 'REQUEST_MEMO')).toBeNull();
  });
});

describe('checkDocumentNumberRule', () => {
  const existing = [
    record({ id: 'a', documentNo: '๑๓/๒๕๖๙', runningNo: 13 }),
    record({ id: 'b', documentNo: '20/2569', runningNo: 20, status: 'VOIDED' }),
  ];

  it('ยอมรับเลขที่ยังไม่มีใครใช้', () => {
    expect(
      checkDocumentNumberRule(
        { documentKind: 'REQUEST_MEMO', status: 'ISSUED', documentNo: '21/2569' },
        existing,
      ),
    ).toBeNull();
  });

  it('ปฏิเสธเลขที่ซ้ำ', () => {
    expect(
      checkDocumentNumberRule(
        { documentKind: 'REQUEST_MEMO', status: 'ISSUED', documentNo: '๑๓/๒๕๖๙' },
        existing,
      )?.code,
    ).toBe('DOCUMENT_NUMBER_DUPLICATE');
  });

  /* กรณีที่ทั้ง F-12 ขึ้นอยู่กับ — เขียนคนละรูปแต่เป็นเลขเดียวกัน */
  it('ปฏิเสธเลขอารบิกที่ตรงกับเลขไทยที่ใช้แล้ว', () => {
    expect(
      checkDocumentNumberRule(
        { documentKind: 'REQUEST_MEMO', status: 'ISSUED', documentNo: '13 / 2569' },
        existing,
      )?.code,
    ).toBe('DOCUMENT_NUMBER_DUPLICATE');
  });

  it('ปฏิเสธเลขที่เคยออกแล้วถูกยกเลิก พร้อมบอกว่าเป็นเลขที่ยกเลิกไป', () => {
    const rejection = checkDocumentNumberRule(
      { documentKind: 'REQUEST_MEMO', status: 'ISSUED', documentNo: '20/2569' },
      existing,
    );

    expect(rejection?.code).toBe('DOCUMENT_NUMBER_DUPLICATE');
    expect(rejection?.messageTh).toContain('ยกเลิก');
  });

  it('เลขเดียวกันในชนิดเอกสารอื่นใช้ได้', () => {
    expect(
      checkDocumentNumberRule(
        { documentKind: 'PURCHASE_ORDER', status: 'ISSUED', documentNo: '๑๓/๒๕๖๙' },
        existing,
      ),
    ).toBeNull();
  });

  it('ไม่นับแถวที่กำลังแก้ไขว่าซ้ำกับตัวเอง', () => {
    expect(
      checkDocumentNumberRule(
        { documentKind: 'REQUEST_MEMO', status: 'ISSUED', documentNo: '๑๓/๒๕๖๙' },
        existing,
        { excludeId: 'a' },
      ),
    ).toBeNull();
  });

  it('สถานะ ISSUED ต้องมีเลข', () => {
    expect(
      checkDocumentNumberRule({ documentKind: 'REQUEST_MEMO', status: 'ISSUED' }, existing)?.code,
    ).toBe('DOCUMENT_NUMBER_REQUIRED');
  });

  it.each(['NOT_REQUIRED', 'PENDING', 'VOIDED'] as const)('%s ต้องมีเหตุผล (F-14)', (status) => {
    expect(requiresReason(status)).toBe(true);
    expect(checkDocumentNumberRule({ documentKind: 'REQUEST_MEMO', status }, existing)?.code).toBe(
      'DOCUMENT_NUMBER_REASON_REQUIRED',
    );
  });

  it('เหตุผลที่เป็นช่องว่างล้วนไม่นับว่ามีเหตุผล', () => {
    expect(
      checkDocumentNumberRule(
        { documentKind: 'REQUEST_MEMO', status: 'NOT_REQUIRED', reason: '   ' },
        existing,
      )?.code,
    ).toBe('DOCUMENT_NUMBER_REASON_REQUIRED');
  });

  it('ระบุเหตุผลแล้วบันทึกว่าไม่ต้องมีเลขได้', () => {
    expect(
      checkDocumentNumberRule(
        {
          documentKind: 'REQUEST_MEMO',
          status: 'NOT_REQUIRED',
          reason: 'ค่าสาธารณูปโภครายเดือน (ตัวอย่าง)',
        },
        existing,
      ),
    ).toBeNull();
  });
});
