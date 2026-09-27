import { describe, expect, it } from 'vitest';
import {
  budgetReportExportHref,
  documentStatusExportHref,
  procurementRegisterExportHref,
} from '@/features/reports/export-hrefs';
import type { BudgetReportFilter } from '@/domain/budget/report-schemas';
import type { ProcurementRegisterFilter } from '@/domain/procurement/register-schemas';
import type { DocumentStatusFilter } from '@/domain/documents/sequence-report-schemas';

function parse(href: string): { pathname: string; params: URLSearchParams } {
  const [pathname, query] = href.split('?');
  if (pathname === undefined) throw new Error('href ไม่มี pathname');
  return { pathname, params: new URLSearchParams(query ?? '') };
}

describe('budgetReportExportHref', () => {
  const emptyFilter: BudgetReportFilter = {
    fiscalYearId: undefined,
    dimension: 'PROJECT',
    asOf: undefined,
    onlyOpen: false,
  };

  it('ชี้ไปที่ /reports/budget/export พร้อม format และ dimension เสมอ', () => {
    const { pathname, params } = parse(budgetReportExportHref(emptyFilter, 'xlsx'));
    expect(pathname).toBe('/reports/budget/export');
    expect(params.get('format')).toBe('xlsx');
    expect(params.get('dimension')).toBe('PROJECT');
  });

  it('ไม่ใส่ fiscalYearId/asOf เมื่อไม่ได้เลือก และไม่ใส่ onlyOpen เมื่อเป็น false', () => {
    const { params } = parse(budgetReportExportHref(emptyFilter, 'csv'));
    expect(params.has('fiscalYearId')).toBe(false);
    expect(params.has('asOf')).toBe(false);
    expect(params.has('onlyOpen')).toBe(false);
  });

  it('ใส่ทุกช่องที่เลือกไว้ รวมทั้ง onlyOpen เป็น "1" เมื่อเป็น true', () => {
    const filter: BudgetReportFilter = {
      fiscalYearId: 'fy-1',
      dimension: 'FUNDING_SOURCE',
      asOf: '2026-09-30',
      onlyOpen: true,
    };
    const { params } = parse(budgetReportExportHref(filter, 'xlsx'));
    expect(params.get('fiscalYearId')).toBe('fy-1');
    expect(params.get('dimension')).toBe('FUNDING_SOURCE');
    expect(params.get('asOf')).toBe('2026-09-30');
    expect(params.get('onlyOpen')).toBe('1');
  });
});

describe('procurementRegisterExportHref', () => {
  const emptyFilter: ProcurementRegisterFilter = {
    fiscalYearId: undefined,
    classification: undefined,
    status: undefined,
    dateFrom: undefined,
    dateTo: undefined,
  };

  it('ชี้ไปที่ /reports/procurements/export พร้อม format เสมอ', () => {
    const { pathname, params } = parse(procurementRegisterExportHref(emptyFilter, 'csv'));
    expect(pathname).toBe('/reports/procurements/export');
    expect(params.get('format')).toBe('csv');
  });

  it('ไม่ใส่ช่องใดเลยเมื่อไม่ได้กรองอะไร', () => {
    const { params } = parse(procurementRegisterExportHref(emptyFilter, 'csv'));
    for (const key of ['fiscalYearId', 'classification', 'status', 'dateFrom', 'dateTo']) {
      expect(params.has(key)).toBe(false);
    }
  });

  it('ใส่ทุกช่องที่เลือกไว้', () => {
    const filter: ProcurementRegisterFilter = {
      fiscalYearId: 'fy-1',
      classification: 'GOODS',
      status: 'ISSUED',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
    };
    const { params } = parse(procurementRegisterExportHref(filter, 'xlsx'));
    expect(params.get('fiscalYearId')).toBe('fy-1');
    expect(params.get('classification')).toBe('GOODS');
    expect(params.get('status')).toBe('ISSUED');
    expect(params.get('dateFrom')).toBe('2026-01-01');
    expect(params.get('dateTo')).toBe('2026-12-31');
  });
});

describe('documentStatusExportHref', () => {
  const emptyFilter: DocumentStatusFilter = {
    fiscalYearId: undefined,
    documentKind: undefined,
    exceptionStatus: undefined,
  };

  it('ชี้ไปที่ /reports/documents/export พร้อม format เสมอ', () => {
    const { pathname, params } = parse(documentStatusExportHref(emptyFilter, 'xlsx'));
    expect(pathname).toBe('/reports/documents/export');
    expect(params.get('format')).toBe('xlsx');
  });

  it('ไม่ใส่ dataset เมื่อไม่ได้ระบุ (สำหรับ XLSX ที่รวมทุกชุดในไฟล์เดียว)', () => {
    const { params } = parse(documentStatusExportHref(emptyFilter, 'xlsx'));
    expect(params.has('dataset')).toBe(false);
  });

  it('ใส่ dataset เมื่อระบุมา (สำหรับ CSV ที่ต้องเลือกหนึ่งชุด)', () => {
    const { params } = parse(documentStatusExportHref(emptyFilter, 'csv', 'exceptions'));
    expect(params.get('dataset')).toBe('exceptions');
  });

  it('ใส่ทุกช่องที่เลือกไว้', () => {
    const filter: DocumentStatusFilter = {
      fiscalYearId: 'fy-1',
      documentKind: 'PURCHASE_ORDER',
      exceptionStatus: 'PENDING',
    };
    const { params } = parse(documentStatusExportHref(filter, 'csv', 'sequence'));
    expect(params.get('fiscalYearId')).toBe('fy-1');
    expect(params.get('documentKind')).toBe('PURCHASE_ORDER');
    expect(params.get('exceptionStatus')).toBe('PENDING');
    expect(params.get('dataset')).toBe('sequence');
  });
});
