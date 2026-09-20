-- =============================================================================
-- Migration 0022 — ฟังก์ชันทะเบียนจัดซื้อจัดจ้างสำหรับรายงาน
--
-- ที่มา: PR-09 ในแผนต่อเนื่อง ขอบเขต "procurement register ซื้อ/จ้าง"
-- เกณฑ์ตรวจรับที่เกี่ยวข้องโดยตรง:
--   * "ยอดรวม report เท่ากับ ledger/query source"
--   * "การเลือกปี/โครงการ/ช่วงวันไม่มีข้อมูลข้าม scope"
--
-- ทำไมต้องมี function ทั้งที่ query ตรงจากตารางก็ได้:
--
--   ทะเบียนหนึ่งแถวต้องรวมข้อมูลจากห้าแหล่ง (รายการ ยอดจากรายการย่อย ผู้ขาย
--   ปีงบ และเลขที่เอกสารสองฉบับ) การประกอบที่ฝั่งแอปด้วย supabase-js
--   ต้องยิงหลายคำขอแล้วจับคู่กันเอง ซึ่งเปิดช่องให้แถวหล่นหายเงียบ ๆ เมื่อ
--   คำขอหนึ่งถูก RLS กรองแต่อีกคำขอไม่ถูกกรอง — ความผิดพลาดที่ไม่มีอะไรฟ้อง
--   และเป็นรูปเดียวกับที่ทำให้ยอดในไฟล์จริงไม่ตรงกัน
--
-- **ไม่ใช่ security definer โดยตั้งใจ** เหตุผลเดียวกับ budget_report_rows:
--
--   ขอบเขตของแถวต้องมาจาก RLS ของ public.procurements เท่านั้น ซึ่งแยก
--   procurement.read.all ออกจาก procurement.read.own อยู่แล้ว ถ้าใช้ definer
--   แล้วลืมตรวจสิทธิ์ในตัว function ผู้ที่เห็นได้เฉพาะรายการของตนจะเห็น
--   ทะเบียนทั้งโรงเรียนทันที มี SQL test ยืนยันทั้งขอบเขตแถวและค่า prosecdef
--
-- ไม่มีตารางใหม่ ไม่มีคอลัมน์ใหม่ ไม่มีการเขียนข้อมูลใด ๆ ใน migration นี้
-- =============================================================================

-- -----------------------------------------------------------------------------
-- procurement_register_rows — หนึ่งแถวต่อหนึ่งรายการจัดซื้อจัดจ้าง
--
-- ยอดเงินมาจาก view procurement_totals ไม่ได้คำนวณซ้ำที่นี่ นิยามของยอดจึง
-- มีที่เดียวทั้งระบบ (หน้ารายการ หน้ารายละเอียด และทะเบียนตอบเลขเดียวกันเสมอ)
--
-- เลขที่เอกสาร: **เอาฉบับที่ยังใช้งานอยู่ก่อน ถ้าไม่มีจึงเอาฉบับที่ยกเลิกล่าสุด**
--
-- หนึ่งรายการมีแถวที่ไม่ใช่ VOIDED ได้ไม่เกินหนึ่งแถวต่อชนิด
-- (document_numbers_active_per_kind_idx) แต่มีแถว VOIDED ได้หลายแถว เพราะออกเลข
-- แล้วยกเลิกได้หลายรอบ
--
-- ถ้าตัดแถว VOIDED ทิ้งไปเลย รายการที่เคยมีเลขแล้วถูกยกเลิกและยังไม่ได้ออกใหม่
-- จะแสดงเหมือนกับรายการที่ไม่เคยมีใครแตะเลย ทั้งที่สองอย่างนี้ต้องการการติดตาม
-- คนละแบบ — อย่างแรกคือเรื่องที่ค้างอยู่ อย่างหลังคือเรื่องที่ยังไม่ได้เริ่ม
--
-- ใช้ lateral join ครั้งเดียวต่อชนิด ไม่ใช่ scalar subquery แยกคอลัมน์ เพราะ
-- เลขกับสถานะต้องมาจากแถวเดียวกันเสมอ การแยกเป็นสอง subquery ที่เรียงเหมือนกัน
-- ยังมีโอกาสหยิบคนละแถวได้ถ้าเวลาสร้างชนกันพอดี แล้วหน้าจอจะแสดงเลขของฉบับหนึ่ง
-- คู่กับสถานะของอีกฉบับหนึ่ง
--
-- ลำดับปิดท้ายด้วย id เพื่อให้เป็นลำดับเดียวจริง ๆ ไม่ใช่ลำดับที่ขึ้นกับ
-- แผนการทำงานของ planner
-- -----------------------------------------------------------------------------

create or replace function public.procurement_register_rows(
  p_fiscal_year_id uuid default null,
  p_classification public.procurement_classification default null,
  p_status public.procurement_status default null,
  p_date_from date default null,
  p_date_to date default null,
  p_limit integer default 1000
)
returns table (
  procurement_id uuid,
  reference text,
  subject text,
  status public.procurement_status,
  classification public.procurement_classification,
  procurement_method public.procurement_method,
  is_emergency boolean,
  fiscal_year_id uuid,
  fiscal_year_code text,
  department_name text,
  vendor_name text,
  request_date date,
  order_or_agreement_date date,
  request_memo_no text,
  request_memo_status public.document_number_status,
  purchase_order_no text,
  purchase_order_status public.document_number_status,
  grand_total numeric,
  funding_total numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.reference,
    p.subject,
    p.status,
    p.classification,
    p.procurement_method,
    p.is_emergency,
    p.fiscal_year_id,
    fy.code,
    d.name_th,
    -- ผู้ขายที่ถูกลบแบบ soft delete จะเป็น null สำหรับผู้ที่ไม่มี masters.manage
    -- ตาม RLS ของ vendors — แถวของทะเบียนยังอยู่ครบ หายเฉพาะชื่อ
    v.name,
    p.request_date,
    p.order_or_agreement_date,
    memo.document_no,
    memo.status,
    po.document_no,
    po.status,
    coalesce(t.grand_total, 0)::numeric(18, 2),
    coalesce(t.funding_total, 0)::numeric(18, 2)
  from public.procurements p
  -- left join ทุกตารางประกอบ เพราะรายการที่ยังไม่มีผู้ขาย ยังไม่ระบุฝ่ายงาน
  -- หรือยังไม่มีเลขเอกสาร **ต้องยังอยู่ในทะเบียน** — แถวที่กรอกไม่ครบคือแถว
  -- ที่ผู้ตรวจต้องเห็นมากที่สุด การใช้ inner join จะซ่อนมันทั้งหมด
  -- มี SQL test ยืนยันด้วยรายการที่ไม่มีผู้ขายและไม่มีเลขเอกสารเลย
  left join public.fiscal_years fy on fy.id = p.fiscal_year_id
  left join public.departments d on d.id = p.department_id
  left join public.vendors v on v.id = p.vendor_id
  -- procurement_totals คืนหนึ่งแถวต่อทุกรายการอยู่แล้ว (group by p.id ใน
  -- migration 0007) รายการที่ยังไม่มีรายการย่อยจึงได้ยอด 0 ไม่ใช่ไม่มีแถว
  -- left join กับ coalesce ที่นี่จึงเป็นการกันไว้เผื่อ view ถูกทำให้แคบลงวันหนึ่ง
  -- **ไม่ใช่สิ่งที่ทำงานอยู่ตอนนี้** — SQL test แยกสองแบบนี้ไม่ได้ และไม่ควรอ้างว่าได้
  left join public.procurement_totals t on t.procurement_id = p.id
  left join lateral (
    select dn.document_no, dn.status
    from public.document_numbers dn
    where dn.procurement_id = p.id
      and dn.document_kind = 'REQUEST_MEMO'
    order by (dn.status <> 'VOIDED') desc, dn.created_at desc, dn.id desc
    limit 1
  ) memo on true
  left join lateral (
    select dn.document_no, dn.status
    from public.document_numbers dn
    where dn.procurement_id = p.id
      and dn.document_kind = 'PURCHASE_ORDER'
    order by (dn.status <> 'VOIDED') desc, dn.created_at desc, dn.id desc
    limit 1
  ) po on true
  -- รายการที่ถูกลบแล้วไม่อยู่ในทะเบียน การลบเป็น soft delete เสมอ (ข้อ 4.2)
  -- ข้อมูลจึงยังอยู่ให้ audit ตรวจได้ แต่ไม่ถูกนับรวมเป็นยอดของโรงเรียน
  where p.deleted_at is null
    and (p_fiscal_year_id is null or p.fiscal_year_id = p_fiscal_year_id)
    and (p_classification is null or p.classification = p_classification)
    and (p_status is null or p.status = p_status)
    -- กรองด้วยวันที่ขอ ซึ่งเป็นช่องเดียวที่ทุกแถวมีเสมอ (not null)
    -- การกรองด้วยวันที่ออกใบสั่งซื้อจะทำให้รายการที่ยังไม่ออกใบสั่งซื้อ
    -- หายไปจากทะเบียนทั้งหมด ทั้งที่เป็นรายการที่ต้องติดตามที่สุด
    and (p_date_from is null or p.request_date >= p_date_from)
    and (p_date_to is null or p.request_date <= p_date_to)
  -- ลำดับต้องเป็นลำดับเดียวเสมอ ไม่ใช่แค่ "เรียงตามวันที่"
  --
  -- reference ไม่ซ้ำกันทั้งระบบ จึงทำให้ผลลัพธ์มีลำดับเดียว ซึ่งเป็นเงื่อนไข
  -- ที่ทำให้การตัดแถวด้วย limit มีความหมาย — ถ้าลำดับไม่แน่นอน การเรียกซ้ำ
  -- ด้วยตัวกรองเดิมอาจได้คนละชุด และผู้อ่านจะไม่มีทางรู้
  order by p.request_date desc, p.reference desc
  -- เพดานกันหน้าค้างเมื่อไม่ได้กรอง โดยไม่ให้ผู้เรียกขอเกินเพดานจริง
  -- ผู้เรียกขอ limit+1 เพื่อรู้ว่าถูกตัดหรือไม่ (ดู repository)
  limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
$$;

comment on function public.procurement_register_rows(
  uuid, public.procurement_classification, public.procurement_status, date, date, integer
) is
  'ทะเบียนจัดซื้อจัดจ้างสำหรับรายงาน — ยอดมาจาก view procurement_totals '
  'security invoker เพื่อให้ RLS ของ procurements เป็นตัวกำหนดขอบเขตแถว';

revoke execute on function public.procurement_register_rows(
  uuid, public.procurement_classification, public.procurement_status, date, date, integer
) from public;

grant execute on function public.procurement_register_rows(
  uuid, public.procurement_classification, public.procurement_status, date, date, integer
) to authenticated;
