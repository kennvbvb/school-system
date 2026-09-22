import type { NextRequest } from 'next/server';
import { requireAnyPermission } from '@/server/auth/guard';
import { AuthorizationError } from '@/server/auth/guard';
import {
  DOCUMENT_EXCEPTION_LIMIT,
  loadDocumentExceptions,
  loadDocumentSequenceRows,
} from '@/server/reports/repository';
import { parseDocumentStatusFilter } from '@/domain/documents/sequence-report-schemas';
import {
  documentExceptionExportDataset,
  documentSequenceExportDataset,
} from '@/features/reports/export-columns';
import { buildCsvText, resolveDataset } from '@/domain/reports/export';
import { buildXlsxBuffer } from '@/server/reports/export-file';
import { sha256Hex } from '@/lib/checksum';
import { recordAuditEvent } from '@/server/audit/audit-log';
import {
  authorizationErrorResponse,
  badRequestResponse,
  fileResponse,
  parseExportFormat,
  truncatedResponse,
} from '@/server/reports/export-http';

/**
 * ส่งออกรายงานสถานะเอกสารเป็น XLSX/CSV (PR-09d)
 *
 * ต้องมี documents.issue หรือ procurement.read.all (เหมือนหน้า /reports/documents)
 * **และ** reports.export
 *
 * รายงานนี้มีสองตาราง — XLSX จึงรวมทั้งสองไว้เป็นสองชีตในไฟล์เดียวเสมอ ไม่ต้องเลือก
 * แต่ CSV มีได้ตารางเดียวต่อไฟล์ จึงต้องระบุ `dataset=sequence` หรือ `dataset=exceptions`
 *
 * ปฏิเสธการส่งออกเมื่อรายการยกเว้นถูกตัด (เกิน DOCUMENT_EXCEPTION_LIMIT) ทั้งสอง
 * รูปแบบไฟล์ — เหตุผลเดียวกับทะเบียนจัดซื้อจัดจ้าง ไฟล์ที่ไม่ครบไม่ควรมีคำเตือน
 * ติดไปแค่ตอนดูบนจอ แต่หายไปตอนถูกดาวน์โหลดเก็บไว้ ลำดับเลขที่เอกสารไม่มีเพดาน
 * แถวจึงไม่ต้องตรวจส่วนนี้
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPORT_KEY = 'document-status';

type ExceptionDatasetChoice = 'sequence' | 'exceptions';

function parseDatasetChoice(searchParams: URLSearchParams): ExceptionDatasetChoice | null {
  const value = searchParams.get('dataset');
  if (value === null) return 'sequence';
  return value === 'sequence' || value === 'exceptions' ? value : null;
}

export async function GET(request: NextRequest): Promise<Response> {
  let actorId: string | null = null;

  try {
    const user = await requireAnyPermission('documents.issue', 'procurement.read.all');
    if (!user.permissions.has('reports.export')) {
      throw new AuthorizationError('FORBIDDEN', 'คุณไม่มีสิทธิ์ส่งออกรายงานนี้');
    }
    actorId = user.id;

    const format = parseExportFormat(request.nextUrl.searchParams);
    if (format === null) {
      return badRequestResponse('รูปแบบไฟล์ต้องเป็น xlsx หรือ csv เท่านั้น');
    }

    const datasetChoice = parseDatasetChoice(request.nextUrl.searchParams);
    if (format === 'csv' && datasetChoice === null) {
      return badRequestResponse('ไฟล์ CSV ต้องระบุ dataset เป็น sequence หรือ exceptions');
    }

    const filter = parseDocumentStatusFilter(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );

    const [sequenceRows, exceptions] = await Promise.all([
      loadDocumentSequenceRows(filter),
      loadDocumentExceptions(filter),
    ]);

    if (exceptions.truncated) {
      return truncatedResponse(
        `มีเอกสารที่ไม่ได้อยู่ในสถานะออกเลขแล้วเกิน ${DOCUMENT_EXCEPTION_LIMIT.toLocaleString('th-TH')} ฉบับ ` +
          'ตามเงื่อนไขที่เลือก จึงไม่ส่งออกไฟล์ที่ไม่ครบ กรุณาเลือกปีงบประมาณหรือชนิดเอกสารให้แคบลงแล้วลองใหม่',
      );
    }

    const sequenceDataset = resolveDataset(documentSequenceExportDataset(sequenceRows));
    const exceptionDataset = resolveDataset(documentExceptionExportDataset(exceptions.rows));

    let buffer: Buffer;
    let rowCount: number;

    if (format === 'xlsx') {
      buffer = await buildXlsxBuffer([sequenceDataset, exceptionDataset]);
      rowCount = sequenceDataset.rows.length + exceptionDataset.rows.length;
    } else {
      const chosen = datasetChoice === 'exceptions' ? exceptionDataset : sequenceDataset;
      buffer = Buffer.from(buildCsvText(chosen), 'utf-8');
      rowCount = chosen.rows.length;
    }

    const checksum = sha256Hex(buffer);

    await recordAuditEvent({
      action: 'report.export',
      entityType: 'report_export',
      entityId: REPORT_KEY,
      actorId,
      metadata: {
        report: REPORT_KEY,
        dataset: format === 'xlsx' ? 'sequence+exceptions' : datasetChoice,
        format,
        filter,
        rowCount,
        checksumAlgorithm: 'sha256',
        checksum,
      },
    });

    return fileResponse(buffer, format, REPORT_KEY);
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationErrorResponse(error);
    throw error;
  }
}
