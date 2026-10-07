-- =============================================================================
-- แก้ F-05 — ผู้เบิก/ผู้อนุมัติของคลัง: รายชื่อให้เลือกได้จริง และผู้อนุมัติต้องมีอำนาจ
--
-- เดิม:
--   1) UI ดึงรายชื่อผู้เบิก/ผู้อนุมัติจากตาราง profiles ซึ่ง RLS ให้เห็นเฉพาะตนเอง (หรือผู้มี users.read)
--      เจ้าหน้าที่คลังตามบทบาทปกติจึงเลือกได้แต่ตัวเอง — เบิกให้ครูคนอื่นหรือระบุผู้อนุมัติจริงไม่ได้
--   2) stock_post_movement รับ UUID ผู้เบิก/ผู้อนุมัติที่ผู้เรียกเลือกมาโดยไม่ตรวจอะไรเลย
--
-- ทางแก้ในรอบนี้:
--   * RPC inventory_staff_directory() — id/ชื่อ/รหัสพนักงาน/ธง can_approve ของผู้ใช้ที่ active เท่านั้น
--     ไม่มีอีเมล ไม่มีบทบาท เปิดเฉพาะผู้มี inventory.issue หรือ inventory.adjust
--   * สิทธิ์ใหม่ inventory.approve (อำนาจอนุมัติเบิกจ่าย/ปรับยอด) — ให้ APPROVER และ SYSTEM_ADMIN เป็นค่าเริ่มต้น
--     (การตัดสินใจเชิงนโยบายที่ต้องให้โรงเรียนยืนยัน ดู docs/assumptions.md; ปรับได้ที่ role_permissions)
--   * stock_post_movement ตรวจ: ผู้เบิกต้อง active, ผู้อนุมัติต้อง active และมี inventory.approve,
--     ผู้เบิกกับผู้อนุมัติต้องเป็นคนละคน
--
-- ขอบเขตที่ยังไม่ทำ: การอนุมัติ "ในระบบ" (ใบเบิก pending → ผู้อนุมัติกดอนุมัติด้วย session ของตน → จึงลง
-- ledger) — ต้องรู้ขั้นตอนจริงของโรงเรียนก่อน จึงยังเป็นการบันทึกว่าใครอนุมัติ (จากเอกสารกระดาษ) ที่ฐานข้อมูล
-- ตรวจว่าผู้นั้นมีอำนาจจริง
-- =============================================================================

-- สิทธิ์ใหม่ — ไม่อ้างอิงบทบาทถ้ายังไม่มี (migration รันก่อน seed ในฐานเปล่า) seed-reference.sql เติมคู่บทบาทให้อีกครั้ง
insert into public.permissions (code, description_th)
values ('inventory.approve', 'อนุมัติการเบิกจ่ายและการปรับยอดคลัง')
on conflict (code) do update set description_th = excluded.description_th;

insert into public.role_permissions (role_code, permission_code)
select r.code, 'inventory.approve'
from public.roles r
where r.code in ('APPROVER', 'SYSTEM_ADMIN')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- ผู้ใช้คนนี้ (ที่ active) มีสิทธิ์นี้ไหม — ฟังก์ชันภายใน ใช้ตรวจผู้อนุมัติที่ผู้เรียกระบุมา
-- (has_permission ตรวจเฉพาะ auth.uid() ของผู้เรียก ใช้กับผู้อื่นไม่ได้)
-- -----------------------------------------------------------------------------

create or replace function public.profile_has_permission(p_user uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    join public.role_permissions rp on rp.role_code = ur.role_code
    where p.id = p_user
      and p.is_active
      and rp.permission_code = p_permission
  );
$$;

revoke execute on function public.profile_has_permission(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- รายชื่อผู้ใช้สำหรับเลือกเป็นผู้เบิก/ผู้อนุมัติ — เปิดเฉพาะข้อมูลที่จำเป็น
-- -----------------------------------------------------------------------------

create or replace function public.inventory_staff_directory()
returns table (
  id uuid,
  display_name text,
  employee_code text,
  can_approve boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.has_permission('inventory.issue') or public.has_permission('inventory.adjust')) then
    raise exception 'ไม่มีสิทธิ์ดูรายชื่อผู้เบิก/ผู้อนุมัติ' using errcode = 'insufficient_privilege';
  end if;

  return query
  select p.id,
         p.first_name_th || ' ' || p.last_name_th,
         p.employee_code,
         public.profile_has_permission(p.id, 'inventory.approve')
  from public.profiles p
  where p.is_active
  order by p.first_name_th, p.last_name_th, p.id;
end;
$$;

revoke execute on function public.inventory_staff_directory() from public, anon;
grant execute on function public.inventory_staff_directory() to authenticated;

comment on function public.inventory_staff_directory() is
  'รายชื่อผู้ใช้ที่ active เฉพาะ id/ชื่อ/รหัสพนักงาน/can_approve สำหรับเลือกผู้เบิก/ผู้อนุมัติของคลัง — ไม่มีอีเมลหรือบทบาท';

-- -----------------------------------------------------------------------------
-- stock_post_movement — เพิ่มการตรวจผู้เบิก/ผู้อนุมัติ (ส่วนอื่นเหมือนเดิมทุกประการ)
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

  -- F-05: ผู้เบิก/ผู้อนุมัติต้องเป็นผู้ใช้ที่ยังใช้งานอยู่ และผู้อนุมัติต้องมีอำนาจอนุมัติ (inventory.approve)
  -- ผู้เรียกส่ง UUID มาเองได้ จึงตรวจที่ฐานข้อมูล ไม่ไว้ใจรายการที่หน้าจอให้เลือก
  -- หมายเหตุ: นี่คือการตรวจว่า "ผู้ที่ระบุเป็นผู้อนุมัติได้จริง" ยังไม่ใช่การอนุมัติในระบบ (ผู้อนุมัติ
  -- ไม่ได้กดอนุมัติเอง) — ดู docs/assumptions.md
  if p_type in ('ISSUE', 'ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE') then
    if p_approved_by is null then
      raise exception 'ต้องระบุผู้อนุมัติ' using errcode = 'check_violation';
    end if;

    if not public.profile_has_permission(p_approved_by, 'inventory.approve') then
      raise exception 'ผู้อนุมัติที่ระบุไม่มีอำนาจอนุมัติรายการคลัง หรือบัญชีถูกปิดใช้งาน'
        using errcode = 'check_violation';
    end if;
  end if;

  if p_type = 'ISSUE' then
    if p_requested_by is null then
      raise exception 'การเบิกจ่ายต้องระบุผู้เบิก' using errcode = 'check_violation';
    end if;

    if not exists (select 1 from public.profiles where id = p_requested_by and is_active) then
      raise exception 'ผู้เบิกที่ระบุไม่มีอยู่หรือถูกปิดใช้งาน' using errcode = 'check_violation';
    end if;

    if p_requested_by = p_approved_by then
      raise exception 'ผู้เบิกกับผู้อนุมัติต้องเป็นคนละคน' using errcode = 'check_violation';
    end if;
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

revoke execute on function public.stock_post_movement(
  uuid, public.stock_movement_type, numeric, date, text, text, text, uuid, uuid, uuid, uuid, uuid, text
) from public, anon;
grant execute on function public.stock_post_movement(
  uuid, public.stock_movement_type, numeric, date, text, text, text, uuid, uuid, uuid, uuid, uuid, text
) to authenticated;
