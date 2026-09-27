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
 * **ตั้งใจไม่ใส่ `import 'server-only'` ที่นี่** ต่างจากไฟล์ server-only อื่น
 * ในระบบ — เพราะ package `server-only` throw ทันทีเมื่อถูก import นอก build
 * ของ Next.js โดยไม่มีเงื่อนไข ทำให้ vitest import ไฟล์นี้ตรงไม่ได้เลย ซึ่งเคย
 * เป็นข้อจำกัดของรอบ PR-09d ก่อนหน้า (มีแต่สคริปต์ทดลองที่ไม่ได้ commit)
 *
 * exceljs เป็นไลบรารี Node ล้วน ไม่มี dependency บน Next.js request context
 * ใด ๆ (ไม่เหมือน src/server/audit/audit-log.ts ที่ต้องใช้ next/headers) และ
 * ไฟล์นี้ถูกเรียกใช้จากที่เดียวคือ src/app/(dashboard)/reports/*\/export/route.ts
 * (Route Handler ซึ่งรันฝั่งเซิร์ฟเวอร์เสมอ) การไม่มี `server-only` ที่นี่จึง
 * ไม่เปิดช่องให้โค้ดนี้หลุดไปอยู่ใน client bundle โดยไม่มีใครสังเกตเห็น — ถ้ามี
 * ใครพยายาม import จาก client component จริง จะพังตอน build อยู่ดีเพราะ
 * exceljs ใช้ Node core module (`buffer`, `stream`) ที่ไม่มีใน browser bundle
 *
 * แลกกับความเสี่ยงเล็กน้อยนี้ ได้ tests/integration/xlsx-export.test.ts ที่
 * import buildXlsxBuffer() ตรง ๆ แล้วเปิดไฟล์กลับด้วย exceljs เองเพื่อ assert
 * ชนิดเซลล์ numFmt freeze pane และ page setup จริง — ปิดช่องว่างที่ PR-09d
 * เดิมยอมรับไว้ว่า "702 tests ไม่ได้พิสูจน์ว่า workbook มีคุณสมบัติตามที่อ้าง"
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
