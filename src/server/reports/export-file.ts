import 'server-only';
import ExcelJS from 'exceljs';
import type { ExportColumnType, ResolvedExportDataset } from '@/domain/reports/export';
import {
  XLSX_NUMBER_FORMATS,
  columnLetter,
  isNumericColumnType,
  sanitizeSheetName,
  xlsxCellValue,
} from '@/domain/reports/export';

/**
 * ผู้เขียนไฟล์ XLSX จริง (PR-09d)
 *
 * ไฟล์นี้ไม่มีตรรกะทางธุรกิจของตัวเอง — แค่เรียก exceljs ตามค่าที่
 * src/domain/reports/export.ts และ src/features/reports/export-columns.ts
 * คำนวณไว้แล้ว ตรรกะที่มีรายละเอียดมากกว่านี้ (การแปลงชนิดข้อมูล การปัดเศษ
 * เปอร์เซ็นต์ การ escape ข้อความ) อยู่ในสองไฟล์นั้นซึ่งทดสอบตรงได้ด้วย vitest
 *
 * ไฟล์นี้ทดสอบตรงด้วย vitest ไม่ได้ เพราะ `import 'server-only'` throw ทันที
 * เมื่อรันนอก build ของ Next.js (แพ็กเกจนี้ throw โดยไม่มีเงื่อนไข ปกติแล้ว
 * Next.js สลับให้เป็น no-op ตอน build ฝั่งเซิร์ฟเวอร์เท่านั้น) — ตรวจสอบ API
 * ของ exceljs ที่ใช้ในนี้ (freeze pane, page setup, autoFilter, typed date
 * round-trip) ด้วยสคริปต์ทดลองนอกชุด test แล้วแทน ดูรายละเอียดใน PR body
 */

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE2E8F0' },
};

/** ความกว้างคอลัมน์โดยประมาณตามชนิดข้อมูล — ผู้ใช้ปรับเองได้อยู่แล้วหลังเปิดไฟล์ */
function columnWidth(type: ExportColumnType, header: string): number {
  const base = type === 'text' ? Math.max(header.length + 2, 16) : 14;
  return Math.min(base, 40);
}

function writeSheet(workbook: ExcelJS.Workbook, dataset: ResolvedExportDataset): void {
  const sheet = workbook.addWorksheet(sanitizeSheetName(dataset.title), {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      // แถวหัวตารางพิมพ์ซ้ำทุกหน้า — ข้อกำหนด "repeated print title" ของ PR-09
      printTitlesRow: '1:1',
      margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  });

  sheet.columns = dataset.columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: columnWidth(column.type, column.header),
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { vertical: 'middle' };

  for (const row of dataset.rows) {
    const values: Record<string, string | number | Date | null> = {};
    dataset.columns.forEach((column, index) => {
      values[column.key] = xlsxCellValue(column.type, row[index] ?? null);
    });

    const addedRow = sheet.addRow(values);
    dataset.columns.forEach((column, index) => {
      const cell = addedRow.getCell(index + 1);
      const numFmt = XLSX_NUMBER_FORMATS[column.type];
      if (numFmt) cell.numFmt = numFmt;
      if (isNumericColumnType(column.type)) cell.alignment = { horizontal: 'right' };
    });
  }

  const lastColumn = columnLetter(dataset.columns.length);
  const lastRow = dataset.rows.length + 1;

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: dataset.columns.length },
  };
  // ขอบเขตพิมพ์ครอบทั้งตารางพอดี — แถวว่างหรือคอลัมน์เกินข้อมูลจะไม่ถูกพิมพ์ไปด้วย
  // (ข้อกำหนด "หน้าว่างหรือแถว format เกินข้อมูลไม่ถูก export" ของ PR-09)
  sheet.pageSetup.printArea = `A1:${lastColumn}${lastRow}`;
}

/**
 * สร้าง XLSX หนึ่งไฟล์จากชุดข้อมูลตั้งแต่หนึ่งชุดขึ้นไป — หนึ่งชุดต่อหนึ่งชีต
 *
 * ผู้เรียกส่งได้มากกว่าหนึ่งชุดเมื่อรายงานมีหลายตารางในหน้าเดียว (เช่น
 * รายงานสถานะเอกสารที่มีทั้งลำดับเลขและรายการยกเว้น) — CSV ทำแบบนี้ไม่ได้
 * เพราะมีตารางเดียวต่อไฟล์ ผู้เรียกฝั่ง CSV จึงต้องเลือกชุดเดียวเอง
 *
 * รับ `ResolvedExportDataset[]` (ผ่าน resolveDataset() แล้ว) ไม่ใช่
 * `ExportDataset<Row>[]` ดิบ — ดูเหตุผลที่ประกาศ ResolvedExportDataset ใน
 * src/domain/reports/export.ts
 */
export async function buildXlsxBuffer(datasets: readonly ResolvedExportDataset[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ระบบงานพัสดุและจัดซื้อจัดจ้างภายในโรงเรียน';
  workbook.created = new Date();

  for (const dataset of datasets) {
    writeSheet(workbook, dataset);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
