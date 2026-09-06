/**
 * เครื่องมือตรวจกฎที่ใช้ร่วมกันทั้งระบบ (แผนข้อ 7)
 *
 * ออกแบบสามอย่างนี้โดยเจตนา:
 *
 * 1. **เก็บผลเป็นรายการ ไม่ใช่โยน exception ที่ข้อแรก** — ผู้ใช้ที่กรอกผิดสามช่อง
 *    ต้องเห็นทั้งสามข้อในรอบเดียว ไม่ใช่แก้ทีละข้อแล้วกดใหม่สามรอบ
 *    ต่างจาก assertLinesConsistent() ที่โยนทันทีเพราะข้อมูลที่ผิดโครงสร้าง
 *    คำนวณต่อไม่ได้เลย
 *
 * 2. **แยกระดับ ERROR / WARNING / INFO** — ไม่ใช่ทุกข้อที่ควรบล็อก
 *    การบล็อกทุกอย่างทำให้คนหาทางเลี่ยงด้วยการกรอกค่าปลอม ซึ่งแย่กว่าปล่อยผ่าน
 *    พร้อมคำเตือนที่บันทึกไว้
 *
 * 3. **`overridable` อยู่ที่ตัวกฎ ไม่ใช่ที่ผู้เรียก** — กฎที่ยกเว้นได้กับยกเว้นไม่ได้
 *    ต้องตัดสินที่นิยามของกฎ มิฉะนั้นจะมีผู้เรียกบางรายเผลอยอมให้ยกเว้นกฎ
 *    ที่ห้ามยกเว้น (แผนข้อ 7.2: "P0 arithmetic/date validity ห้าม override")
 *
 * ไฟล์นี้เป็นตรรกะบริสุทธิ์ ห้าม import Supabase หรือ Next.js
 */

export const VALIDATION_SEVERITIES = ['ERROR', 'WARNING', 'INFO'] as const;

export type ValidationSeverity = (typeof VALIDATION_SEVERITIES)[number];

/**
 * รหัสกฎขั้นต่ำตามแผนข้อ 7.1
 *
 * รหัสที่ยังไม่มีกฎจริงในรอบนี้ก็ประกาศไว้ เพราะรหัสเป็นสัญญากับเอกสารและรายงาน
 * การเพิ่มทีหลังทำให้เอกสารที่อ้างรหัสไว้แล้วชี้ไปที่ไม่มีอยู่
 */
export const RULE_CODES = [
  'DATE_INVALID',
  'DATE_REQUEST_AFTER_DELIVERY',
  'DATE_APPROVAL_AFTER_ORDER',
  'DATE_ORDER_AFTER_DELIVERY',
  'DATE_OUT_OF_ORDER',
  'BUDGET_INSUFFICIENT',
  'FUNDING_TOTAL_MISMATCH',
  'DOCUMENT_NUMBER_DUPLICATE',
  'DOCUMENT_NUMBER_REASON_REQUIRED',
  'REQUIRED_REPORT_FIELD_MISSING',
  'LEGAL_CONTENT_UNPUBLISHED',
  'VENDOR_INCOMPLETE',
  'STOCK_WOULD_GO_NEGATIVE',
  'SOURCE_DOCUMENT_MISSING',
  'FISCAL_YEAR_MISMATCH',
  'TEMPLATE_PLACEHOLDER_REMAINS',
] as const;

export type RuleCode = (typeof RULE_CODES)[number];

/**
 * กฎที่ยกเว้นได้ด้วยสิทธิ์ เหตุผล และหลักฐาน
 *
 * ทุกข้อที่ **ไม่** อยู่ในรายการนี้ห้ามยกเว้นเด็ดขาด เขียนแบบขึ้นบัญชีเฉพาะ
 * ข้อที่ยกเว้นได้ (allow-list) ไม่ใช่ขึ้นบัญชีข้อที่ห้าม เพราะรหัสใหม่ที่เพิ่ม
 * ภายหลังจะถูกถือว่า "ห้ามยกเว้น" โดยอัตโนมัติ ซึ่งเป็นค่าเริ่มต้นที่ปลอดภัยกว่า
 *
 * `DATE_INVALID` ไม่อยู่ในรายการ — วันที่ที่ไม่มีอยู่จริงในปฏิทินไม่ใช่เรื่องที่
 * ใครอนุมัติให้ผ่านได้ (แผนข้อ 7.2) และฐานข้อมูลก็ปฏิเสธตั้งแต่ชนิดคอลัมน์อยู่แล้ว
 *
 * `FUNDING_TOTAL_MISMATCH` ไม่อยู่ในรายการ — เป็นเรื่องเลขคณิต ไม่ใช่ดุลพินิจ
 */
const OVERRIDABLE_RULES: readonly RuleCode[] = [
  'DATE_REQUEST_AFTER_DELIVERY',
  'DATE_APPROVAL_AFTER_ORDER',
  'DATE_ORDER_AFTER_DELIVERY',
  'DATE_OUT_OF_ORDER',
  'BUDGET_INSUFFICIENT',
  'VENDOR_INCOMPLETE',
];

export function isOverridableRule(code: RuleCode): boolean {
  return OVERRIDABLE_RULES.includes(code);
}

export interface ValidationFinding {
  code: RuleCode;
  severity: ValidationSeverity;
  /** ข้อความภาษาไทยที่บอกว่าผิดอย่างไรและต้องแก้อะไร */
  message: string;
  /** ชื่อช่องในฟอร์ม ใช้ลิงก์ผู้ใช้ไปที่จุดที่ต้องแก้ */
  field?: string | undefined;
}

/** ผลตรวจทั้งชุด พร้อมตัวช่วยตอบคำถามที่ผู้เรียกถามบ่อย */
export class ValidationReport {
  readonly findings: readonly ValidationFinding[];

  constructor(findings: readonly ValidationFinding[]) {
    this.findings = findings;
  }

  get errors(): ValidationFinding[] {
    return this.findings.filter((finding) => finding.severity === 'ERROR');
  }

  get warnings(): ValidationFinding[] {
    return this.findings.filter((finding) => finding.severity === 'WARNING');
  }

  /** มีข้อที่บล็อกอยู่หรือไม่ (ยังไม่คิดเรื่องการยกเว้น) */
  get hasErrors(): boolean {
    return this.findings.some((finding) => finding.severity === 'ERROR');
  }

  /**
   * ข้อที่บล็อกอยู่ **หลังจาก** ใช้สิทธิ์ยกเว้นแล้ว
   *
   * ข้อที่ยกเว้นไม่ได้ยังบล็อกอยู่เสมอ ไม่ว่าผู้เรียกจะมีสิทธิ์อะไร —
   * นี่คือจุดที่ทำให้ "P0 ห้าม override" เป็นจริงในโค้ด ไม่ใช่แค่ในเอกสาร
   */
  blockingAfterOverride(hasOverridePermission: boolean): ValidationFinding[] {
    return this.errors.filter(
      (finding) => !hasOverridePermission || !isOverridableRule(finding.code),
    );
  }

  /** true = ส่งต่อได้ (อาจต้องใช้สิทธิ์ยกเว้น) */
  canProceed(hasOverridePermission: boolean): boolean {
    return this.blockingAfterOverride(hasOverridePermission).length === 0;
  }

  /** true = ผ่านได้เพราะใช้สิทธิ์ยกเว้นเท่านั้น จึงต้องบังคับให้ระบุเหตุผล */
  requiresOverrideReason(hasOverridePermission: boolean): boolean {
    return this.hasErrors && this.canProceed(hasOverridePermission);
  }
}

/** ตัวช่วยสะสมผลตรวจ ให้แต่ละกฎเขียนสั้นและอ่านง่าย */
export class FindingCollector {
  private readonly items: ValidationFinding[] = [];

  add(finding: ValidationFinding): void {
    this.items.push(finding);
  }

  error(code: RuleCode, message: string, field?: string): void {
    this.add({ code, severity: 'ERROR', message, field });
  }

  warn(code: RuleCode, message: string, field?: string): void {
    this.add({ code, severity: 'WARNING', message, field });
  }

  info(code: RuleCode, message: string, field?: string): void {
    this.add({ code, severity: 'INFO', message, field });
  }

  report(): ValidationReport {
    return new ValidationReport(this.items);
  }
}

/**
 * ตรวจว่าข้อความเป็นรหัสกฎที่ระบบรู้จักหรือไม่
 *
 * จำเป็นเพราะรหัสที่อ่านกลับมาจากฐานข้อมูลเป็น `text` ไม่ใช่ชนิดที่ TypeScript
 * รับประกันได้ การแปลงด้วย `as RuleCode` เฉย ๆ จะทำให้รหัสที่พิมพ์ผิดใน SQL
 * ผ่านเข้ามาโดยไม่มีอะไรฟ้อง
 */
export function isRuleCode(value: string): value is RuleCode {
  return (RULE_CODES as readonly string[]).includes(value);
}
