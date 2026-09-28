-- =============================================================================
-- Migration 0022 — RLS, append-only enforcement และ function ของคลังพัสดุ
--
-- แยกจาก migration 0021 ด้วยเหตุผลเดียวกับที่แยก budget ledger ออกเป็นสองไฟล์:
-- โครงสร้างตารางกับกฎการเข้าถึงเปลี่ยนคนละจังหวะกัน
-- =============================================================================

alter table public.inventory_items enable row level security;
alter table public.stock_movements enable row level security;

-- -----------------------------------------------------------------------------
-- รายการพัสดุ — อ่านได้เมื่อมี inventory.read แก้ทะเบียนได้เมื่อมี inventory.adjust
--
-- ใช้ inventory.adjust แทนที่จะเพิ่มสิทธิ์ใหม่ เพราะการกำหนดรายการพัสดุใหม่
-- (รหัส/ชื่อ/หน่วยนับ) เป็นการตัดสินใจเชิงบริหารคลัง ไม่ใช่งานรับของประจำวัน
-- ซึ่งตรงกับกลุ่มบทบาทที่มีสิทธิ์นี้อยู่แล้ว (INVENTORY_OFFICER, SYSTEM_ADMIN)
-- -----------------------------------------------------------------------------

create policy inventory_items_select on public.inventory_items
  for select to authenticated
  using (public.has_permission('inventory.read'));

create policy inventory_items_insert on public.inventory_items
  for insert to authenticated
  with check (public.has_permission('inventory.adjust'));

create policy inventory_items_update on public.inventory_items
  for update to authenticated
  using (public.has_permission('inventory.adjust'))
  with check (public.has_permission('inventory.adjust'));

-- ไม่มี policy delete — รายการพัสดุที่มีรายการเคลื่อนไหวแล้วต้องอยู่ต่อ ปิดด้วย status
revoke delete on public.inventory_items from authenticated, anon;

-- -----------------------------------------------------------------------------
-- รายการเคลื่อนไหว — append-only เหมือน budget_movements และ audit_events
--
-- ไม่มี policy insert ตรง ๆ: การลงรายการต้องผ่าน function ที่ล็อกรายการพัสดุ
-- และอ่านยอดล่าสุดก่อน มิฉะนั้นสองคำขอพร้อมกันจะเห็นยอดเดิมแล้วลงได้ทั้งคู่
-- จนยอดติดลบ ซึ่งเป็นของจริงที่เบิกไม่ได้ (ต่างจากงบที่ override ได้)
-- -----------------------------------------------------------------------------

create policy stock_movements_select on public.stock_movements
  for select to authenticated
  using (public.has_permission('inventory.read'));

revoke insert, update, delete on public.stock_movements from authenticated, anon;

-- กันการแก้ผ่านเส้นทางอื่นที่ privilege ไม่ครอบคลุม เช่น function ที่เขียนผิด
--
-- ต่างจาก budget_movements ตรงที่ไม่มีข้อยกเว้นให้เติมคอลัมน์ใดภายหลังเลย
-- เพราะ stock_movements ไม่มีคู่ต้องชี้หากันแบบ TRANSFER — ปฏิเสธทุกการแก้ไข/ลบ
create or replace function public.stock_movements_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'รายการเคลื่อนไหวคลังพัสดุแก้หรือลบไม่ได้ ให้ลงรายการย้อน (REVERSAL) แทน'
    using errcode = 'restrict_violation';
end;
$$;

create trigger stock_movements_no_update
  before update or delete on public.stock_movements
  for each row execute function public.stock_movements_block_mutation();

-- -----------------------------------------------------------------------------
-- ยอดคงเหลือของรายการเดียว — ใช้ทั้งใน function และให้แอปเรียกได้
-- -----------------------------------------------------------------------------

create or replace function public.stock_on_hand(item_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select on_hand from public.stock_item_balances where stock_item_balances.item_id = stock_on_hand.item_id),
    0
  );
$$;

-- -----------------------------------------------------------------------------
-- ลงรายการเคลื่อนไหวหนึ่งแถว
--
-- ล็อกแถวรายการพัสดุก่อนอ่านยอด เพื่อให้สองคำขอพร้อมกันเข้าคิวกัน
-- (เหตุผลเดียวกับ budget_post_movement) — ล็อกที่ตัว item ไม่ใช่แถว ledger ล่าสุด
-- เพราะรายการที่ยังไม่มีแถวเลย (สร้างใหม่) ก็ต้องกันการลงพร้อมกันได้เช่นกัน
--
-- audit event ถูกเขียนใน function เดียวกัน จึงอยู่ในทรานแซกชันเดียวกับ movement
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
  v_last_balance numeric;
  v_has_movements boolean;
  v_direction integer;
  v_new_balance numeric;
  v_movement_id uuid;
  v_actor uuid := auth.uid();
  v_required_permission text;
  v_target_type public.stock_movement_type;
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

  -- ล็อกรายการพัสดุก่อนอ่านยอด — จุดนี้คือสิ่งที่กัน race condition
  select * into v_item from public.inventory_items where id = p_item_id for update;

  if not found then
    raise exception 'ไม่พบรายการพัสดุที่ระบุ' using errcode = 'foreign_key_violation';
  end if;

  if v_item.status = 'INACTIVE' then
    raise exception 'รายการพัสดุนี้ถูกปิดใช้งานแล้ว ลงรายการเพิ่มไม่ได้' using errcode = 'restrict_violation';
  end if;

  select exists(select 1 from public.stock_movements where item_id = p_item_id) into v_has_movements;

  if p_type = 'OPENING_BALANCE' and v_has_movements then
    raise exception 'ลงยอดยกมาได้เฉพาะครั้งแรกก่อนมีรายการเคลื่อนไหวอื่นของรายการนี้'
      using errcode = 'restrict_violation';
  end if;

  if p_type <> 'OPENING_BALANCE' and not v_has_movements then
    raise exception 'ต้องลงยอดยกมาก่อนลงรายการเคลื่อนไหวชนิดอื่นของรายการนี้'
      using errcode = 'restrict_violation';
  end if;

  select balance_after into v_last_balance
  from public.stock_movements
  where item_id = p_item_id
  order by created_at desc, id desc
  limit 1;
  v_last_balance := coalesce(v_last_balance, 0);

  v_direction := case
    when p_type in ('OPENING_BALANCE', 'RECEIPT', 'RETURN', 'ADJUSTMENT_INCREASE') then 1
    when p_type in ('ISSUE', 'ADJUSTMENT_DECREASE') then -1
    when p_type = 'REVERSAL' then
      case
        when p_reverses_movement_id is null then null
        else (
          select case
            when movement_type in ('OPENING_BALANCE', 'RECEIPT', 'RETURN', 'ADJUSTMENT_INCREASE') then -1
            else 1
          end
          from public.stock_movements where id = p_reverses_movement_id
        )
      end
  end;

  if p_type = 'REVERSAL' then
    if p_reverses_movement_id is null then
      raise exception 'รายการย้อนต้องระบุว่าย้อนรายการใด' using errcode = 'check_violation';
    end if;

    select movement_type into v_target_type
    from public.stock_movements where id = p_reverses_movement_id;

    if not found then
      raise exception 'ไม่พบรายการต้นทางที่ต้องการย้อน' using errcode = 'foreign_key_violation';
    end if;

    if v_target_type = 'REVERSAL' then
      raise exception 'ย้อนรายการย้อนอีกชั้นไม่ได้' using errcode = 'restrict_violation';
    end if;

    if btrim(coalesce(p_reason, '')) = '' then
      raise exception 'การย้อนรายการต้องระบุเหตุผล' using errcode = 'check_violation';
    end if;
  end if;

  v_new_balance := v_last_balance + (v_direction * p_quantity);

  if v_new_balance < 0 then
    raise exception 'ยอดคงเหลือไม่พอ คงเหลือ % ขอเบิก/ปรับลด %',
      trim(to_char(v_last_balance, 'FM999999999990.000')),
      trim(to_char(p_quantity, 'FM999999999990.000'))
      using errcode = 'check_violation';
  end if;

  insert into public.stock_movements (
    item_id, movement_type, quantity, balance_after, effective_date,
    reference, reason, source_type, source_id,
    requested_by, approved_by, attachment_id, reverses_movement_id, created_by
  ) values (
    p_item_id, p_type, p_quantity, v_new_balance, p_effective_date,
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
    jsonb_build_object('balance_after', v_new_balance, 'reason', p_reason)
  );

  return v_movement_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- สิทธิ์เรียก function
-- -----------------------------------------------------------------------------

revoke execute on function public.stock_on_hand(uuid) from public;
revoke execute on function public.stock_post_movement(
  uuid, public.stock_movement_type, numeric, date, text, text, text, uuid, uuid, uuid, uuid, uuid, text
) from public;

grant execute on function public.stock_on_hand(uuid) to authenticated;
grant execute on function public.stock_post_movement(
  uuid, public.stock_movement_type, numeric, date, text, text, text, uuid, uuid, uuid, uuid, uuid, text
) to authenticated;
