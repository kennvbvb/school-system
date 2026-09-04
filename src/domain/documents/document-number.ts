/**
 * รูปแบบเลขที่เอกสาร (FR-NUM-001, FR-NUM-006)
 *
 * ไฟล์นี้รับผิดชอบเฉพาะการ "จัดรูปแบบ" เท่านั้น
 * การ "จอง" running number ต้องทำใน database transaction พร้อม unique constraint
 * (ดู supabase/migrations — ฟังก์ชัน allocate_document_number)
 */

export class DocumentNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentNumberError';
  }
}

export interface DocumentNumberContext {
  prefix?: string;
  running: number;
  fiscalYearBE: number;
  departmentCode?: string;
  documentType?: string;
}

/** ข้อความที่ใช้แทนเลขจริงในหน้า Preview — Preview ห้ามใช้เลขจริงเด็ดขาด (FR-NUM-006) */
export const DRAFT_DOCUMENT_NUMBER = 'DRAFT';

const TOKEN_PATTERN = /\{(\w+)(?::(\d+))?\}/g;

/**
 * แทนที่ token ในรูปแบบเลขที่เอกสาร
 *
 * Token ที่รองรับ:
 *   {prefix}          คำนำหน้าที่ตั้งไว้ใน document_sequences
 *   {running}         เลขลำดับ
 *   {running:4}       เลขลำดับเติมศูนย์หน้าให้ครบ 4 หลัก
 *   {fiscalYearBE}    ปีงบประมาณ พ.ศ. เต็ม เช่น 2569
 *   {fiscalYearBE:2}  ปีงบประมาณ พ.ศ. สองหลักท้าย เช่น 69
 *   {fiscalYearCE}    ปีงบประมาณ ค.ศ.
 *   {departmentCode}  รหัสหน่วยงาน
 *   {documentType}    รหัสชนิดเอกสาร
 *
 * ตัวอย่าง: formatDocumentNumber('{prefix}/{running:4}/{fiscalYearBE}', ...)
 *          -> "ศธ04/0007/2569"
 */
export function formatDocumentNumber(pattern: string, context: DocumentNumberContext): string {
  if (!pattern.trim()) {
    throw new DocumentNumberError('รูปแบบเลขที่เอกสารว่างเปล่า');
  }
  if (!Number.isInteger(context.running) || context.running < 1) {
    throw new DocumentNumberError('เลขลำดับต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
  }

  const unknownTokens: string[] = [];

  const result = pattern.replace(TOKEN_PATTERN, (_match, token: string, width?: string) => {
    const pad = (value: string): string =>
      width ? value.padStart(Number(width), '0').slice(-Number(width)) : value;

    switch (token) {
      case 'prefix':
        return context.prefix ?? '';
      case 'running':
        return pad(String(context.running));
      case 'fiscalYearBE':
        return pad(String(context.fiscalYearBE));
      case 'fiscalYearCE':
        return pad(String(context.fiscalYearBE - 543));
      case 'departmentCode':
        return context.departmentCode ?? '';
      case 'documentType':
        return context.documentType ?? '';
      default:
        unknownTokens.push(token);
        return '';
    }
  });

  if (unknownTokens.length > 0) {
    throw new DocumentNumberError(
      `รูปแบบเลขที่เอกสารมี token ที่ระบบไม่รู้จัก: ${unknownTokens.join(', ')}`,
    );
  }

  // ตัดเครื่องหมายคั่นที่ค้างอยู่เมื่อ token ไม่มีค่า เช่น prefix ว่างแล้วเหลือ "/0007/2569"
  return result
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}
