/**
 * ทะเบียนจัดซื้อจัดจ้าง (PR-09, "procurement register ซื้อ/จ้าง")
 *
 * ทะเบียนคือ "สมุดคุมทั้งเล่ม" ไม่ใช่รายการที่ผู้ใช้คนหนึ่งกำลังทำอยู่ — หน้า
 * /procurements ตอบคำถาม "งานของฉันถึงไหนแล้ว" ส่วนทะเบียนตอบคำถามที่ผู้ตรวจถาม
 * คือ "ปีนี้โรงเรียนจัดซื้อจัดจ้างอะไรไปบ้าง รวมเป็นเงินเท่าไร และมีแถวใดที่
 * กรอกไม่ครบ"
 *
 * ไฟล์นี้เป็นตรรกะบริสุทธิ์ ห้าม import Supabase หรือ Next.js
 *
 * **ยอดรวมและยอดรายกลุ่มคิดจากแถวชุดเดียวกันเสมอ** ด้วยเหตุผลเดียวกับ
 * src/domain/budget/report.ts — รายงานที่ยอดรวมมาจากคนละ query กับรายละเอียด
 * จะค่อย ๆ ไม่ตรงกันโดยไม่มีอะไรฟ้อง
 *
 * ป้ายภาษาไทยของสถานะไม่ได้อยู่ในไฟล์นี้โดยตั้งใจ — มีอยู่แล้วที่
 * src/features/procurements/format.ts การสร้างชุดที่สองขึ้นมาจะทำให้คำเรียก
 * สถานะเดียวกันในสองหน้าจอต่างกันได้โดยไม่มีอะไรฟ้อง
 */
import type { ProcurementStatus } from './status';
import { PROCUREMENT_STATUSES } from './status';
import type { ProcurementClassification, ProcurementMethodCode } from './schemas';
import type { DocumentNumberStatus } from '@/domain/documents/document-register';

/*
 * สถานะของเลขที่เอกสารใช้ชนิดเดียวกับทะเบียนเลขที่เอกสาร (PR-04b) ไม่ประกาศใหม่
 * เพราะเป็น enum เดียวกันในฐานข้อมูล และมี parity test ที่อ่าน migration จริง
 * มาเทียบอยู่แล้วที่ tests/unit/document-number-parity.test.ts
 *
 * `null` (ไม่มีแถวเลย) ต่างจาก 'PENDING' (มีแถวที่บอกว่ายังไม่ได้เลข พร้อมเหตุผล)
 * โดยสิ้นเชิง: อย่างแรกคือยังไม่มีใครพิจารณา อย่างหลังคือพิจารณาแล้วและบันทึกไว้
 * การยุบสองอย่างนี้เป็นค่าเดียวกันจะทำให้ข้อค้นพบ F-14 กลับมา — ไฟล์จริงมี 12 แถว
 * ที่ไม่มีเลขเอกสาร ซึ่ง "บางรายการอาจไม่ต้องมีเลขจริง" แต่แยกไม่ออกว่าแถวไหน
 */
export type { DocumentNumberStatus };

/** หนึ่งแถวของทะเบียน = หนึ่งรายการจัดซื้อจัดจ้าง */
export interface ProcurementRegisterRow {
  procurementId: string;
  /** เลขอ้างอิงภายในที่ระบบสร้างเอง ไม่ใช่เลขที่เอกสารทางราชการ */
  reference: string;
  subject: string;
  status: ProcurementStatus;
  classification: ProcurementClassification | null;
  method: ProcurementMethodCode | null;
  isEmergency: boolean;
  fiscalYearId: string;
  fiscalYearCode: string | null;
  departmentName: string | null;
  vendorName: string | null;
  requestDate: string;
  orderDate: string | null;
  /** เลขที่บันทึกขออนุมัติที่ยังใช้งานอยู่ (ไม่รวมฉบับที่ยกเลิกแล้ว) */
  requestMemoNo: string | null;
  requestMemoStatus: DocumentNumberStatus | null;
  /** เลขที่ใบสั่งซื้อ/ใบสั่งจ้างที่ยังใช้งานอยู่ */
  purchaseOrderNo: string | null;
  purchaseOrderStatus: DocumentNumberStatus | null;
  /** ยอดรวมของรายการ คิดจากรายการย่อยที่ฐานข้อมูล (view procurement_totals) */
  grandTotalSatang: bigint;
  /** ผลรวมของแหล่งเงินที่ผูกไว้ */
  fundingTotalSatang: bigint;
}

/**
 * ข้อสังเกตของแถวหนึ่ง — ตรงกับข้อค้นพบที่รายงานตรวจเอกสารนับไว้
 *
 *   NO_DOCUMENT_NUMBER  F-14 — 12 แถวของทะเบียนซื้อไม่มีเลขเอกสาร
 *   ZERO_AMOUNT         F-15 — ทะเบียนจ้าง 3 แถวไม่มีจำนวนเงิน
 *   FUNDING_MISMATCH    F-02 — ใช้เงินข้ามโครงการโดยไม่มีเอกสารโอนงบ
 *
 * เป็น "ข้อสังเกต" ไม่ใช่ "ข้อผิดพลาด" โดยตั้งใจ: บางแถวมีเหตุผลที่ชอบธรรม
 * และผู้มีอำนาจของโรงเรียนเป็นผู้ตัดสิน ไม่ใช่ระบบ (ข้อ 12 ของแผนต่อเนื่อง)
 */
export const REGISTER_FLAGS = ['NO_DOCUMENT_NUMBER', 'ZERO_AMOUNT', 'FUNDING_MISMATCH'] as const;

export type RegisterFlag = (typeof REGISTER_FLAGS)[number];

export const REGISTER_FLAG_LABELS_TH: Readonly<Record<RegisterFlag, string>> = {
  NO_DOCUMENT_NUMBER: 'ยังไม่มีเลขที่ใบสั่งซื้อ/ใบสั่งจ้าง',
  ZERO_AMOUNT: 'ยังไม่มีจำนวนเงิน',
  FUNDING_MISMATCH: 'แหล่งเงินรวมไม่เท่ากับยอดของรายการ',
};

/**
 * สถานะที่ถือว่ารายการ "ออกสู่ภายนอกแล้ว" จึงต้องมีข้อมูลครบ
 *
 * ก่อนถึงจุดนี้รายการยังอยู่ระหว่างจัดทำ การกางธงว่ากรอกไม่ครบจึงไม่มีความหมาย
 * — ทุกฉบับร่างย่อมกรอกไม่ครบ ถ้าตั้งธงตั้งแต่ DRAFT ทะเบียนจะเต็มไปด้วยธง
 * จนธงไม่เหลือความหมาย ซึ่งเท่ากับไม่มีธงเลย
 *
 * REJECTED และ CANCELLED ไม่อยู่ในรายการนี้ เพราะไม่มีใครต้องกลับไปกรอกให้ครบอีก
 * ส่วน APPROVED ยังไม่อยู่ เพราะเลขใบสั่งซื้อเกิดตอนออกใบสั่งซื้อ (สถานะ ISSUED)
 * ไม่ใช่ตอนอนุมัติ — ตรงกับเส้นทางเงินที่ผูกพันงบที่ ISSUED เช่นกัน
 */
const STATUSES_EXPECTING_COMPLETE_DATA: readonly ProcurementStatus[] = [
  'ISSUED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
];

export function expectsCompleteData(status: ProcurementStatus): boolean {
  return STATUSES_EXPECTING_COMPLETE_DATA.includes(status);
}

/**
 * เลขที่เอกสารฉบับนี้ถือว่า "จบเรื่องแล้ว" หรือไม่
 *
 * NOT_REQUIRED นับว่าจบแล้ว เพราะเป็นคำตอบที่โรงเรียนบันทึกไว้พร้อมเหตุผล
 * ตามกลไกที่ปิด F-14 — การนับว่ายังไม่มีจะเป็นการทวงเอกสารที่ระเบียบไม่ได้บังคับ
 *
 * VOIDED ไม่นับ เพราะเลขที่ยกเลิกแล้วห้ามนำกลับมาใช้ (migration 0014)
 * รายการนั้นจึงยังไม่มีเลขที่ใช้ได้ และเป็นเรื่องที่ค้างรอการออกเลขใหม่
 */
function documentSettled(status: DocumentNumberStatus | null): boolean {
  return status === 'ISSUED' || status === 'NOT_REQUIRED';
}

/**
 * ข้อสังเกตของแถวหนึ่ง เรียงตามลำดับใน REGISTER_FLAGS เสมอ
 *
 * ลำดับคงที่ทำให้ผลลัพธ์ไม่ขึ้นกับลำดับที่เขียนเงื่อนไขในฟังก์ชันนี้
 */
export function registerFlagsOf(row: ProcurementRegisterRow): RegisterFlag[] {
  if (!expectsCompleteData(row.status)) return [];

  const flags: RegisterFlag[] = [];

  /* ใบสั่งซื้อคือเอกสารที่ทำให้เกิดข้อผูกพันกับผู้ขาย จึงเป็นฉบับที่ทะเบียนต้องมีเลข
     ส่วนบันทึกขออนุมัติเป็นเอกสารภายในที่แสดงไว้ให้ครบเท่านั้น */
  if (!documentSettled(row.purchaseOrderStatus)) flags.push('NO_DOCUMENT_NUMBER');
  if (row.grandTotalSatang <= 0n) flags.push('ZERO_AMOUNT');
  if (row.fundingTotalSatang !== row.grandTotalSatang) flags.push('FUNDING_MISMATCH');

  return flags;
}

export interface RegisterStatusGroup {
  status: ProcurementStatus;
  count: number;
  grandTotalSatang: bigint;
}

export interface FlaggedRegisterRow {
  row: ProcurementRegisterRow;
  flags: RegisterFlag[];
}

export interface ProcurementRegister {
  rows: ProcurementRegisterRow[];
  count: number;
  grandTotalSatang: bigint;
  /** แยกตามสถานะ เรียงตามลำดับของ state machine ไม่ใช่ตามจำนวน */
  byStatus: RegisterStatusGroup[];
  /** แถวที่มีข้อสังเกตอย่างน้อยหนึ่งข้อ เรียงตามวันที่ขอจากเก่าไปใหม่ */
  flagged: FlaggedRegisterRow[];
}

/**
 * สรุปทะเบียนจากแถวที่ได้มา
 *
 * ยอดรวมทั้งหมด ยอดรายสถานะ และรายการที่มีข้อสังเกต **คิดจาก `rows` ชุดเดียวกัน**
 * ผลรวมของ byStatus จึงเท่ากับ count และ grandTotalSatang เสมอโดยโครงสร้าง
 * ไม่ใช่โดยบังเอิญ — มี unit test บังคับคุณสมบัตินี้
 */
export function buildProcurementRegister(
  rows: readonly ProcurementRegisterRow[],
): ProcurementRegister {
  const buckets = new Map<ProcurementStatus, RegisterStatusGroup>();
  let grandTotal = 0n;

  for (const row of rows) {
    grandTotal += row.grandTotalSatang;

    const bucket = buckets.get(row.status);
    if (bucket) {
      bucket.count += 1;
      bucket.grandTotalSatang += row.grandTotalSatang;
    } else {
      buckets.set(row.status, {
        status: row.status,
        count: 1,
        grandTotalSatang: row.grandTotalSatang,
      });
    }
  }

  /* เรียงตามลำดับของ state machine ไม่ใช่ตามจำนวนหรือตามตัวอักษร
     ผู้อ่านติดตามงานเป็นลำดับขั้น การสลับที่ทุกครั้งที่ตัวเลขเปลี่ยน
     ทำให้เทียบสองช่วงเวลาด้วยสายตาไม่ได้ */
  const byStatus = [...buckets.values()].sort(
    (a, b) => PROCUREMENT_STATUSES.indexOf(a.status) - PROCUREMENT_STATUSES.indexOf(b.status),
  );

  const flagged = rows
    .map((row) => ({ row, flags: registerFlagsOf(row) }))
    .filter((entry) => entry.flags.length > 0)
    .sort((a, b) => {
      /* วันที่เก่าที่สุดขึ้นก่อน เพราะแถวที่ค้างมานานคือแถวที่เสี่ยงที่สุดว่า
         จะไม่มีใครกลับไปแก้ ส่วน reference เป็นตัวตัดสินที่ไม่ซ้ำกันเลย
         ผลลัพธ์จึงมีลำดับเดียวเสมอไม่ว่าจะได้แถวมาเรียงแบบใด */
      const byDate = a.row.requestDate.localeCompare(b.row.requestDate);
      return byDate !== 0 ? byDate : a.row.reference.localeCompare(b.row.reference);
    });

  return {
    rows: [...rows],
    count: rows.length,
    grandTotalSatang: grandTotal,
    byStatus,
    flagged,
  };
}
