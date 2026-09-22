import { describe, expect, it } from 'vitest';
import {
  columnLetter,
  csvCellText,
  escapeCsvField,
  percentFraction,
  percentText,
  resolveDataset,
  sanitizeSheetName,
  xlsxCellValue,
  buildCsvText,
} from '@/domain/reports/export';
import type { ExportDataset } from '@/domain/reports/export';

describe('columnLetter', () => {
  it('แปลงคอลัมน์ 1..26 เป็น A..Z', () => {
    expect(columnLetter(1)).toBe('A');
    expect(columnLetter(2)).toBe('B');
    expect(columnLetter(26)).toBe('Z');
  });

  it('แปลงคอลัมน์ที่เกิน 26 เป็นสองตัวอักษร (AA, AB, ...)', () => {
    expect(columnLetter(27)).toBe('AA');
    expect(columnLetter(28)).toBe('AB');
    expect(columnLetter(52)).toBe('AZ');
    expect(columnLetter(53)).toBe('BA');
  });

  it('แปลงคอลัมน์ 702 เป็น ZZ และ 703 เป็น AAA (ขอบเขตของหลักที่สาม)', () => {
    expect(columnLetter(702)).toBe('ZZ');
    expect(columnLetter(703)).toBe('AAA');
  });

  it('โยน error เมื่อได้เลขที่ไม่ใช่จำนวนเต็มบวก', () => {
    expect(() => columnLetter(0)).toThrow(RangeError);
    expect(() => columnLetter(-1)).toThrow(RangeError);
    expect(() => columnLetter(1.5)).toThrow(RangeError);
  });
});

describe('sanitizeSheetName', () => {
  it('คืนชื่อเดิมเมื่อไม่มีอักขระต้องห้ามและความยาวไม่เกิน 31', () => {
    expect(sanitizeSheetName('ยอดงบตามโครงการ')).toBe('ยอดงบตามโครงการ');
  });

  it('แทนที่อักขระต้องห้ามของ Excel ด้วยช่องว่าง', () => {
    expect(sanitizeSheetName('A/B\\C?D*E[F]G')).toBe('A B C D E F G');
  });

  it('ตัดชื่อที่ยาวเกิน 31 ตัวอักษร', () => {
    const long = 'ก'.repeat(40);
    const result = sanitizeSheetName(long);
    expect(result.length).toBe(31);
  });

  it('คืนชื่อสำรองเมื่อผลลัพธ์หลังตัดอักขระต้องห้ามว่างเปล่า', () => {
    expect(sanitizeSheetName('///')).toBe('รายงาน');
  });
});

describe('percentFraction / percentText', () => {
  it('percentFraction แปลงหน่วยหนึ่งในหมื่นเป็นเศษส่วน 0..1', () => {
    expect(percentFraction(10_000)).toBe(1);
    expect(percentFraction(4567)).toBeCloseTo(0.4567, 10);
    expect(percentFraction(0)).toBe(0);
  });

  it('percentFraction คืน null เมื่อรับ null', () => {
    expect(percentFraction(null)).toBeNull();
  });

  it('percentText แปลงเป็นข้อความร้อยละสองตำแหน่ง', () => {
    expect(percentText(4567)).toBe('45.67');
    expect(percentText(10_000)).toBe('100.00');
  });

  it('percentText คืนข้อความว่างเมื่อรับ null', () => {
    expect(percentText(null)).toBe('');
  });
});

describe('xlsxCellValue', () => {
  it('date: แปลงข้อความ YYYY-MM-DD เป็น Date ที่เที่ยงคืน UTC', () => {
    const value = xlsxCellValue('date', '2026-09-15');
    expect(value).toBeInstanceOf(Date);
    expect((value as Date).toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });

  it('datetime: แปลงข้อความ ISO เป็น Date ตรง ๆ', () => {
    const value = xlsxCellValue('datetime', '2026-09-15T10:23:00.000Z');
    expect(value).toBeInstanceOf(Date);
    expect((value as Date).toISOString()).toBe('2026-09-15T10:23:00.000Z');
  });

  it('integer: ส่งต่อ number ตรง ๆ', () => {
    expect(xlsxCellValue('integer', 42)).toBe(42);
  });

  it('money: แปลงข้อความทศนิยมเป็น number', () => {
    expect(xlsxCellValue('money', '1234.56')).toBe(1234.56);
    expect(xlsxCellValue('money', '-1234.56')).toBe(-1234.56);
  });

  it('percent: แปลงหน่วยหนึ่งในหมื่นเป็นเศษส่วน', () => {
    expect(xlsxCellValue('percent', 4567)).toBeCloseTo(0.4567, 10);
  });

  it('text: ส่งต่อข้อความตรง ๆ', () => {
    expect(xlsxCellValue('text', 'สวัสดี')).toBe('สวัสดี');
  });

  it('ทุกชนิดคืน null เมื่อค่าดิบเป็น null', () => {
    for (const type of ['date', 'datetime', 'integer', 'money', 'percent', 'text'] as const) {
      expect(xlsxCellValue(type, null)).toBeNull();
    }
  });
});

describe('csvCellText', () => {
  it('date/datetime/text: คืนข้อความตามที่ได้รับ', () => {
    expect(csvCellText('date', '2026-09-15')).toBe('2026-09-15');
    expect(csvCellText('datetime', '2026-09-15T10:23:00.000Z')).toBe('2026-09-15T10:23:00.000Z');
    expect(csvCellText('text', 'สวัสดี')).toBe('สวัสดี');
  });

  it('integer: แปลง number เป็นข้อความโดยไม่มีตัวคั่นหลักพัน', () => {
    expect(csvCellText('integer', 1234)).toBe('1234');
  });

  it('money: คืนข้อความทศนิยมตามที่ได้รับตรง ๆ (ไม่มีตัวคั่นหลักพัน)', () => {
    expect(csvCellText('money', '1234.56')).toBe('1234.56');
  });

  it('percent: แปลงเป็นข้อความร้อยละ ไม่ใช่เศษส่วน', () => {
    expect(csvCellText('percent', 4567)).toBe('45.67');
  });

  it('ทุกชนิดคืนข้อความว่างเมื่อค่าดิบเป็น null', () => {
    for (const type of ['date', 'datetime', 'integer', 'money', 'percent', 'text'] as const) {
      expect(csvCellText(type, null)).toBe('');
    }
  });
});

describe('escapeCsvField', () => {
  it('ไม่ครอบด้วยเครื่องหมายคำพูดเมื่อไม่มีอักขระพิเศษ', () => {
    expect(escapeCsvField('ปกติ')).toBe('ปกติ');
  });

  it('ครอบด้วยเครื่องหมายคำพูดเมื่อมีจุลภาค', () => {
    expect(escapeCsvField('ก,ข')).toBe('"ก,ข"');
  });

  it('ครอบและ escape เครื่องหมายคำพูดซ้อนในตัวเอง', () => {
    expect(escapeCsvField('บอกว่า "ไม่ได้"')).toBe('"บอกว่า ""ไม่ได้"""');
  });

  it('ครอบเมื่อมีการขึ้นบรรทัดใหม่', () => {
    expect(escapeCsvField('บรรทัดหนึ่ง\nบรรทัดสอง')).toBe('"บรรทัดหนึ่ง\nบรรทัดสอง"');
    expect(escapeCsvField('บรรทัดหนึ่ง\r\nบรรทัดสอง')).toBe('"บรรทัดหนึ่ง\r\nบรรทัดสอง"');
  });
});

interface SampleRow {
  id: string;
  amount: string;
  count: number;
}

function sampleDataset(): ExportDataset<SampleRow> {
  return {
    title: 'ตัวอย่าง',
    columns: [
      { key: 'id', header: 'รหัส', type: 'text', value: (row) => row.id },
      { key: 'amount', header: 'จำนวนเงิน', type: 'money', value: (row) => row.amount },
      { key: 'count', header: 'จำนวน', type: 'integer', value: (row) => row.count },
    ],
    rows: [
      { id: 'A1', amount: '1234.56', count: 3 },
      { id: 'A2,B2', amount: '-100.00', count: 0 },
    ],
  };
}

describe('resolveDataset', () => {
  it('เรียก value() ของทุกคอลัมน์ให้กับทุกแถว ตามลำดับเดียวกับ columns', () => {
    const resolved = resolveDataset(sampleDataset());

    expect(resolved.title).toBe('ตัวอย่าง');
    expect(resolved.columns.map((c) => c.key)).toEqual(['id', 'amount', 'count']);
    expect(resolved.rows).toEqual([
      ['A1', '1234.56', 3],
      ['A2,B2', '-100.00', 0],
    ]);
  });

  it('ตัด value() ออกจากคอลัมน์ที่ resolve แล้ว (เหลือแค่ key/header/type)', () => {
    const resolved = resolveDataset(sampleDataset());
    for (const column of resolved.columns) {
      expect(Object.keys(column).sort()).toEqual(['header', 'key', 'type']);
    }
  });

  it('ชุดข้อมูลว่างให้ผลลัพธ์แถวว่าง ไม่ล้ม', () => {
    const empty = resolveDataset({ title: 'ว่าง', columns: sampleDataset().columns, rows: [] });
    expect(empty.rows).toEqual([]);
  });
});

describe('buildCsvText', () => {
  it('ขึ้นต้นด้วย BOM (U+FEFF) เสมอ', () => {
    const csv = buildCsvText(resolveDataset(sampleDataset()));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('มีแถวหัวและแถวข้อมูลคั่นด้วย CRLF ตามลำดับคอลัมน์', () => {
    const csv = buildCsvText(resolveDataset(sampleDataset()));
    const withoutBom = csv.slice(1);
    const lines = withoutBom.split('\r\n').filter((line) => line.length > 0);

    expect(lines[0]).toBe('รหัส,จำนวนเงิน,จำนวน');
    expect(lines[1]).toBe('A1,1234.56,3');
    // ฟิลด์ id ของแถวที่สองมีจุลภาคปนอยู่จริง จึงต้องถูก escape ด้วยเครื่องหมายคำพูด
    expect(lines[2]).toBe('"A2,B2",-100.00,0');
  });

  it('ชุดข้อมูลไม่มีแถว ยังมีแถวหัวให้เสมอ', () => {
    const csv = buildCsvText(
      resolveDataset({ title: 'ว่าง', columns: sampleDataset().columns, rows: [] }),
    );
    const withoutBom = csv.slice(1);
    expect(withoutBom).toBe('รหัส,จำนวนเงิน,จำนวน\r\n');
  });
});
