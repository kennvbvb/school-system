-- =============================================================================
-- Migration 0016 — กันยอดงบตอนอนุมัติ และคืนยอดตอนยกเลิก
--
-- ปิดช่องโหว่ที่ค้างมาตั้งแต่ PR-03 และบันทึกไว้ใน PR-04a:
--
--   **สองรายการผ่านการตรวจงบพร้อมกันได้** การตรวจ `BUDGET_INSUFFICIENT` ตอน
--   ส่งอนุมัติเป็นการ "อ่านยอดแล้วเทียบ" เท่านั้น ไม่ได้จองยอดไว้ รายการสองใบที่
--   รวมกันเกินงบจึงผ่านการตรวจได้ทั้งคู่ แล้วอนุมัติได้ทั้งคู่ จนยอดจริงติดลบ
--   — เป็นอาการเดียวกับข้อค้นพบ F-01 (โครงการที่งบติดลบในไฟล์จริง)
--
-- การตรวจตอนส่งอนุมัติยังมีประโยชน์อยู่ (บอกผู้ขอตั้งแต่เนิ่น ๆ) แต่ **ไม่ใช่ชั้นที่
-- บังคับ** ชั้นที่บังคับคือการลง RESERVE จริงตอนอนุมัติ ซึ่งล็อกแถวบัญชีก่อนอ่านยอด
--
-- ยอดที่กันไว้จะถูกคืนเมื่อยกเลิกรายการที่เคยอนุมัติแล้วเท่านั้น
-- **การแปลงยอดที่กันไว้เป็นค่าใช้จ่ายจริง (COMMIT/ACTUAL) ยังไม่อยู่ในรอบนี้**
-- อยู่กับงานตรวจรับและเบิกจ่าย ซึ่งเป็นคนละเรื่องกับการอนุมัติ
-- =============================================================================

-- -----------------------------------------------------------------------------
-- budget_post_movement — เปิดทางให้ workflow ลง RESERVE/RELEASE ได้
--
-- ปัญหา: ฟังก์ชันนี้ต้องการสิทธิ์ `budget.manage` ซึ่ง **ผู้อนุมัติไม่จำเป็นต้องมี**
-- ผู้อนุมัติมีหน้าที่อนุมัติการจัดซื้อ ไม่ใช่จัดการงบ การบังคับให้ผู้อนุมัติทุกคน
-- ถือสิทธิ์จัดการงบเพื่อให้กดอนุมัติได้ คือการขยายสิทธิ์ให้เกินหน้าที่จริง
--
-- วิธีแก้: ใช้ค่าตั้งระดับทรานแซกชันเป็นเครื่องหมายว่า "การลงรายการนี้มาจาก workflow
-- ไม่ใช่จากคน" แบบเดียวกับที่ `budget_transfer` ใช้อยู่แล้ว — ผู้เรียกผ่าน PostgREST
-- ตั้งค่านี้เองไม่ได้ เพราะ `set_config` อยู่ใน pg_catalog ซึ่งไม่ได้ถูก expose เป็น RPC
--
-- **เครื่องหมายนี้อนุญาตเฉพาะ RESERVE และ RELEASE** ไม่ใช่ทุกชนิด การเปิดกว้าง
-- ทั้งหมดจะทำให้ทรานแซกชันที่ตั้งธงแล้วลง ALLOCATION เพิ่มงบเองได้
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

    select coalesce(sum(amount), 0) into v_released
    from public.budget_movements
    where releases_movement_id = p_releases_movement_id;

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
-- procurement_reserve_budget — กันยอดตามแหล่งเงินของรายการ
--
-- รวมยอดตามบัญชีก่อนลง ไม่ลงทีละบรรทัด — รายการที่ใช้บัญชีเดียวกันสองบรรทัด
-- ควรได้รายการกันยอดหนึ่งแถวต่อบัญชี ไม่ใช่สองแถวที่ต้องคืนแยกกันทีหลัง
-- และเรียงตาม id เพื่อให้ทุกทรานแซกชันล็อกบัญชีในลำดับเดียวกัน กัน deadlock
-- เมื่อสองรายการใช้บัญชีชุดเดียวกันแต่คนละลำดับ
-- -----------------------------------------------------------------------------

create or replace function public.procurement_reserve_budget(
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
  v_alloc record;
  v_count integer := 0;
begin
  perform set_config('app.budget_workflow_posting', 'on', true);

  for v_alloc in
    select budget_account_id, sum(amount) as total
    from public.procurement_funding_allocations
    where procurement_id = p_procurement_id
    group by budget_account_id
    order by budget_account_id
  loop
    perform public.budget_post_movement(
      v_alloc.budget_account_id, 'RESERVE', v_alloc.total, p_effective_date,
      p_reason, 'PROCUREMENT', p_procurement_id,
      null, null, null, null, p_request_id
    );
    v_count := v_count + 1;
  end loop;

  -- ปิดเครื่องหมายทันทีที่ลงครบ เพื่อไม่ให้การเรียกอื่นในทรานแซกชันเดียวกันอาศัยต่อ
  perform set_config('app.budget_workflow_posting', 'off', true);

  return v_count;
end;
$$;

comment on function public.procurement_reserve_budget(uuid, date, text, text) is
  'กันยอดงบตามแหล่งเงินของรายการจัดซื้อ — เรียกจาก procurement_transition เท่านั้น';

-- -----------------------------------------------------------------------------
-- procurement_release_budget — คืนยอดที่ยังค้างอยู่ของรายการ
--
-- คืนเฉพาะ **ส่วนที่ยังไม่ได้คืน** ของแต่ละรายการกันยอด ไม่ใช่คืนเต็มจำนวน
-- ถ้าคืนเต็มจำนวนโดยไม่หักที่คืนไปแล้ว ยอดที่ใช้ได้จะงอกขึ้นจากการคืนซ้ำ
-- (`budget_post_movement` กันไว้อีกชั้นอยู่แล้ว แต่ที่นี่ต้องคำนวณให้ถูกตั้งแต่ต้น
-- มิฉะนั้นการยกเลิกจะล้มด้วยข้อความเรื่องคืนยอดเกิน ซึ่งผู้ใช้แก้ตามไม่ได้)
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
  v_reserve record;
  v_outstanding numeric;
  v_count integer := 0;
begin
  perform set_config('app.budget_workflow_posting', 'on', true);

  for v_reserve in
    select m.id, m.budget_account_id, m.amount
    from public.budget_movements m
    where m.source_type = 'PROCUREMENT'
      and m.source_id = p_procurement_id
      and m.movement_type = 'RESERVE'
      /* รายการกันยอดที่ถูกย้อนไปแล้วไม่มีผลกับยอดอีก จึงไม่ต้องคืน
         ถ้าคืนด้วยจะกลายเป็นการเพิ่มยอดที่ใช้ได้จากรายการที่ถูกลบผลไปแล้ว */
      and not exists (
        select 1 from public.budget_movements r
        where r.reverses_movement_id = m.id
      )
    order by m.budget_account_id
  loop
    select v_reserve.amount - coalesce(sum(r.amount), 0) into v_outstanding
    from public.budget_movements r
    where r.releases_movement_id = v_reserve.id;

    if v_outstanding > 0 then
      perform public.budget_post_movement(
        v_reserve.budget_account_id, 'RELEASE', v_outstanding, p_effective_date,
        p_reason, 'PROCUREMENT', p_procurement_id,
        null, null, v_reserve.id, null, p_request_id
      );
      v_count := v_count + 1;
    end if;
  end loop;

  perform set_config('app.budget_workflow_posting', 'off', true);

  return v_count;
end;
$$;

comment on function public.procurement_release_budget(uuid, date, text, text) is
  'คืนยอดงบที่กันไว้ให้รายการจัดซื้อ — เรียกจาก procurement_transition เท่านั้น';

/*
 * ทั้งสองฟังก์ชันไม่เปิดให้ authenticated เรียกตรง
 *
 * ถ้าเรียกตรงได้ จะมีทางกันยอดหรือคืนยอดโดยไม่เปลี่ยนสถานะรายการ ทำให้ ledger
 * กับสถานะไม่ตรงกัน — รายการที่ยังไม่อนุมัติจะมียอดกันไว้ หรือรายการที่อนุมัติแล้ว
 * จะไม่มียอดกันไว้ ซึ่งตรวจสอบย้อนหลังไม่ได้เลย
 *
 * ต้องเพิกถอนจาก `authenticated` ด้วย ไม่ใช่แค่จาก `public` — Supabase ตั้ง
 * default privileges ให้ role นี้ได้ execute ทุกฟังก์ชันในสคีมา การ revoke จาก
 * `public` อย่างเดียวจึงไม่มีผล และจะดูเหมือนได้ผลทั้งที่ยังเรียกได้อยู่
 */
revoke all on function public.procurement_reserve_budget(uuid, date, text, text)
  from public, authenticated, anon;
revoke all on function public.procurement_release_budget(uuid, date, text, text)
  from public, authenticated, anon;
