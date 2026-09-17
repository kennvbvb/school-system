-- =============================================================================
-- Migration 0020 — ฟังก์ชันรวมยอดงบสำหรับรายงาน
--
-- ที่มา: PR-09 ในแผนต่อเนื่อง เกณฑ์ตรวจรับข้อแรกคือ "ยอดรวม report เท่ากับ
-- ledger/query source" และข้อที่สองคือ "การเลือกปี/โครงการ/ช่วงวันไม่มีข้อมูล
-- ข้าม scope"
--
-- ทำไมต้องมี function ทั้งที่มี view budget_account_balances อยู่แล้ว:
--
--   view นั้นรวมยอด "ทั้งหมดที่เคยลง" จึงตอบคำถาม "ยอด ณ วันที่" ไม่ได้
--   ซึ่งเป็นคำถามที่การรายงานสิ้นปีงบต้องใช้ การดึงรายการเคลื่อนไหวทั้งหมด
--   ออกมารวมที่แอปแทนก็ทำไม่ได้ เพราะจำนวนแถวโตไปเรื่อย ๆ ไม่มีเพดาน
--
-- **ไม่ใช่ security definer โดยตั้งใจ** ต่างจาก function อื่นในระบบนี้:
--
--   function นี้ไม่ต้องอ่านอะไรที่ผู้เรียกอ่านเองไม่ได้ และการรวมยอดทั้งโรงเรียน
--   ไว้ในที่เดียวคือสิ่งที่ไม่ควรหลุดไปหาผู้ไม่มีสิทธิ์มากที่สุด การใช้
--   security invoker ทำให้ RLS ของ budget_accounts และ budget_movements
--   เป็นตัวบังคับจริง ถ้าใช้ definer แล้วลืมตรวจสิทธิ์ในตัว function
--   ยอดงบทั้งปีจะเปิดให้ผู้ใช้ทุกคนอ่านได้ทันที
--   มี SQL test ยืนยันว่าผู้ไม่มี budget.read ได้ศูนย์แถว
--
-- ไม่มีตารางใหม่ ไม่มีการเขียนข้อมูลใด ๆ ใน migration นี้
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ยอดงบรายบัญชี พร้อมชื่อของ scope ที่ผูกไว้ กรองตามปีงบและวันที่มีผล
--
-- คืนเพียงสามยอด ไม่มี "ยอดที่ใช้ได้" เพราะเป็นผลลบของสามยอดนี้เสมอ
-- การคืนมาเป็นยอดที่สี่เท่ากับมีนิยามที่สองของเลขเดียวกัน ซึ่งวันหนึ่งจะไม่ตรงกัน
-- ฝั่งแอปคิดที่ availableOf() ใน src/domain/budget/report.ts จุดเดียว
-- และมี SQL test เทียบว่า granted − reserved − used ที่นี่เท่ากับ
-- available_amount ของ view budget_account_balances เมื่อไม่จำกัดวันที่
-- -----------------------------------------------------------------------------

create or replace function public.budget_report_rows(
  p_fiscal_year_id uuid default null,
  p_as_of date default null,
  p_only_open boolean default false
)
returns table (
  budget_account_id uuid,
  account_code text,
  account_status public.budget_account_status,
  fiscal_year_id uuid,
  fiscal_year_code text,
  project_id uuid,
  project_name text,
  funding_source_id uuid,
  funding_source_name text,
  department_id uuid,
  department_name text,
  granted_amount numeric,
  reserved_amount numeric,
  used_amount numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with scoped as (
    select a.id, a.code, a.status, a.fiscal_year_id,
           a.project_id, a.funding_source_id, a.department_id
    from public.budget_accounts a
    where (p_fiscal_year_id is null or a.fiscal_year_id = p_fiscal_year_id)
      and (not coalesce(p_only_open, false) or a.status = 'OPEN')
  ),
  effective as (
    select
      m.budget_account_id as account_id,
      -- REVERSAL ใช้ชนิดของแถวที่มันย้อน แล้วกลับทิศด้วย sign_flip
      --
      -- การ join หาแถวต้นทาง **ไม่ถูกกรองด้วย p_as_of** โดยตั้งใจ:
      -- การย้อนรายการที่ลงไว้ก่อนวันตัดยอด ต้องรู้ชนิดของรายการนั้นให้ได้
      -- ถ้ากรองด้วย แถวย้อนจะกลายเป็นชนิด REVERSAL ที่ไม่เข้ากลุ่มใดเลย
      -- แล้วเงินก้อนนั้นจะหายไปจากยอดเงียบ ๆ
      coalesce(target.movement_type, m.movement_type) as effective_type,
      case when m.movement_type = 'REVERSAL' then -1 else 1 end as sign_flip,
      m.amount
    from public.budget_movements m
    left join public.budget_movements target on target.id = m.reverses_movement_id
    where m.budget_account_id in (select s.id from scoped s)
      -- ยอด "ณ วันที่" ตัดที่วันมีผลของแถวเอง ไม่ใช่วันที่บันทึก
      -- เพราะวันมีผลคือวันที่ใช้ทางบัญชี ส่วนวันบันทึกเป็นเวลาที่คนพิมพ์เข้าระบบ
      and (p_as_of is null or m.effective_date <= p_as_of)
  )
  select
    s.id,
    s.code,
    s.status,
    s.fiscal_year_id,
    fy.code,
    s.project_id,
    p.name_th,
    s.funding_source_id,
    f.name_th,
    s.department_id,
    d.name_th,
    coalesce(sum(
      case
        when e.effective_type in ('ALLOCATION', 'INCREASE', 'TRANSFER_IN')
          then e.amount * e.sign_flip
        when e.effective_type in ('DECREASE', 'TRANSFER_OUT') then -e.amount * e.sign_flip
        else 0
      end
    ), 0)::numeric(18, 2),
    coalesce(sum(
      case
        when e.effective_type = 'RESERVE' then e.amount * e.sign_flip
        when e.effective_type = 'RELEASE' then -e.amount * e.sign_flip
        else 0
      end
    ), 0)::numeric(18, 2),
    coalesce(sum(
      case when e.effective_type in ('COMMIT', 'ACTUAL') then e.amount * e.sign_flip else 0 end
    ), 0)::numeric(18, 2)
  from scoped s
  -- left join ทุกตารางของ scope เพราะบัญชีงบผูกครบทั้งสามไม่ได้เสมอไป
  -- บัญชีที่ผูกกับแหล่งเงินอย่างเดียวต้องยังอยู่ในรายงานตามโครงการ
  -- มิฉะนั้นยอดรวมจะน้อยกว่าความจริงโดยที่หน้าจอดูปกติทุกอย่าง
  left join public.fiscal_years fy on fy.id = s.fiscal_year_id
  left join public.projects p on p.id = s.project_id
  left join public.funding_sources f on f.id = s.funding_source_id
  left join public.departments d on d.id = s.department_id
  left join effective e on e.account_id = s.id
  group by s.id, s.code, s.status, s.fiscal_year_id, fy.code,
           s.project_id, p.name_th, s.funding_source_id, f.name_th,
           s.department_id, d.name_th
  order by s.code;
$$;

comment on function public.budget_report_rows(uuid, date, boolean) is
  'ยอดงบรายบัญชีสำหรับรายงาน — นิยามเดียวกับ view budget_account_balances '
  'แต่กรองตามปีงบและวันที่มีผลได้ security invoker เพื่อให้ RLS เป็นตัวบังคับสิทธิ์';

revoke execute on function public.budget_report_rows(uuid, date, boolean) from public;
grant execute on function public.budget_report_rows(uuid, date, boolean) to authenticated;
