import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server-client';

/**
 * การเข้าถึงข้อมูลการเบิกจ่าย (PR-04d)
 *
 * ทุก query ผ่าน client ของผู้ใช้ ไม่ใช่ service-role — RLS เป็นตัวกรองว่าใครเห็นอะไร
 * (ADR 0003, 0004)
 */

export interface DisbursementRow {
  id: string;
  amountSatang: bigint;
  paidOn: string;
  documentNo: string | null;
  payeeName: string | null;
  note: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

interface RawRow {
  id: string;
  amount: string | number;
  paid_on: string;
  document_no: string | null;
  payee_name: string | null;
  note: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

const COLUMNS =
  'id, amount, paid_on, document_no, payee_name, note, created_at, voided_at, void_reason';

/**
 * แปลงบาททศนิยมจากฐานข้อมูลเป็นสตางค์จำนวนเต็ม
 *
 * ผ่าน string เสมอ ไม่ผ่าน Number — จำนวนเงินที่เป็น float ปัดเศษเพี้ยนได้
 * ในระดับสตางค์ ซึ่งเป็นสิ่งที่ ADR 0005 ห้ามไว้ทั้งระบบ
 */
function toSatang(amount: string | number): bigint {
  const text = typeof amount === 'string' ? amount : amount.toFixed(2);
  const [baht = '0', fraction = ''] = text.split('.');
  const satang = `${fraction}00`.slice(0, 2);
  return BigInt(baht) * 100n + BigInt(satang);
}

function toRow(raw: RawRow): DisbursementRow {
  return {
    id: raw.id,
    amountSatang: toSatang(raw.amount),
    paidOn: raw.paid_on,
    documentNo: raw.document_no,
    payeeName: raw.payee_name,
    note: raw.note,
    createdAt: raw.created_at,
    voidedAt: raw.voided_at,
    voidReason: raw.void_reason,
  };
}

export async function listDisbursements(procurementId: string): Promise<DisbursementRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('procurement_disbursements')
    .select(COLUMNS)
    .eq('procurement_id', procurementId)
    .order('paid_on', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw new Error(`อ่านรายการเบิกจ่ายไม่สำเร็จ: ${error.message}`);

  return (data as RawRow[]).map(toRow);
}

/**
 * ยอดที่ยังกันไว้ของรายการหนึ่ง
 *
 * คำนวณจาก `budget_movements` ผ่าน RLS ของผู้ใช้ **ไม่เรียก
 * procurement_outstanding_reserve** ซึ่งถูกเพิกถอนจาก authenticated โดยเจตนา
 * เพราะฟังก์ชันนั้นอ่านข้าม RLS ได้ ตัวเลขที่ได้ที่นี่จึงเป็นเพียงข้อมูลแสดงผล
 * ส่วนการบังคับ "จ่ายเกินยอดที่กันไว้ไม่ได้" อยู่ที่ RPC เสมอ
 */
export async function outstandingReserveSatang(procurementId: string): Promise<bigint> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('budget_movements')
    .select('id, amount, movement_type, releases_movement_id, reverses_movement_id')
    .eq('source_type', 'PROCUREMENT')
    .eq('source_id', procurementId);

  if (error) throw new Error(`อ่านยอดที่กันไว้ไม่สำเร็จ: ${error.message}`);

  const rows = data as {
    id: string;
    amount: string | number;
    movement_type: string;
    releases_movement_id: string | null;
    reverses_movement_id: string | null;
  }[];

  const reversed = new Set(
    rows.map((row) => row.reverses_movement_id).filter((id): id is string => id !== null),
  );

  let total = 0n;
  for (const row of rows) {
    if (reversed.has(row.id)) continue;
    if (row.movement_type === 'RESERVE') total += toSatang(row.amount);
    else if (row.movement_type === 'RELEASE') total -= toSatang(row.amount);
  }

  return total > 0n ? total : 0n;
}
