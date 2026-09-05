-- =============================================================================
-- Migration 0009 — ปิดช่องโหว่ความถูกต้องของ ledger ที่ค้างจาก migration 0006
--
-- ที่มา: ระหว่างทำหน้าจอบัญชีงบ (PR-02.1) พบว่ากฎสามข้อที่ src/domain/budget
-- ประกาศไว้ ถูกบังคับเฉพาะฝั่ง TypeScript ไม่ได้ถูกบังคับที่ฐานข้อมูล
-- ซึ่งขัดกับหลักการข้อ 4.2 "เลี่ยงด้วยการเรียก API ตรงไม่ได้"
--
-- budget_post_movement เปิดให้ role authenticated เรียกได้ผ่าน PostgREST อยู่แล้ว
-- ผู้ถือสิทธิ์ budget.manage จึงเรียกตรงได้โดยไม่ผ่านหน้าจอ ทั้งสามข้อด้านล่าง
-- จึงเป็นช่องที่เปิดอยู่จริง ไม่ใช่ความเสี่ยงทางทฤษฎี
--
--   1. โอนงบขาข้างเดียว — เรียก budget_post_movement ด้วย 'TRANSFER_IN' ตรง ๆ
--      ได้ผลเป็นการเพิ่มงบให้บัญชีหนึ่งโดยไม่มีบัญชีใดถูกหักคู่กัน
--      เท่ากับสร้างเงินขึ้นจากระบบ
--   2. ย้อนรายการของบัญชีอื่น หรือย้อนรายการย้อนอีกชั้น — ทำให้ยอดของบัญชีที่ย้อน
--      เปลี่ยนโดยไม่มีรายการต้นทางของตัวเองรองรับ
--      (การย้อนซ้ำแถวเดิมถูกกันด้วย unique index ใน migration 0005 อยู่แล้ว)
--   3. คืนยอดเกินที่กันไว้ หรือคืนให้รายการที่ไม่ใช่การกันยอด — ทำให้ยอดที่
--      ใช้ได้งอกขึ้นจากการคืนยอดที่ไม่เคยกัน
--
-- ทั้งสามข้อมีการตรวจใน assertMovementShapeValid() อยู่แล้ว migration นี้ย้าย
-- กฎเดียวกันลงมาที่ชั้นที่บังคับได้จริง ไม่ได้เปลี่ยนกติกา
-- =============================================================================

-- -----------------------------------------------------------------------------
-- budget_post_movement — เพิ่มการตรวจสามชุด ส่วนที่เหลือคงเดิม
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
begin
  if not public.has_permission('budget.manage') then
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
      'reason', p_reason
    )
  );

  return v_movement_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- budget_transfer — ตั้งเครื่องหมายว่ากำลังโอนจริง
--
-- ใช้ set_config แบบ local (พารามิเตอร์ที่สาม = true) จึงหมดผลเมื่อจบทรานแซกชัน
-- ไม่ว่าจะ commit หรือ rollback และไม่รั่วไปยังคำขออื่นที่ใช้ connection เดียวกัน
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

  perform set_config('app.budget_transfer_active', 'on', true);

  v_out_id := public.budget_post_movement(
    p_from_account_id, 'TRANSFER_OUT', p_amount, p_effective_date,
    p_reason, 'BUDGET_TRANSFER', null, null, null, null, p_approval_reference, p_request_id
  );

  v_in_id := public.budget_post_movement(
    p_to_account_id, 'TRANSFER_IN', p_amount, p_effective_date,
    p_reason, 'BUDGET_TRANSFER', null, v_out_id, null, null, p_approval_reference, p_request_id
  );

  -- ปิดเครื่องหมายทันทีที่ลงครบคู่ เพื่อไม่ให้การเรียกอื่นในทรานแซกชันเดียวกัน
  -- อาศัยเครื่องหมายนี้ลง TRANSFER ขาเดียวต่อท้าย
  perform set_config('app.budget_transfer_active', 'off', true);

  -- ชี้กลับให้ครบทั้งสองทาง ทำหลัง insert เพราะต้องรู้ id ของอีกฝั่งก่อน
  -- trigger append-only เปิดช่องไว้เฉพาะการเติมคู่ที่ยังว่าง (migration 0006)
  update public.budget_movements set paired_movement_id = v_in_id where id = v_out_id;

  return array[v_out_id, v_in_id];
end;
$$;
