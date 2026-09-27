/**
 * สร้างลิงก์ดาวน์โหลดของ Route Handler ส่งออกรายงานทั้งสาม (PR-09d)
 *
 * ใช้ตัวกรองที่ผ่านการตรวจของหน้าจอแล้ว (ไม่ใช่ query string ดิบจาก URL) เพื่อให้
 * ไฟล์ที่ได้ตรงกับสิ่งที่อยู่บนจอเสมอ แม้ผู้ใช้จะพิมพ์ query string แปลก ๆ มาเอง
 * ก็ตาม เพราะ parse*Filter ได้แปลงเป็นค่าที่ปลอดภัยไว้ก่อนถึงตรงนี้แล้ว
 *
 * เป็น pure function ไม่พึ่ง Supabase/Next.js จึงทดสอบตรงได้และใช้ได้ทั้งใน
 * Server Component และ Client Component
 */
import type { BudgetReportFilter } from '@/domain/budget/report-schemas';
import type { ProcurementRegisterFilter } from '@/domain/procurement/register-schemas';
import type { DocumentStatusFilter } from '@/domain/documents/sequence-report-schemas';

export type ExportFormat = 'xlsx' | 'csv';

export function budgetReportExportHref(filter: BudgetReportFilter, format: ExportFormat): string {
  const params = new URLSearchParams({ format, dimension: filter.dimension });
  if (filter.fiscalYearId) params.set('fiscalYearId', filter.fiscalYearId);
  if (filter.asOf) params.set('asOf', filter.asOf);
  if (filter.onlyOpen) params.set('onlyOpen', '1');
  return `/reports/budget/export?${params.toString()}`;
}

export function procurementRegisterExportHref(
  filter: ProcurementRegisterFilter,
  format: ExportFormat,
): string {
  const params = new URLSearchParams({ format });
  if (filter.fiscalYearId) params.set('fiscalYearId', filter.fiscalYearId);
  if (filter.classification) params.set('classification', filter.classification);
  if (filter.status) params.set('status', filter.status);
  if (filter.dateFrom) params.set('dateFrom', filter.dateFrom);
  if (filter.dateTo) params.set('dateTo', filter.dateTo);
  return `/reports/procurements/export?${params.toString()}`;
}

export function documentStatusExportHref(
  filter: DocumentStatusFilter,
  format: ExportFormat,
  dataset?: 'sequence' | 'exceptions',
): string {
  const params = new URLSearchParams({ format });
  if (dataset) params.set('dataset', dataset);
  if (filter.fiscalYearId) params.set('fiscalYearId', filter.fiscalYearId);
  if (filter.documentKind) params.set('documentKind', filter.documentKind);
  if (filter.exceptionStatus) params.set('exceptionStatus', filter.exceptionStatus);
  return `/reports/documents/export?${params.toString()}`;
}
