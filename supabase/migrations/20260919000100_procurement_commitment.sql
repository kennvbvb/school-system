-- =============================================================================
-- Migration 0021 — การผูกพันงบตอนออกใบสั่งซื้อ (PR-04e)
--
-- ที่มา: ชนิดรายการ `COMMIT` ถูกประกาศไว้ตั้งแต่ migration 0005 ทั้งใน enum
-- และในสูตรคิดยอด แต่ **ไม่มีโค้ดบรรทัดใดสร้างมันเลย** ระบบกระโดดจาก
-- `RESERVE` (ตอนอนุมัติ) ไป `ACTUAL` (ตอนจ่าย) ตรง ๆ ช่วงที่ออกใบสั่งซื้อแล้ว
-- แต่ยังไม่จ่ายจึงถูกนับเป็น "กันไว้" ทั้งที่ทางบัญชีคือ "ผูกพัน" ซึ่งเป็นภาระ
-- ที่โรงเรียนยกเลิกเองไม่ได้แล้ว และต้องแยกกันในรายงานสิ้นปี
--
-- ledger เป็น append-only ยอดที่ถืออยู่จึงย้ายถังไม่ได้โดยไม่คืนแล้วลงใหม่
-- การออกใบสั่งซื้อจึงลง `RELEASE` แล้วตามด้วย `COMMIT` จำนวนเท่ากันทันที
-- ในทรานแซกชันเดียว — **ยอดที่ใช้ได้ต้องไม่ขยับ** มี SQL test ยืนยันด้วยตัวเลขจริง
--
-- ผลที่ลามไปทั้งเส้น และเป็นเหตุผลที่ migration นี้ยาว:
--
--   * `RELEASE` ต้องคืนยอดให้ `COMMIT` ได้ ไม่ใช่เฉพาะ `RESERVE`
--   * การจัดกลุ่มของ `RELEASE` ต้องตามแถวที่มันคืนให้ มิฉะนั้นการคืนยอดผูกพัน
--     จะไปลด "ยอดที่กันไว้" จนติดลบ และ "ยอดที่ใช้ไป" จะค้างสูงเกินจริง
--   * เส้นทางคืนยอดตอนยกเลิก และการเบิกจ่าย เดิมมองหาเฉพาะแถว `RESERVE`
--     ถ้าแก้ครึ่งเดียวจะได้อาการ "ผูกพันไว้ตลอดกาล" ซึ่งเป็นบั๊กรูปเดียวกับที่
--     migration 0019 เพิ่งปิดไป
-- =============================================================================

-- -----------------------------------------------------------------------------
-- สถานะที่ถือยอดแต่ละชนิด
--
-- คู่กับ `STATUSES_HOLDING_RESERVATION` / `STATUSES_HOLDING_COMMITMENT`
-- ใน src/domain/procurement/status.ts และมี parity test อ่านไฟล์นี้มาเทียบ
--
-- สองรายการนี้ต้องไม่ซ้อนทับกัน สถานะที่ถือทั้งสองชนิดจะทำให้รายการเดียว
-- กินงบสองเท่า — มีทั้ง unit test และ SQL test บังคับ
-- -----------------------------------------------------------------------------

create or replace function public.status_holds_reservation(p_status public.procurement_status)
returns boolean
language sql
immutable
as $$
  -- เหลือเพียง APPROVED — ตั้งแต่ ISSUED เป็นต้นไปถือเป็นยอดผูกพันแทน
  select p_status in ('APPROVED');
$$;

create or replace function public.status_holds_commitment(p_status public.procurement_status)
returns boolean
language sql
immutable
as $$
  select p_status in ('ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED');
$$;

comment on function public.status_holds_commitment(public.procurement_status) is
  'สถานะที่ถือยอดผูกพันงบ — คู่กับ STATUSES_HOLDING_COMMITMENT ในชั้นโดเมน';

-- -----------------------------------------------------------------------------
-- ยอดคงเหลือ — `RELEASE` เข้ากลุ่มเดียวกับแถวที่มันคืนยอดให้
--
-- เดิม `RELEASE` ถูกตรึงให้อยู่กลุ่ม "ยอดที่กันไว้" เสมอ ซึ่งถูกตราบที่ยังไม่มี
-- ใครคืนยอดให้การผูกพัน พอมี การคืนยอดผูกพันจะไปลดยอดที่กันไว้จนติดลบ
-- และยอดที่ใช้ไปจะค้างสูงเกินจริง ทั้งที่เงินก้อนนั้นไม่ได้ถูกใช้แล้ว
--
-- `REVERSAL` ของ `RELEASE` ต้องมองทะลุไปถึงแถวที่ RELEASE นั้นคืนให้ด้วย
-- จึงใช้ coalesce ของ releases_movement_id ทั้งของตัวเองและของแถวที่ถูกย้อน
--
-- กติกาเดียวกันนี้อยู่ใน src/domain/budget/availability.ts
-- -----------------------------------------------------------------------------

create or replace view public.budget_account_balances as
with effective as (
  select
    m.budget_account_id,
    coalesce(rev.movement_type, m.movement_type) as effective_type,
    case when m.movement_type = 'REVERSAL' then -1 else 1 end as sign_flip,
    rel.movement_type as release_target_type,
    m.amount
  from public.budget_movements m
  left join public.budget_movements rev on rev.id = m.reverses_movement_id
  left join public.budget_movements rel
    on rel.id = coalesce(m.releases_movement_id, rev.releases_movement_id)
)
select
  a.id as budget_account_id,
  coalesce(sum(
    case
      when e.effective_type in ('ALLOCATION', 'INCREASE', 'TRANSFER_IN') then e.amount * e.sign_flip
      when e.effective_type in ('DECREASE', 'TRANSFER_OUT') then -e.amount * e.sign_flip
      else 0
    end
  ), 0)::numeric(18, 2) as granted_amount,
  coalesce(sum(
    case
      when e.effective_type = 'RESERVE' then e.amount * e.sign_flip
      when e.effective_type = 'RELEASE' and e.release_target_type is distinct from 'COMMIT'
        then -e.amount * e.sign_flip
      else 0
    end
  ), 0)::numeric(18, 2) as reserved_amount,
  coalesce(sum(
    case
      when e.effective_type in ('COMMIT', 'ACTUAL') then e.amount * e.sign_flip
      when e.effective_type = 'RELEASE' and e.release_target_type = 'COMMIT'
        then -e.amount * e.sign_flip
      else 0
    end
  ), 0)::numeric(18, 2) as used_amount,
  coalesce(sum(
    case
      when e.effective_type in ('ALLOCATION', 'INCREASE', 'TRANSFER_IN') then e.amount * e.sign_flip
      when e.effective_type in ('DECREASE', 'TRANSFER_OUT', 'RESERVE', 'COMMIT', 'ACTUAL')
        then -e.amount * e.sign_flip
      when e.effective_type = 'RELEASE' then e.amount * e.sign_flip
      else 0
    end
  ), 0)::numeric(18, 2) as available_amount
from public.budget_accounts a
left join effective e on e.budget_account_id = a.id
group by a.id;

comment on view public.budget_account_balances is
  'ยอดงบที่คำนวณจาก ledger — นิยามเดียวกับ src/domain/budget/availability.ts';

-- -----------------------------------------------------------------------------
-- ฟังก์ชันรายงาน — ใช้กติกาการจัดกลุ่มชุดเดียวกับ view
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
      -- การ join หาแถวต้นทาง **ไม่ถูกกรองด้วย p_as_of** โดยตั้งใจ (ดู migration 0020)
      coalesce(rev.movement_type, m.movement_type) as effective_type,
      case when m.movement_type = 'REVERSAL' then -1 else 1 end as sign_flip,
      rel.movement_type as release_target_type,
      m.amount
    from public.budget_movements m
    left join public.budget_movements rev on rev.id = m.reverses_movement_id
    left join public.budget_movements rel
      on rel.id = coalesce(m.releases_movement_id, rev.releases_movement_id)
    where m.budget_account_id in (select s.id from scoped s)
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
        when e.effective_type = 'RELEASE' and e.release_target_type is distinct from 'COMMIT'
          then -e.amount * e.sign_flip
        else 0
      end
    ), 0)::numeric(18, 2),
    coalesce(sum(
      case
        when e.effective_type in ('COMMIT', 'ACTUAL') then e.amount * e.sign_flip
        when e.effective_type = 'RELEASE' and e.release_target_type = 'COMMIT'
          then -e.amount * e.sign_flip
        else 0
      end
    ), 0)::numeric(18, 2)
  from scoped s
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

revoke execute on function public.budget_report_rows(uuid, date, boolean) from public;
grant execute on function public.budget_report_rows(uuid, date, boolean) to authenticated;


-- -----------------------------------------------------------------------------
-- ออก budget_post_movement ใหม่ — สองจุด
--
--   1. `COMMIT` ลงได้ในนามของ workflow เช่นเดียวกับ RESERVE/RELEASE
--      เพราะผู้ที่กดออกใบสั่งซื้อถือ documents.issue ไม่ใช่ budget.manage
--   2. `RELEASE` คืนยอดให้ `COMMIT` ได้ ไม่ใช่เฉพาะ `RESERVE`
--
-- ส่วนที่เหลือคงเดิมทุกบรรทัดจาก migration 0019
-- -----------------------------------------------------------------------------

create or replace function public.budget_post_movement(
  p_account_id uuid,
  p_type public.budget_movement_type,
  p_amount numeric,
  p_effective_date date,
  p_reason text default null,
  p_source_type text default null,
  p_source_id uuid default null,
  p_paired_movement_id uuid default null,
  p_reverses_movement_id uuid default null,
  p_releases_movement_id uuid default null,
  p_approval_reference text default null,
  p_request_id text default 'system'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.budget_accounts%rowtype;
  v_fiscal public.fiscal_years%rowtype;
  v_target public.budget_movements%rowtype;
  v_released numeric;
  v_projected numeric;
  v_direction integer;
  v_movement_id uuid;
  v_actor uuid := auth.uid();
  v_system_posting boolean :=
    coalesce(current_setting('app.budget_workflow_posting', true), 'off') = 'on'
    /* COMMIT อยู่ในกลุ่มนี้ด้วยตั้งแต่ PR-04e — ผู้ที่กดออกใบสั่งซื้อถือสิทธิ์
       documents.issue ไม่ใช่ budget.manage การผูกพันงบจึงต้องลงได้ในนามของ workflow
       เช่นเดียวกับการกันยอดตอนอนุมัติ */
    and p_type in ('RESERVE', 'RELEASE', 'COMMIT');
begin
  if not v_system_posting and not public.has_permission('budget.manage') then
    raise exception 'ไม่มีสิทธิ์ลงรายการเคลื่อนไหวงบ' using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'จำนวนเงินต้องมากกว่าศูนย์ ทิศทางมาจากชนิดรายการ'
      using errcode = 'check_violation';
  end if;

  /*
   * การโอนงบต้องมาจาก budget_transfer เท่านั้น
   *
   * ใช้ค่าตั้งระดับทรานแซกชันเป็นเครื่องหมายว่ากำลังอยู่ในการโอนจริง
   * ผู้เรียกผ่าน PostgREST ตั้งค่านี้เองไม่ได้ เพราะ set_config อยู่ใน pg_catalog
   * ซึ่งไม่ได้ถูก expose เป็น RPC
   */
  if p_type in ('TRANSFER_IN', 'TRANSFER_OUT')
     and coalesce(current_setting('app.budget_transfer_active', true), 'off') <> 'on' then
    raise exception 'การโอนงบต้องทำผ่าน budget_transfer เพื่อให้เกิดเป็นคู่ในทรานแซกชันเดียว'
      using errcode = 'check_violation';
  end if;

  -- ล็อกบัญชีก่อนอ่านยอด — จุดนี้คือสิ่งที่กัน race condition
  select * into v_account from public.budget_accounts where id = p_account_id for update;

  if not found then
    raise exception 'ไม่พบบัญชีงบที่ระบุ' using errcode = 'foreign_key_violation';
  end if;

  if v_account.status = 'CLOSED' then
    raise exception 'บัญชีงบนี้ปิดแล้ว ลงรายการเพิ่มไม่ได้' using errcode = 'restrict_violation';
  end if;

  select * into v_fiscal from public.fiscal_years where id = v_account.fiscal_year_id;

  if p_effective_date < v_fiscal.start_date or p_effective_date > v_fiscal.end_date then
    raise exception 'วันที่มีผล % อยู่นอกช่วงปีงบประมาณ %', p_effective_date, v_fiscal.code
      using errcode = 'check_violation';
  end if;

  -- ปีงบที่ปิดแล้วต้องใช้สิทธิ์เฉพาะ ไม่ใช่ปิดตายเพราะบางครั้งต้องแก้ย้อนหลังจริง
  if v_fiscal.status = 'CLOSED' and not public.has_permission('budget.override') then
    raise exception 'ปีงบประมาณ % ปิดแล้ว ลงรายการย้อนหลังไม่ได้', v_fiscal.code
      using errcode = 'restrict_violation';
  end if;

  /*
   * การย้อนรายการต้องอ้างแถวต้นทางของบัญชีเดียวกัน
   *
   * ถ้าไม่ตรวจบัญชี การย้อนรายการของบัญชีอื่นจะไปเปลี่ยนยอดของบัญชีนี้
   * โดยไม่มีรายการต้นทางของตัวเองรองรับ ทำให้ยอดสองบัญชีคลาดเคลื่อนพร้อมกัน
   */
  if p_type = 'REVERSAL' then
    if p_reverses_movement_id is null then
      raise exception 'รายการย้อนต้องระบุว่าย้อนรายการใด' using errcode = 'check_violation';
    end if;

    select * into v_target from public.budget_movements where id = p_reverses_movement_id;

    if not found then
      raise exception 'ไม่พบรายการต้นทางที่รายการย้อนอ้างถึง'
        using errcode = 'foreign_key_violation';
    end if;

    if v_target.budget_account_id <> p_account_id then
      raise exception 'ย้อนได้เฉพาะรายการของบัญชีงบเดียวกันเท่านั้น'
        using errcode = 'check_violation';
    end if;

    if v_target.movement_type = 'REVERSAL' then
      raise exception 'ย้อนรายการย้อนอีกชั้นไม่ได้' using errcode = 'check_violation';
    end if;

    if btrim(coalesce(p_reason, '')) = '' then
      raise exception 'การย้อนรายการต้องระบุเหตุผล' using errcode = 'check_violation';
    end if;
  end if;

  /*
   * การคืนยอดต้องคืนให้การกันยอดของบัญชีเดียวกัน และคืนรวมกันไม่เกินที่กันไว้
   *
   * ยอดที่คืนเกินจะกลายเป็นงบที่ใช้ได้เพิ่มขึ้นจากรายการที่ไม่เคยมีอยู่จริง
   */
  if p_type = 'RELEASE' then
    if p_releases_movement_id is null then
      raise exception 'การคืนยอดต้องระบุว่าคืนให้รายการกันยอดใด'
        using errcode = 'check_violation';
    end if;

    select * into v_target from public.budget_movements where id = p_releases_movement_id;

    if not found then
      raise exception 'ไม่พบรายการกันยอดที่อ้างถึง' using errcode = 'foreign_key_violation';
    end if;

    /*
     * คืนยอดได้ทั้งการกันยอดและการผูกพันงบ แต่ต้องเป็นบัญชีเดียวกัน
     *
     * ACTUAL ไม่อยู่ในกลุ่มนี้โดยตั้งใจ — เงินที่จ่ายออกไปแล้วคืนด้วย RELEASE ไม่ได้
     * ต้องย้อนรายการ ซึ่งทิ้งร่องรอยว่ามีการจ่ายผิดเกิดขึ้นจริงให้ผู้ตรวจสอบเห็น
     */
    if v_target.budget_account_id <> p_account_id
       or v_target.movement_type not in ('RESERVE', 'COMMIT') then
      raise exception 'คืนยอดได้เฉพาะรายการกันยอดหรือผูกพันงบของบัญชีงบเดียวกันเท่านั้น'
        using errcode = 'check_violation';
    end if;

    /*
     * ไม่นับการคืนยอดที่ถูกย้อนไปแล้ว (migration 0019)
     *
     * การย้อน RELEASE ทำให้ยอดกลับไปเป็น "กันไว้" ตามเดิม ถ้ายังนับแถวนั้นอยู่
     * จะเท่ากับว่าคืนไปแล้วทั้งที่ผลถูกลบไปแล้ว ผลคือยกเลิกการเบิกจ่ายแล้ว
     * จ่ายใหม่ไม่ได้อีกเลย ทั้งที่ยอดที่กันไว้กลับมาครบ — เป็นทางตันที่ผู้ใช้
     * แก้เองไม่ได้ และเป็นเหตุผลเดียวกับที่ procurement_outstanding_reserve
     * ก็ไม่นับแถวที่ถูกย้อน ทั้งสองที่ต้องนิยาม "คืนไปแล้ว" ตรงกัน
     */
    select coalesce(sum(r.amount), 0) into v_released
    from public.budget_movements r
    where r.releases_movement_id = p_releases_movement_id
      and not exists (
        select 1 from public.budget_movements rr where rr.reverses_movement_id = r.id
      );

    if v_released + p_amount > v_target.amount then
      raise exception 'คืนยอดเกินจำนวนที่กันไว้ไม่ได้ (กันไว้ % คืนแล้ว %)',
        to_char(v_target.amount, 'FM999999999990.00'),
        to_char(v_released, 'FM999999999990.00')
        using errcode = 'check_violation';
    end if;
  end if;

  v_direction := case
    when p_type in ('ALLOCATION', 'INCREASE', 'TRANSFER_IN', 'RELEASE') then 1
    when p_type = 'REVERSAL' then
      case
        when v_target.movement_type in ('ALLOCATION', 'INCREASE', 'TRANSFER_IN', 'RELEASE')
          then -1
        else 1
      end
    else -1
  end;

  v_projected := public.budget_available(p_account_id) + (v_direction * p_amount);

  if v_projected < 0 and not public.has_permission('budget.override') then
    raise exception 'ยอดงบคงเหลือไม่พอ ขาดอีก % บาท', to_char(-v_projected, 'FM999999999990.00')
      using errcode = 'check_violation';
  end if;

  -- การลงเกินยอดต้องมีเหตุผลเสมอ สิทธิ์อย่างเดียวไม่พอสำหรับการตรวจสอบย้อนหลัง
  if v_projected < 0 and btrim(coalesce(p_reason, '')) = '' then
    raise exception 'การลงรายการเกินยอดคงเหลือต้องระบุเหตุผล'
      using errcode = 'check_violation';
  end if;

  insert into public.budget_movements (
    budget_account_id, movement_type, amount, effective_date,
    source_type, source_id, paired_movement_id, reverses_movement_id,
    releases_movement_id, reason, approval_reference, created_by
  ) values (
    p_account_id, p_type, p_amount, p_effective_date,
    p_source_type, p_source_id, p_paired_movement_id, p_reverses_movement_id,
    p_releases_movement_id, p_reason, p_approval_reference, v_actor
  )
  returning id into v_movement_id;

  insert into public.audit_events (
    request_id, actor_id, action, entity_type, entity_id, after_json, metadata_json
  ) values (
    p_request_id,
    v_actor,
    'entity.create',
    'budget_movement',
    v_movement_id::text,
    jsonb_build_object(
      'budget_account_id', p_account_id,
      'movement_type', p_type,
      'amount', p_amount,
      'effective_date', p_effective_date
    ),
    jsonb_build_object(
      'available_after', v_projected,
      'overdrawn', v_projected < 0,
      'reason', p_reason,
      'posted_by_workflow', v_system_posting
    )
  );

  return v_movement_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- procurement_outstanding_hold — ยอดที่ยัง "ถือไว้" แยกรายแถว
--
-- แทนที่ `procurement_outstanding_reserve` ของ migration 0019 ซึ่งมองหาเฉพาะ
-- แถว `RESERVE` พอการออกใบสั่งซื้อแปลงยอดเป็น `COMMIT` ฟังก์ชันเดิมจะคืนศูนย์แถว
-- แล้วทั้งการเบิกจ่ายและการคืนยอดตอนยกเลิกจะเงียบ ไม่ใช่ล้ม — เงินจะค้างผูกพัน
-- อยู่ตลอดกาลโดยไม่มีใครเห็น
--
-- "ยังถือไว้" = จำนวนที่ลงไว้ ลบที่ RELEASE ไปแล้ว โดยไม่นับแถวที่ถูกย้อน
-- ทั้งแถวต้นทางเองและแถว RELEASE ที่ถูกย้อน
--
-- ตรรกะนี้เคยอยู่สองที่ (ในนี้และใน procurement_release_budget แบบ inline)
-- ตอนนี้เหลือที่เดียว ทั้งสองเส้นทางจึงตอบเหมือนกันเสมอโดยโครงสร้าง
-- -----------------------------------------------------------------------------

drop function if exists public.procurement_outstanding_reserve(uuid);

create or replace function public.procurement_outstanding_hold(p_procurement_id uuid)
returns table (
  budget_account_id uuid,
  hold_id uuid,
  hold_type public.budget_movement_type,
  outstanding numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    m.budget_account_id,
    m.id,
    m.movement_type,
    m.amount - coalesce((
      select sum(r.amount) from public.budget_movements r
      where r.releases_movement_id = m.id
        and not exists (
          select 1 from public.budget_movements rr where rr.reverses_movement_id = r.id
        )
    ), 0)
  from public.budget_movements m
  where m.source_type = 'PROCUREMENT'
    and m.source_id = p_procurement_id
    and m.movement_type in ('RESERVE', 'COMMIT')
    and not exists (
      select 1 from public.budget_movements x where x.reverses_movement_id = m.id
    )
    and m.amount - coalesce((
      select sum(r.amount) from public.budget_movements r
      where r.releases_movement_id = m.id
        and not exists (
          select 1 from public.budget_movements rr where rr.reverses_movement_id = r.id
        )
    ), 0) > 0
  order by m.budget_account_id, m.id;
$$;

/*
 * อ่านข้าม RLS ของ budget_movements ได้ จึงไม่เปิดให้เรียกตรง
 * ผู้เรียกที่ชอบธรรมคือ RPC ที่ตรวจสิทธิ์มาก่อนแล้วเท่านั้น
 */
revoke all on function public.procurement_outstanding_hold(uuid)
  from public, authenticated, anon;

-- -----------------------------------------------------------------------------
-- procurement_release_budget — คืนยอดที่ถือไว้ทั้งหมด ไม่ว่าชนิดใด
--
-- ใช้ procurement_outstanding_hold แทนการไล่แถวเอง ตรรกะ "เหลือเท่าไร"
-- จึงมีที่เดียวร่วมกับการเบิกจ่าย
-- -----------------------------------------------------------------------------

create or replace function public.procurement_release_budget(
  p_procurement_id uuid,
  p_effective_date date,
  p_reason text,
  p_request_id text default 'system'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hold record;
  v_count integer := 0;
begin
  perform set_config('app.budget_workflow_posting', 'on', true);

  for v_hold in select * from public.procurement_outstanding_hold(p_procurement_id)
  loop
    perform public.budget_post_movement(
      v_hold.budget_account_id, 'RELEASE', v_hold.outstanding, p_effective_date,
      p_reason, 'PROCUREMENT', p_procurement_id,
      null, null, v_hold.hold_id, null, p_request_id
    );
    v_count := v_count + 1;
  end loop;

  perform set_config('app.budget_workflow_posting', 'off', true);

  return v_count;
end;
$$;

comment on function public.procurement_release_budget(uuid, date, text, text) is
  'คืนยอดงบที่กันไว้หรือผูกพันไว้ — เรียกจาก procurement_transition เท่านั้น';

-- -----------------------------------------------------------------------------
-- procurement_commit_budget — แปลงยอดที่กันไว้เป็นยอดผูกพัน
--
-- คืนยอดที่กันไว้แล้วลงผูกพันจำนวนเท่ากันทันทีในทรานแซกชันเดียว
-- **ยอดที่ใช้ได้ต้องไม่ขยับ** เพราะทั้งสองแถวหักล้างกันพอดี
--
-- ลำดับสำคัญ: คืนก่อนแล้วจึงผูกพัน ถ้าสลับกัน จะมีจังหวะที่ยอดถูกนับสองเท่า
-- และบัญชีที่กันยอดไว้เต็มจำนวนจะถูกปฏิเสธว่างบไม่พอ ทั้งที่ยอดสุทธิไม่เปลี่ยน
-- (บทเรียนเดียวกับลำดับการย้อนใน procurement_disbursement_void)
--
-- ข้ามแถวที่เป็น COMMIT อยู่แล้ว จึงเรียกซ้ำได้โดยไม่ผูกพันซ้อน
-- -----------------------------------------------------------------------------

create or replace function public.procurement_commit_budget(
  p_procurement_id uuid,
  p_effective_date date,
  p_reason text,
  p_request_id text default 'system'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hold record;
  v_count integer := 0;
begin
  perform set_config('app.budget_workflow_posting', 'on', true);

  for v_hold in
    select * from public.procurement_outstanding_hold(p_procurement_id)
    where hold_type = 'RESERVE'
  loop
    perform public.budget_post_movement(
      v_hold.budget_account_id, 'RELEASE', v_hold.outstanding, p_effective_date,
      coalesce(p_reason, 'แปลงยอดที่กันไว้เป็นยอดผูกพันเมื่อออกใบสั่งซื้อ'),
      'PROCUREMENT', p_procurement_id,
      null, null, v_hold.hold_id, null, p_request_id
    );

    perform public.budget_post_movement(
      v_hold.budget_account_id, 'COMMIT', v_hold.outstanding, p_effective_date,
      coalesce(p_reason, 'ผูกพันงบตามใบสั่งซื้อ/สั่งจ้าง'),
      'PROCUREMENT', p_procurement_id,
      null, null, null, null, p_request_id
    );

    v_count := v_count + 1;
  end loop;

  perform set_config('app.budget_workflow_posting', 'off', true);

  return v_count;
end;
$$;

comment on function public.procurement_commit_budget(uuid, date, text, text) is
  'แปลงยอดที่กันไว้เป็นยอดผูกพัน — เรียกจาก procurement_transition เท่านั้น';

revoke all on function public.procurement_commit_budget(uuid, date, text, text)
  from public, authenticated, anon;


-- -----------------------------------------------------------------------------
-- ออก procurement_disburse ใหม่ — เปลี่ยนแหล่งที่มาของ "ยอดที่เหลือให้จ่าย"
--
-- จาก procurement_outstanding_reserve (เฉพาะ RESERVE) เป็น
-- procurement_outstanding_hold (RESERVE หรือ COMMIT) เพราะการเบิกจ่ายเกิดที่
-- สถานะ PARTIALLY_RECEIVED/RECEIVED ซึ่งหลังการออกใบสั่งซื้อเสมอ ยอดที่ถืออยู่
-- ณ จุดนั้นจึงเป็น COMMIT ไม่ใช่ RESERVE อีกต่อไป
--
-- **ตรรกะการแบ่งยอดตามสัดส่วนและการปัดเศษคงเดิมทุกบรรทัด** เปลี่ยนเฉพาะชื่อ
-- ฟังก์ชันต้นทาง ชื่อคอลัมน์ และถ้อยคำใน error ที่เคยพูดถึง "ยอดที่กันไว้" อย่างเดียว
-- -----------------------------------------------------------------------------

create or replace function public.procurement_disburse(
  p_procurement_id uuid,
  p_amount numeric,
  p_paid_on date,
  p_document_no text default null,
  p_payee_name text default null,
  p_note text default null,
  p_request_id text default 'system'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.procurements%rowtype;
  v_total_satang bigint;
  v_amount_satang bigint;
  v_line record;
  v_disbursement_id uuid;
  v_lines jsonb := '[]'::jsonb;
  v_movement_ids uuid[] := '{}';
  v_release_id uuid;
  v_actual_id uuid;
begin
  if not public.has_permission('procurement.disburse') then
    raise exception 'คุณไม่มีสิทธิ์บันทึกการเบิกจ่าย' using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'จำนวนเงินที่เบิกจ่ายต้องมากกว่าศูนย์' using errcode = 'check_violation';
  end if;

  /* ล็อกรายการไว้ตลอดทรานแซกชัน กันการจ่ายพร้อมกันสองครั้งจนเกินยอดที่กันไว้ */
  select * into v_row from public.procurements where id = p_procurement_id for update;

  if not found then
    raise exception 'ไม่พบรายการจัดซื้อจัดจ้างที่ระบุ' using errcode = 'no_data_found';
  end if;

  if not public.status_allows_disbursement(v_row.status) then
    raise exception 'เบิกจ่ายได้เมื่อรับของแล้วเท่านั้น — สถานะปัจจุบันคือ %', v_row.status
      using errcode = 'check_violation';
  end if;

  v_amount_satang := round(p_amount * 100)::bigint;

  select coalesce(sum(round(r.outstanding * 100)::bigint), 0) into v_total_satang
  from public.procurement_outstanding_hold(p_procurement_id) r;

  if v_total_satang <= 0 then
    raise exception 'รายการนี้ไม่มียอดที่กันไว้หรือผูกพันไว้เหลือให้เบิกจ่าย'
      using errcode = 'check_violation';
  end if;

  /*
   * จ่ายเกินยอดที่ถือไว้ไม่ได้
   *
   * ถ้าราคาจริงสูงกว่าที่อนุมัติ ต้องกลับไปขออนุมัติเพิ่มก่อน ไม่ใช่ให้ระบบ
   * ดูดงบส่วนต่างไปเงียบ ๆ ตอนจ่าย — ส่วนต่างที่ไม่มีใครอนุมัติคือสิ่งที่
   * ผู้ตรวจสอบตามหา
   */
  if v_amount_satang > v_total_satang then
    raise exception 'เบิกจ่ายเกินยอดที่ถือไว้ไม่ได้ — ถือไว้ % บาท แต่ขอเบิก % บาท',
      to_char(v_total_satang / 100.0, 'FM999999999990.00'),
      to_char(p_amount, 'FM999999999990.00')
      using errcode = 'check_violation';
  end if;

  insert into public.procurement_disbursements (
    procurement_id, amount, paid_on, document_no, payee_name, note, created_by
  ) values (
    p_procurement_id, p_amount, p_paid_on,
    nullif(btrim(coalesce(p_document_no, '')), ''),
    nullif(btrim(coalesce(p_payee_name, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    v_actor
  )
  returning id into v_disbursement_id;

  perform set_config('app.budget_workflow_posting', 'on', true);

  /*
   * แบ่งยอดในคำสั่งเดียว ไม่ใช้ temporary table
   *
   * temp table แบบ `on commit drop` จะชนกันเองถ้าฟังก์ชันนี้ถูกเรียกสองครั้ง
   * ในทรานแซกชันเดียว ซึ่งเกิดจริงทั้งใน test และตอนจ่ายหลายงวดติดกัน
   */
  for v_line in
    with base as (
      select r.hold_id, r.budget_account_id, round(r.outstanding * 100)::bigint as os
      from public.procurement_outstanding_hold(p_procurement_id) r
      where r.outstanding > 0
    ),
    floored as (
      /*
       * ต้อง cast ตัวหารเป็น bigint ให้เป็นการหารจำนวนเต็ม
       *
       * ถ้าใช้ผลของ sum() ตรง ๆ จะได้ numeric แล้วการหารกลายเป็นทศนิยม
       * บรรทัดที่ควรได้ศูนย์จะได้เศษ (เช่น 0.333) ซึ่งรอดตัวกรอง > 0 มาได้
       * แล้วถูกปัดเป็น 0.00 ตอนลงบัญชี จนชน constraint amount > 0
       * — bug นี้ test "เศษสตางค์ต้องไม่หาย" เป็นผู้จับได้
       */
      select b.*,
        (b.os * v_amount_satang) / v_total_satang as share,
        row_number() over (order by b.os desc, b.budget_account_id) as rn
      from base b
    ),
    spread as (
      select f.*,
        v_amount_satang - (select sum(share)::bigint from floored) as remainder
      from floored f
    )
    select
      hold_id,
      budget_account_id,
      (share + case when rn <= remainder then 1 else 0 end) as share_satang
    from spread
    where share + case when rn <= remainder then 1 else 0 end > 0
    order by budget_account_id
  loop
    -- คืนยอดที่ถือไว้ (กันไว้หรือผูกพัน) เท่าที่จ่าย
    v_release_id := public.budget_post_movement(
      v_line.budget_account_id, 'RELEASE', v_line.share_satang / 100.0, p_paid_on,
      'เบิกจ่ายตามรายการจัดซื้อจัดจ้าง', 'PROCUREMENT', p_procurement_id,
      null, null, v_line.hold_id, p_document_no, p_request_id
    );

    -- แล้วลงเป็นค่าใช้จ่ายจริงทันทีในทรานแซกชันเดียวกัน
    v_actual_id := public.budget_post_movement(
      v_line.budget_account_id, 'ACTUAL', v_line.share_satang / 100.0, p_paid_on,
      'เบิกจ่ายตามรายการจัดซื้อจัดจ้าง', 'PROCUREMENT', p_procurement_id,
      null, null, null, p_document_no, p_request_id
    );

    v_movement_ids := v_movement_ids || v_release_id || v_actual_id;

    v_lines := v_lines || jsonb_build_object(
      'budget_account_id', v_line.budget_account_id,
      'amount', v_line.share_satang / 100.0
    );
  end loop;

  perform set_config('app.budget_workflow_posting', 'off', true);

  update public.procurement_disbursements
  set movement_ids = v_movement_ids
  where id = v_disbursement_id;

  insert into public.audit_events (
    request_id, actor_id, action, entity_type, entity_id, after_json
  ) values (
    p_request_id, v_actor, 'procurement.disburse', 'procurement_disbursement',
    v_disbursement_id::text,
    jsonb_build_object(
      'procurement_id', p_procurement_id,
      'amount', p_amount,
      'paid_on', p_paid_on,
      'lines', v_lines
    )
  );

  return v_disbursement_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- ออก procurement_transition ใหม่ — ตัดสินจาก "ชนิดของยอดที่ถือ" แทนค่า boolean
--
-- เดิมถามว่า "ถือยอดอยู่ไหม" ซึ่งตอบได้แค่ใช่/ไม่ใช่ จึงแยกไม่ออกว่าการเปลี่ยน
-- จาก APPROVED ไป ISSUED คือการถือต่อ (ไม่ต้องทำอะไร) หรือการเปลี่ยนชนิดของยอด
-- ตอนนี้ถามว่า "ถือยอดชนิดใด" แล้วเทียบก่อนกับหลัง:
--
--   ไม่ถือ → RESERVE   = กันยอด (อนุมัติ)
--   RESERVE → COMMIT   = แปลงเป็นยอดผูกพัน (ออกใบสั่งซื้อ)
--   ถืออยู่ → ไม่ถือ    = คืนยอดทั้งหมด (ยกเลิก)
--   เหมือนเดิม         = ไม่แตะเงิน
--
-- ยังตัดสินจากสถานะก่อน/หลัง ไม่ใช่จากชื่อ action ด้วยเหตุผลเดิมทุกประการ
-- -----------------------------------------------------------------------------

create or replace function public.procurement_transition(
  p_procurement_id uuid,
  p_action text,
  p_expected_version integer,
  p_reason text default null,
  p_request_id text default 'system'
)
returns public.procurement_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.procurements%rowtype;
  v_actor uuid := auth.uid();
  v_rule record;
  v_profile record;
  v_role text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_step integer;
  v_kind_before text;
  v_kind_after text;
  v_sqlstate text;
begin
  if v_actor is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนดำเนินการ' using errcode = 'insufficient_privilege';
  end if;

  /*
   * ปฏิเสธ submit ที่นี่อย่างชัดเจน
   *
   * ถ้าปล่อยให้ตกไปเป็น "ไม่พบกติกา" ผู้อ่านโค้ดจะเข้าใจว่าลืมใส่ ไม่ใช่ว่าตั้งใจกัน
   * และข้อความก็จะไม่บอกผู้เรียกว่าต้องไปใช้ทางไหนแทน
   */
  if p_action = 'submit' then
    raise exception 'การส่งอนุมัติต้องผ่าน procurement_submit เพื่อให้ตรวจกฎครบชุดก่อน'
      using errcode = 'restrict_violation';
  end if;

  select * into v_row
  from public.procurements
  where id = p_procurement_id and deleted_at is null
  for update;

  if not found then
    raise exception 'ไม่พบรายการนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = 'no_data_found';
  end if;

  /*
   * ต้องอ่านรายการนี้ได้ก่อนจึงจะดำเนินการได้
   *
   * ฟังก์ชันนี้เป็น security definer จึงข้าม RLS ได้ ถ้าไม่ตรวจตรงนี้ ผู้ที่เดา id
   * ถูกจะเปลี่ยนสถานะรายการที่ตัวเองไม่มีสิทธิ์แม้แต่จะเห็น
   */
  if not public.can_read_procurement(p_procurement_id) then
    raise exception 'ไม่พบรายการนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = 'no_data_found';
  end if;

  if v_row.version <> p_expected_version then
    raise exception 'มีผู้อื่นแก้ไขรายการนี้ไปแล้ว กรุณาโหลดหน้าใหม่ก่อนดำเนินการ'
      using errcode = 'serialization_failure';
  end if;

  select * into v_rule from public.procurement_transition_rule(p_action, v_row.status);

  if not found then
    raise exception 'รายการที่อยู่ในสถานะนี้ทำรายการดังกล่าวไม่ได้'
      using errcode = 'restrict_violation';
  end if;

  if not public.has_permission(v_rule.required_permission) then
    -- ไม่บอกว่าขาดสิทธิ์ชื่ออะไร เพราะผู้ไม่มีสิทธิ์จะใช้ข้อความนั้นสำรวจระบบได้ (ข้อ 14.2)
    raise exception 'คุณไม่มีสิทธิ์ดำเนินการนี้' using errcode = 'insufficient_privilege';
  end if;

  if v_rule.requires_reason and v_reason is null then
    raise exception 'การดำเนินการนี้ต้องระบุเหตุผล' using errcode = 'check_violation';
  end if;

  if public.is_self_action_forbidden(p_action) and v_row.created_by = v_actor then
    raise exception 'ผู้สร้างรายการตรวจสอบหรืออนุมัติรายการของตัวเองไม่ได้'
      using errcode = 'insufficient_privilege';
  end if;

  -- ---- สำเนาข้อมูลผู้ทำรายการ ณ เวลานี้ (ดู migration 0012) ----
  select p.title_th, p.first_name_th, p.last_name_th, pos.name_th as position_th
  into v_profile
  from public.profiles p
  left join public.positions pos on pos.id = p.position_id
  where p.id = v_actor;

  /*
   * บันทึกบทบาทที่ "ใช้ดำเนินการ" ไม่ใช่บทบาททั้งหมดที่ผู้ใช้มี
   *
   * เลือกบทบาทที่ถือสิทธิ์ของการกระทำนี้ เพราะเป็นบทบาทที่ทำให้กดได้จริง
   * ผู้ใช้ที่ถือหลายบทบาทจึงได้ประวัติที่บอกได้ว่ากดในฐานะอะไร
   */
  select ur.role_code into v_role
  from public.user_roles ur
  join public.role_permissions rp on rp.role_code = ur.role_code
  where ur.user_id = v_actor and rp.permission_code = v_rule.required_permission
  order by ur.role_code
  limit 1;

  select coalesce(max(step_no), 0) + 1 into v_step
  from public.procurement_approvals
  where procurement_id = p_procurement_id;

  insert into public.procurement_approvals (
    procurement_id, step_no, action, from_status, to_status,
    actor_id, actor_name_th, actor_role_code, actor_position_th, reason
  ) values (
    p_procurement_id, v_step, p_action, v_row.status, v_rule.to_status,
    v_actor,
    btrim(concat_ws(' ', v_profile.title_th, v_profile.first_name_th, v_profile.last_name_th)),
    coalesce(v_role, 'UNKNOWN'),
    v_profile.position_th,
    v_reason
  );

  /*
   * ---- กันยอดงบ / คืนยอดงบ ----
   *
   * ตัดสินจาก **สถานะก่อนและหลัง** ไม่ใช่จากชื่อ action
   *
   * ถ้าผูกกับชื่อ action การเพิ่มเส้นทางใหม่ที่พาเข้าหรือออกจากสถานะที่ถือยอด
   * จะลืมกันยอดหรือลืมคืนยอดโดยไม่มีอะไรฟ้อง — ผูกกับสถานะแล้วเส้นทางใหม่ทุกเส้น
   * ได้พฤติกรรมที่ถูกต้องโดยอัตโนมัติ
   *
   * ใช้วันที่ของวันนี้เป็นวันที่มีผล เพราะการกันยอดเกิดขึ้นจริงตอนนี้
   * ถ้าวันนี้อยู่นอกช่วงปีงบ `budget_post_movement` จะปฏิเสธพร้อมบอกเหตุผล
   * และการอนุมัติทั้งชุดถูกย้อนกลับ — **ไม่ปัดวันที่ให้เข้าช่วงโดยอัตโนมัติ**
   * เพราะจะเป็นการบันทึกวันที่ที่ไม่ได้เกิดขึ้นจริงลง ledger
   */
  v_kind_before := case
    when public.status_holds_reservation(v_row.status) then 'RESERVE'
    when public.status_holds_commitment(v_row.status) then 'COMMIT'
  end;
  v_kind_after := case
    when public.status_holds_reservation(v_rule.to_status) then 'RESERVE'
    when public.status_holds_commitment(v_rule.to_status) then 'COMMIT'
  end;

  /*
   * ออกจากสถานะที่ถือยอดไม่ได้ ถ้ายังมีการเบิกจ่ายที่ยังไม่ถูกยกเลิก (migration 0019)
   *
   * ยอดที่กันไว้ถูกแปลงเป็นค่าใช้จ่ายจริงไปแล้ว การคืนยอดจึงไม่มีอะไรให้คืน
   * ผลคือรายการถูกยกเลิกแต่เงินยังหายไปจากงบ โดยไม่มีอะไรบอกว่าทำไม
   */
  if v_kind_before is not null and v_kind_after is null
     and public.procurement_has_live_disbursement(p_procurement_id) then
    raise exception 'ยกเลิกรายการที่จ่ายเงินไปแล้วไม่ได้ ต้องยกเลิกการเบิกจ่ายก่อน'
      using errcode = 'restrict_violation';
  end if;

  begin
    if v_kind_after = 'RESERVE' and v_kind_before is null then
      perform public.procurement_reserve_budget(
        p_procurement_id, current_date, v_reason, p_request_id);
    elsif v_kind_after = 'COMMIT' and v_kind_before = 'RESERVE' then
      /* ออกใบสั่งซื้อ — แปลงยอดที่กันไว้เป็นยอดผูกพัน ยอดที่ใช้ได้ไม่ขยับ */
      perform public.procurement_commit_budget(
        p_procurement_id, current_date, v_reason, p_request_id);
    elsif v_kind_after = 'COMMIT' and v_kind_before is null then
      /*
       * ผูกพันโดยไม่เคยกันยอดมาก่อน — ยังไม่มีเส้นทางใดพามาถึงตรงนี้
       * แต่เขียนไว้เพราะกติกาตัดสินจากสถานะ ไม่ใช่จากชื่อ action
       * เส้นทางใหม่ที่ข้ามการอนุมัติจึงต้องได้ยอดผูกพัน ไม่ใช่เงียบ
       */
      perform public.procurement_reserve_budget(
        p_procurement_id, current_date, v_reason, p_request_id);
      perform public.procurement_commit_budget(
        p_procurement_id, current_date, v_reason, p_request_id);
    elsif v_kind_before is not null and v_kind_after is null then
      perform public.procurement_release_budget(
        p_procurement_id, current_date,
        coalesce(v_reason, 'คืนยอดที่ถือไว้เพราะรายการถูกยกเลิก'), p_request_id);
    end if;
  exception
    when others then
      /*
       * ใส่บริบทให้ข้อความ แต่คง errcode เดิมไว้
       *
       * ผู้ใช้กดปุ่ม "อนุมัติ" แล้วได้ข้อความเรื่องงบล้วน ๆ จะไม่เข้าใจว่าเกี่ยวกันอย่างไร
       * ส่วน errcode ต้องคงไว้เพราะชั้นบนใช้แยกว่าเป็นความผิดพลาดชนิดใด
       */
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      raise exception '%: %',
        case
          when v_kind_after = 'RESERVE' then 'อนุมัติไม่สำเร็จเพราะกันยอดงบไม่ได้'
          when v_kind_after = 'COMMIT' then 'ออกใบสั่งซื้อไม่สำเร็จเพราะผูกพันงบไม่ได้'
          else 'ยกเลิกไม่สำเร็จเพราะคืนยอดงบไม่ได้'
        end,
        sqlerrm
        using errcode = v_sqlstate;
  end;

  /*
   * `approved_date` ตั้งโดย workflow ไม่ใช่ให้กรอกเอง
   *
   * PR-03 เปิดให้กรอกช่องนี้ไว้ชั่วคราวและระบุไว้ใน comment ของคอลัมน์ว่า
   * จะย้ายมาให้ workflow เป็นผู้ตั้ง — จุดนี้คือที่นั้น
   */
  update public.procurements
  set status = v_rule.to_status,
      approved_date = case
        when p_action = 'approve' then coalesce(approved_date, current_date)
        else approved_date
      end,
      updated_at = now()
  where id = p_procurement_id;

  insert into public.audit_events (
    request_id, actor_id, action, entity_type, entity_id, before_json, after_json, metadata_json
  ) values (
    p_request_id, v_actor, 'procurement.status_change', 'procurement', p_procurement_id::text,
    jsonb_build_object('status', v_row.status),
    jsonb_build_object('status', v_rule.to_status),
    jsonb_build_object(
      'action', p_action,
      'step_no', v_step,
      'reason', v_reason,
      /* บันทึกชนิดของยอดที่ถือก่อนและหลัง ไม่ใช่แค่ว่า "กันยอด/คืนยอด"
         ผู้ตรวจสอบจึงเห็นได้ว่าเงินเปลี่ยนจากกันไว้เป็นผูกพันเมื่อใด */
      'budget_hold_before', v_kind_before,
      'budget_hold_after', v_kind_after
    )
  );

  return v_rule.to_status;
end;
$$;
