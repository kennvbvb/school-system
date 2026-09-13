-- -----------------------------------------------------------------------------
-- migration 0019 — การเบิกจ่าย: แปลงยอดที่กันไว้ให้เป็นค่าใช้จ่ายจริง
--
-- ปัญหาที่ปิด: migration 0017 ทำให้การอนุมัติกันยอด (RESERVE) ไว้ แต่ไม่มีอะไร
-- มาปลด ยอดที่กันไว้จึงค้างตลอดไป และงบที่ใช้ได้ต่ำกว่าความจริงเรื่อย ๆ
-- จนโรงเรียนเลิกเชื่อตัวเลขบนหน้าจอ แล้วกลับไปนับเองใน Excel — ซึ่งเป็นอาการ
-- เดียวกับที่ระบบนี้ตั้งใจจะแก้ตั้งแต่ต้น
--
-- การเบิกจ่ายหนึ่งครั้งทำสองอย่างใน **ทรานแซกชันเดียวกันเสมอ**
--   1. คืนยอดที่กันไว้ (RELEASE) ตามจำนวนที่จ่าย
--   2. ลงค่าใช้จ่ายจริง (ACTUAL) จำนวนเดียวกัน
-- ถ้าแยกกันทำ จะมีช่วงเวลาที่ยอดถูกนับซ้ำ หรือหายไปทั้งก้อนถ้าขั้นที่สองล้ม
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- สิทธิ์ใหม่ — แยกจาก budget.manage โดยเจตนา
--
-- budget.manage คือการ "จัดสรรและโอนงบ" ส่วน procurement.disburse คือการ
-- "จ่ายเงินตามรายการที่อนุมัติแล้ว" เป็นคนละหน้าที่และควรมอบหมายแยกกันได้
-- ตามหลักแบ่งแยกหน้าที่ (ข้อ 4.1) ผู้ที่ตั้งวงเงินเองแล้วจ่ายเงินเองได้
-- คือช่องที่การตรวจสอบภายในต้องมองหา
-- -----------------------------------------------------------------------------

insert into public.permissions (code, description_th) values
  ('procurement.disburse', 'บันทึกการเบิกจ่ายและยกเลิกการเบิกจ่าย')
on conflict (code) do update set description_th = excluded.description_th;

/*
 * มอบสิทธิ์ให้บทบาทเฉพาะเมื่อบทบาทนั้นมีอยู่แล้ว
 *
 * บนฐานข้อมูลใหม่ migration รันก่อน seed-reference.sql ตาราง roles จึงยังว่าง
 * บรรทัดนี้จะไม่ทำอะไรและ seed เป็นผู้มอบสิทธิ์ให้ ส่วนบนฐานข้อมูลที่ใช้งานอยู่แล้ว
 * บทบาทมีครบ บรรทัดนี้จึงมอบสิทธิ์ให้ทันทีโดยไม่ต้องรัน seed ซ้ำ
 */
insert into public.role_permissions (role_code, permission_code)
select r.code, 'procurement.disburse'
from public.roles r
where r.code in ('FINANCE', 'SYSTEM_ADMIN')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- ตารางการเบิกจ่าย
--
-- **ไม่มีคอลัมน์ budget_account_id** — การจ่ายหนึ่งครั้งกระจายไปหลายบัญชีงบได้
-- ตามสัดส่วนที่ยังกันไว้ (F-02) รายละเอียดรายบัญชีอยู่ใน budget_movements
-- ซึ่งเป็นแหล่งความจริงของยอดอยู่แล้ว การเก็บซ้ำที่นี่จะสร้างโอกาสให้สองที่ไม่ตรงกัน
--
-- **ยกเลิกด้วย voided_at ไม่ใช่ delete** — การจ่ายเงินที่เคยบันทึกแล้วเป็น
-- ข้อเท็จจริงที่ผู้ตรวจสอบต้องเห็น รวมถึงตอนที่บันทึกผิดแล้วยกเลิก
-- -----------------------------------------------------------------------------

create table public.procurement_disbursements (
  id uuid primary key default gen_random_uuid(),
  procurement_id uuid not null references public.procurements (id) on delete restrict,
  amount numeric(18, 2) not null,
  paid_on date not null,
  document_no text,
  payee_name text,
  note text,

  /*
   * id ของแถวใน budget_movements ที่การจ่ายครั้งนี้สร้างขึ้น
   *
   * เก็บไว้ตรง ๆ เพราะตอนยกเลิกต้องย้อน **แถวของการจ่ายครั้งนั้น** ให้ถูกตัว
   * การไล่หาย้อนหลังด้วยวันที่กับเลขเอกสารจะชนกันเองเมื่อจ่ายสองครั้งในวันเดียวกัน
   * โดยไม่มีเลขเอกสาร ซึ่งเป็นกรณีที่เกิดจริงเวลาแบ่งจ่ายเป็นงวด
   */
  movement_ids uuid[] not null default '{}',

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null,
  void_reason text,

  constraint procurement_disbursements_amount_positive check (amount > 0),

  -- ยกเลิกแล้วต้องมีทั้งเวลาและเหตุผล ไม่มีการยกเลิกแบบไม่บอกว่าทำไม
  constraint procurement_disbursements_void_complete check (
    (voided_at is null and void_reason is null)
    or (voided_at is not null and btrim(coalesce(void_reason, '')) <> '')
  )
);

create index procurement_disbursements_procurement_idx
  on public.procurement_disbursements (procurement_id, paid_on);

comment on table public.procurement_disbursements is
  'การเบิกจ่ายของรายการจัดซื้อจัดจ้าง — ยอดรายบัญชีงบอยู่ใน budget_movements';

-- -----------------------------------------------------------------------------
-- RLS — อ่านได้ถ้าอ่านรายการจัดซื้อนั้นได้ หรือมีสิทธิ์เบิกจ่าย
--
-- **ไม่มี policy สำหรับ insert/update/delete** เขียนได้ทางเดียวคือผ่าน RPC
-- ด้านล่าง การเปิดช่องให้เขียนตรงจะข้ามการลง ledger ไปได้ ซึ่งทำให้ยอดที่กันไว้
-- กับค่าใช้จ่ายจริงไม่ตรงกันโดยไม่มีอะไรฟ้อง
-- -----------------------------------------------------------------------------

alter table public.procurement_disbursements enable row level security;

create policy procurement_disbursements_select on public.procurement_disbursements
  for select to authenticated
  using (public.can_read_procurement(procurement_id));

create policy procurement_disbursements_select_finance on public.procurement_disbursements
  for select to authenticated
  using (public.has_permission('procurement.disburse'));

revoke insert, update, delete on public.procurement_disbursements from authenticated;

-- -----------------------------------------------------------------------------
-- procurement_outstanding_reserve — ยอดที่ยังกันไว้ แยกรายบัญชีงบ
--
-- "ยังกันไว้" = จำนวนที่ RESERVE ไว้ ลบที่ RELEASE ไปแล้ว โดยไม่นับรายการ
-- ที่ถูกย้อน (REVERSAL) เพราะรายการที่ถูกย้อนไม่มีผลกับยอดอีกแล้ว
-- -----------------------------------------------------------------------------

create or replace function public.procurement_outstanding_reserve(p_procurement_id uuid)
returns table (budget_account_id uuid, reserve_id uuid, outstanding numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    m.budget_account_id,
    m.id,
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
    and m.movement_type = 'RESERVE'
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
  order by m.budget_account_id;
$$;

/*
 * ฟังก์ชันนี้อ่านข้าม RLS ของ budget_movements ได้ จึงไม่เปิดให้เรียกตรง
 * ผู้เรียกที่ชอบธรรมคือ RPC ด้านล่างซึ่งตรวจสิทธิ์มาก่อนแล้ว
 */
revoke all on function public.procurement_outstanding_reserve(uuid)
  from public, authenticated, anon;


-- -----------------------------------------------------------------------------
-- ออก budget_post_movement ใหม่ — แก้การนับ "คืนยอดไปแล้ว"
--
-- **นี่คือ bug ที่ test ของ PR นี้จับได้** ตัวตรวจ "คืนยอดเกินจำนวนที่กันไว้ไม่ได้"
-- นับแถว RELEASE ที่ถูกย้อนไปแล้วรวมอยู่ด้วย พอยกเลิกการเบิกจ่ายแล้วจ่ายใหม่
-- จึงถูกปฏิเสธว่า "คืนไปครบแล้ว" ทั้งที่ยอดที่กันไว้กลับมาครบ
--
-- ก่อนหน้านี้ไม่มีใครเจอ เพราะยังไม่มีเส้นทางไหนย้อน RELEASE — การเบิกจ่าย
-- เป็นเส้นทางแรกที่ทำ ส่วนที่เปลี่ยนคือ subquery ของ v_released เท่านั้น
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
    and p_type in ('RESERVE', 'RELEASE');
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

    if v_target.budget_account_id <> p_account_id or v_target.movement_type <> 'RESERVE' then
      raise exception 'คืนยอดได้เฉพาะรายการกันยอดของบัญชีงบเดียวกันเท่านั้น'
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
-- status_allows_disbursement — สถานะที่เบิกจ่ายได้
--
-- ต้องตรงกับ STATUSES_ALLOWING_DISBURSEMENT ใน
-- src/domain/procurement/disbursement.ts — มี parity test อ่านไฟล์นี้มาเทียบ
--
-- จ่ายเงินได้เมื่อรับของแล้วเท่านั้น การจ่ายก่อนรับของเป็นความเสี่ยงที่ระบบ
-- ไม่ควรเปิดทางให้โดยปริยาย (ยังไม่ครอบคลุมงานจ้างเหมาที่จ่ายตามงวด — Q31)
-- -----------------------------------------------------------------------------

create or replace function public.status_allows_disbursement(p_status public.procurement_status)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select p_status in ('PARTIALLY_RECEIVED', 'RECEIVED');
$$;

-- -----------------------------------------------------------------------------
-- procurement_disburse — บันทึกการเบิกจ่ายหนึ่งครั้ง
--
-- แบ่งยอดที่จ่ายไปตามสัดส่วนของยอดที่ยังกันไว้ แล้วลง RELEASE + ACTUAL คู่กัน
-- ทุกบรรทัด กติกาการแบ่งต้องตรงกับ `splitProRata()` ใน
-- src/domain/procurement/disbursement.ts:
--
--   * ปัดลงทุกบรรทัดก่อน แล้วแจกเศษทีละสตางค์
--   * เศษไปบรรทัดที่กันไว้มากที่สุดก่อน เสมอกันตัดสินด้วย budget_account_id
--
-- คำนวณเป็นสตางค์ (จำนวนเต็ม) ไม่ใช่ทศนิยม เพราะการหารทศนิยมแล้วปัดทีหลัง
-- ทำให้ผลรวมของบรรทัดไม่เท่ากับยอดที่จ่ายจริงได้ — เงินหายหรืองอกทีละสตางค์
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
  from public.procurement_outstanding_reserve(p_procurement_id) r;

  if v_total_satang <= 0 then
    raise exception 'รายการนี้ไม่มียอดที่กันไว้เหลือให้เบิกจ่าย' using errcode = 'check_violation';
  end if;

  /*
   * จ่ายเกินยอดที่กันไว้ไม่ได้
   *
   * ถ้าราคาจริงสูงกว่าที่อนุมัติ ต้องกลับไปขออนุมัติเพิ่มก่อน ไม่ใช่ให้ระบบ
   * ดูดงบส่วนต่างไปเงียบ ๆ ตอนจ่าย — ส่วนต่างที่ไม่มีใครอนุมัติคือสิ่งที่
   * ผู้ตรวจสอบตามหา
   */
  if v_amount_satang > v_total_satang then
    raise exception 'เบิกจ่ายเกินยอดที่กันไว้ไม่ได้ — กันไว้ % บาท แต่ขอเบิก % บาท',
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
      select r.reserve_id, r.budget_account_id, round(r.outstanding * 100)::bigint as os
      from public.procurement_outstanding_reserve(p_procurement_id) r
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
      reserve_id,
      budget_account_id,
      (share + case when rn <= remainder then 1 else 0 end) as share_satang
    from spread
    where share + case when rn <= remainder then 1 else 0 end > 0
    order by budget_account_id
  loop
    -- คืนยอดที่กันไว้เท่าที่จ่าย
    v_release_id := public.budget_post_movement(
      v_line.budget_account_id, 'RELEASE', v_line.share_satang / 100.0, p_paid_on,
      'เบิกจ่ายตามรายการจัดซื้อจัดจ้าง', 'PROCUREMENT', p_procurement_id,
      null, null, v_line.reserve_id, p_document_no, p_request_id
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

revoke all on function public.procurement_disburse(uuid, numeric, date, text, text, text, text)
  from public, anon;
grant execute on function public.procurement_disburse(uuid, numeric, date, text, text, text, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- procurement_disbursement_void — ยกเลิกการเบิกจ่ายที่บันทึกผิด
--
-- ย้อนด้วย REVERSAL ไม่ลบแถวเดิม (กติกาเดียวกับทั้ง ledger) การย้อน RELEASE
-- ทำให้ยอดกลับไปเป็น "กันไว้" ตามเดิม และการย้อน ACTUAL ทำให้ค่าใช้จ่ายจริง
-- ลดลง สุทธิแล้วเท่ากับยังไม่เคยจ่าย แต่ประวัติยังอยู่ครบให้ผู้ตรวจสอบอ่าน
--
-- ย้อนได้ครั้งเดียวต่อแถว — บังคับด้วย unique index budget_movements_single_reversal
-- ที่มีอยู่แล้ว การกดซ้ำจึงล้มที่ฐานข้อมูล ไม่ใช่เงียบ ๆ ลงซ้ำสองรอบ
-- -----------------------------------------------------------------------------

create or replace function public.procurement_disbursement_void(
  p_disbursement_id uuid,
  p_reason text,
  p_request_id text default 'system'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.procurement_disbursements%rowtype;
  v_movement record;
  v_count integer := 0;
begin
  if not public.has_permission('procurement.disburse') then
    raise exception 'คุณไม่มีสิทธิ์ยกเลิกการเบิกจ่าย' using errcode = 'insufficient_privilege';
  end if;

  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'ต้องระบุเหตุผลที่ยกเลิกการเบิกจ่าย' using errcode = 'check_violation';
  end if;

  select * into v_row from public.procurement_disbursements
  where id = p_disbursement_id for update;

  if not found then
    raise exception 'ไม่พบรายการเบิกจ่ายที่ระบุ' using errcode = 'no_data_found';
  end if;

  if v_row.voided_at is not null then
    raise exception 'รายการเบิกจ่ายนี้ถูกยกเลิกไปแล้ว' using errcode = 'check_violation';
  end if;

  perform set_config('app.budget_workflow_posting', 'on', true);

  /*
   * ย้อน ACTUAL ก่อน RELEASE
   *
   * ลำดับนี้ทำให้ยอดที่ใช้ได้ไม่เคยสูงกว่าความจริงระหว่างทาง ถ้าย้อน RELEASE ก่อน
   * จะมีจังหวะที่ทั้ง "กันไว้" และ "จ่ายจริง" ถูกนับพร้อมกัน ซึ่งทำให้ยอดติดลบ
   * ชั่วคราวและถูก budget_post_movement ปฏิเสธทั้งที่การยกเลิกไม่ควรถูกปฏิเสธ
   */
  for v_movement in
    select m.id, m.movement_type, m.budget_account_id, m.amount
    from public.budget_movements m
    where m.id = any (v_row.movement_ids)
      and not exists (
        select 1 from public.budget_movements r where r.reverses_movement_id = m.id
      )
    order by case when m.movement_type = 'ACTUAL' then 0 else 1 end, m.id
  loop
    perform public.budget_post_movement(
      v_movement.budget_account_id, 'REVERSAL', v_movement.amount, v_row.paid_on,
      'ยกเลิกการเบิกจ่าย: ' || p_reason,
      'PROCUREMENT', v_row.procurement_id,
      null, v_movement.id, null, v_row.document_no, p_request_id
    );
    v_count := v_count + 1;
  end loop;

  perform set_config('app.budget_workflow_posting', 'off', true);

  update public.procurement_disbursements
  set voided_at = now(), voided_by = v_actor, void_reason = btrim(p_reason)
  where id = p_disbursement_id;

  insert into public.audit_events (
    request_id, actor_id, action, entity_type, entity_id, before_json, after_json
  ) values (
    p_request_id, v_actor, 'procurement.disburse_void', 'procurement_disbursement',
    p_disbursement_id::text,
    jsonb_build_object('amount', v_row.amount, 'voided_at', null),
    jsonb_build_object('reason', btrim(p_reason), 'reversed_movements', v_count)
  );

  return v_count;
end;
$$;

revoke all on function public.procurement_disbursement_void(uuid, text, text)
  from public, anon;
grant execute on function public.procurement_disbursement_void(uuid, text, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- กันการยกเลิกรายการที่จ่ายเงินไปแล้ว
--
-- ถ้ายกเลิกได้ procurement_release_budget() จะพยายามคืนยอดที่กันไว้ — ซึ่งถูก
-- แปลงเป็นค่าใช้จ่ายจริงไปแล้ว จึงไม่เหลือให้คืน ผลคือรายการถูกยกเลิกแต่เงิน
-- ยังหายไปจากงบ โดยไม่มีอะไรบอกว่าทำไม
--
-- ทางที่ถูกคือยกเลิกการเบิกจ่ายก่อน (procurement_disbursement_void) แล้วค่อย
-- ยกเลิกรายการ ข้อความจึงบอกลำดับนั้นไว้ตรง ๆ
-- -----------------------------------------------------------------------------

create or replace function public.procurement_has_live_disbursement(p_procurement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.procurement_disbursements d
    where d.procurement_id = p_procurement_id and d.voided_at is null
  );
$$;

revoke all on function public.procurement_has_live_disbursement(uuid)
  from public, authenticated, anon;

-- -----------------------------------------------------------------------------
-- ออก procurement_transition ใหม่ พร้อม guard ของการเบิกจ่าย
--
-- ออกทั้งตัวแทนการแก้ทีละบรรทัด เพราะ Postgres ไม่มี "แก้เฉพาะส่วนของฟังก์ชัน"
-- ส่วนที่เปลี่ยนจาก migration 0017 คือบล็อก procurement_has_live_disbursement
-- ด้านล่างเท่านั้น ที่เหลือคงเดิมทุกบรรทัด
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
  v_held_before boolean;
  v_held_after boolean;
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
  v_held_before := public.status_holds_reservation(v_row.status);
  v_held_after := public.status_holds_reservation(v_rule.to_status);

  /*
   * ออกจากสถานะที่ถือยอดไม่ได้ ถ้ายังมีการเบิกจ่ายที่ยังไม่ถูกยกเลิก (migration 0019)
   *
   * ยอดที่กันไว้ถูกแปลงเป็นค่าใช้จ่ายจริงไปแล้ว การคืนยอดจึงไม่มีอะไรให้คืน
   * ผลคือรายการถูกยกเลิกแต่เงินยังหายไปจากงบ โดยไม่มีอะไรบอกว่าทำไม
   */
  if v_held_before and not v_held_after
     and public.procurement_has_live_disbursement(p_procurement_id) then
    raise exception 'ยกเลิกรายการที่จ่ายเงินไปแล้วไม่ได้ ต้องยกเลิกการเบิกจ่ายก่อน'
      using errcode = 'restrict_violation';
  end if;

  begin
    if v_held_after and not v_held_before then
      perform public.procurement_reserve_budget(
        p_procurement_id, current_date, v_reason, p_request_id);
    elsif v_held_before and not v_held_after then
      perform public.procurement_release_budget(
        p_procurement_id, current_date,
        coalesce(v_reason, 'คืนยอดที่กันไว้เพราะรายการถูกยกเลิก'), p_request_id);
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
        case when v_held_after then 'อนุมัติไม่สำเร็จเพราะกันยอดงบไม่ได้'
             else 'ยกเลิกไม่สำเร็จเพราะคืนยอดงบไม่ได้' end,
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
      'budget_reserved', v_held_after and not v_held_before,
      'budget_released', v_held_before and not v_held_after
    )
  );

  return v_rule.to_status;
end;
$$;
