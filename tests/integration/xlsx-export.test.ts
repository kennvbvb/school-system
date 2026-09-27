import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { resolveDataset } from '@/domain/reports/export';
import type { ExportDataset } from '@/domain/reports/export';
import { buildXlsxBuffer } from '@/server/reports/export-file';

/**
 * ทดสอบ buildXlsxBuffer() แบบ round-trip จริง (PR-09d follow-up)
 *
 * เดิม src/server/reports/export-file.ts มี `import 'server-only'` ทำให้ vitest
 * import ตรงไม่ได้ (throw ทันทีนอก build ของ Next.js) รอบก่อนหน้าจึงยืนยัน
 * พฤติกรรมของ exceljs ด้วยสคริปต์ทดลองที่ไม่ได้ commit เท่านั้น — ไฟล์นี้ปิด
 * ช่องว่างนั้นโดยเรียก buildXlsxBuffer() ตัวจริงแล้วเปิดผลลัพธ์กลับด้วย ExcelJS
 * เอง (ไม่มี dependency เพิ่ม เพราะ exceljs อ่านไฟล์ของตัวเองได้อยู่แล้ว)
 */

interface SampleRow {
  subject: string;
  amount: string;
  requestDate: string;
  count: number;
  utilization: number;
}

function sampleDataset(): ExportDataset<SampleRow> {
  return {
    title: 'รายงานทดสอบ/มีตัวคั่น',
    columns: [
      { key: 'subject', header: 'เรื่อง', type: 'text', value: (row) => row.subject },
      { key: 'amount', header: 'จำนวนเงิน', type: 'money', value: (row) => row.amount },
      { key: 'requestDate', header: 'วันที่ขอ', type: 'date', value: (row) => row.requestDate },
      { key: 'count', header: 'จำนวน', type: 'integer', value: (row) => row.count },
      {
        key: 'utilization',
        header: 'ร้อยละใช้ไป',
        type: 'percent',
        value: (row) => row.utilization,
      },
    ],
    rows: [
      {
        subject: '=HYPERLINK("http://evil.example")',
        amount: '1234.56',
        requestDate: '2026-09-15',
        count: 3,
        utilization: 4567,
      },
      { subject: 'ปกติ', amount: '-100.00', requestDate: '2026-01-01', count: 0, utilization: 0 },
    ],
  };
}

/**
 * ชนิดพารามิเตอร์ที่ exceljs ประกาศรับจริงสำหรับ `xlsx.load()` — อ้างจาก
 * signature ของ exceljs เอง แทนการเขียน `Buffer` เปล่า ๆ ตรง ๆ
 *
 * ยืนยันด้วยการทดลองแล้วว่าใน tsconfig ของโปรเจกต์นี้ (เปิด "lib": ["dom", ...])
 * `Buffer` ที่เขียนเปล่า ๆ ในไฟล์นี้กับ `Buffer` ที่ exceljs ใช้ประกาศพารามิเตอร์
 * ของตัวเอง แม้เป็นชื่อชนิดเดียวกัน แต่ค่า default ของ type parameter
 * (`TArrayBuffer extends ArrayBufferLike = ArrayBuffer`) กลับ resolve ไม่ตรงกัน
 * ระหว่างสองบริบท (ปัญหาเดียวกับที่ src/server/reports/export-http.ts เจอ
 * กับ BodyInit แต่คนละรูปแบบ) — การอ้างชนิดผ่าน Parameters<> ของฟังก์ชันจริง
 * แทนการเขียน `Buffer` เองจึงตรงกับสิ่งที่ exceljs คาดหวังเสมอไม่ว่า default
 * จะ resolve อย่างไรก็ตาม
 */
type XlsxLoadInput = Parameters<InstanceType<typeof ExcelJS.Workbook>['xlsx']['load']>[0];

async function loadBack(
  buffer: Awaited<ReturnType<typeof buildXlsxBuffer>>,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as XlsxLoadInput);
  return workbook;
}

describe('buildXlsxBuffer (round-trip ผ่าน exceljs จริง)', () => {
  it('ตั้งชื่อชีตตามชื่อ dataset โดยตัดอักขระต้องห้ามของ Excel ออก', async () => {
    const buffer = await buildXlsxBuffer([resolveDataset(sampleDataset())]);
    const workbook = await loadBack(buffer);

    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.worksheets[0]?.name).toBe('รายงานทดสอบ มีตัวคั่น');
  });

  it('แถวหัวเป็นตัวหนา และคอลัมน์ตรงกับ header ที่กำหนด', async () => {
    const buffer = await buildXlsxBuffer([resolveDataset(sampleDataset())]);
    const workbook = await loadBack(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('ไม่มีชีต');

    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.getCell('A1').value).toBe('เรื่อง');
    expect(sheet.getCell('B1').value).toBe('จำนวนเงิน');
    expect(sheet.getCell('C1').value).toBe('วันที่ขอ');
  });

  it('เซลล์วันที่เป็น Date object จริง (typed date) พร้อม numFmt yyyy-mm-dd', async () => {
    const buffer = await buildXlsxBuffer([resolveDataset(sampleDataset())]);
    const workbook = await loadBack(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('ไม่มีชีต');

    const cell = sheet.getCell('C2');
    expect(cell.type).toBe(ExcelJS.ValueType.Date);
    expect(cell.value).toBeInstanceOf(Date);
    expect((cell.value as Date).toISOString()).toBe('2026-09-15T00:00:00.000Z');
    expect(cell.numFmt).toBe('yyyy-mm-dd');
  });

  it('เซลล์จำนวนเงินเป็น number พร้อม numFmt ตัวคั่นหลักพันสองตำแหน่งทศนิยม', async () => {
    const buffer = await buildXlsxBuffer([resolveDataset(sampleDataset())]);
    const workbook = await loadBack(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('ไม่มีชีต');

    const cell = sheet.getCell('B2');
    expect(cell.type).toBe(ExcelJS.ValueType.Number);
    expect(cell.value).toBe(1234.56);
    expect(cell.numFmt).toBe('#,##0.00');
  });

  it('เซลล์ร้อยละเก็บเป็นเศษส่วน 0..1 พร้อม numFmt แบบเปอร์เซ็นต์', async () => {
    const buffer = await buildXlsxBuffer([resolveDataset(sampleDataset())]);
    const workbook = await loadBack(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('ไม่มีชีต');

    const cell = sheet.getCell('E2');
    expect(cell.value).toBeCloseTo(0.4567, 10);
    expect(cell.numFmt).toBe('0.00%');
  });

  it('เซลล์ข้อความที่ขึ้นต้นด้วยอักขระคล้ายสูตรยังเป็นชนิด String ไม่ใช่ Formula (ไม่ถูกประมวลผลเป็นสูตร)', async () => {
    const buffer = await buildXlsxBuffer([resolveDataset(sampleDataset())]);
    const workbook = await loadBack(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('ไม่มีชีต');

    const cell = sheet.getCell('A2');
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe('=HYPERLINK("http://evil.example")');
  });

  it('freeze pane อยู่ที่แถว 1 (ySplit=1, state=frozen)', async () => {
    const buffer = await buildXlsxBuffer([resolveDataset(sampleDataset())]);
    const workbook = await loadBack(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('ไม่มีชีต');

    const view = sheet.views[0];
    expect(view?.state).toBe('frozen');
    if (view?.state !== 'frozen') throw new Error('คาดว่า view เป็น frozen');
    expect(view.ySplit).toBe(1);
  });

  it('autoFilter ครอบทั้งแถวหัวตามจำนวนคอลัมน์จริง', async () => {
    const buffer = await buildXlsxBuffer([resolveDataset(sampleDataset())]);
    const workbook = await loadBack(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('ไม่มีชีต');

    expect(sheet.autoFilter).toBe('A1:E1');
  });

  it('print area ครอบพอดีทั้งตาราง (ไม่รวมแถว/คอลัมน์เกินข้อมูล) พร้อม page setup แนวนอนและพิมพ์แถวหัวซ้ำ', async () => {
    const buffer = await buildXlsxBuffer([resolveDataset(sampleDataset())]);
    const workbook = await loadBack(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('ไม่มีชีต');

    expect(sheet.pageSetup.printArea).toBe('A1:E3');
    expect(sheet.pageSetup.printTitlesRow).toBe('1:1');
    expect(sheet.pageSetup.orientation).toBe('landscape');
    expect(sheet.pageSetup.fitToWidth).toBe(1);
    expect(sheet.pageSetup.fitToHeight).toBe(0);
  });

  it('หลาย dataset กลายเป็นหลายชีตตามลำดับที่ส่งเข้าไป', async () => {
    const second: ExportDataset<{ label: string }> = {
      title: 'ชีตที่สอง',
      columns: [{ key: 'label', header: 'ป้ายกำกับ', type: 'text', value: (row) => row.label }],
      rows: [{ label: 'แถวเดียว' }],
    };

    const buffer = await buildXlsxBuffer([resolveDataset(sampleDataset()), resolveDataset(second)]);
    const workbook = await loadBack(buffer);

    expect(workbook.worksheets).toHaveLength(2);
    expect(workbook.worksheets[0]?.name).toBe('รายงานทดสอบ มีตัวคั่น');
    expect(workbook.worksheets[1]?.name).toBe('ชีตที่สอง');
  });

  it('ชุดข้อมูลไม่มีแถว ยังสร้างไฟล์ได้ปกติ มีแค่แถวหัว', async () => {
    const empty: ExportDataset<SampleRow> = { ...sampleDataset(), rows: [] };
    const buffer = await buildXlsxBuffer([resolveDataset(empty)]);
    const workbook = await loadBack(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('ไม่มีชีต');

    expect(sheet.rowCount).toBe(1);
    expect(sheet.pageSetup.printArea).toBe('A1:E1');
  });
});
