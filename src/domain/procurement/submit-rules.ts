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
import {
  BUY_FIRST_REPORT_DEADLINE_DAYS,
  SPECIFIC_METHOD_LIMIT_SATANG,
  isBuyFirstAllowed,
  isSimplifiedPurchase,
  valueTierOf,
  weekdaysAfter,
} from './value-tier';
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
 * ช่องที่ต้องมีในรายงานขอซื้อ/ขอจ้างเสมอ ไม่ว่าวงเงินเท่าใด
 *
 * มาจากสาระสำคัญที่รายงานขอซื้อขอจ้างต้องมี — ประเภทงาน วิธีจัดหา และวันที่รายงาน
 * ข้อค้นพบ F-16 และ F-17 คือกรณีที่ข้อมูลเหล่านี้ขาดหรือถูกยัดรวมอยู่ช่องเดียว
 * จนแยกไม่ออก
 *
 * **ไม่รวมชื่อผู้ขาย** — บางวิธีจัดหายังไม่มีผู้ขาย ณ วันรายงาน การบังคับ
 * ตรงนี้จะทำให้คนกรอกชื่อผู้ขายที่ยังไม่ได้เลือกจริง
 *
 * ช่อง "เหตุผลความจำเป็น" และ "กำหนดเวลาที่ต้องการใช้" ขึ้นกับวงเงิน
 * ดู `checkSubmitRules` — การซื้อไม่เกิน 50,000 บาทใช้รายงาน 3 รายการ (ว804)
 */
const ALWAYS_REQUIRED_REPORT_FIELDS: readonly {
  key: keyof ProcurementDraftInput;
  labelTh: string;
}[] = [
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

  /*
   * ขั้นวงเงิน — คำนวณก่อนตรวจช่องบังคับ เพราะช่องบังคับขึ้นกับวงเงิน
   *
   * ข้ามเมื่อไม่มีรายการเลย เพราะ totalOfDraft() โยน MoneyError กับรายการว่าง
   * (ดูเหตุผลที่ยอดแหล่งเงินด้านล่าง) ไม่รู้วงเงินก็ถือว่าเข้มที่สุดไว้ก่อน
   */
  const grandTotal = draft.items.length > 0 ? totalOfDraft(draft) : 0n;
  const tier = draft.items.length > 0 ? valueTierOf(grandTotal) : undefined;
  const simplified =
    tier !== undefined && !draft.isEmergency && isSimplifiedPurchase(tier, draft.classification);

  const requiredFields = [...ALWAYS_REQUIRED_REPORT_FIELDS];
  // ข้อ 22(1): เหตุผลความจำเป็น — ว804 ตัดออกจากรายงาน 3 รายการของการซื้อไม่เกิน 50,000 บาท
  // กรณีฉุกเฉินต้องมีเสมอ เพราะเหตุผลคือสิ่งที่ทำให้ซื้อก่อนรายงานได้
  if (!simplified) requiredFields.push({ key: 'purpose', labelTh: 'เหตุผลความจำเป็น' });
  // ข้อ 22(5): กำหนดเวลาที่ต้องการใช้พัสดุ — ข้อ 22 วรรคสองให้ตัดรายการได้เมื่อฉุกเฉิน
  if (!simplified && !draft.isEmergency) {
    requiredFields.push({
      key: 'requiredDate',
      labelTh: 'กำหนดเวลาที่ต้องการใช้พัสดุหรือให้งานแล้วเสร็จ',
    });
  }

  for (const field of requiredFields) {
    const value = draft[field.key];
    if (value === undefined || value === null || value === '') {
      collector.error(
        'REQUIRED_REPORT_FIELD_MISSING',
        `รายงานขอซื้อ/ขอจ้างต้องระบุ${field.labelTh}`,
        field.key,
      );
    }
  }

  // ---- วิธีจัดหาเทียบกับวงเงิน ----
  const hasLegalBasis = (draft.methodLegalBasisCode ?? '').trim() !== '';

  if (
    tier === 'OVER_500K' &&
    draft.procurementMethod === 'SPECIFIC' &&
    !draft.isEmergency &&
    !hasLegalBasis
  ) {
    collector.error(
      'METHOD_EXCEEDS_LIMIT',
      `วงเงิน ${formatSatang(grandTotal)} บาท เกิน ${formatSatang(SPECIFIC_METHOD_LIMIT_SATANG)} บาท ` +
        'ใช้วิธีเฉพาะเจาะจงไม่ได้ เว้นแต่เป็นกรณีฉุกเฉินหรือระบุฐานกฎหมายของวิธีนี้ ' +
        '(กฎกระทรวงกำหนดวงเงินฯ พ.ศ. 2560 ข้อ 1)',
      'procurementMethod',
    );
  }

  if (
    tier !== undefined &&
    tier !== 'OVER_500K' &&
    (draft.procurementMethod === 'AUCTION' || draft.procurementMethod === 'SELECTION')
  ) {
    collector.warn(
      'METHOD_NOT_SPECIFIC_FOR_SMALL',
      `วงเงิน ${formatSatang(grandTotal)} บาท ไม่เกิน ${formatSatang(SPECIFIC_METHOD_LIMIT_SATANG)} บาท ` +
        'กฎกระทรวงกำหนดให้ใช้วิธีเฉพาะเจาะจง — ตรวจว่าเลือกวิธีจัดหาถูกต้องหรือไม่ ' +
        '(กฎกระทรวงกำหนดวงเงินฯ พ.ศ. 2560 ข้อ 1)',
      'procurementMethod',
    );
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

  /*
   * ซื้อก่อนรายงานตามหลัง — ผ่อนเฉพาะขั้นเอกสารที่ตามหลังขั้นปฏิบัติ
   *
   * ผ่อนได้เฉพาะเร่งด่วน (ข้อ 79 วรรคสอง) หรือซื้อขั้นตอนย่อไม่เกิน 50,000 บาท (ว804)
   * ทั้งสองกรณีผู้ใช้ต้องเห็นว่ากำลังใช้ทางลัดอยู่ จึงออกข้อความ INFO/WARNING ทุกครั้ง
   * ที่ผ่อนจริง ไม่ผ่อนเงียบ ๆ
   */
  const buyFirst =
    tier !== undefined && isBuyFirstAllowed(tier, draft.classification, draft.isEmergency);
  const strictChronology = checkChronology(dates);
  const chronology = buyFirst ? checkChronology(dates, { buyFirst: true }) : strictChronology;

  if (buyFirst && strictChronology.findings.length > chronology.findings.length) {
    addBuyFirstNotice(collector, draft, simplified);
  }

  return new ValidationReport([
    ...collector.report().findings,
    ...mergeReports([chronology, checkFiscalYearRange(dates, context.fiscalYear)]),
  ]);
}

/**
 * แจ้งว่ารายการนี้ใช้ทางลัด "ซื้อก่อนรายงานตามหลัง"
 *
 * การซื้อขั้นตอนย่อมีกำหนดชัด (5 วันทำการนับถัดจากวันซื้อ ตามข่าว กวจ. 52/2568)
 * เกินกำหนดเป็น WARNING ส่วนกรณีเร่งด่วน ข้อ 79 วรรคสองมีแค่ "รีบรายงาน" ไม่มีจำนวนวัน
 * จึงเป็น INFO เท่านั้น ไม่กุกำหนดวันเอง
 *
 * ระบบไม่รู้วันหยุดราชการ นับวันหยุดเป็นวันทำการ จึงมีค่ามากกว่าหรือเท่าของจริง —
 * เป็นเหตุผลที่เกินกำหนดต้องเป็น WARNING ไม่ใช่ ERROR
 */
function addBuyFirstNotice(
  collector: FindingCollector,
  draft: ProcurementDraftInput,
  simplified: boolean,
): void {
  const purchaseDates = [draft.orderOrAgreementDate, draft.deliveryOrServiceDate].filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  const purchaseDate = purchaseDates.length > 0 ? [...purchaseDates].sort()[0] : undefined;

  if (simplified && draft.reportDate && purchaseDate && draft.reportDate > purchaseDate) {
    const days = weekdaysAfter(purchaseDate, draft.reportDate);
    if (days > BUY_FIRST_REPORT_DEADLINE_DAYS) {
      collector.warn(
        'BUY_FIRST_REPORT_DEADLINE',
        `ซื้อก่อนรายงาน: รายงานสรุปผลเสนอหลังวันซื้อ ${days} วันทำการ เกิน ` +
          `${BUY_FIRST_REPORT_DEADLINE_DAYS} วันทำการตามแนวปฏิบัติซื้อไม่เกิน 50,000 บาท ` +
          '(นับวันหยุดราชการเป็นวันทำการ ตรวจวันที่จริงอีกครั้ง)',
        'reportDate',
      );
    } else {
      collector.info(
        'BUY_FIRST_REPORT_DEADLINE',
        `ซื้อก่อนรายงาน: รายงานสรุปผลเสนอหลังวันซื้อ ${days} วันทำการ ` +
          `อยู่ในกำหนด ${BUY_FIRST_REPORT_DEADLINE_DAYS} วันทำการ`,
        'reportDate',
      );
    }
    return;
  }

  collector.info(
    'BUY_FIRST_REPORT_DEADLINE',
    'ซื้อ/จ้างไปก่อนแล้วรายงานตามหลัง (กรณีเร่งด่วน ระเบียบ ข้อ 79 วรรคสอง) — ' +
      'ต้องรีบรายงานขอความเห็นชอบ และเมื่อหัวหน้าหน่วยงานเห็นชอบถือเป็นหลักฐานตรวจรับโดยอนุโลม',
    'reportDate',
  );
}
