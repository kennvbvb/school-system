-- =============================================================================
-- Migration 0023 — ฟังก์ชันรายงานสถานะเอกสาร
--
-- ที่มา: PR-09 ในแผนต่อเนื่อง ขอบเขต "document status/missing documents"
-- ปิดข้อค้นพบสองข้อที่ทะเบียนจัดซื้อจัดจ้าง (PR-09b) ตั้งใจไม่ทำ:
--
--   F-12  ลำดับซ้ำ — ลำดับ 139 ปรากฏ 2 แถวในไฟล์จริง
--   F-13  เลขกระโดด — `๑๓/๒๕๖๙` แล้วต่อด้วย `๙๑/๒๕๖๙`, `๙๒/๒๕๖๙`
--
-- **ทั้งสองข้อตรวจจาก running_no ซึ่งเป็นค่าที่ระบบเดาจากข้อความ**
-- (comment ของคอลัมน์บอกไว้ตรง ๆ ว่า "เป็นค่าเดา ใช้กับรายงานและค่าเสนอแนะ
-- เท่านั้น") รายงานนี้จึงเป็นการยกขึ้นมาให้คนตรวจ ไม่ใช่การตัดสิน และไม่มี
-- ฟังก์ชันใดในไฟล์นี้ที่แก้ข้อมูล — ตรงกับกลไกที่ระบุไว้สำหรับ F-13 คือ
-- "ห้ามแก้อัตโนมัติโดยเดา"
--
-- **ไม่ใช่ security definer โดยตั้งใจ** เหตุผลเดียวกับ budget_report_rows()
-- และ procurement_register_rows() — RLS ของ document_numbers เป็นตัวกำหนด
-- ขอบเขตแถว ซึ่งเปิดให้ผู้ถือ documents.issue เห็นทั้งเล่มอยู่แล้วโดยเจตนา
-- (policy document_numbers_select_register ใน migration 0014)
--
-- ไม่มีตารางใหม่ ไม่มีคอลัมน์ใหม่ ไม่มีการเขียนข้อมูลใด ๆ ใน migration นี้
-- =============================================================================

-- -----------------------------------------------------------------------------
-- เพดานความกว้างของช่วงที่ยอมไล่ทีละเลข
--
-- เลขที่กรอกผิดเพียงตัวเดียว (เช่นพิมพ์ 20569 แทน 2/2569) ทำให้ช่วง min..max
-- กว้างเป็นหลักหมื่น การ generate_series ข้ามช่วงนั้นจะสร้างแถวจำนวนมหาศาล
-- และทำให้รายงานทั้งหน้าค้าง — ซึ่งเป็นผลจากข้อมูลผิดหนึ่งแถว
--
-- **จำนวนเลขที่ขาดยังคำนวณได้ถูกต้องเสมอ** เพราะใช้เลขคณิต (max − min + 1 − used)
-- ไม่ได้นับจากรายการ ที่หายไปเมื่อเกินเพดานคือ "ตัวอย่างว่าขาดเลขไหนบ้าง"
-- เท่านั้น หน้าจอจึงยังบอกได้ว่ามีปัญหา แค่ไม่ไล่รายตัวให้
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- document_sequence_rows — หนึ่งแถวต่อหนึ่งคู่ (ปีงบ × ชนิดเอกสาร)
--
-- ขอบเขตนี้ตรงกับ document_numbers_unique_idx ที่กันเลขซ้ำอยู่จริง ถ้ารายงาน
-- ใช้ขอบเขตอื่น มันจะรายงานช่องว่างของลำดับที่ระบบไม่ได้คุมอยู่
--
-- **เลขที่ "ถูกใช้ไปแล้ว" คือ ISSUED และ VOIDED** ไม่ใช่ ISSUED อย่างเดียว
-- เลขที่ยกเลิกแล้วห้ามนำกลับมาใช้ (comment ของ document_numbers_unique_idx)
-- มันจึงไม่ใช่ช่องว่าง ถ้านับเป็นช่องว่าง รายงานจะชวนให้คนไปกรอกเลขที่ระบบ
-- จะปฏิเสธในวินาทีถัดไป
--
-- **ไม่กรองรายการที่ถูกลบแบบ soft delete ออก** ต่างจากทะเบียนจัดซื้อจัดจ้าง
-- เพราะเลขของรายการที่ถูกลบก็ยังกินที่ในดัชนีและนำกลับมาใช้ไม่ได้ การกรองออก
-- จะทำให้รายงานประกาศช่องว่างปลอมที่ไม่มีทางเติมได้
-- -----------------------------------------------------------------------------

create or replace function public.document_sequence_rows(
  p_fiscal_year_id uuid default null,
  p_document_kind public.document_kind default null
)
returns table (
  fiscal_year_id uuid,
  fiscal_year_code text,
  document_kind public.document_kind,
  issued_count integer,
  voided_count integer,
  pending_count integer,
  not_required_count integer,
  min_running integer,
  max_running integer,
  used_running_count integer,
  missing_count integer,
  missing_sample integer[],
  duplicate_running integer[],
  unparsed_count integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with scoped as (
    select dn.fiscal_year_id, dn.document_kind, dn.status, dn.running_no
    from public.document_numbers dn
    where (p_fiscal_year_id is null or dn.fiscal_year_id = p_fiscal_year_id)
      and (p_document_kind is null or dn.document_kind = p_document_kind)
  ),
  -- เลขที่ถูกใช้ไปแล้วและนำกลับมาใช้ไม่ได้
  taken as (
    select s.fiscal_year_id, s.document_kind, s.running_no
    from scoped s
    where s.status in ('ISSUED', 'VOIDED') and s.running_no is not null
  ),
  counts as (
    select
      s.fiscal_year_id,
      s.document_kind,
      count(*) filter (where s.status = 'ISSUED')::integer as issued_count,
      count(*) filter (where s.status = 'VOIDED')::integer as voided_count,
      count(*) filter (where s.status = 'PENDING')::integer as pending_count,
      count(*) filter (where s.status = 'NOT_REQUIRED')::integer as not_required_count,
      count(*) filter (
        where s.status in ('ISSUED', 'VOIDED') and s.running_no is null
      )::integer as unparsed_count
    from scoped s
    group by s.fiscal_year_id, s.document_kind
  ),
  bounds as (
    select
      t.fiscal_year_id,
      t.document_kind,
      min(t.running_no)::integer as min_running,
      max(t.running_no)::integer as max_running,
      count(distinct t.running_no)::integer as used_running_count
    from taken t
    group by t.fiscal_year_id, t.document_kind
  ),
  -- ตัวอย่างเลขที่ขาด — ไล่ทีละเลขเฉพาะช่วงที่ไม่กว้างเกินไป (ดูหมายเหตุด้านบน)
  missing as (
    select b.fiscal_year_id, b.document_kind,
           array_agg(g.n order by g.n) as sample
    from bounds b
    cross join lateral (
      select n
      from generate_series(b.min_running, b.max_running) as n
      where b.max_running - b.min_running <= 10000
        and not exists (
          select 1 from taken t
          where t.fiscal_year_id = b.fiscal_year_id
            and t.document_kind = b.document_kind
            and t.running_no = n
        )
      order by n
      limit 200
    ) as g(n)
    group by b.fiscal_year_id, b.document_kind
  ),
  -- เลขลำดับที่มีมากกว่าหนึ่งแถว — คืน **เลขละหนึ่งครั้ง** ไม่ใช่ซ้ำตามจำนวนแถว
  -- สิ่งที่ผู้อ่านต้องรู้คือ "เลขไหนซ้ำ" ส่วนจำนวนแถวดูได้จากรายการเอกสารของเลขนั้น
  duplicates as (
    select t.fiscal_year_id, t.document_kind, t.running_no
    from taken t
    group by t.fiscal_year_id, t.document_kind, t.running_no
    having count(*) > 1
  ),
  duplicates_grouped as (
    select d.fiscal_year_id, d.document_kind,
           array_agg(d.running_no order by d.running_no) as duplicate_running
    from duplicates d
    group by d.fiscal_year_id, d.document_kind
  )
  select
    c.fiscal_year_id,
    fy.code,
    c.document_kind,
    c.issued_count,
    c.voided_count,
    c.pending_count,
    c.not_required_count,
    b.min_running,
    b.max_running,
    coalesce(b.used_running_count, 0),
    -- จำนวนเลขที่ขาดคิดด้วยเลขคณิต ไม่ได้นับจากรายการตัวอย่าง
    -- จึงถูกต้องเสมอแม้ช่วงจะกว้างเกินกว่าจะไล่ทีละเลข
    case
      when b.min_running is null then 0
      else greatest(b.max_running - b.min_running + 1 - b.used_running_count, 0)
    end::integer,
    coalesce(m.sample, array[]::integer[]),
    coalesce(dg.duplicate_running, array[]::integer[]),
    c.unparsed_count
  -- counts เป็นแกน ไม่ใช่ bounds — ลำดับที่มีแต่แถว PENDING ยังไม่มีเลขสักเลข
  -- แต่เป็นลำดับที่ต้องเห็นมากที่สุด เพราะมีเอกสารค้างรอออกเลขอยู่
  from counts c
  left join public.fiscal_years fy on fy.id = c.fiscal_year_id
  left join bounds b
    on b.fiscal_year_id = c.fiscal_year_id and b.document_kind = c.document_kind
  left join missing m
    on m.fiscal_year_id = c.fiscal_year_id and m.document_kind = c.document_kind
  left join duplicates_grouped dg
    on dg.fiscal_year_id = c.fiscal_year_id and dg.document_kind = c.document_kind
  order by fy.code desc nulls last, c.document_kind;
$$;

comment on function public.document_sequence_rows(uuid, public.document_kind) is
  'สรุปลำดับเลขที่เอกสารต่อ (ปีงบ × ชนิด) พร้อมเลขที่ขาด (F-13) และเลขลำดับซ้ำ (F-12) '
  'อ้างอิง running_no ซึ่งเป็นค่าเดา จึงใช้เพื่อยกขึ้นมาให้คนตรวจเท่านั้น';

revoke execute on function public.document_sequence_rows(uuid, public.document_kind) from public;
grant execute on function public.document_sequence_rows(uuid, public.document_kind) to authenticated;

-- -----------------------------------------------------------------------------
-- document_number_exceptions — เอกสารที่ไม่ได้อยู่ในสถานะ ISSUED
--
-- ทั้งสามสถานะต้องมีเหตุผลกำกับเสมอตาม document_numbers_reason_required
-- รายงานนี้จึงเป็นที่เดียวที่อ่านเหตุผลทั้งหมดต่อกันได้ ซึ่งเป็นสิ่งที่ผู้ตรวจทำ
--
-- **กรองรายการที่ถูกลบแบบ soft delete ออก** ต่างจาก document_sequence_rows
-- ด้านบนโดยตั้งใจ: การวิเคราะห์ลำดับต้องนับเลขที่ถูกกินไปแล้วทุกเลขจึงจะไม่
-- ประกาศช่องว่างปลอม ส่วนรายการนี้เป็นงานที่ต้องตามต่อ และไม่มีใครต้องตาม
-- เอกสารของรายการที่ถูกลบไปแล้ว
-- -----------------------------------------------------------------------------

create or replace function public.document_number_exceptions(
  p_fiscal_year_id uuid default null,
  p_document_kind public.document_kind default null,
  p_status public.document_number_status default null,
  p_limit integer default 500
)
returns table (
  document_number_id uuid,
  fiscal_year_code text,
  document_kind public.document_kind,
  status public.document_number_status,
  document_no text,
  running_no integer,
  reason text,
  procurement_id uuid,
  procurement_reference text,
  procurement_subject text,
  created_at timestamptz,
  voided_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    dn.id,
    fy.code,
    dn.document_kind,
    dn.status,
    dn.document_no,
    dn.running_no,
    dn.reason,
    dn.procurement_id,
    -- left join เพราะผู้ถือ documents.issue เห็นทะเบียนเลขทั้งเล่มได้ แต่ไม่จำเป็น
    -- ต้องอ่านรายการต้นทางทุกรายการ — แถวยังอยู่ครบ หายเฉพาะชื่อเรื่องและเลขอ้างอิง
    p.reference,
    p.subject,
    dn.created_at,
    dn.voided_at
  from public.document_numbers dn
  left join public.fiscal_years fy on fy.id = dn.fiscal_year_id
  left join public.procurements p on p.id = dn.procurement_id
  where dn.status <> 'ISSUED'
    and (p.id is null or p.deleted_at is null)
    and (p_fiscal_year_id is null or dn.fiscal_year_id = p_fiscal_year_id)
    and (p_document_kind is null or dn.document_kind = p_document_kind)
    and (p_status is null or dn.status = p_status)
  -- เก่าสุดขึ้นก่อน เพราะเอกสารที่ค้างมานานคือเอกสารที่เสี่ยงที่สุดว่าจะไม่มีใคร
  -- กลับไปตาม ส่วน id ปิดท้ายเพื่อให้เป็นลำดับเดียวจริง ๆ ไม่ใช่ลำดับที่ขึ้นกับ planner
  order by dn.created_at, dn.id
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;

comment on function public.document_number_exceptions(
  uuid, public.document_kind, public.document_number_status, integer
) is
  'เอกสารที่ยังไม่ได้เลข ไม่ต้องมีเลข หรือยกเลิกเลขแล้ว พร้อมเหตุผลที่บันทึกไว้';

revoke execute on function public.document_number_exceptions(
  uuid, public.document_kind, public.document_number_status, integer
) from public;

grant execute on function public.document_number_exceptions(
  uuid, public.document_kind, public.document_number_status, integer
) to authenticated;
