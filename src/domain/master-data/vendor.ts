/**
 * โดเมนผู้ขาย (FR-MST-005, FR-MST-009)
 *
 * ส่วนสำคัญคือการตรวจผู้ขายซ้ำ ซึ่งมีสองระดับที่ต่างกันโดยเจตนา:
 *
 *   BLOCK  — เลขประจำตัวผู้เสียภาษีและสาขาซ้ำกับผู้ขายที่ยังใช้งานอยู่
 *            เป็นข้อมูลเดียวกันแน่นอน ฐานข้อมูลมี unique index กันไว้อีกชั้น
 *
 *   WARN   — ชื่อคล้ายกันมาก แต่เลขผู้เสียภาษีต่างกันหรือยังไม่ได้กรอก
 *            เตือนให้เจ้าหน้าที่ตรวจก่อน แต่ไม่บล็อก เพราะร้านคนละแห่ง
 *            อาจชื่อคล้ายกันได้จริง เช่น "ร้านวัสดุก่อสร้างสมชาย" กับ
 *            "ร้านวัสดุก่อสร้างสมชัย" ซึ่งเป็นคนละร้าง
 *
 * การบล็อกกรณี WARN จะทำให้เจ้าหน้าที่บันทึกผู้ขายที่มีอยู่จริงไม่ได้
 * ซึ่งแย่กว่าการมีข้อมูลซ้ำที่รวมทีหลังได้
 */

export interface VendorSummary {
  id: string;
  vendorCode: string;
  name: string;
  taxId: string | null;
  branchNo: string | null;
  isActive: boolean;
}

export interface VendorDraft {
  name: string;
  taxId?: string | null;
  branchNo?: string | null;
}

export type DuplicateSeverity = 'BLOCK' | 'WARN';

export interface DuplicateFinding {
  severity: DuplicateSeverity;
  vendor: VendorSummary;
  reasonTh: string;
}

/** สาขาที่ไม่ระบุถือเป็นสำนักงานใหญ่ ตรงกับค่า default ใน unique index ของฐานข้อมูล */
const HEAD_OFFICE_BRANCH = '00000';

const normalizeBranch = (branchNo: string | null | undefined): string =>
  branchNo?.trim() ? branchNo.trim() : HEAD_OFFICE_BRANCH;

/**
 * ตัดคำนำหน้าที่พบบ่อยและช่องว่างออก ก่อนเทียบความคล้ายของชื่อ
 *
 * "บริษัท ก ก่อสร้าง จำกัด" กับ "บ. ก ก่อสร้าง จก." ควรถือว่าคล้ายกัน
 * เพราะเป็นนิติบุคคลเดียวกันที่เขียนคนละแบบ
 */
export function normalizeVendorName(name: string): string {
  return name
    .replace(/\s+/g, '')
    .replace(/บริษัท|บจก\.?|บมจ\.?|บ\.|หจก\.?|ห้างหุ้นส่วนจำกัด|ห้างหุ้นส่วน/g, '')
    .replace(/จำกัด|จก\.?|\(มหาชน\)|มหาชน/g, '')
    .replace(/ร้าน|คุณ|นาย|นาง|นางสาว|น\.ส\./g, '')
    .toLowerCase();
}

/**
 * ระยะแก้ไข (Levenshtein) ระหว่างสองสตริง
 *
 * เขียนเองแทนการเพิ่ม dependency เพราะใช้ที่เดียวและอินพุตสั้น (ชื่อผู้ขาย)
 * ใช้อาร์เรย์แถวเดียวเพื่อให้ใช้หน่วยความจำ O(n) ไม่ใช่ O(n²)
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + substitutionCost,
      );
    }
    previous = current;
  }

  return previous[b.length] ?? 0;
}

/** ความคล้ายในช่วง 0..1 โดย 1 คือเหมือนกันทุกตัวอักษรหลัง normalize */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeVendorName(a);
  const right = normalizeVendorName(b);

  if (left === '' && right === '') return 1;

  const longest = Math.max(left.length, right.length);
  if (longest === 0) return 1;

  return 1 - editDistance(left, right) / longest;
}

/**
 * เกณฑ์ความคล้ายที่ถือว่าควรเตือน
 *
 * 0.85 มาจากการที่ชื่อผู้ขายภาษาไทยยาวราว 15-30 ตัวอักษรหลัง normalize
 * ค่านี้จึงยอมให้ต่างกันได้ประมาณ 2-4 ตัวอักษร ซึ่งครอบคลุมการพิมพ์ผิด
 * และการเขียนคนละแบบ แต่ไม่กว้างจนเตือนพร่ำเพรื่อ
 *
 * เป็นค่าที่ควรปรับตามข้อมูลจริงหลังใช้งานไประยะหนึ่ง
 */
export const NAME_SIMILARITY_THRESHOLD = 0.85;

/**
 * ตรวจว่าผู้ขายที่กำลังจะบันทึกซ้ำกับที่มีอยู่หรือไม่
 *
 * @param existing ผู้ขายที่ยังไม่ถูกลบ (ผู้เรียกกรอง deleted_at มาแล้ว)
 * @returns รายการที่พบ เรียง BLOCK ก่อน WARN และในกลุ่มเดียวกันเรียงตามความคล้าย
 */
export function findDuplicateVendors(
  draft: VendorDraft,
  existing: readonly VendorSummary[],
): DuplicateFinding[] {
  const findings: (DuplicateFinding & { score: number })[] = [];
  const draftTaxId = draft.taxId?.trim() || null;
  const draftBranch = normalizeBranch(draft.branchNo);

  for (const vendor of existing) {
    if (
      draftTaxId &&
      vendor.taxId === draftTaxId &&
      normalizeBranch(vendor.branchNo) === draftBranch
    ) {
      findings.push({
        severity: 'BLOCK',
        vendor,
        reasonTh: `เลขประจำตัวผู้เสียภาษีและสาขาซ้ำกับ "${vendor.name}" (${vendor.vendorCode})`,
        score: 1,
      });
      continue;
    }

    const similarity = nameSimilarity(draft.name, vendor.name);
    if (similarity >= NAME_SIMILARITY_THRESHOLD) {
      findings.push({
        severity: 'WARN',
        vendor,
        reasonTh:
          similarity === 1
            ? `ชื่อตรงกับ "${vendor.name}" (${vendor.vendorCode}) ที่มีอยู่แล้ว`
            : `ชื่อคล้ายกับ "${vendor.name}" (${vendor.vendorCode})`,
        score: similarity,
      });
    }
  }

  return findings
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'BLOCK' ? -1 : 1;
      return b.score - a.score;
    })
    .map(({ score: _score, ...finding }) => finding);
}

/** มีรายการที่ต้องบล็อกหรือไม่ — ผู้เรียกใช้ตัดสินว่าจะบันทึกได้หรือไม่ */
export function hasBlockingDuplicate(findings: readonly DuplicateFinding[]): boolean {
  return findings.some((finding) => finding.severity === 'BLOCK');
}
