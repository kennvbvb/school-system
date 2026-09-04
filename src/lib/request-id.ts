/**
 * Request ID สำหรับผูก error บนหน้าจอเข้ากับ log และ audit event
 * (NFR-009, ข้อ 12.6 "Error แสดงพร้อม request ID เมื่อเป็น server error")
 */

export const REQUEST_ID_HEADER = 'x-request-id';

export function generateRequestId(): string {
  return crypto.randomUUID();
}

/** ยอมรับเฉพาะรูปแบบที่ระบบสร้างเอง เพื่อไม่ให้ผู้เรียกภายนอกฉีดข้อความลง log */
export function sanitizeRequestId(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[a-zA-Z0-9-]{8,64}$/.test(value) ? value : null;
}

/**
 * Header ที่ proxy ใช้บอก Server Component ว่า request นี้มาจาก path ไหน
 *
 * Layout และ Server Component ไม่มีทางอ่าน pathname ได้เองใน App Router
 * แต่การ์ดต้องรู้ เพื่อพาผู้ใช้กลับมาที่หน้าเดิมหลังเข้าสู่ระบบ
 */
export const PATHNAME_HEADER = 'x-pathname';

/**
 * รับเฉพาะ path ภายในระบบ เพื่อกัน open redirect
 * ปฏิเสธ "//host" ที่ browser ตีความเป็น protocol-relative URL ด้วย
 */
export function sanitizeInternalPath(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.startsWith('/') && !value.startsWith('//') ? value : null;
}
