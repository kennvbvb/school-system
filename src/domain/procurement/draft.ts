/**
 * กฎของฉบับร่าง — ตรรกะบริสุทธิ์ ไม่มี I/O
 *
 * ตอบสามคำถามที่ต้องตอบเหมือนกันทั้งหน้าจอและ server:
 *   1. รายการนี้แก้ได้ไหม
 *   2. ยอดแหล่งเงินตรงกับยอดรวมหรือยัง
 *   3. การคัดลอกรายการต้องไม่พาอะไรติดไปบ้าง
 */
import type { ProcurementStatus } from './status';
import type { FundingAllocationInput, ProcurementDraftInput } from './schemas';
import { decimalStringToSatang, formatSatang } from '@/domain/money/money';
import { calculateDocument } from '@/domain/money/calculation';
import type { LineInput } from '@/domain/money/calculation';

/** สถานะที่ยังแก้เนื้อหาได้ — ตรงกับ policy ใน migration 0008 */
export const EDITABLE_STATUSES: readonly ProcurementStatus[] = ['DRAFT', 'NEEDS_REVISION'];

export function isEditable(status: ProcurementStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

export class ProcurementDraftError extends Error {
  readonly code:
    | 'NOT_EDITABLE'
    | 'FUNDING_TOTAL_MISMATCH'
    | 'NO_ITEMS'
    | 'VERSION_CONFLICT'
    | 'DUPLICATE_LINE_NO'
    | 'DUPLICATE_BUDGET_ACCOUNT';

  constructor(code: ProcurementDraftError['code'], message: string) {
    super(message);
    this.name = 'ProcurementDraftError';
    this.code = code;
  }
}

export function assertEditable(status: ProcurementStatus): void {
  if (!isEditable(status)) {
    throw new ProcurementDraftError(
      'NOT_EDITABLE',
      'รายการนี้ถูกส่งเข้าสู่ขั้นตอนอนุมัติแล้ว จึงแก้ไขไม่ได้',
    );
  }
}

/** ยอดรวมของรายการ คำนวณจากรายการย่อยเสมอ */
export function totalOfDraft(draft: Pick<ProcurementDraftInput, 'items' | 'taxMode'>): bigint {
  const lines: LineInput[] = draft.items.map((item) => ({
    lineNo: item.lineNo,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discountAmount: item.discountAmount,
    taxRate: item.taxRate,
  }));

  return calculateDocument(lines, draft.taxMode).grandTotal;
}

export function fundingTotal(allocations: readonly FundingAllocationInput[]): bigint {
  return allocations.reduce((sum, row) => sum + decimalStringToSatang(row.amount), 0n);
}

/**
 * ตรวจว่าเลขบรรทัดและบัญชีงบไม่ซ้ำ
 *
 * ฐานข้อมูลมี unique constraint อยู่แล้ว แต่ error จากฐานข้อมูลบอกผู้ใช้ไม่ได้ว่า
 * ซ้ำที่บรรทัดไหน จึงตรวจที่นี่ก่อนเพื่อให้ข้อความชี้จุดได้
 */
export function assertLinesConsistent(draft: ProcurementDraftInput): void {
  const itemLineNos = draft.items.map((item) => item.lineNo);
  const duplicateItemLine = itemLineNos.find(
    (lineNo, index) => itemLineNos.indexOf(lineNo) !== index,
  );
  if (duplicateItemLine !== undefined) {
    throw new ProcurementDraftError(
      'DUPLICATE_LINE_NO',
      `มีรายการย่อยเลขบรรทัด ${duplicateItemLine} ซ้ำกัน`,
    );
  }

  const accountIds = draft.fundingAllocations.map((row) => row.budgetAccountId);
  const duplicateAccount = accountIds.find((id, index) => accountIds.indexOf(id) !== index);
  if (duplicateAccount !== undefined) {
    throw new ProcurementDraftError(
      'DUPLICATE_BUDGET_ACCOUNT',
      'มีบัญชีงบประมาณเดียวกันมากกว่าหนึ่งบรรทัด ให้รวมเป็นบรรทัดเดียว',
    );
  }
}

/**
 * ตรวจความพร้อมก่อนส่งอนุมัติ (rule code FUNDING_TOTAL_MISMATCH)
 *
 * แยกจากการบันทึกฉบับร่างโดยเจตนา — ร่างต้องบันทึกค้างไว้ได้แม้ยังไม่ครบ
 * แต่ส่งอนุมัติไม่ได้จนกว่าจะครบ (แผนข้อ 7.2)
 *
 * การบังคับตอน submit จริงอยู่ที่ PR-03 ฟังก์ชันนี้เป็นกติกาที่ทั้งสองฝั่งใช้ร่วมกัน
 */
export function assertReadyToSubmit(draft: ProcurementDraftInput): void {
  assertLinesConsistent(draft);

  if (draft.items.length === 0) {
    throw new ProcurementDraftError('NO_ITEMS', 'ต้องมีรายการพัสดุอย่างน้อยหนึ่งรายการ');
  }

  const grandTotal = totalOfDraft(draft);
  const funding = fundingTotal(draft.fundingAllocations);

  if (funding !== grandTotal) {
    const difference = grandTotal - funding;
    const direction = difference > 0n ? 'ขาดอีก' : 'เกินมา';
    throw new ProcurementDraftError(
      'FUNDING_TOTAL_MISMATCH',
      `ยอดแหล่งเงินรวม ${formatSatang(funding)} บาท ไม่เท่ากับยอดรวมของรายการ ` +
        `${formatSatang(grandTotal)} บาท (${direction} ${formatSatang(
          difference > 0n ? difference : -difference,
        )} บาท)`,
    );
  }
}

/**
 * ข้อมูลที่คัดลอกได้เมื่อทำสำเนารายการ
 *
 * สิ่งที่ **ห้าม** ติดไปกับสำเนา: เลขอ้างอิง เลขที่เอกสาร สถานะ ประวัติอนุมัติ
 * และวันที่ทุกชนิด — สำเนาคือรายการใหม่ที่เริ่มจากศูนย์ ไม่ใช่รายการเดิมที่มีสองใบ
 *
 * วันที่ไม่คัดลอกเพราะวันขอของรายการใหม่คือวันที่ทำสำเนา ไม่ใช่วันของรายการเดิม
 * ถ้าคัดลอกไป ผู้ใช้ที่กดสำเนาแล้วส่งเลยจะได้เอกสารที่ลงวันที่ย้อนหลังโดยไม่ตั้งใจ
 * ซึ่งเป็นข้อผิดพลาดชนิดเดียวกับที่พบในไฟล์จริง (F-04)
 *
 * `isEmergency` ก็ไม่คัดลอกด้วยเหตุผลเดียวกัน — ความเร่งด่วนเป็นข้อเท็จจริงของ
 * คำขอครั้งนั้น ไม่ใช่คุณสมบัติของสิ่งที่ซื้อ สำเนาที่ติดธงเร่งด่วนมาโดยที่ผู้ใช้
 * ไม่ได้ตั้งใจ จะได้สิทธิ์ยกเว้นกฎลำดับเวลาไปโดยไม่มีใครทักท้วง
 *
 * ส่วน `classification` และ `procurementMethod` **คัดลอก** เพราะเป็นคุณสมบัติของ
 * สิ่งที่ซื้อและวิธีที่ใช้ซื้อ ซึ่งมักเหมือนเดิมจริงเมื่อทำรายการซ้ำ
 */
export interface CloneResult {
  draft: Omit<
    ProcurementDraftInput,
    | 'requestDate'
    | 'requiredDate'
    | 'reportDate'
    | 'approvedDate'
    | 'selectionDate'
    | 'orderOrAgreementDate'
    | 'deliveryOrServiceDate'
    | 'inspectionDate'
    | 'sentToFinanceDate'
  >;
  /** ช่องที่ผู้ใช้ต้องกรอกใหม่เอง */
  clearedFields: readonly string[];
}

export function cloneDraft(source: ProcurementDraftInput): CloneResult {
  return {
    draft: {
      subject: source.subject,
      purpose: source.purpose,
      taxMode: source.taxMode,
      fiscalYearId: source.fiscalYearId,
      departmentId: source.departmentId,
      vendorId: source.vendorId,
      classification: source.classification,
      procurementMethod: source.procurementMethod,
      methodLegalBasisCode: source.methodLegalBasisCode,
      // ความเร่งด่วนต้องตัดสินใหม่ทุกครั้ง ไม่ติดมากับสำเนา
      isEmergency: false,
      note: source.note,
      items: source.items.map((item) => ({ ...item })),
      // แหล่งเงินไม่คัดลอก เพราะยอดของรายการใหม่อาจต่างไป
      // และการกันยอดงบต้องเกิดจากการตัดสินใจใหม่เสมอ
      fundingAllocations: [],
    },
    clearedFields: [
      'requestDate',
      'requiredDate',
      'reportDate',
      'approvedDate',
      'selectionDate',
      'orderOrAgreementDate',
      'deliveryOrServiceDate',
      'inspectionDate',
      'sentToFinanceDate',
      'isEmergency',
      'fundingAllocations',
      'status',
      'reference',
    ],
  };
}
