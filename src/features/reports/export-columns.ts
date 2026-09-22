/**
 * นิยามคอลัมน์ส่งออกของรายงานทั้งสาม (PR-09d)
 *
 * อยู่ในชั้น feature ไม่ใช่ชั้นโดเมน ด้วยเหตุผลเดียวกับ src/features/documents/format.ts
 * และ src/features/procurements/format.ts — ป้ายภาษาไทยและการจัดคอลัมน์เป็นเรื่อง
 * การแสดงผล (ในที่นี้คือแสดงผลในไฟล์แทนที่จะเป็นหน้าจอ) ไม่ใช่กติกาทางธุรกิจ
 * ชั้นโดเมนไม่ควรรู้ว่าไฟล์ที่ส่งออกเรียกคอลัมน์เหล่านี้ว่าอะไร
 *
 * แต่ละฟังก์ชันในไฟล์นี้รับผลลัพธ์ที่หน้าจอ (page.tsx) ใช้แสดงอยู่แล้วตรง ๆ —
 * ไฟล์ส่งออกจึงมีข้อมูลชุดเดียวกับที่ผู้ใช้เห็นบนจอเสมอ ไม่มีทางที่ตัวเลขในไฟล์
 * กับตัวเลขบนจอจะไม่ตรงกัน เพราะไม่ได้ query แยกจากกัน
 */
import { satangToDecimalString } from '@/domain/money/money';
import type { ExportColumn, ExportDataset } from '@/domain/reports/export';
import type { BudgetReport, BudgetReportGroup } from '@/domain/budget/report';
import { BUDGET_REPORT_DIMENSION_LABELS_TH, utilizationBasisPoints } from '@/domain/budget/report';
import type {
  DocumentNumberStatus,
  ProcurementRegister,
  ProcurementRegisterRow,
} from '@/domain/procurement/register';
import { REGISTER_FLAG_LABELS_TH, registerFlagsOf } from '@/domain/procurement/register';
import { CLASSIFICATION_LABELS_TH, METHOD_LABELS_TH } from '@/domain/procurement/schemas';
import type { DocumentExceptionRow, DocumentSequenceRow } from '@/domain/documents/sequence-report';
import {
  SEQUENCE_FLAG_LABELS_TH,
  sequenceFlagsOf,
  toNumberRanges,
} from '@/domain/documents/sequence-report';
import {
  DOCUMENT_KIND_LABELS_TH,
  DOCUMENT_NUMBER_STATUS_LABELS_TH,
} from '@/features/documents/format';
import { STATUS_LABELS_TH } from '@/features/procurements/format';

const EMPTY = '—';

// -----------------------------------------------------------------------------
// รายงานงบประมาณ
// -----------------------------------------------------------------------------

/**
 * ชุดข้อมูลส่งออกของรายงานงบ — กลุ่มตามมิติที่เลือกบวกแถวรวมทั้งหมดท้ายตาราง
 *
 * ใช้แถวเดียวกับที่ src/features/reports/budget-report-table.tsx แสดง (รวมแถว
 * `<tfoot>` รวมทั้งหมดด้วย) ไม่ใช่แถวบัญชีงบดิบทีละบัญชี เพราะนั่นไม่ใช่สิ่งที่
 * ผู้ใช้เห็นบนจอ — รายงานส่งออกที่มีระดับความละเอียดต่างจากที่เห็นบนจอ
 * จะกลายเป็นแหล่งความจริงที่สองซึ่งไม่มีวันตรงกับจอ 100% ในระยะยาว
 */
export function budgetReportExportDataset(report: BudgetReport): ExportDataset<BudgetReportGroup> {
  const dimensionLabel = BUDGET_REPORT_DIMENSION_LABELS_TH[report.dimension];

  const totalRow: BudgetReportGroup = {
    key: '__TOTAL__',
    labelTh: 'รวมทั้งหมด',
    accountCount: report.accountCount,
    amounts: report.total,
  };

  const columns: ExportColumn<BudgetReportGroup>[] = [
    { key: 'dimension', header: dimensionLabel, type: 'text', value: (row) => row.labelTh },
    {
      key: 'accountCount',
      header: 'จำนวนบัญชี',
      type: 'integer',
      value: (row) => row.accountCount,
    },
    {
      key: 'granted',
      header: 'งบที่ได้รับ (บาท)',
      type: 'money',
      value: (row) => satangToDecimalString(row.amounts.grantedSatang),
    },
    {
      key: 'reserved',
      header: 'กันไว้ (บาท)',
      type: 'money',
      value: (row) => satangToDecimalString(row.amounts.reservedSatang),
    },
    {
      key: 'used',
      header: 'ใช้ไปแล้ว (บาท)',
      type: 'money',
      value: (row) => satangToDecimalString(row.amounts.usedSatang),
    },
    {
      key: 'available',
      header: 'ใช้ได้ (บาท)',
      type: 'money',
      value: (row) => satangToDecimalString(row.amounts.availableSatang),
    },
    {
      key: 'utilization',
      header: 'สัดส่วนที่ใช้',
      type: 'percent',
      value: (row) => utilizationBasisPoints(row.amounts),
    },
  ];

  return {
    title: `ยอดงบตาม${dimensionLabel}`,
    columns,
    rows: [...report.groups, totalRow],
  };
}

// -----------------------------------------------------------------------------
// ทะเบียนจัดซื้อจัดจ้าง
// -----------------------------------------------------------------------------

/** ข้อความของเลขที่เอกสารหนึ่งฉบับ ใช้ร่วมกันทั้งบันทึกขออนุมัติและใบสั่งซื้อ/จ้าง */
function documentNumberText(
  documentNo: string | null,
  status: DocumentNumberStatus | null,
): string {
  if (status === null) return 'ยังไม่ได้บันทึก';
  if (status === 'ISSUED') return documentNo ?? EMPTY;
  return DOCUMENT_NUMBER_STATUS_LABELS_TH[status];
}

/**
 * ชุดข้อมูลส่งออกของทะเบียนจัดซื้อจัดจ้าง — หนึ่งแถวต่อหนึ่งรายการ ไม่มีแถวรวม
 *
 * ต่างจากรายงานงบตรงที่ไม่เติมแถวสรุปท้ายตาราง เพราะทะเบียนเป็นข้อมูลระดับ
 * รายการที่ผู้ใช้จะนำไปวิเคราะห์ต่อ (pivot, กรอง, รวมยอดเอง) การปนแถวที่ไม่ใช่
 * รายการจริงเข้าไปในช่วงข้อมูลจะทำให้ผลรวมอัตโนมัติของ Excel ผิดถ้าเผลอลากรวม
 * แถวนั้นไปด้วย — สรุปยอดตามสถานะดูได้จากหน้าจอซึ่งมีอยู่แล้วนอกตาราง
 *
 * มีคอลัมน์มากกว่าที่ตารางบนจอแสดง (ปีงบ ฝ่ายงาน แหล่งเงินรวม) เพราะพื้นที่บนจอ
 * จำกัดกว่าไฟล์ ไม่ใช่เพราะข้อมูลเหล่านั้นอ่อนไหวกว่า — ผู้อ่านที่มีสิทธิ์เดียวกัน
 * เห็นข้อมูลชุดเดียวกันทั้งบนจอและในไฟล์เสมอ
 */
export function procurementRegisterExportDataset(
  register: ProcurementRegister,
): ExportDataset<ProcurementRegisterRow> {
  const columns: ExportColumn<ProcurementRegisterRow>[] = [
    { key: 'requestDate', header: 'วันที่ขอ', type: 'date', value: (row) => row.requestDate },
    { key: 'reference', header: 'เลขอ้างอิงภายใน', type: 'text', value: (row) => row.reference },
    { key: 'subject', header: 'เรื่อง', type: 'text', value: (row) => row.subject },
    {
      key: 'isEmergency',
      header: 'กรณีเร่งด่วน',
      type: 'text',
      value: (row) => (row.isEmergency ? 'ใช่' : 'ไม่ใช่'),
    },
    {
      key: 'classification',
      header: 'ประเภท',
      type: 'text',
      value: (row) =>
        row.classification === null ? EMPTY : CLASSIFICATION_LABELS_TH[row.classification],
    },
    {
      key: 'method',
      header: 'วิธีจัดหา',
      type: 'text',
      value: (row) => (row.method === null ? EMPTY : METHOD_LABELS_TH[row.method]),
    },
    {
      key: 'fiscalYear',
      header: 'ปีงบประมาณ',
      type: 'text',
      value: (row) => row.fiscalYearCode ?? EMPTY,
    },
    {
      key: 'department',
      header: 'ฝ่ายงาน',
      type: 'text',
      value: (row) => row.departmentName ?? EMPTY,
    },
    { key: 'vendor', header: 'ผู้ขาย', type: 'text', value: (row) => row.vendorName ?? EMPTY },
    {
      key: 'requestMemoNo',
      header: 'เลขที่บันทึกขออนุมัติ',
      type: 'text',
      value: (row) => documentNumberText(row.requestMemoNo, row.requestMemoStatus),
    },
    {
      key: 'purchaseOrderNo',
      header: 'เลขที่ใบสั่งซื้อ/จ้าง',
      type: 'text',
      value: (row) => documentNumberText(row.purchaseOrderNo, row.purchaseOrderStatus),
    },
    {
      key: 'orderDate',
      header: 'วันที่ใบสั่งซื้อ/จ้าง',
      type: 'date',
      value: (row) => row.orderDate,
    },
    {
      key: 'grandTotal',
      header: 'จำนวนเงิน (บาท)',
      type: 'money',
      value: (row) => satangToDecimalString(row.grandTotalSatang),
    },
    {
      key: 'fundingTotal',
      header: 'แหล่งเงินรวม (บาท)',
      type: 'money',
      value: (row) => satangToDecimalString(row.fundingTotalSatang),
    },
    { key: 'status', header: 'สถานะ', type: 'text', value: (row) => STATUS_LABELS_TH[row.status] },
    {
      key: 'flags',
      header: 'ข้อสังเกต',
      type: 'text',
      value: (row) => {
        const flags = registerFlagsOf(row);
        return flags.length === 0
          ? EMPTY
          : flags.map((flag) => REGISTER_FLAG_LABELS_TH[flag]).join(' / ');
      },
    },
  ];

  return {
    title: 'ทะเบียนจัดซื้อจัดจ้าง',
    columns,
    rows: register.rows,
  };
}

// -----------------------------------------------------------------------------
// รายงานสถานะเอกสาร
// -----------------------------------------------------------------------------

/** ช่วงเลขที่ขาด/ซ้ำเป็นข้อความ เช่น "14–90, 120" — เหมือน rangeText() ของตารางบนจอ */
function rangesText(numbers: readonly number[]): string {
  return toNumberRanges(numbers)
    .map((range) => (range.from === range.to ? `${range.from}` : `${range.from}–${range.to}`))
    .join(', ');
}

/** ข้อความอธิบายเลขที่ขาดของลำดับหนึ่ง — สามกรณีเดียวกับ missingText() ของตารางบนจอ */
function missingRangeText(row: DocumentSequenceRow): string {
  if (row.missingCount === 0) return EMPTY;
  if (row.missingSample.length === 0)
    return `ขาด ${row.missingCount} เลข (ช่วงกว้างเกินกว่าจะไล่รายตัว)`;

  const shown = rangesText(row.missingSample);
  return row.missingSample.length < row.missingCount
    ? `${shown} … รวม ${row.missingCount} เลข`
    : shown;
}

/**
 * ชุดข้อมูลส่งออกของ "ลำดับเลขที่เอกสาร" — หนึ่งแถวต่อหนึ่งคู่ (ปีงบ × ชนิดเอกสาร)
 *
 * เป็นแถวสรุปที่คำนวณจากฐานข้อมูลมาแล้ว (GROUP BY) ไม่ใช่แถวรายการดิบ จึงไม่มี
 * ปัญหาการปนแถวรวมเข้ากับแถวรายการแบบทะเบียนจัดซื้อจัดจ้าง — ไม่ต้องเติมแถวสรุป
 * เพิ่มเพราะทุกแถวในนี้เป็น "สรุป" อยู่แล้วในระดับเดียวกัน
 */
export function documentSequenceExportDataset(
  rows: readonly DocumentSequenceRow[],
): ExportDataset<DocumentSequenceRow> {
  const columns: ExportColumn<DocumentSequenceRow>[] = [
    {
      key: 'fiscalYear',
      header: 'ปีงบ',
      type: 'text',
      value: (row) => row.fiscalYearCode ?? EMPTY,
    },
    {
      key: 'documentKind',
      header: 'ชนิดเอกสาร',
      type: 'text',
      value: (row) => DOCUMENT_KIND_LABELS_TH[row.documentKind],
    },
    { key: 'issued', header: 'ออกเลขแล้ว', type: 'integer', value: (row) => row.issuedCount },
    { key: 'voided', header: 'ยกเลิก', type: 'integer', value: (row) => row.voidedCount },
    { key: 'pending', header: 'รอออกเลข', type: 'integer', value: (row) => row.pendingCount },
    {
      key: 'notRequired',
      header: 'ไม่ต้องมีเลข',
      type: 'integer',
      value: (row) => row.notRequiredCount,
    },
    {
      key: 'minRunning',
      header: 'เลขต่ำสุดที่ใช้',
      type: 'integer',
      value: (row) => row.minRunning,
    },
    {
      key: 'maxRunning',
      header: 'เลขสูงสุดที่ใช้',
      type: 'integer',
      value: (row) => row.maxRunning,
    },
    {
      key: 'missingCount',
      header: 'เลขที่ขาด (จำนวน)',
      type: 'integer',
      value: (row) => row.missingCount,
    },
    { key: 'missingSample', header: 'ตัวอย่างเลขที่ขาด', type: 'text', value: missingRangeText },
    {
      key: 'duplicateRunning',
      header: 'เลขลำดับซ้ำ',
      type: 'text',
      value: (row) =>
        row.duplicateRunning.length === 0 ? EMPTY : rangesText(row.duplicateRunning),
    },
    {
      key: 'unparsed',
      header: 'แยกลำดับไม่ได้ (ฉบับ)',
      type: 'integer',
      value: (row) => row.unparsedCount,
    },
    {
      key: 'flags',
      header: 'ข้อสังเกต',
      type: 'text',
      value: (row) => {
        const flags = sequenceFlagsOf(row);
        return flags.length === 0
          ? EMPTY
          : flags.map((flag) => SEQUENCE_FLAG_LABELS_TH[flag]).join(' / ');
      },
    },
  ];

  return { title: 'ลำดับเลขที่เอกสาร', columns, rows };
}

/**
 * ชุดข้อมูลส่งออกของ "เอกสารที่ไม่ได้อยู่ในสถานะออกเลขแล้ว"
 *
 * หนึ่งแถวต่อหนึ่งฉบับ ไม่เติมแถวสรุป ด้วยเหตุผลเดียวกับทะเบียนจัดซื้อจัดจ้าง
 */
export function documentExceptionExportDataset(
  rows: readonly DocumentExceptionRow[],
): ExportDataset<DocumentExceptionRow> {
  const columns: ExportColumn<DocumentExceptionRow>[] = [
    {
      key: 'fiscalYear',
      header: 'ปีงบ',
      type: 'text',
      value: (row) => row.fiscalYearCode ?? EMPTY,
    },
    {
      key: 'documentKind',
      header: 'ชนิดเอกสาร',
      type: 'text',
      value: (row) => DOCUMENT_KIND_LABELS_TH[row.documentKind],
    },
    {
      key: 'status',
      header: 'สถานะ',
      type: 'text',
      value: (row) => DOCUMENT_NUMBER_STATUS_LABELS_TH[row.status],
    },
    {
      key: 'documentNo',
      header: 'เลขที่เอกสาร (เดิม)',
      type: 'text',
      value: (row) => row.documentNo ?? EMPTY,
    },
    { key: 'runningNo', header: 'เลขลำดับ', type: 'integer', value: (row) => row.runningNo },
    { key: 'reason', header: 'เหตุผล', type: 'text', value: (row) => row.reason ?? EMPTY },
    {
      key: 'procurementReference',
      header: 'เลขอ้างอิงรายการ',
      type: 'text',
      value: (row) => row.procurementReference ?? '(ไม่มีสิทธิ์อ่านรายการต้นทาง)',
    },
    {
      key: 'procurementSubject',
      header: 'เรื่อง',
      type: 'text',
      value: (row) => row.procurementSubject ?? EMPTY,
    },
    {
      key: 'createdAt',
      header: 'บันทึกเมื่อ (UTC)',
      type: 'datetime',
      value: (row) => row.createdAt,
    },
    {
      key: 'voidedAt',
      header: 'ยกเลิกเมื่อ (UTC)',
      type: 'datetime',
      value: (row) => row.voidedAt,
    },
  ];

  return { title: 'เอกสารยังไม่ออกเลข', columns, rows };
}
