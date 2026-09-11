-- =============================================================================
-- การเปลี่ยนสถานะตามสายอนุมัติ บังคับที่ฐานข้อมูล (แผนข้อ 4.2, 5.1)
--
-- ตาราง procurements ไม่มี policy ให้เปลี่ยน status ด้วย update อยู่แล้ว
-- การเปลี่ยนสถานะจึงผ่านฟังก์ชันนี้ทางเดียว และการเรียก API ตรงถูกปฏิเสธ
-- เหมือนกดผ่านหน้าจอทุกประการ
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ตารางกติกาการเปลี่ยนสถานะ
--
-- **เป็นสำเนาที่จำเป็นของ TRANSITIONS ใน src/domain/procurement/status.ts**
--
-- แยกกันไม่ได้ เพราะชั้นโดเมนห้ามพึ่งฐานข้อมูล และฐานข้อมูลต้องบังคับได้เองแม้ไม่มีแอป
-- แต่ถ้าสองที่ไม่ตรงกัน จะเกิดกรณีที่หน้าจอแสดงปุ่มแล้ว server ปฏิเสธ ซึ่งผู้ใช้แก้ตามไม่ได้
-- `tests/unit/transition-parity.test.ts` จึงอ่านไฟล์นี้มาเทียบกับโดเมนทุกแถว
--
-- **ไม่มี 'submit' ในตารางนี้โดยเจตนา** — การส่งอนุมัติต้องผ่าน procurement_submit()
-- ซึ่งตรวจกฎครบชุดก่อนเปลี่ยนสถานะ ถ้าใส่ไว้ที่นี่ด้วยจะมีทางส่งอนุมัติที่ข้าม
-- การตรวจทั้งหมดได้ ฟังก์ชันด้านล่างจึงปฏิเสธ 'submit' อย่างชัดเจน
-- -----------------------------------------------------------------------------

create or replace function public.procurement_transition_rule(
  p_action text,
  p_from public.procurement_status
)
returns table (
  to_status public.procurement_status,
  required_permission text,
  requires_reason boolean
)
language sql
immutable
as $$
  -- VALUES ให้ค่าเป็น text ต้อง cast กลับเป็น enum ให้ตรงกับชนิดที่ประกาศไว้
  select r.to_status::public.procurement_status, r.required_permission::text, r.requires_reason
  from (
    values
      ('review_pass',     'PENDING_REVIEW',     'PENDING_APPROVAL',   'procurement.review', false),
      ('review_return',   'PENDING_REVIEW',     'NEEDS_REVISION',     'procurement.review', true),
      ('approve',         'PENDING_APPROVAL',   'APPROVED',           'procurement.approve', false),
      ('approve_return',  'PENDING_APPROVAL',   'NEEDS_REVISION',     'procurement.approve', true),
      ('reject',          'PENDING_APPROVAL',   'REJECTED',           'procurement.approve', true),
      ('issue',           'APPROVED',           'ISSUED',             'documents.issue', false),
      ('receive_partial', 'ISSUED',             'PARTIALLY_RECEIVED', 'inventory.receive', false),
      ('receive_partial', 'PARTIALLY_RECEIVED', 'PARTIALLY_RECEIVED', 'inventory.receive', false),
      ('receive_all',     'ISSUED',             'RECEIVED',           'inventory.receive', false),
      ('receive_all',     'PARTIALLY_RECEIVED', 'RECEIVED',           'inventory.receive', false),
      ('cancel',          'DRAFT',              'CANCELLED',          'procurement.cancel', true),
      ('cancel',          'PENDING_REVIEW',     'CANCELLED',          'procurement.cancel', true),
      ('cancel',          'NEEDS_REVISION',     'CANCELLED',          'procurement.cancel', true),
      ('cancel',          'PENDING_APPROVAL',   'CANCELLED',          'procurement.cancel', true),
      ('cancel',          'APPROVED',           'CANCELLED',          'procurement.cancel', true),
      ('cancel',          'ISSUED',             'CANCELLED',          'procurement.cancel', true),
      ('cancel',          'PARTIALLY_RECEIVED', 'CANCELLED',          'procurement.cancel', true)
  ) as r(action, from_status, to_status, required_permission, requires_reason)
  where r.action = p_action
    and r.from_status::public.procurement_status = p_from;
$$;

/*
 * การกระทำที่ผู้สร้างรายการทำกับรายการของตัวเองไม่ได้ (separation of duties)
 *
 * บังคับเสมอ ไม่ใช่ค่าตั้งที่ปิดได้ — ดู assumptions ข้อ 2.9
 * ค่าตั้งที่ปิดได้ต้องมีคนตัดสินใจและมีหน้าจอให้เปลี่ยน ซึ่งเป็นพื้นที่ผิดพลาด
 * เพิ่มขึ้นเพื่อรองรับทางเลือกที่ไม่ควรเลือกตั้งแต่แรก
 *
 * `cancel` ไม่อยู่ในรายการ — ผู้ขอยกเลิกคำขอของตัวเองได้ ซึ่งไม่ใช่การอนุมัติ
 * ให้ตัวเองและไม่ทำให้เงินเคลื่อน
 */
create or replace function public.is_self_action_forbidden(p_action text)
returns boolean
language sql
immutable
as $$
  select p_action in ('review_pass', 'review_return', 'approve', 'approve_return', 'reject');
$$;

-- -----------------------------------------------------------------------------
-- procurement_transition
--
-- ทุกอย่างอยู่ในทรานแซกชันเดียว: ตรวจสิทธิ์ → ตรวจกติกา → บันทึกประวัติ →
-- เปลี่ยนสถานะ → เขียน audit ถ้าขั้นใดล้ม ทั้งชุดถูกย้อนกลับ จึงไม่มีสถานะ
-- ที่เปลี่ยนไปแล้วแต่ไม่มีประวัติกำกับ
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
    jsonb_build_object('action', p_action, 'step_no', v_step, 'reason', v_reason)
  );

  return v_rule.to_status;
end;
$$;

revoke all on function public.procurement_transition(uuid, text, integer, text, text) from public;
grant execute on function public.procurement_transition(uuid, text, integer, text, text)
  to authenticated;

comment on function public.procurement_transition(uuid, text, integer, text, text) is
  'เปลี่ยนสถานะตามสายอนุมัติ พร้อมบันทึกประวัติและ audit ในทรานแซกชันเดียว';
