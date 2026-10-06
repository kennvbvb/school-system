-- =============================================================================
-- Migration — แก้ความถูกต้องของ ledger คลังพัสดุ (F-02, F-03, F-04 ในรายงานตรวจสอบ
-- 2026-10-06)
--
-- F-03  ลำดับของ ledger ต้องมาจากตัวนับต่อรายการ (sequence_no) ไม่ใช่ created_at/id
--       เดิมใช้ now() ซึ่งคือเวลาเริ่มทรานแซกชัน ไม่ใช่เวลาที่ได้ล็อก และ id เป็น UUID
--       สุ่ม — สองรายการในทรานแซกชันเดียวกันจึงลำดับสลับได้ ทำให้ balance_after
--       และ view ยอดคงเหลือชี้ไปแถวที่ไม่ใช่แถวล่าสุดจริง
-- F-02  ย้อนรายการ (REVERSAL) ต้องตรวจในฐานข้อมูลว่าต้นทางอยู่รายการเดียวกัน
--       และจำนวนเท่ากัน ไม่ไว้ใจให้ server action ตรวจฝั่งเดียว (เรียก RPC ตรงได้)
-- F-04  รายการแรกของรายการพัสดุไม่ต้องเป็น OPENING_BALANCE อีกต่อไป — รับเข้าครั้งแรก
--       จากยอด 0 ได้เลย ส่วน OPENING_BALANCE ยังลงได้เฉพาะเมื่อยังไม่มีรายการใด
-- และปิดสิทธิ์ anon ที่ Supabase ให้ execute โดยตรง (revoke from public ไม่พอ)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- sequence_no — backfill ตามลำดับเดิม (created_at, id) แล้วค่อยบังคับต่อจากนี้
--
-- ตารางนี้ append-only ผ่าน trigger จึงต้องปิด trigger ชั่วคราวเฉพาะตอน backfill
-- (migration รันเป็นเจ้าของตาราง) แล้วเปิดคืนทันทีใน migration เดียวกัน
-- -----------------------------------------------------------------------------

alter table public.stock_movements add column sequence_no bigint;

alter table public.stock_movements disable trigger stock_movements_no_update;

update public.stock_movements m
set sequence_no = o.rn
from (
  select id, row_number() over (partition by item_id order by created_at, id) as rn
  from public.stock_movements
) o
where o.id = m.id;

alter table public.stock_movements enable trigger stock_movements_no_update;

alter table public.stock_movements alter column sequence_no set not null;
alter table public.stock_movements
  add constraint stock_movements_sequence_positive check (sequence_no > 0);

-- unique นี้คือเกราะสุดท้าย: ถ้าล็อกหลุดจนสองแถวได้เลขเดียวกัน ทรานแซกชันหลังจะล้ม
-- ไม่ใช่ลงสำเร็จแล้วยอดเพี้ยนเงียบ ๆ
create unique index stock_movements_item_sequence
  on public.stock_movements (item_id, sequence_no);

drop index public.stock_movements_item_idx;

-- -----------------------------------------------------------------------------
-- view ยอดคงเหลือ — เรียงตาม sequence_no (ชื่อ/คอลัมน์เดิมทุกอย่าง)
-- -----------------------------------------------------------------------------

create or replace view public.stock_item_balances as
select distinct on (item_id)
  item_id,
  balance_after as on_hand,
  effective_date as as_of_date,
  created_at as as_of
from public.stock_movements
order by item_id, sequence_no desc;

comment on view public.stock_item_balances is
  'ยอดคงเหลือล่าสุดต่อรายการพัสดุ — อ่านจากแถวสุดท้ายตาม sequence_no ไม่ sum ทั้งชุด';

-- -----------------------------------------------------------------------------
-- stock_post_movement — ล็อกรายการพัสดุ แล้วค่อยหาลำดับถัดไปและยอดล่าสุด
-- -----------------------------------------------------------------------------

create or replace function public.stock_post_movement(
  p_item_id uuid,
  p_type public.stock_movement_type,
  p_quantity numeric,
  p_effective_date date,
  p_reference text,
  p_reason text default null,
  p_source_type text default null,
  p_source_id uuid default null,
  p_requested_by uuid default null,
  p_approved_by uuid default null,
  p_attachment_id uuid default null,
  p_reverses_movement_id uuid default null,
  p_request_id text default 'system'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.inventory_items%rowtype;
  v_target public.stock_movements%rowtype;
  v_last_balance numeric;
  v_last_sequence bigint;
  v_direction integer;
  v_new_balance numeric;
  v_movement_id uuid;
  v_actor uuid := auth.uid();
  v_required_permission text;
begin
  v_required_permission := case
    when p_type = 'ISSUE' then 'inventory.issue'
    when p_type in ('ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE', 'REVERSAL') then 'inventory.adjust'
    else 'inventory.receive' -- RECEIPT, RETURN, OPENING_BALANCE
  end;

  if not public.has_permission(v_required_permission) then
    raise exception 'ไม่มีสิทธิ์ลงรายการเคลื่อนไหวคลังพัสดุชนิดนี้' using errcode = 'insufficient_privilege';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'จำนวนต้องมากกว่าศูนย์ ทิศทางมาจากชนิดรายการ' using errcode = 'check_violation';
  end if;

  if btrim(coalesce(p_reference, '')) = '' then
    raise exception 'ต้องระบุเลขที่เอกสารอ้างอิงทุกครั้ง' using errcode = 'check_violation';
  end if;

  if p_type <> 'REVERSAL' and p_reverses_movement_id is not null then
    raise exception 'ระบุรายการต้นทางได้เฉพาะรายการชนิดย้อนรายการ (REVERSAL)'
      using errcode = 'check_violation';
  end if;

  -- ล็อกรายการพัสดุก่อนอ่านอะไรทั้งนั้น — จุดนี้คือสิ่งที่กัน race condition
  -- และทำให้ลำดับ sequence_no ที่คำนวณต่อไปนี้ไม่ชนกันระหว่างสองคำขอ
  select * into v_item from public.inventory_items where id = p_item_id for update;

  if not found then
    raise exception 'ไม่พบรายการพัสดุที่ระบุ' using errcode = 'foreign_key_violation';
  end if;

  if v_item.status = 'INACTIVE' then
    raise exception 'รายการพัสดุนี้ถูกปิดใช้งานแล้ว ลงรายการเพิ่มไม่ได้' using errcode = 'restrict_violation';
  end if;

  select sequence_no, balance_after into v_last_sequence, v_last_balance
  from public.stock_movements
  where item_id = p_item_id
  order by sequence_no desc
  limit 1;

  -- ยังไม่มีรายการใดเลย = ยอด 0 และลำดับเริ่มที่ 1 (ไม่บังคับ OPENING_BALANCE แล้ว)
  v_last_sequence := coalesce(v_last_sequence, 0);
  v_last_balance := coalesce(v_last_balance, 0);

  if p_type = 'OPENING_BALANCE' and v_last_sequence > 0 then
    raise exception 'ลงยอดยกมาได้เฉพาะครั้งแรกก่อนมีรายการเคลื่อนไหวอื่นของรายการนี้'
      using errcode = 'restrict_violation';
  end if;

  if p_type = 'REVERSAL' then
    if p_reverses_movement_id is null then
      raise exception 'รายการย้อนต้องระบุว่าย้อนรายการใด' using errcode = 'check_violation';
    end if;

    select * into v_target from public.stock_movements where id = p_reverses_movement_id;

    if not found then
      raise exception 'ไม่พบรายการต้นทางที่ต้องการย้อน' using errcode = 'foreign_key_violation';
    end if;

    if v_target.movement_type = 'REVERSAL' then
      raise exception 'ย้อนรายการย้อนอีกชั้นไม่ได้' using errcode = 'restrict_violation';
    end if;

    -- F-02: ตรวจในฐานข้อมูลเอง ไม่ไว้ใจพารามิเตอร์ที่ผู้เรียกส่งมา
    if v_target.item_id <> p_item_id then
      raise exception 'รายการต้นทางเป็นคนละรายการพัสดุกับที่ระบุ ย้อนข้ามรายการไม่ได้'
        using errcode = 'check_violation';
    end if;

    if v_target.quantity <> p_quantity then
      raise exception 'จำนวนที่ย้อนต้องเท่ากับจำนวนของรายการต้นทาง (% แต่ระบุ %)',
        trim(to_char(v_target.quantity, 'FM999999999990.000')),
        trim(to_char(p_quantity, 'FM999999999990.000'))
        using errcode = 'check_violation';
    end if;

    if btrim(coalesce(p_reason, '')) = '' then
      raise exception 'การย้อนรายการต้องระบุเหตุผล' using errcode = 'check_violation';
    end if;

    v_direction := case
      when v_target.movement_type in ('OPENING_BALANCE', 'RECEIPT', 'RETURN', 'ADJUSTMENT_INCREASE') then -1
      else 1
    end;
  else
    v_direction := case
      when p_type in ('OPENING_BALANCE', 'RECEIPT', 'RETURN', 'ADJUSTMENT_INCREASE') then 1
      else -1 -- ISSUE, ADJUSTMENT_DECREASE
    end;
  end if;

  v_new_balance := v_last_balance + (v_direction * p_quantity);

  if v_new_balance < 0 then
    raise exception 'ยอดคงเหลือไม่พอ คงเหลือ % ขอเบิก/ปรับลด %',
      trim(to_char(v_last_balance, 'FM999999999990.000')),
      trim(to_char(p_quantity, 'FM999999999990.000'))
      using errcode = 'check_violation';
  end if;

  insert into public.stock_movements (
    item_id, sequence_no, movement_type, quantity, balance_after, effective_date,
    reference, reason, source_type, source_id,
    requested_by, approved_by, attachment_id, reverses_movement_id, created_by
  ) values (
    p_item_id, v_last_sequence + 1, p_type, p_quantity, v_new_balance, p_effective_date,
    p_reference, p_reason, p_source_type, p_source_id,
    p_requested_by, p_approved_by, p_attachment_id, p_reverses_movement_id, v_actor
  )
  returning id into v_movement_id;

  insert into public.audit_events (
    request_id, actor_id, action, entity_type, entity_id, after_json, metadata_json
  ) values (
    p_request_id,
    v_actor,
    'entity.create',
    'stock_movement',
    v_movement_id::text,
    jsonb_build_object(
      'item_id', p_item_id,
      'movement_type', p_type,
      'quantity', p_quantity,
      'effective_date', p_effective_date,
      'reference', p_reference
    ),
    jsonb_build_object('balance_after', v_new_balance, 'reason', p_reason, 'sequence_no', v_last_sequence + 1)
  );

  return v_movement_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- สิทธิ์ — Supabase ให้ execute แก่ anon โดยตรง `from public` อย่างเดียวไม่พอ
-- (create or replace คงสิทธิ์เดิมไว้ แต่ย้ำซ้ำเพื่อให้ migration นี้อ่านแล้วครบในตัว)
-- -----------------------------------------------------------------------------

revoke execute on function public.stock_on_hand(uuid) from public, anon;
revoke execute on function public.stock_post_movement(
  uuid, public.stock_movement_type, numeric, date, text, text, text, uuid, uuid, uuid, uuid, uuid, text
) from public, anon;

grant execute on function public.stock_on_hand(uuid) to authenticated;
grant execute on function public.stock_post_movement(
  uuid, public.stock_movement_type, numeric, date, text, text, text, uuid, uuid, uuid, uuid, uuid, text
) to authenticated;
