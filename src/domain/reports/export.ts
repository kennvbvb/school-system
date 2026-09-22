/**
 * ชนิดข้อมูลและตัวช่วยล้วนสำหรับส่งออกรายงานเป็น XLSX/CSV (PR-09d)
 *
 * ไฟล์นี้ตอบคำถามเดียว: "แต่ละคอลัมน์ของรายงานหนึ่งอ่านค่าจากแถวโดเมนอย่างไร
 * เป็นชนิดข้อมูลใด และแปลงเป็นข้อความ CSV หรือค่าที่จะใส่ในเซลล์ XLSX อย่างไร"
 *
 * ทั้ง XLSX และ CSV ของรายงานเดียวกันต้องอ่านคอลัมน์ชุดเดียวกันเสมอ — การแยก
 * "นิยามคอลัมน์" (ไฟล์นี้และ src/features/reports/export-columns.ts) ออกจาก
 * "ผู้เขียนไฟล์จริง" (src/server/reports/export-file.ts ซึ่งใช้ exceljs และ
 * ต้อง import 'server-only' จึง test ตรงด้วย vitest ไม่ได้) ทำให้ตรรกะที่มี
 * รายละเอียดมากที่สุด — การแปลงชนิดข้อมูล การปัดเศษเปอร์เซ็นต์ การ escape CSV —
 * ยังอยู่ในชั้นที่ทดสอบได้ตรง ๆ ส่วนไฟล์ XLSX เหลือแค่การเรียก exceljs ตาม
 * ค่าที่คำนวณไว้แล้ว ซึ่งเสี่ยงน้อยกว่ามาก
 *
 * ไฟล์นี้เป็นตรรกะบริสุทธิ์ ห้าม import Supabase หรือ Next.js
 */

/**
 * ชนิดคอลัมน์ที่รายงานส่งออกรองรับ
 *
 *   text     ข้อความล้วน แสดงตามที่ส่งมา
 *   date     วันที่ไม่มีเวลา เก็บเป็นข้อความ 'YYYY-MM-DD' ของฐานข้อมูล
 *   datetime วันเวลา เก็บเป็นข้อความ ISO 8601 (UTC) ของฐานข้อมูล
 *   integer  จำนวนเต็ม เช่น จำนวนบัญชี จำนวนฉบับ
 *   money    จำนวนเงิน เก็บเป็นข้อความทศนิยมสองตำแหน่งจาก satangToDecimalString()
 *            ไม่ใช่ bigint สตางค์ตรง ๆ เพราะไฟล์ปลายทางต้องการจำนวนเป็นหน่วยบาท
 *   percent  ร้อยละ เก็บเป็นหน่วยหนึ่งในหมื่น (basis points) แบบเดียวกับ
 *            utilizationBasisPoints() ของ src/domain/budget/report.ts
 */
export type ExportColumnType = 'text' | 'date' | 'datetime' | 'integer' | 'money' | 'percent';

/**
 * ค่าดิบที่สุดที่อ่านจากแถวโดเมน — ยังไม่ถูกแปลงเป็นชนิดของไฟล์ปลายทาง
 *
 * ความหมายของตัวเลขขึ้นกับ `type` ของคอลัมน์ (ดูด้านบน) เช่น 'money' ส่งเป็น
 * ข้อความทศนิยม ไม่ใช่ number ตรง ๆ เพื่อไม่ให้ปัดเศษผิดพลาดจาก bigint สตางค์
 */
export type ExportRawValue = string | number | null;

export interface ExportColumn<Row> {
  /** คีย์ภายในสำหรับผู้เขียนไฟล์ — ไม่แสดงผล ต้องไม่ซ้ำกันในชุดคอลัมน์เดียวกัน */
  key: string;
  /** หัวคอลัมน์ภาษาไทยที่แสดงทั้งในแถวแรกของ CSV และแถวหัวของ XLSX */
  header: string;
  type: ExportColumnType;
  value: (row: Row) => ExportRawValue;
}

export interface ExportDataset<Row> {
  /** ใช้ตั้งชื่อชีตของ XLSX และหัวไฟล์ของ CSV */
  title: string;
  columns: readonly ExportColumn<Row>[];
  rows: readonly Row[];
}

/** ข้อมูลคอลัมน์หลังตัด `value()` ออกแล้ว — สิ่งเดียวที่ผู้เขียนไฟล์ต้องรู้ */
export interface ResolvedExportColumn {
  key: string;
  header: string;
  type: ExportColumnType;
}

/**
 * ชุดข้อมูลหลังคำนวณค่าของทุกเซลล์ไว้ล่วงหน้าแล้ว — ไม่มี generic `Row` เหลืออยู่เลย
 *
 * เกิดจากปัญหา "อาร์เรย์ที่ต้องรวมชุดข้อมูลซึ่งมีชนิดแถวต่างกัน" เช่น XLSX ของ
 * รายงานสถานะเอกสารที่มีทั้งชีตลำดับเลขกับชีตรายการยกเว้นในไฟล์เดียว —
 * `ExportDataset<Row>` ที่มี `Row` ต่างกันรวมกันเป็นอาร์เรย์เดียวไม่ได้อย่างปลอดภัย
 * ด้วยระบบชนิดของ TypeScript (พารามิเตอร์ของฟังก์ชันแปรผันตรงข้าม) ทางแก้ทั่วไป
 * คือใช้ `any` ตัดปัญหา แต่โค้ดฐานนี้ไม่มี eslint-disable แม้แต่จุดเดียว —
 * `resolveDataset()` คำนวณค่าทุกเซลล์ให้เสร็จตั้งแต่ตอนนี้แทน ผลลัพธ์จึงไม่มี
 * ชนิด `Row` เหลือให้ต้องกังวลอีก ผู้เขียนไฟล์ (src/server/reports/export-file.ts)
 * และ `buildCsvText()` ด้านล่างจึงรับอาร์เรย์ที่ชนิดต่างกันเดิมได้โดยไม่ต้องมี
 * `any` ที่ไหนเลย
 */
export interface ResolvedExportDataset {
  title: string;
  columns: readonly ResolvedExportColumn[];
  /** `rows[i][j]` = ค่าของแถวที่ i คอลัมน์ที่ j เรียงลำดับเดียวกับ `columns` */
  rows: readonly (readonly ExportRawValue[])[];
}

export function resolveDataset<Row>(dataset: ExportDataset<Row>): ResolvedExportDataset {
  return {
    title: dataset.title,
    columns: dataset.columns.map(({ key, header, type }) => ({ key, header, type })),
    rows: dataset.rows.map((row) => dataset.columns.map((column) => column.value(row))),
  };
}

/**
 * แปลงลำดับคอลัมน์ (เริ่มที่ 1) เป็นตัวอักษรอ้างอิงคอลัมน์ของ Excel เช่น 1 -> 'A', 27 -> 'AA'
 *
 * ใช้คำนวณขอบเขต print area (`A1:คอลัมน์สุดท้ายแถวสุดท้าย`) เอง แทนที่จะพึ่งพา
 * helper ของ exceljs ที่ไม่มี export สาธารณะสำหรับเรื่องนี้โดยตรง
 */
export function columnLetter(oneBasedIndex: number): string {
  if (!Number.isInteger(oneBasedIndex) || oneBasedIndex < 1) {
    throw new RangeError(`columnLetter ต้องการเลขจำนวนเต็มตั้งแต่ 1 ได้รับ ${oneBasedIndex}`);
  }

  let n = oneBasedIndex;
  let result = '';

  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }

  return result;
}

/**
 * ชื่อชีตของ Excel มีข้อจำกัด: ยาวไม่เกิน 31 ตัวอักษร และห้ามมีอักขระ `\ / ? * [ ]`
 *
 * ตัดให้พอดีแทนการปล่อยให้ exceljs โยน error ตอนเขียนไฟล์ ซึ่งจะทำให้การส่งออก
 * ทั้งไฟล์ล้มเหลวจากเหตุผลที่ผู้ใช้ไม่เกี่ยวข้องด้วยเลย (ชื่อรายงานยาวเกินไป)
 */
export function sanitizeSheetName(title: string): string {
  const cleaned = title.replace(/[\\/?*[\]]/g, ' ').trim();
  const name = cleaned.length > 0 ? cleaned : 'รายงาน';
  return name.length > 31 ? name.slice(0, 31) : name;
}

/**
 * ร้อยละจากหน่วยหนึ่งในหมื่นเป็นเศษส่วน 0..1 สำหรับ numFmt แบบเปอร์เซ็นต์ของ Excel
 *
 * Excel คูณค่าที่เก็บในเซลล์ด้วย 100 เองตอนแสดงผลเมื่อ format เป็น '0.00%'
 * ค่าที่เก็บจึงต้องเป็นเศษส่วน ไม่ใช่ตัวเลขร้อยละตรง ๆ — 4567 หน่วยหนึ่งในหมื่น
 * (45.67%) จึงเก็บเป็น 0.4567 ไม่ใช่ 45.67
 */
export function percentFraction(basisPoints: number | null): number | null {
  if (basisPoints === null) return null;
  return basisPoints / 10_000;
}

/** ร้อยละเป็นข้อความสำหรับ CSV ซึ่งไม่มีชนิดเซลล์ให้กำหนด format เอง */
export function percentText(basisPoints: number | null): string {
  if (basisPoints === null) return '';
  return (basisPoints / 100).toFixed(2);
}

/**
 * ค่าที่จะใส่ในเซลล์ของ XLSX ตามชนิดคอลัมน์
 *
 * คืนเป็น Date จริงสำหรับ 'date'/'datetime' (ข้อกำหนด "typed date" ของ PR-09)
 * ไม่ใช่ข้อความวันที่ — Excel ถึงจะเรียง กรอง และคำนวณผลต่างวันที่ได้
 *
 * ใช้เวลาเที่ยงคืน UTC เดียวกับที่ src/features/reports/register-table.tsx และ
 * ที่อื่นในระบบใช้แปลงข้อความวันที่ 'YYYY-MM-DD' เป็น Date เสมอ (กันวันเลื่อน
 * จาก timezone ของเครื่องที่รัน) — exceljs แปลง Date เป็นเลขลำดับวันของ Excel
 * จากค่า UTC ของ Date เช่นกัน จึงได้วันปฏิทินเดียวกันไม่ว่าจะเปิดที่โซนเวลาใด
 */
export function xlsxCellValue(
  type: ExportColumnType,
  raw: ExportRawValue,
): string | number | Date | null {
  if (raw === null) return null;

  switch (type) {
    case 'date':
      return new Date(`${raw}T00:00:00Z`);
    case 'datetime':
      return new Date(raw as string);
    case 'integer':
      return raw as number;
    case 'money':
      return Number(raw as string);
    case 'percent':
      return percentFraction(raw as number);
    case 'text':
      return raw as string;
  }
}

/** numFmt ของ exceljs ต่อชนิดคอลัมน์ — 'text' ไม่กำหนด (ใช้ format ทั่วไป) */
export const XLSX_NUMBER_FORMATS: Readonly<Partial<Record<ExportColumnType, string>>> = {
  date: 'yyyy-mm-dd',
  datetime: 'yyyy-mm-dd hh:mm',
  integer: '#,##0',
  money: '#,##0.00',
  percent: '0.00%',
};

/** คอลัมน์ชนิดตัวเลขที่ควรชิดขวา เพื่อให้อ่านเป็นแถวเดียวกันได้ง่าย เหมือนตารางบนจอ */
export function isNumericColumnType(type: ExportColumnType): boolean {
  return type === 'integer' || type === 'money' || type === 'percent';
}

/** ค่าที่จะใส่ในเซลล์ CSV — ข้อความล้วนเสมอ เพราะ CSV ไม่มีชนิดเซลล์ */
export function csvCellText(type: ExportColumnType, raw: ExportRawValue): string {
  if (raw === null) return '';

  switch (type) {
    case 'date':
    case 'text':
      return raw as string;
    case 'datetime':
      return raw as string;
    case 'integer':
      return String(raw);
    case 'money':
      return raw as string;
    case 'percent':
      return percentText(raw as number);
  }
}

/**
 * escape หนึ่งช่องของ CSV ตาม RFC 4180
 *
 * ครอบด้วยเครื่องหมายคำพูดเมื่อมีจุลภาค เครื่องหมายคำพูด หรือการขึ้นบรรทัดใหม่
 * ปนอยู่ — ฟิลด์ "เหตุผล" ของรายงานสถานะเอกสารเป็นข้อความอิสระที่ผู้ใช้พิมพ์เอง
 * จึงมีโอกาสมีอักขระเหล่านี้ปนอยู่จริง ไม่ใช่กรณีที่ไม่เกิดขึ้น
 */
export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * สร้างข้อความ CSV ทั้งไฟล์จากชุดข้อมูลเดียว (CSV มีได้ตารางเดียวต่อไฟล์)
 *
 * ขึ้นต้นด้วย U+FEFF (byte order mark) เสมอ — Excel ภาษาไทยจะตีความไฟล์ CSV
 * ที่ไม่มี BOM ว่าเป็น codepage ของเครื่อง ไม่ใช่ UTF-8 ทำให้ข้อความไทยกลายเป็น
 * ตัวอักษรอ่านไม่ออกทันทีที่เปิด — ปัญหานี้เกิดกับผู้ใช้จริงเสมอ ไม่ใช่กรณีหายาก
 * จึงต้องใส่ BOM ไว้ตั้งแต่ต้นโดยไม่มีเงื่อนไข
 *
 * ใช้ CRLF คั่นแถวตาม RFC 4180 ซึ่งเป็นบรรทัดที่ Excel คาดหวังเช่นกัน
 *
 * รับ `ResolvedExportDataset` (ผ่าน resolveDataset() แล้ว) ไม่ใช่ `ExportDataset<Row>`
 * ดิบ — ดูเหตุผลที่ประกาศ ResolvedExportDataset ด้านบน
 */
export function buildCsvText(dataset: ResolvedExportDataset): string {
  const headerLine = dataset.columns.map((column) => escapeCsvField(column.header)).join(',');

  const lines = dataset.rows.map((row) =>
    dataset.columns
      .map((column, index) => escapeCsvField(csvCellText(column.type, row[index] ?? null)))
      .join(','),
  );

  const BOM = '﻿';
  return BOM + [headerLine, ...lines].map((line) => `${line}\r\n`).join('');
}
