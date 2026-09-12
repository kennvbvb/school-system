import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import type {
  DocumentKind,
  DocumentNumberRecord,
  DocumentNumberStatus,
} from '@/domain/documents/document-register';

/**
 * การเข้าถึงทะเบียนเลขที่เอกสาร
 *
 * ทุก query ผ่าน client ของผู้ใช้ ไม่ใช่ service-role — RLS เป็นตัวกรองว่าใครเห็นอะไร
 * (ADR 0003, 0004) เงื่อนไข where ที่นี่เป็นเรื่องการแสดงผลล้วน ๆ
 */

export interface DocumentNumberRow extends DocumentNumberRecord {
  procurementId: string;
  fiscalYearId: string;
  issuedDate: string | null;
  reason: string | null;
  createdAt: string;
  voidedAt: string | null;
}

interface RawRow {
  id: string;
  procurement_id: string;
  fiscal_year_id: string;
  document_kind: DocumentKind;
  status: DocumentNumberStatus;
  document_no: string | null;
  running_no: number | null;
  issued_date: string | null;
  reason: string | null;
  created_at: string;
  voided_at: string | null;
}

const COLUMNS =
  'id, procurement_id, fiscal_year_id, document_kind, status, document_no, running_no, issued_date, reason, created_at, voided_at';

const toRow = (raw: RawRow): DocumentNumberRow => ({
  id: raw.id,
  procurementId: raw.procurement_id,
  fiscalYearId: raw.fiscal_year_id,
  documentKind: raw.document_kind,
  status: raw.status,
  documentNo: raw.document_no,
  runningNo: raw.running_no,
  issuedDate: raw.issued_date,
  reason: raw.reason,
  createdAt: raw.created_at,
  voidedAt: raw.voided_at,
});

/** เลขที่เอกสารทั้งหมดของรายการหนึ่ง รวมที่ยกเลิกแล้ว เพราะประวัติต้องเห็นครบ */
export async function listDocumentNumbers(procurementId: string): Promise<DocumentNumberRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('document_numbers')
    .select(COLUMNS)
    .eq('procurement_id', procurementId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  return (data as RawRow[] | null)?.map(toRow) ?? [];
}

/**
 * เลขที่ใช้ไปแล้วทุกชนิดในปีงบหนึ่ง สำหรับให้หน้าจอเตือนซ้ำและเสนอเลขถัดไป
 *
 * คืนทุกชนิดเอกสารในคราวเดียว แล้วให้ฟังก์ชันโดเมนกรองตามชนิดที่ผู้ใช้เลือก —
 * ถ้าดึงใหม่ทุกครั้งที่เปลี่ยนชนิด ผู้ใช้จะเห็นคำเตือนช้ากว่าที่พิมพ์
 *
 * **รวมแถวที่ยกเลิกแล้วด้วย** เพราะเลขที่ยกเลิกแล้วนำกลับมาใช้ไม่ได้ ถ้าไม่รวม
 * หน้าจอจะเสนอเลขที่ server จะปฏิเสธ และจะไม่เตือนผู้ใช้ที่พิมพ์เลขนั้นเข้ามาเอง
 *
 * ดึงเฉพาะช่องที่การตรวจซ้ำและการเสนอเลขต้องใช้ ไม่ส่งเหตุผลหรือวันที่ไปที่ browser
 * โดยไม่จำเป็น
 */
export async function listNumbersInScope(fiscalYearId: string): Promise<DocumentNumberRecord[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('document_numbers')
    .select('id, document_kind, status, document_no, running_no')
    .eq('fiscal_year_id', fiscalYearId)
    .not('document_no', 'is', null)
    .order('running_no', { ascending: false, nullsFirst: false });

  if (error) throw new Error(error.message);

  return (
    (
      data as
        Pick<RawRow, 'id' | 'document_kind' | 'status' | 'document_no' | 'running_no'>[] | null
    )?.map((raw) => ({
      id: raw.id,
      documentKind: raw.document_kind,
      status: raw.status,
      documentNo: raw.document_no,
      runningNo: raw.running_no,
    })) ?? []
  );
}
