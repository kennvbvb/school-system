/**
 * กฎลำดับเวลาของรายการจัดซื้อจัดจ้าง — ปิดข้อค้นพบ F-04
 *
 * F-04 คือกรณีที่ **วันใช้บริการ 31 ม.ค. 2569 เกิดก่อนวันขออนุมัติ 2 ก.พ. 2569**
 * พบใน 2 sheet ของไฟล์จริง อาการนี้เกิดได้เพราะสเปรดชีตไม่มีอะไรเทียบวันที่
 * ระหว่างช่องให้เลย แต่ละช่องถูกต้องในตัวเอง ผิดแต่เมื่ออ่านรวมกัน
 *
 * F-03 (วันที่ 31 กันยายน ซึ่งไม่มีอยู่จริง) **ไม่ได้ปิดที่ไฟล์นี้** — ปิดด้วย
 * ชนิดคอลัมน์ date ในฐานข้อมูลและ businessDateSchema ที่ขอบเขต ซึ่งปฏิเสธตั้งแต่
 * ก่อนถึงชั้นนี้ ที่นี่จึงถือว่าทุกวันที่ที่รับเข้ามามีอยู่จริงในปฏิทินแล้ว
 *
 * ไฟล์นี้เป็นตรรกะบริสุทธิ์ ห้าม import Supabase หรือ Next.js
 */
import { FindingCollector } from '@/domain/validation/rules';
import type { RuleCode, ValidationReport } from '@/domain/validation/rules';
import { formatThaiDate } from '@/lib/format/thai-date';

/**
 * ขั้นตอนตามลำดับที่ต้องเกิดจริง
 *
 * ลำดับนี้คือ **นิยามเดียว** ของคำว่า "ก่อน-หลัง" ในระบบ ทั้งกฎ ข้อความ และ
 * หน้าจอเรียงตามนี้ทั้งหมด ถ้าเพิ่มขั้นใหม่ให้แทรกที่นี่ที่เดียว
 */
export const PROCUREMENT_MILESTONES = [
  'requestDate',
  'reportDate',
  'approvedDate',
  'selectionDate',
  'orderOrAgreementDate',
  'deliveryOrServiceDate',
  'inspectionDate',
  'sentToFinanceDate',
] as const;

export type ProcurementMilestone = (typeof PROCUREMENT_MILESTONES)[number];

export const MILESTONE_LABELS_TH: Readonly<Record<ProcurementMilestone, string>> = {
  requestDate: 'วันที่ขอซื้อ/ขอจ้าง',
  reportDate: 'วันที่รายงานขอซื้อ/ขอจ้าง',
  approvedDate: 'วันที่อนุมัติ',
  selectionDate: 'วันที่คัดเลือกผู้ขาย',
  orderOrAgreementDate: 'วันที่สั่งซื้อ/ทำข้อตกลง',
  deliveryOrServiceDate: 'วันที่ส่งมอบ/ใช้บริการ',
  inspectionDate: 'วันที่ตรวจรับ',
  sentToFinanceDate: 'วันที่ส่งเบิกการเงิน',
};

/** วันที่ทั้งชุด — ทุกช่องยกเว้น requestDate เป็น null ได้ (แผนข้อ 6.3) */
export type ProcurementDates = {
  requestDate: string;
} & Partial<Record<Exclude<ProcurementMilestone, 'requestDate'>, string | null | undefined>>;

/**
 * คู่ที่มีรหัสกฎเฉพาะของตัวเอง
 *
 * สามคู่นี้ถูกระบุชื่อไว้ในแผนข้อ 7.1 เพราะเป็นความผิดที่พบบ่อยและมีความหมาย
 * ทางระเบียบชัดเจน คู่อื่นใช้รหัสรวม `DATE_OUT_OF_ORDER`
 *
 * แยกแบบนี้เพราะรายงานและการนับสถิติต้องแยก "อนุมัติหลังสั่งซื้อ" (ซึ่งแปลว่า
 * สั่งไปก่อนได้รับอนุมัติ) ออกจากความผิดลำดับทั่วไปที่อาจเป็นแค่กรอกสลับช่อง
 */
const NAMED_PAIR_RULES: readonly {
  earlier: ProcurementMilestone;
  later: ProcurementMilestone;
  code: RuleCode;
}[] = [
  { earlier: 'requestDate', later: 'deliveryOrServiceDate', code: 'DATE_REQUEST_AFTER_DELIVERY' },
  { earlier: 'approvedDate', later: 'orderOrAgreementDate', code: 'DATE_APPROVAL_AFTER_ORDER' },
  {
    earlier: 'orderOrAgreementDate',
    later: 'deliveryOrServiceDate',
    code: 'DATE_ORDER_AFTER_DELIVERY',
  },
];

function readDate(dates: ProcurementDates, milestone: ProcurementMilestone): string | null {
  const value = dates[milestone];
  return typeof value === 'string' && value !== '' ? value : null;
}

function describe(milestone: ProcurementMilestone, value: string): string {
  return `${MILESTONE_LABELS_TH[milestone]} (${formatThaiDate(new Date(`${value}T00:00:00Z`))})`;
}

/**
 * ตรวจลำดับเวลาทั้งชุด
 *
 * เทียบ **ทุกคู่ที่มีค่าครบทั้งสองข้าง** ไม่ใช่เทียบเฉพาะขั้นที่ติดกัน
 *
 * เหตุผล: ถ้าเทียบเฉพาะขั้นติดกัน รายการที่เว้นขั้นกลางไว้ว่าง (ซึ่งเกิดบ่อย
 * เพราะไม่ใช่ทุกงานที่มีทุกขั้น) จะไม่ถูกตรวจเลย เช่นกรอกวันขอ 2 ก.พ. และ
 * วันส่งมอบ 31 ม.ค. โดยเว้นวันอนุมัติกับวันสั่งซื้อไว้ — ซึ่งเป็นรูปแบบเดียวกับ
 * F-04 พอดี การเทียบทุกคู่จับได้ทันทีโดยไม่ต้องรอให้กรอกครบ
 *
 * เปรียบเทียบสตริง YYYY-MM-DD ตรง ๆ ได้ เพราะรูปแบบนี้เรียงตามพจนานุกรม
 * ตรงกับลำดับเวลาเสมอ และไม่ต้องผ่าน Date ซึ่งจะพาเรื่องเขตเวลาเข้ามาโดยไม่จำเป็น
 */
export function checkChronology(dates: ProcurementDates): ValidationReport {
  const collector = new FindingCollector();

  for (let i = 0; i < PROCUREMENT_MILESTONES.length; i += 1) {
    const earlier = PROCUREMENT_MILESTONES[i];
    if (!earlier) continue;

    const earlierValue = readDate(dates, earlier);
    if (!earlierValue) continue;

    for (let j = i + 1; j < PROCUREMENT_MILESTONES.length; j += 1) {
      const later = PROCUREMENT_MILESTONES[j];
      if (!later) continue;

      const laterValue = readDate(dates, later);
      if (!laterValue) continue;

      if (laterValue >= earlierValue) continue;

      const named = NAMED_PAIR_RULES.find(
        (rule) => rule.earlier === earlier && rule.later === later,
      );

      collector.error(
        named?.code ?? 'DATE_OUT_OF_ORDER',
        `${describe(later, laterValue)} เกิดก่อน${describe(earlier, earlierValue)} ` +
          'ซึ่งเป็นลำดับที่เกิดขึ้นจริงไม่ได้',
        // ชี้ไปที่ช่องหลัง เพราะเป็นช่องที่ผู้ใช้มักกรอกผิด และเป็นช่องที่แก้แล้วจบ
        later,
      );
    }
  }

  return collector.report();
}

/**
 * วันที่ทุกช่องต้องอยู่ในปีงบประมาณที่เลือก
 *
 * แยกจาก checkChronology เพราะคนละคำถาม: อันนั้นถามว่า "ลำดับถูกไหม"
 * อันนี้ถามว่า "อยู่ในปีที่เลือกไหม" รายการที่ลำดับถูกทั้งหมดยังอาจอยู่ผิดปีได้
 */
export function checkFiscalYearRange(
  dates: ProcurementDates,
  fiscalYear: { code: string; startDate: string; endDate: string },
): ValidationReport {
  const collector = new FindingCollector();

  for (const milestone of PROCUREMENT_MILESTONES) {
    const value = readDate(dates, milestone);
    if (!value) continue;

    if (value < fiscalYear.startDate || value > fiscalYear.endDate) {
      collector.error(
        'FISCAL_YEAR_MISMATCH',
        `${describe(milestone, value)} อยู่นอกช่วงปีงบประมาณ ${fiscalYear.code}`,
        milestone,
      );
    }
  }

  return collector.report();
}
