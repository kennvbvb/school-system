/**
 * ชุดกฎที่ต้องผ่านก่อนส่งอนุมัติ (แผนข้อ 7.2 "Submit ต้องผ่าน rule set ของขั้น submit")
 *
 * รวมกฎจากหลายที่ไว้เป็นชุดเดียว เพื่อให้ทั้งหน้าจอและ server เรียกฟังก์ชันเดียวกัน
 * และได้คำตอบเดียวกัน — ผู้ใช้จึงไม่เจอกรณีที่หน้าจอบอกว่าผ่านแต่ server ปฏิเสธ
 *
 * **server เป็นผู้ตัดสินเสมอ** (แผนข้อ 7.2) หน้าจอเรียกเพื่อบอกล่วงหน้าเท่านั้น
 * และฐานข้อมูลตรวจซ้ำอีกชั้นใน `procurement_submit()` เพราะการเรียก API ตรง
 * ต้องถูกปฏิเสธเช่นเดียวกับการกดผ่านหน้าจอ (ข้อ 4.2)
 *
 * ไฟล์นี้เป็นตรรกะบริสุทธิ์ ห้าม import Supabase หรือ Next.js
 */
import { FindingCollector, ValidationReport } from '@/domain/validation/rules';
import type { ValidationFinding } from '@/domain/validation/rules';
import { checkChronology, checkFiscalYearRange } from './chronology';
import { fundingTotal, totalOfDraft } from './draft';
import { decimalStringToSatang, formatSatang } from '@/domain/money/money';
import type { ProcurementDraftInput } from './schemas';

export interface SubmitContext {
  /** ปีงบประมาณที่รายการนี้ผูกอยู่ — ใช้ตรวจว่าวันที่อยู่ในช่วงหรือไม่ */
  fiscalYear: { code: string; startDate: string; endDate: string; status: 'OPEN' | 'CLOSED' };
  /**
   * ยอดที่ใช้ได้ของบัญชีงบแต่ละบัญชีที่รายการนี้อ้างถึง หน่วยสตางค์
   *
   * ส่งเข้ามาแทนที่จะให้ฟังก์ชันนี้ไปอ่านเอง เพราะชั้นโดเมนห้ามมี I/O
   */
  availableByAccount: ReadonlyMap<string, bigint>;
  /** ผู้ขายกรอกครบหรือยัง — ยังไม่บล็อกที่ขั้น submit แต่เตือนไว้ */
  vendorComplete?: boolean;
}

/**
 * ช่องที่ต้องมีในรายงานขอซื้อ/ขอจ้าง
 *
 * มาจากสาระสำคัญที่รายงานขอซื้อขอจ้างต้องมี — เหตุผลที่ต้องซื้อ ประเภทงาน
 * วิธีจัดหา และวันที่รายงาน ข้อค้นพบ F-16 และ F-17 คือกรณีที่ข้อมูลเหล่านี้
 * ขาดหรือถูกยัดรวมอยู่ช่องเดียวจนแยกไม่ออก
 *
 * **ไม่รวมชื่อผู้ขาย** — บางวิธีจัดหายังไม่มีผู้ขาย ณ วันรายงาน การบังคับ
 * ตรงนี้จะทำให้คนกรอกชื่อผู้ขายที่ยังไม่ได้เลือกจริง
 */
const REQUIRED_REPORT_FIELDS: readonly {
  key: keyof ProcurementDraftInput;
  labelTh: string;
}[] = [
  { key: 'purpose', labelTh: 'เหตุผลความจำเป็น' },
  { key: 'classification', labelTh: 'ประเภทงาน' },
  { key: 'procurementMethod', labelTh: 'วิธีจัดหา' },
  { key: 'reportDate', labelTh: 'วันที่รายงานขอซื้อ/ขอจ้าง' },
];

function mergeReports(reports: readonly ValidationReport[]): ValidationFinding[] {
  return reports.flatMap((report) => [...report.findings]);
}

/**
 * ตรวจทุกกฎของขั้น submit แล้วคืนผลทั้งชุด
 *
 * ไม่โยน exception — ผู้เรียกเป็นผู้ตัดสินว่าจะบล็อกหรือให้ผ่านด้วยสิทธิ์ยกเว้น
 * โดยเรียก `report.canProceed()` ซึ่งรู้เองว่ากฎข้อไหนยกเว้นได้
 */
export function checkSubmitRules(
  draft: ProcurementDraftInput,
  context: SubmitContext,
): ValidationReport {
  const collector = new FindingCollector();

  // ---- ความครบถ้วนของรายการ ----
  if (draft.items.length === 0) {
    collector.error(
      'REQUIRED_REPORT_FIELD_MISSING',
      'ต้องมีรายการพัสดุอย่างน้อยหนึ่งรายการ',
      'items',
    );
  }

  for (const field of REQUIRED_REPORT_FIELDS) {
    const value = draft[field.key];
    if (value === undefined || value === null || value === '') {
      collector.error(
        'REQUIRED_REPORT_FIELD_MISSING',
        `รายงานขอซื้อ/ขอจ้างต้องระบุ${field.labelTh}`,
        field.key,
      );
    }
  }

  /*
   * ยอดแหล่งเงินต้องเท่ากับยอดรวม (F-02)
   *
   * ข้ามการเทียบเมื่อไม่มีรายการเลย เพราะ totalOfDraft() โยน MoneyError กับ
   * รายการว่าง (การคำนวณยอดของศูนย์บรรทัดไม่มีความหมายทางบัญชี) และการโยน
   * จะทำให้ผู้ใช้ได้หน้า error แทนที่จะได้รายการสิ่งที่ต้องแก้ — ซึ่งขัดกับ
   * เหตุผลทั้งหมดที่ rule engine เก็บผลเป็นรายการแทนการโยน
   *
   * กรณีนี้ถูกรายงานด้วย REQUIRED_REPORT_FIELD_MISSING ที่ช่อง items ไปแล้ว
   */
  const grandTotal = draft.items.length > 0 ? totalOfDraft(draft) : 0n;
  const funding = fundingTotal(draft.fundingAllocations);

  if (draft.items.length > 0 && funding !== grandTotal) {
    const difference = grandTotal - funding;
    const direction = difference > 0n ? 'ขาดอีก' : 'เกินมา';
    collector.error(
      'FUNDING_TOTAL_MISMATCH',
      `ยอดแหล่งเงินรวม ${formatSatang(funding)} บาท ไม่เท่ากับยอดรวมของรายการ ` +
        `${formatSatang(grandTotal)} บาท (${direction} ` +
        `${formatSatang(difference > 0n ? difference : -difference)} บาท)`,
      'fundingAllocations',
    );
  }

  // ---- งบต้องพอในทุกบัญชีที่อ้างถึง ----
  //
  // รวมยอดต่อบัญชีก่อนเทียบ เพราะรายการเดียวอ้างบัญชีเดิมได้หลายบรรทัด
  // ถ้าเทียบทีละบรรทัดจะผ่านทั้งที่ผลรวมเกินยอดที่ใช้ได้
  const requestedByAccount = new Map<string, bigint>();
  for (const allocation of draft.fundingAllocations) {
    const current = requestedByAccount.get(allocation.budgetAccountId) ?? 0n;
    // แปลงผ่าน decimalStringToSatang เสมอ ห้ามผ่าน Number แล้วคูณ 100 (ADR 0005)
    requestedByAccount.set(
      allocation.budgetAccountId,
      current + decimalStringToSatang(allocation.amount),
    );
  }

  for (const [accountId, requested] of requestedByAccount) {
    const available = context.availableByAccount.get(accountId);
    if (available === undefined) continue;

    if (requested > available) {
      collector.error(
        'BUDGET_INSUFFICIENT',
        `ยอดงบคงเหลือของบัญชีที่เลือกไม่พอ ต้องใช้ ${formatSatang(requested)} บาท ` +
          `แต่เหลือ ${formatSatang(available)} บาท`,
        'fundingAllocations',
      );
    }
  }

  // ---- ปีงบประมาณ ----
  if (context.fiscalYear.status === 'CLOSED') {
    collector.error(
      'FISCAL_YEAR_MISMATCH',
      `ปีงบประมาณ ${context.fiscalYear.code} ปิดแล้ว ส่งอนุมัติรายการใหม่ไม่ได้`,
      'fiscalYearId',
    );
  }

  // ---- ผู้ขาย ----
  //
  // เตือนไม่บล็อก เพราะบางวิธีจัดหายังไม่มีผู้ขาย ณ วันส่งอนุมัติ
  // จะกลายเป็น ERROR ตอนออกเอกสารใน PR-06 ซึ่งเป็นจุดที่ต้องรู้ตัวผู้ขายแน่นอนแล้ว
  if (context.vendorComplete === false) {
    collector.warn('VENDOR_INCOMPLETE', 'ข้อมูลผู้ขายยังไม่ครบ — ต้องครบก่อนออกเอกสาร', 'vendorId');
  }

  const dates = {
    requestDate: draft.requestDate,
    reportDate: draft.reportDate,
    approvedDate: draft.approvedDate,
    selectionDate: draft.selectionDate,
    orderOrAgreementDate: draft.orderOrAgreementDate,
    deliveryOrServiceDate: draft.deliveryOrServiceDate,
    inspectionDate: draft.inspectionDate,
    sentToFinanceDate: draft.sentToFinanceDate,
  };

  return new ValidationReport([
    ...collector.report().findings,
    ...mergeReports([checkChronology(dates), checkFiscalYearRange(dates, context.fiscalYear)]),
  ]);
}
