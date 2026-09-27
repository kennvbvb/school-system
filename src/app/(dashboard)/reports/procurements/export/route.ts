import type { NextRequest } from 'next/server';
import { requirePermission } from '@/server/auth/guard';
import { AuthorizationError } from '@/server/auth/guard';
import { loadProcurementRegister, REGISTER_EXPORT_ROW_LIMIT } from '@/server/reports/repository';
import { parseProcurementRegisterFilter } from '@/domain/procurement/register-schemas';
import { buildProcurementRegister } from '@/domain/procurement/register';
import { procurementRegisterExportDataset } from '@/features/reports/export-columns';
import { buildCsvText, resolveDataset } from '@/domain/reports/export';
import { buildXlsxBuffer } from '@/server/reports/export-file';
import { sha256Hex } from '@/lib/checksum';
import { recordAuditEvent } from '@/server/audit/audit-log';
import { checkExportRateLimit } from '@/server/reports/export-rate-limit';
import {
  auditFailedResponse,
  authorizationErrorResponse,
  badRequestResponse,
  fileResponse,
  parseExportFormat,
  rateLimitedResponse,
  truncatedResponse,
} from '@/server/reports/export-http';

/**
 * ส่งออกทะเบียนจัดซื้อจัดจ้างเป็น XLSX/CSV (PR-09d)
 *
 * ต้องมี procurement.read.all **และ** reports.export — เหตุผลเดียวกับ
 * /reports/budget/export (ดูคอมเมนต์ที่นั่น) ใช้ requirePermission ตัวเดียว
 * เพราะที่นี่ต้องมีสิทธิ์แรกแบบเจาะจง ไม่ใช่ "อย่างใดอย่างหนึ่ง" แบบรายงานงบ
 *
 * ใช้เพดานแถวสูงกว่าหน้าจอ (REGISTER_EXPORT_ROW_LIMIT แทน REGISTER_ROW_LIMIT
 * ดูเหตุผลที่ src/server/reports/repository.ts) เพราะไฟล์ที่ส่งออกไม่มีแถว
 * ยอดรวมสังเคราะห์ให้ต้องกังวลเรื่องยอดไม่ตรงกับแถวที่ถูกตัดเหมือนหน้าจอ
 *
 * ปฏิเสธการส่งออกเมื่อข้อมูลยังถูกตัดอยู่แม้ใช้เพดานที่สูงขึ้นแล้ว แทนที่จะ
 * ส่งไฟล์ที่ไม่ครบ — หน้าจอเลือกซ่อนยอดรวมในกรณีนี้ได้เพราะยังมีตารางให้ดูบางส่วน
 * แต่ไฟล์ที่ดาวน์โหลดไปแล้วจะถูกอ้างอิงในภายหลังว่า "ครบ" โดยไม่มีคำเตือนติดไปด้วย
 * ซึ่งอันตรายกว่าการไม่มีไฟล์ให้เลย — ผู้ใช้ต้องเลือกปีงบหรือช่วงวันให้แคบลง
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPORT_KEY = 'procurement-register';

export async function GET(request: NextRequest): Promise<Response> {
  let actorId: string | null = null;

  try {
    const user = await requirePermission('procurement.read.all', 'reports.export');
    actorId = user.id;

    const rateLimit = checkExportRateLimit(`${REPORT_KEY}:${actorId}`);
    if (!rateLimit.allowed) return rateLimitedResponse(rateLimit.retryAfterSeconds);

    const format = parseExportFormat(request.nextUrl.searchParams);
    if (format === null) {
      return badRequestResponse('รูปแบบไฟล์ต้องเป็น xlsx หรือ csv เท่านั้น');
    }

    const filter = parseProcurementRegisterFilter(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const result = await loadProcurementRegister(filter, REGISTER_EXPORT_ROW_LIMIT);

    if (result.truncated) {
      return truncatedResponse(
        `มีรายการเกิน ${REGISTER_EXPORT_ROW_LIMIT.toLocaleString('th-TH')} รายการตามเงื่อนไขที่เลือก ` +
          'จึงไม่ส่งออกไฟล์ที่ไม่ครบ กรุณาเลือกปีงบประมาณหรือช่วงวันที่ให้แคบลงแล้วลองใหม่',
      );
    }

    const register = buildProcurementRegister(result.rows);
    const dataset = resolveDataset(procurementRegisterExportDataset(register));

    const buffer =
      format === 'xlsx'
        ? await buildXlsxBuffer([dataset])
        : Buffer.from(buildCsvText(dataset), 'utf-8');

    const checksum = sha256Hex(buffer);

    const auditResult = await recordAuditEvent({
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
    if (!auditResult.ok) return auditFailedResponse();

    return fileResponse(buffer, format, REPORT_KEY);
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationErrorResponse(error);
    throw error;
  }
}
