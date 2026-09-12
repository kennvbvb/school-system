-- =============================================================================
-- Migration 0017 — ผูกการกันยอดงบเข้ากับการเปลี่ยนสถานะ
--
-- การกันยอดกับการเปลี่ยนสถานะต้องอยู่ในทรานแซกชันเดียวกัน ถ้าแยกกันจะเกิดสองอาการ
-- ที่แย่ทั้งคู่: รายการที่อนุมัติแล้วแต่ไม่มียอดกันไว้ (งบถูกใช้ซ้ำได้) หรือยอดที่กันไว้
-- โดยไม่มีรายการอนุมัติรองรับ (งบหายไปเฉย ๆ) — ทั้งสองอย่างตรวจสอบย้อนหลังไม่ได้
-- =============================================================================

-- -----------------------------------------------------------------------------
-- status_holds_reservation — สถานะใดถือยอดที่กันไว้
--
-- ประกาศเป็นฟังก์ชันแทนการเขียนเงื่อนไขซ้ำในหลายที่ เพราะเป็นกติกาที่ต้องตรงกัน
-- ระหว่างการกัน การคืน และหน้าจอ — มี parity test อ่านไฟล์นี้ไปเทียบกับชั้นโดเมน
--
-- `RECEIVED` ยังถือยอดไว้ เพราะรับของแล้วแต่ยังไม่ได้เบิกจ่าย เงินยังผูกพันอยู่
-- การแปลงยอดที่กันไว้เป็นค่าใช้จ่ายจริง (`COMMIT`/`ACTUAL`) เป็นงานของการเบิกจ่าย
-- ซึ่งยังไม่มีในรอบนี้ — **ยอดที่กันไว้จึงยังค้างอยู่จนกว่าจะมีขั้นตอนนั้น**
-- -----------------------------------------------------------------------------

create or replace function public.status_holds_reservation(p_status public.procurement_status)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select p_status in ('APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED');
$$;

comment on function public.status_holds_reservation(public.procurement_status) is
  'สถานะที่ถือยอดงบที่กันไว้ — ต้องตรงกับ STATUSES_HOLDING_RESERVATION ในชั้นโดเมน';

-- -----------------------------------------------------------------------------
-- procurement_transition — กันยอดตอนเข้าสถานะที่ถือยอด และคืนตอนออก
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

comment on function public.procurement_transition(uuid, text, integer, text, text) is
  'เปลี่ยนสถานะตามสายอนุมัติ พร้อมกันยอดงบ ประวัติ และ audit ในทรานแซกชันเดียว';
