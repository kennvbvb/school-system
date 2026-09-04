-- =============================================================================
-- Migration 0006 — RLS, append-only enforcement และ function ของ budget ledger
--
-- แยกจาก migration 0005 ด้วยเหตุผลเดียวกับที่แยก 0002 ออกจาก 0001:
-- โครงสร้างตารางกับกฎการเข้าถึงเปลี่ยนคนละจังหวะกัน
--
-- ทุก function เป็น security definer และตรึง search_path เพราะต้องอ่าน
-- ตารางที่ผู้เรียกไม่มีสิทธิ์อ่านตรง ๆ (ADR 0004)
-- =============================================================================

alter table public.budget_accounts enable row level security;
alter table public.budget_movements enable row level security;

-- -----------------------------------------------------------------------------
-- บัญชีงบ — อ่านได้เมื่อมี budget.read แก้ได้เมื่อมี budget.manage
--
-- ไม่ให้ทุกคนที่ active อ่านได้เหมือน master data อื่น เพราะยอดงบคงเหลือ
-- เป็นข้อมูลที่ไม่ใช่ทุกบทบาทควรเห็น
-- -----------------------------------------------------------------------------

create policy budget_accounts_select on public.budget_accounts
  for select to authenticated
  using (public.has_permission('budget.read'));

create policy budget_accounts_insert on public.budget_accounts
  for insert to authenticated
  with check (public.has_permission('budget.manage'));

create policy budget_accounts_update on public.budget_accounts
  for update to authenticated
  using (public.has_permission('budget.manage'))
  with check (public.has_permission('budget.manage'));

-- ไม่มี policy สำหรับ delete — บัญชีงบที่มีรายการแล้วต้องอยู่ต่อ ปิดด้วย status
revoke delete on public.budget_accounts from authenticated, anon;

-- -----------------------------------------------------------------------------
-- รายการเคลื่อนไหว — append-only เหมือน audit_events
--
-- ไม่มี policy insert ตรง ๆ ด้วย: การลงรายการต้องผ่าน function ที่ล็อกบัญชี
-- และตรวจยอดก่อน มิฉะนั้นสองคำขอพร้อมกันจะเห็นยอดเดียวกันแล้วลงได้ทั้งคู่
-- -----------------------------------------------------------------------------

create policy budget_movements_select on public.budget_movements
  for select to authenticated
  using (public.has_permission('budget.read'));

revoke insert, update, delete on public.budget_movements from authenticated, anon;

-- กันการแก้ผ่านเส้นทางอื่นที่ privilege ไม่ครอบคลุม เช่น function ที่เขียนผิด
--
-- มีข้อยกเว้นเดียว: การเติม paired_movement_id ของการโอนที่ยังว่างอยู่
-- เพราะคู่โอนต้องชี้หากัน แต่ id ของอีกฝั่งยังไม่เกิดตอน insert แถวแรก
--
-- ทางเลือกที่ปฏิเสธคือให้ function ปิด trigger ชั่วคราวด้วย ALTER TABLE
-- ซึ่งจับ ACCESS EXCLUSIVE lock ทั้งตาราง ทำให้การลงรายการของทุกบัญชี
-- ต้องเข้าคิวรอกันและเสี่ยง deadlock — แพงกว่าปัญหาที่แก้มาก
--
-- ข้อยกเว้นนี้แคบโดยตั้งใจ: ทุกคอลัมน์ที่เหลือต้องไม่เปลี่ยนเลย
-- และเติมได้เฉพาะตอนที่ค่าเดิมเป็น null จึงเขียนทับคู่ที่ตั้งไว้แล้วไม่ได้
create or replace function public.budget_movements_block_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.paired_movement_id is null
     and new.paired_movement_id is not null
     and new.id is not distinct from old.id
     and new.budget_account_id is not distinct from old.budget_account_id
     and new.movement_type is not distinct from old.movement_type
     and new.amount is not distinct from old.amount
     and new.effective_date is not distinct from old.effective_date
     and new.source_type is not distinct from old.source_type
     and new.source_id is not distinct from old.source_id
     and new.reverses_movement_id is not distinct from old.reverses_movement_id
     and new.releases_movement_id is not distinct from old.releases_movement_id
     and new.reason is not distinct from old.reason
     and new.approval_reference is not distinct from old.approval_reference
     and new.created_at is not distinct from old.created_at
     and new.created_by is not distinct from old.created_by
  then
    return new;
  end if;

  raise exception 'รายการเคลื่อนไหวงบแก้หรือลบไม่ได้ ให้ลงรายการย้อน (REVERSAL) แทน'
    using errcode = 'restrict_violation';
end;
$$;

create trigger budget_movements_no_update
  before update or delete on public.budget_movements
  for each row execute function public.budget_movements_block_mutation();

-- -----------------------------------------------------------------------------
-- ยอดคงเหลือของบัญชีเดียว — ใช้ทั้งใน function และให้แอปเรียกได้
-- -----------------------------------------------------------------------------

create or replace function public.budget_available(account_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select available_amount from public.budget_account_balances where budget_account_id = account_id),
    0
  );
$$;

-- -----------------------------------------------------------------------------
-- ลงรายการเคลื่อนไหวหนึ่งแถว
--
-- ล็อกแถวบัญชีงบก่อนอ่านยอด เพื่อให้สองคำขอพร้อมกันเข้าคิวกัน
-- ถ้าไม่ล็อก ทั้งคู่จะเห็นยอดเดิมแล้วลงได้ทั้งคู่จนยอดติดลบ
-- ซึ่งเป็นอาการเดียวกับข้อค้นพบ F-01
--
-- audit event ถูกเขียนใน function เดียวกัน จึงอยู่ในทรานแซกชันเดียวกับ movement
-- (ปิดหนี้ทางเทคนิคข้อ 2.10 ใน docs/assumptions.md สำหรับส่วนงบประมาณ)
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
  v_projected numeric;
  v_direction integer;
  v_movement_id uuid;
  v_actor uuid := auth.uid();
begin
  if not public.has_permission('budget.manage') then
    raise exception 'ไม่มีสิทธิ์ลงรายการเคลื่อนไหวงบ' using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'จำนวนเงินต้องมากกว่าศูนย์ ทิศทางมาจากชนิดรายการ'
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

  v_direction := case
    when p_type in ('ALLOCATION', 'INCREASE', 'TRANSFER_IN', 'RELEASE') then 1
    when p_type = 'REVERSAL' then
      case
        when (select movement_type from public.budget_movements where id = p_reverses_movement_id)
             in ('ALLOCATION', 'INCREASE', 'TRANSFER_IN', 'RELEASE') then -1
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
      'reason', p_reason
    )
  );

  return v_movement_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- โอนงบระหว่างบัญชี — ต้องเป็นคู่ในทรานแซกชันเดียว
--
-- ล็อกบัญชีตามลำดับ id เสมอ เพื่อไม่ให้เกิด deadlock เมื่อสองคนโอนสวนทางกัน
-- -----------------------------------------------------------------------------

create or replace function public.budget_transfer(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_effective_date date,
  p_reason text,
  p_approval_reference text default null,
  p_request_id text default 'system'
)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_out_id uuid;
  v_in_id uuid;
begin
  if p_from_account_id = p_to_account_id then
    raise exception 'โอนงบไปบัญชีเดียวกันไม่ได้' using errcode = 'check_violation';
  end if;

  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'การโอนงบต้องระบุเหตุผล' using errcode = 'check_violation';
  end if;

  perform id from public.budget_accounts
  where id in (p_from_account_id, p_to_account_id)
  order by id
  for update;

  v_out_id := public.budget_post_movement(
    p_from_account_id, 'TRANSFER_OUT', p_amount, p_effective_date,
    p_reason, 'BUDGET_TRANSFER', null, null, null, null, p_approval_reference, p_request_id
  );

  v_in_id := public.budget_post_movement(
    p_to_account_id, 'TRANSFER_IN', p_amount, p_effective_date,
    p_reason, 'BUDGET_TRANSFER', null, v_out_id, null, null, p_approval_reference, p_request_id
  );

  -- ชี้กลับให้ครบทั้งสองทาง ทำหลัง insert เพราะต้องรู้ id ของอีกฝั่งก่อน
  -- trigger append-only เปิดช่องไว้เฉพาะการเติมคู่ที่ยังว่าง (ดูด้านบน)
  update public.budget_movements set paired_movement_id = v_in_id where id = v_out_id;

  return array[v_out_id, v_in_id];
end;
$$;

-- -----------------------------------------------------------------------------
-- สิทธิ์เรียก function
-- -----------------------------------------------------------------------------

revoke execute on function public.budget_available(uuid) from public;
revoke execute on function public.budget_post_movement(
  uuid, public.budget_movement_type, numeric, date, text, text, uuid, uuid, uuid, uuid, text, text
) from public;
revoke execute on function public.budget_transfer(uuid, uuid, numeric, date, text, text, text)
  from public;

grant execute on function public.budget_available(uuid) to authenticated;
grant execute on function public.budget_post_movement(
  uuid, public.budget_movement_type, numeric, date, text, text, uuid, uuid, uuid, uuid, text, text
) to authenticated;
grant execute on function public.budget_transfer(uuid, uuid, numeric, date, text, text, text)
  to authenticated;
