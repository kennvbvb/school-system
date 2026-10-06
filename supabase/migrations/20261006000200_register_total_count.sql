-- =============================================================================
-- แก้ F-01 — export/หน้าจอทะเบียนตรวจไม่พบว่าข้อมูลถูกตัด
--
-- เดิม repository ขอ `limit + 1` แล้วเดาว่าถูกตัดถ้าได้แถวเกิน limit แต่มีเพดานซ้อนสองชั้น
-- ที่ทำให้เดานั้นผิดโดยไม่มีอะไรฟ้อง:
--   1. SQL clamp ที่ 5,000 — ขอ 5,001 ได้ 5,000 จึงดูเหมือน "ครบ"
--   2. PostgREST max_rows (config.toml = 1,000; production ยังไม่ตรวจ) — ตัดจำนวนแถว
--      ของ set-returning function ก่อนถึง Next.js แม้หน้าจอจะขอ 1,001
--
-- ทางแก้: ให้ฐานข้อมูลบอกจำนวนทั้งหมดเองใน statement เดียวกับแถวที่คืน
--   * procurement_register_rows เพิ่มคอลัมน์ total_count (นับก่อน limit)
--   * procurement_register_result ห่อเป็น jsonb ค่าเดียว { total_count, rows } —
--     ค่าเดียวไม่ถูก max_rows ตัด และ count กับแถวมาจาก snapshot เดียวกัน
-- =============================================================================

drop function public.procurement_register_rows(
  uuid, public.procurement_classification, public.procurement_status, date, date, integer
);

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
  funding_total numeric,
  total_count bigint
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
    coalesce(t.funding_total, 0)::numeric(18, 2),
    -- จำนวนแถวที่ตรงตัวกรองทั้งหมด **ก่อน limit** จาก statement เดียวกับแถวที่คืน
    -- (F-01) ผู้เรียกจึงรู้ได้ว่าถูกตัดหรือไม่โดยไม่ต้องขอเกินเพดานหนึ่งแถวแล้วเดา
    count(*) over ()
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
  -- เพดานกันหน้าค้างเมื่อไม่ได้กรอง — ถ้าผู้เรียกขอเกิน 5,000 แถวที่ได้คือ 5,000
  -- และ total_count บอกจำนวนจริง ผู้เรียกต้องเทียบสองค่านี้ ไม่ใช่เดาจากจำนวนแถว
  limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
$$;

comment on function public.procurement_register_rows(
  uuid, public.procurement_classification, public.procurement_status, date, date, integer
) is
  'ทะเบียนจัดซื้อจัดจ้างสำหรับรายงาน — ยอดมาจาก view procurement_totals '
  'security invoker เพื่อให้ RLS ของ procurements เป็นตัวกำหนดขอบเขตแถว '
  'total_count = จำนวนแถวที่ตรงตัวกรองทั้งหมดก่อน limit';

revoke execute on function public.procurement_register_rows(
  uuid, public.procurement_classification, public.procurement_status, date, date, integer
) from public, anon;

grant execute on function public.procurement_register_rows(
  uuid, public.procurement_classification, public.procurement_status, date, date, integer
) to authenticated;

-- -----------------------------------------------------------------------------
-- procurement_register_result — { "total_count": n, "rows": [...] } ใน jsonb ค่าเดียว
--
-- ค่า numeric ส่งเป็นข้อความ (grand_total/funding_total) เพื่อไม่ให้ผ่านการแปลงเป็น
-- double ของ JSON.parse ก่อนถึง toSatang — เหมือนที่ PostgREST ส่ง numeric เป็น string
-- ทั้งนี้ rows เรียงลำดับเดียวกับฟังก์ชันต้นทาง (วันที่ขอ ใหม่→เก่า แล้ว reference)
-- -----------------------------------------------------------------------------

create function public.procurement_register_result(
  p_fiscal_year_id uuid default null,
  p_classification public.procurement_classification default null,
  p_status public.procurement_status default null,
  p_date_from date default null,
  p_date_to date default null,
  p_limit integer default 1000
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with matched as (
    select * from public.procurement_register_rows(
      p_fiscal_year_id, p_classification, p_status, p_date_from, p_date_to, p_limit
    )
  )
  select jsonb_build_object(
    'total_count', coalesce((select max(m.total_count) from matched m), 0),
    'rows', coalesce(
      (select jsonb_agg(
         (to_jsonb(m) - 'total_count')
           || jsonb_build_object(
                'grand_total', m.grand_total::text,
                'funding_total', m.funding_total::text)
         order by m.request_date desc, m.reference desc)
       from matched m),
      '[]'::jsonb)
  );
$$;

comment on function public.procurement_register_result(
  uuid, public.procurement_classification, public.procurement_status, date, date, integer
) is
  'ทะเบียนจัดซื้อจัดจ้างแบบ jsonb ค่าเดียว { total_count, rows } — ไม่ถูก PostgREST max_rows ตัด '
  'และ total_count กับ rows มาจาก snapshot เดียวกัน security invoker (RLS กำหนดขอบเขตแถว)';

revoke execute on function public.procurement_register_result(
  uuid, public.procurement_classification, public.procurement_status, date, date, integer
) from public, anon;

grant execute on function public.procurement_register_result(
  uuid, public.procurement_classification, public.procurement_status, date, date, integer
) to authenticated;
