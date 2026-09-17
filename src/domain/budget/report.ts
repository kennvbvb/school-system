/**
 * การรวมยอดงบประมาณสำหรับรายงาน (PR-09, เกณฑ์ตรวจรับ "ยอดรวม report เท่ากับ ledger")
 *
 * ไฟล์นี้ตอบคำถามเดียว: "เมื่อมีบัญชีงบชุดหนึ่ง จะรวมยอดตามมิติที่เลือกได้อย่างไร
 * โดยไม่ทำให้บัญชีใดหายไปและไม่ทำให้ยอดรวมไม่ตรงกับผลรวมของแถว"
 *
 * **ยอดรวมทั้งหมดและยอดรายกลุ่มถูกคิดจากแถวชุดเดียวกันเสมอ** ไม่ใช่จากการ query
 * แยกอีกครั้ง เพราะรายงานที่ยอดรวมมาจากคนละแหล่งกับรายละเอียดคือรายงานที่
 * ตัวเลขสองส่วนจะค่อย ๆ ไม่ตรงกันโดยไม่มีอะไรฟ้อง ซึ่งอันตรายกว่าไม่มีรายงานเลย
 * เพราะผู้อ่านเชื่อตัวเลขที่เห็นไปแล้ว
 *
 * ไฟล์นี้เป็นตรรกะบริสุทธิ์ ห้าม import Supabase หรือ Next.js
 */

/** มิติที่รวมยอดได้ — ตรงกับ scope ที่บัญชีงบผูกไว้ได้ (migration 0005) */
export const BUDGET_REPORT_DIMENSIONS = [
  'PROJECT',
  'FUNDING_SOURCE',
  'DEPARTMENT',
  'FISCAL_YEAR',
] as const;

export type BudgetReportDimension = (typeof BUDGET_REPORT_DIMENSIONS)[number];

export const BUDGET_REPORT_DIMENSION_LABELS_TH: Readonly<Record<BudgetReportDimension, string>> = {
  PROJECT: 'โครงการ',
  FUNDING_SOURCE: 'แหล่งเงิน',
  DEPARTMENT: 'ฝ่ายงาน',
  FISCAL_YEAR: 'ปีงบประมาณ',
};

/**
 * คีย์ของกลุ่มที่รวมบัญชีซึ่งไม่ได้ผูกกับมิติที่เลือก
 *
 * บัญชีงบต้องผูกกับอย่างน้อยหนึ่ง scope แต่ไม่จำเป็นต้องผูกครบทั้งสาม
 * บัญชีที่ผูกกับแหล่งเงินอย่างเดียวจึงไม่มีโครงการ — **ต้องยังปรากฏในรายงาน
 * ตามโครงการ** มิฉะนั้นยอดรวมจะน้อยกว่าความจริงโดยที่หน้าจอดูปกติทุกอย่าง
 */
export const UNASSIGNED_GROUP_KEY = '__UNASSIGNED__';

/**
 * บัญชีงบหนึ่งบัญชีพร้อมยอดในช่วงที่รายงานครอบคลุม
 *
 * ไม่มีช่อง "ยอดที่ใช้ได้" เพราะเป็นค่าที่คิดได้จากสามช่องนี้เสมอ
 * การส่งมาเป็นช่องที่สี่เปิดโอกาสให้ตัวเลขที่แสดงไม่ตรงกับผลลบของช่องอื่น
 * ในหน้าเดียวกัน (ดู availableOf)
 */
export interface BudgetReportRow {
  accountId: string;
  accountCode: string;
  status: 'OPEN' | 'CLOSED';
  fiscalYearId: string;
  fiscalYearCode: string | null;
  projectId: string | null;
  projectName: string | null;
  fundingSourceId: string | null;
  fundingSourceName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  grantedSatang: bigint;
  reservedSatang: bigint;
  usedSatang: bigint;
}

export interface BudgetReportAmounts {
  grantedSatang: bigint;
  reservedSatang: bigint;
  usedSatang: bigint;
  /** granted − reserved − used — นิยามเดียวกับ src/domain/budget/availability.ts */
  availableSatang: bigint;
}

export interface BudgetReportGroup {
  /** id ของมิติ หรือ UNASSIGNED_GROUP_KEY */
  key: string;
  labelTh: string;
  accountCount: number;
  amounts: BudgetReportAmounts;
}

export interface BudgetReport {
  dimension: BudgetReportDimension;
  groups: BudgetReportGroup[];
  /** ยอดรวมทุกกลุ่ม คิดจากแถวชุดเดียวกับที่ใช้สร้างกลุ่ม */
  total: BudgetReportAmounts;
  accountCount: number;
}

export const ZERO_AMOUNTS: BudgetReportAmounts = {
  grantedSatang: 0n,
  reservedSatang: 0n,
  usedSatang: 0n,
  availableSatang: 0n,
};

/**
 * ยอดที่ใช้ได้ของแถวหนึ่ง
 *
 * นิยามนี้ซ้ำกับ `summarize()` ใน availability.ts และกับ view
 * `budget_account_balances` โดยตั้งใจ — รายงานอ่านยอดที่ฐานข้อมูลรวมมาให้แล้ว
 * จึงไม่ได้ไล่ movement เอง แต่ต้องได้คำตอบเดียวกัน
 * มี SQL test เทียบผลของทั้งสองทางเพื่อไม่ให้นิยามแยกจากกันเงียบ ๆ
 */
export function availableOf(amounts: {
  grantedSatang: bigint;
  reservedSatang: bigint;
  usedSatang: bigint;
}): bigint {
  return amounts.grantedSatang - amounts.reservedSatang - amounts.usedSatang;
}

function amountsOf(rows: readonly BudgetReportRow[]): BudgetReportAmounts {
  let granted = 0n;
  let reserved = 0n;
  let used = 0n;

  for (const row of rows) {
    granted += row.grantedSatang;
    reserved += row.reservedSatang;
    used += row.usedSatang;
  }

  return {
    grantedSatang: granted,
    reservedSatang: reserved,
    usedSatang: used,
    availableSatang: availableOf({
      grantedSatang: granted,
      reservedSatang: reserved,
      usedSatang: used,
    }),
  };
}

/** id และชื่อของมิติที่เลือก สำหรับแถวหนึ่ง */
function dimensionOf(
  row: BudgetReportRow,
  dimension: BudgetReportDimension,
): { id: string | null; name: string | null } {
  switch (dimension) {
    case 'PROJECT':
      return { id: row.projectId, name: row.projectName };
    case 'FUNDING_SOURCE':
      return { id: row.fundingSourceId, name: row.fundingSourceName };
    case 'DEPARTMENT':
      return { id: row.departmentId, name: row.departmentName };
    case 'FISCAL_YEAR':
      return { id: row.fiscalYearId, name: row.fiscalYearCode };
  }
}

/**
 * เรียงกลุ่มตามชื่อภาษาไทย โดยให้กลุ่ม "ไม่ได้ผูก" อยู่ท้ายสุดเสมอ
 *
 * กลุ่มนั้นเป็นเศษที่เหลือ ไม่ใช่กลุ่มที่เทียบเคียงกับกลุ่มอื่นได้
 * การให้มันไปแทรกกลางตามลำดับตัวอักษรทำให้ผู้อ่านนับรวมมันเป็นโครงการหนึ่ง
 */
function compareGroups(a: BudgetReportGroup, b: BudgetReportGroup): number {
  if (a.key === UNASSIGNED_GROUP_KEY) return b.key === UNASSIGNED_GROUP_KEY ? 0 : 1;
  if (b.key === UNASSIGNED_GROUP_KEY) return -1;
  return a.labelTh.localeCompare(b.labelTh, 'th');
}

/**
 * สร้างรายงานจากแถวบัญชีงบ
 *
 * ทุกแถวลงกลุ่มเดียวเสมอ ทั้งจำนวนบัญชีและยอดรวมจึงเท่ากับผลรวมของกลุ่มพอดี
 * — มี unit test บังคับคุณสมบัตินี้กับข้อมูลที่มีค่าว่างปนอยู่ด้วย
 */
export function buildBudgetReport(
  rows: readonly BudgetReportRow[],
  dimension: BudgetReportDimension,
): BudgetReport {
  const buckets = new Map<string, { labelTh: string; rows: BudgetReportRow[] }>();

  for (const row of rows) {
    const { id, name } = dimensionOf(row, dimension);
    const key = id ?? UNASSIGNED_GROUP_KEY;
    const labelTh =
      id === null
        ? `ไม่ได้ผูกกับ${BUDGET_REPORT_DIMENSION_LABELS_TH[dimension]}`
        : // ชื่ออาจว่างได้เมื่อผู้อ่านไม่มีสิทธิ์เห็นตาราง master data ที่ join มา
          (name ?? `(ไม่ทราบชื่อ) ${id}`);

    const bucket = buckets.get(key);
    if (bucket) bucket.rows.push(row);
    else buckets.set(key, { labelTh, rows: [row] });
  }

  const groups = [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      labelTh: bucket.labelTh,
      accountCount: bucket.rows.length,
      amounts: amountsOf(bucket.rows),
    }))
    .sort(compareGroups);

  return {
    dimension,
    groups,
    total: amountsOf(rows),
    accountCount: rows.length,
  };
}

/**
 * ร้อยละการใช้งบเป็นหน่วยหนึ่งในหมื่น (basis points) เพื่อไม่ต้องใช้ทศนิยม
 *
 * นับทั้งยอดที่กันไว้และยอดที่ใช้จริง เพราะทั้งคู่เป็นเงินที่ใช้ทำอย่างอื่นไม่ได้แล้ว
 * (สมมติฐานเดียวกับ availability.ts — คำถาม Q17)
 *
 * คืน null เมื่อยังไม่ได้รับงบหรืองบที่ได้รับติดลบ การแสดง 0% หรือ ∞%
 * ในกรณีนั้นทำให้ผู้อ่านเข้าใจว่าใช้งบน้อย ทั้งที่ความจริงคือยังไม่มีงบให้เทียบ
 */
export function utilizationBasisPoints(amounts: BudgetReportAmounts): number | null {
  if (amounts.grantedSatang <= 0n) return null;

  const numerator = (amounts.reservedSatang + amounts.usedSatang) * 10_000n;
  return Number(numerator / amounts.grantedSatang);
}

/**
 * บัญชีที่ยอดคงเหลือติดลบ เรียงจากติดลบมากที่สุด
 *
 * นี่คือข้อค้นพบ F-01 ที่ทำให้ระบบนี้เกิดขึ้น — งบติดลบในสเปรดชีตไม่มีใครเห็น
 * เพราะเป็นผลลัพธ์ของสูตรในเซลล์หนึ่ง ไม่ใช่สิ่งที่ถูกยกขึ้นมาบอก
 * รายงานนี้จึงต้องยกขึ้นมาไว้บนสุด ไม่ใช่ให้ผู้อ่านไล่หาเองในตาราง
 */
export function overdrawnRows(rows: readonly BudgetReportRow[]): BudgetReportRow[] {
  return rows
    .filter((row) => availableOf(row) < 0n)
    .sort((a, b) => {
      const diff = availableOf(a) - availableOf(b);
      if (diff !== 0n) return diff < 0n ? -1 : 1;
      return a.accountCode.localeCompare(b.accountCode, 'th');
    });
}
