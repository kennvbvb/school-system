import { describe, expect, it } from 'vitest';
import {
  DRAFT_DOCUMENT_NUMBER,
  DocumentNumberError,
  formatDocumentNumber,
} from '@/domain/documents/document-number';

describe('formatDocumentNumber', () => {
  const context = {
    prefix: 'ศธ04',
    running: 7,
    fiscalYearBE: 2569,
    departmentCode: 'FIN',
    documentType: 'PO',
  };

  it('แทน token พื้นฐาน', () => {
    expect(formatDocumentNumber('{prefix}/{running}/{fiscalYearBE}', context)).toBe('ศธ04/7/2569');
  });

  it('เติมศูนย์หน้าตามความกว้างที่ระบุ', () => {
    expect(formatDocumentNumber('{prefix}/{running:4}/{fiscalYearBE}', context)).toBe(
      'ศธ04/0007/2569',
    );
  });

  it('รองรับปี พ.ศ. สองหลักและปี ค.ศ.', () => {
    expect(formatDocumentNumber('{running:3}/{fiscalYearBE:2}', context)).toBe('007/69');
    expect(formatDocumentNumber('{running}/{fiscalYearCE}', context)).toBe('7/2026');
  });

  it('รองรับรหัสหน่วยงานและชนิดเอกสาร', () => {
    expect(formatDocumentNumber('{documentType}-{departmentCode}-{running:5}', context)).toBe(
      'PO-FIN-00007',
    );
  });

  it('ยุบเครื่องหมายคั่นที่ค้างเมื่อ token ไม่มีค่า', () => {
    expect(
      formatDocumentNumber('{prefix}/{running:4}/{fiscalYearBE}', {
        running: 7,
        fiscalYearBE: 2569,
      }),
    ).toBe('0007/2569');
  });

  it('ปฏิเสธ token ที่ไม่รู้จัก แทนการปล่อยช่องว่างเงียบ ๆ', () => {
    expect(() => formatDocumentNumber('{prefix}/{unknownToken}', context)).toThrow(
      /token ที่ระบบไม่รู้จัก: unknownToken/,
    );
  });

  it('ปฏิเสธเลขลำดับที่ไม่ถูกต้อง', () => {
    expect(() => formatDocumentNumber('{running}', { ...context, running: 0 })).toThrow(
      DocumentNumberError,
    );
    expect(() => formatDocumentNumber('{running}', { ...context, running: 1.5 })).toThrow(
      DocumentNumberError,
    );
  });

  it('ปฏิเสธรูปแบบที่ว่างเปล่า', () => {
    expect(() => formatDocumentNumber('   ', context)).toThrow(DocumentNumberError);
  });
});

describe('DRAFT_DOCUMENT_NUMBER', () => {
  it('Preview ต้องไม่ใช้เลขจริง (FR-NUM-006)', () => {
    expect(DRAFT_DOCUMENT_NUMBER).toBe('DRAFT');
  });
});
