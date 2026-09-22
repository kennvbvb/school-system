import type { NextRequest } from 'next/server';
import { requireAnyPermission } from '@/server/auth/guard';
import { AuthorizationError } from '@/server/auth/guard';
import { loadBudgetReportRows } from '@/server/reports/repository';
import { parseBudgetReportFilter } from '@/domain/budget/report-schemas';
import { buildBudgetReport } from '@/domain/budget/report';
import { budgetReportExportDataset } from '@/features/reports/export-columns';
import { buildCsvText, resolveDataset } from '@/domain/reports/export';
import { buildXlsxBuffer } from '@/server/reports/export-file';
import { sha256Hex } from '@/lib/checksum';
import { recordAuditEvent } from '@/server/audit/audit-log';
import {
  authorizationErrorResponse,
  badRequestResponse,
  fileResponse,
  parseExportFormat,
} from '@/server/reports/export-http';

/**
 * ส่งออกรายงานงบประมาณเป็น XLSX/CSV (PR-09d)
 *
 * ต้องมี budget.read หรือ budget.manage (สิทธิ์เดียวกับหน้า /reports/budget)
 * **และ** reports.export เพิ่ม — การดูบนจอกับการนำออกนอกระบบเป็นสิทธิ์คนละชุด
 * ด้วยเหตุผลเดียวกับที่หน้า page.tsx เขียนไว้ตอนยังไม่มีปุ่มส่งออก
 *
 * อ่านข้อมูลด้วยฟังก์ชันชุดเดียวกับหน้าจอ (loadBudgetReportRows + buildBudgetReport)
 * ไฟล์ที่ได้จึงมีตัวเลขตรงกับที่อยู่บนจอเสมอ ไม่ใช่ query แยกที่อาจค่อย ๆ เพี้ยน
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPORT_KEY = 'budget-report';

export async function GET(request: NextRequest): Promise<Response> {
  let actorId: string | null = null;

  try {
    const user = await requireAnyPermission('budget.read', 'budget.manage');
    if (!user.permissions.has('reports.export')) {
      throw new AuthorizationError('FORBIDDEN', 'คุณไม่มีสิทธิ์ส่งออกรายงานนี้');
    }
    actorId = user.id;

    const format = parseExportFormat(request.nextUrl.searchParams);
    if (format === null) {
      return badRequestResponse('รูปแบบไฟล์ต้องเป็น xlsx หรือ csv เท่านั้น');
    }

    const filter = parseBudgetReportFilter(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const rows = await loadBudgetReportRows(filter);
    const report = buildBudgetReport(rows, filter.dimension);
    const dataset = resolveDataset(budgetReportExportDataset(report));

    const buffer =
      format === 'xlsx'
        ? await buildXlsxBuffer([dataset])
        : Buffer.from(buildCsvText(dataset), 'utf-8');

    const checksum = sha256Hex(buffer);

    await recordAuditEvent({
      action: 'report.export',
      entityType: 'report_export',
      entityId: REPORT_KEY,
      actorId,
      metadata: {
        report: REPORT_KEY,
        format,
        filter,
        rowCount: dataset.rows.length,
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
