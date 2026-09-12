import type { DocumentKind, DocumentNumberStatus } from '@/domain/documents/document-register';

/**
 * ป้ายภาษาไทยของทะเบียนเลขที่เอกสาร
 *
 * อยู่ในชั้น feature ไม่ใช่ชั้นโดเมน เพราะเป็นเรื่องการแสดงผลล้วน ๆ
 * ชั้นโดเมนไม่ควรรู้ว่าหน้าจอเรียกสิ่งเหล่านี้ว่าอะไร
 */

export const DOCUMENT_KIND_LABELS_TH: Record<DocumentKind, string> = {
  REQUEST_MEMO: 'บันทึกข้อความขออนุมัติ',
  PURCHASE_ORDER: 'ใบสั่งซื้อ/ใบสั่งจ้าง',
  INSPECTION_REPORT: 'ใบตรวจรับ',
  DISBURSEMENT: 'เอกสารเบิกจ่าย',
  OTHER: 'เอกสารอื่น',
};

export const DOCUMENT_NUMBER_STATUS_LABELS_TH: Record<DocumentNumberStatus, string> = {
  ISSUED: 'ออกเลขแล้ว',
  NOT_REQUIRED: 'ไม่ต้องมีเลข',
  PENDING: 'ยังไม่ได้เลข',
  VOIDED: 'ยกเลิกแล้ว',
};

export const DOCUMENT_NUMBER_STATUS_CLASSES: Record<DocumentNumberStatus, string> = {
  ISSUED: 'bg-emerald-100 text-emerald-900',
  NOT_REQUIRED: 'bg-slate-200 text-slate-800',
  PENDING: 'bg-amber-100 text-amber-900',
  VOIDED: 'bg-rose-100 text-rose-900',
};
