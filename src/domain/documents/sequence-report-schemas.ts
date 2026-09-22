/**
 * Zod schema ของตัวกรองรายงานสถานะเอกสาร (ข้อ 10.1)
 *
 * เหตุผลเดียวกับ schema ของรายงานอื่น — ค่าทั้งหมดมาจาก query string ซึ่งผู้ใช้
 * แก้ในแถบที่อยู่เองได้ schema นี้จึงแปลงค่าที่พิมพ์มั่วให้เป็นค่าเริ่มต้นที่ปลอดภัย
 * แทนที่จะทำให้ทั้งหน้าล้ม
 */
import { z } from 'zod';
import { DOCUMENT_KINDS } from './document-register';

/**
 * สถานะที่ถือเป็น "ข้อยกเว้น" — ทุกสถานะที่ไม่ใช่ ISSUED
 *
 * ทั้งสามต้องมีเหตุผลกำกับเสมอตาม `document_numbers_reason_required`
 * ซึ่งเป็นเหตุผลเดียวกับที่ทำให้ทั้งสามอยู่ในรายงานเดียวกัน
 */
export const DOCUMENT_EXCEPTION_STATUSES = ['PENDING', 'NOT_REQUIRED', 'VOIDED'] as const;

export type DocumentExceptionStatus = (typeof DOCUMENT_EXCEPTION_STATUSES)[number];

const optionalUuid = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.uuid().optional().catch(undefined),
);

export const documentStatusFilterSchema = z.object({
  /** undefined = ทุกปีงบ ซึ่งเป็นค่าที่ไม่ซ่อนลำดับใดไว้ */
  fiscalYearId: optionalUuid,
  documentKind: z.enum(DOCUMENT_KINDS).optional().catch(undefined),
  /** undefined = ข้อยกเว้นทุกสถานะ */
  exceptionStatus: z.enum(DOCUMENT_EXCEPTION_STATUSES).optional().catch(undefined),
});

export type DocumentStatusFilter = z.infer<typeof documentStatusFilterSchema>;

/** อ่านตัวกรองจาก searchParams ของ Next.js ซึ่งค่าอาจเป็น array ได้ */
export function parseDocumentStatusFilter(
  params: Record<string, string | string[] | undefined>,
): DocumentStatusFilter {
  const first = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  return documentStatusFilterSchema.parse({
    fiscalYearId: first('fiscalYearId'),
    documentKind: first('documentKind'),
    exceptionStatus: first('exceptionStatus'),
  });
}

/** ตัวกรองนี้แคบกว่า "ดูทั้งหมด" หรือไม่ — ใช้ตัดสินว่าจะแสดงปุ่มล้างตัวกรอง */
export function hasActiveDocumentStatusFilter(filter: DocumentStatusFilter): boolean {
  return (
    filter.fiscalYearId !== undefined ||
    filter.documentKind !== undefined ||
    filter.exceptionStatus !== undefined
  );
}
