-- =============================================================================
-- Migration 0018 — การจัดการผู้ใช้และบทบาทผ่านหน้าจอ
--
-- ก่อนหน้านี้การเพิ่มผู้ใช้ต้องรัน SQL เอง ซึ่งโรงเรียนทำไม่ได้ — เท่ากับระบบ
-- เริ่มใช้จริงไม่ได้เลยแม้ฟีเจอร์อื่นจะครบ
--
-- RLS ของ profiles / user_roles รองรับ users.manage อยู่แล้วตั้งแต่ migration 0002
-- migration นี้เพิ่มสองอย่างที่ policy ทำไม่ได้:
--
--   1. **กันการล็อกทุกคนออกจากระบบ** — ความผิดพลาดชนิดที่แก้เองจากหน้าจอไม่ได้
--      ต้องเข้าฐานข้อมูลตรงไปแก้ ซึ่งโรงเรียนทำเองไม่ได้
--   2. **audit ในทรานแซกชันเดียวกับการเปลี่ยนสิทธิ์** — การเปลี่ยนสิทธิ์ที่ไม่มี
--      ร่องรอยว่าใครเปลี่ยนและเปลี่ยนจากอะไร ตรวจสอบย้อนหลังไม่ได้เลย
-- =============================================================================

-- -----------------------------------------------------------------------------
-- user_manages_users — ผู้ใช้คนนี้ถือสิทธิ์จัดการผู้ใช้อยู่หรือไม่
--
-- ดูจาก **สิทธิ์** ไม่ใช่ชื่อบทบาท เพราะบทบาทเป็นข้อมูลที่ผู้ดูแลแก้ได้ผ่านตาราง
-- role_permissions ถ้าผูกกฎไว้กับชื่อ 'SYSTEM_ADMIN' การย้ายสิทธิ์ไปบทบาทอื่น
-- จะทำให้กฎนี้เฝ้าของที่ไม่สำคัญแล้ว
--
-- ไม่ใช้ has_permission() เพราะตัวนั้นดูจากผู้ใช้ปัจจุบัน ส่วนที่นี่ต้องถามถึงคนอื่น
-- -----------------------------------------------------------------------------

create or replace function public.user_manages_users(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_code = ur.role_code
    where ur.user_id = p_user_id and rp.permission_code = 'users.manage'
  );
$$;

comment on function public.user_manages_users(uuid) is
  'ผู้ใช้คนนี้ถือสิทธิ์ users.manage หรือไม่ — ดูจากสิทธิ์ ไม่ใช่ชื่อบทบาท';

-- -----------------------------------------------------------------------------
-- other_active_user_managers — เหลือผู้ดูแลคนอื่นอีกกี่คน
--
-- นับเฉพาะผู้ที่ยัง active เพราะบัญชีที่ปิดแล้วเข้าระบบไม่ได้ จึงกู้ระบบไม่ได้
-- -----------------------------------------------------------------------------

create or replace function public.other_active_user_managers(p_excluding uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(distinct p.id)::integer
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
  join public.role_permissions rp on rp.role_code = ur.role_code
  where p.is_active
    and p.id <> p_excluding
    and rp.permission_code = 'users.manage';
$$;

-- -----------------------------------------------------------------------------
-- user_set_roles — แทนที่ชุดบทบาททั้งชุด
--
-- เขียนทับทั้งชุดแทนการเพิ่ม/ลบทีละบทบาท เพราะหน้าจอส่งสถานะสุดท้ายมาทั้งชุด
-- และการ diff ทีละแถวเสี่ยงหลงเหลือบทบาทที่ผู้ใช้เอาออกไปแล้ว
-- -----------------------------------------------------------------------------

create or replace function public.user_set_roles(
  p_user_id uuid,
  p_role_codes text[],
  p_request_id text default 'system'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_before text[];
  v_managed_before boolean;
  v_manages_after boolean;
  v_unknown text;
begin
  if v_actor is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนดำเนินการ' using errcode = 'insufficient_privilege';
  end if;

  if not public.has_permission('users.manage') then
    raise exception 'คุณไม่มีสิทธิ์ดำเนินการนี้' using errcode = 'insufficient_privilege';
  end if;

  if p_role_codes is null or array_length(p_role_codes, 1) is null then
    raise exception 'ผู้ใช้ต้องมีอย่างน้อยหนึ่งบทบาท มิฉะนั้นจะเข้าใช้ระบบไม่ได้เลย'
      using errcode = 'check_violation';
  end if;

  -- ล็อกแถวโปรไฟล์ไว้ เพื่อให้การนับผู้ดูแลที่เหลือกับการเขียนอยู่ในภาพเดียวกัน
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'ไม่พบผู้ใช้ที่ระบุ' using errcode = 'no_data_found';
  end if;

  /*
   * ตั้งชื่อคอลัมน์ของ unnest ให้ต่างจาก `roles.code`
   *
   * ถ้าใช้ชื่อ `code` เหมือนกัน เงื่อนไข `r.code = code` ในซับเควรีจะผูกกับ `r.code`
   * ทั้งสองข้าง (ขอบเขตในชนะขอบเขตนอก) กลายเป็นจริงเสมอ แล้วบทบาทที่ไม่มีจริง
   * จะหลุดไปติด foreign key แทน ซึ่งให้ข้อความที่ผู้ใช้อ่านไม่รู้เรื่อง
   */
  select t.role_code into v_unknown
  from unnest(p_role_codes) as t(role_code)
  where not exists (select 1 from public.roles r where r.code = t.role_code)
  limit 1;

  if v_unknown is not null then
    raise exception 'ไม่พบบทบาท %', v_unknown using errcode = 'foreign_key_violation';
  end if;

  select coalesce(array_agg(role_code order by role_code), '{}') into v_before
  from public.user_roles where user_id = p_user_id;

  v_managed_before := public.user_manages_users(p_user_id);

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_code = any (p_role_codes) and rp.permission_code = 'users.manage'
  ) into v_manages_after;

  /*
   * กันการล็อกทุกคนออกจากระบบ
   *
   * ไม่ได้ห้ามลดสิทธิ์ตัวเอง แต่ห้ามทำจนไม่เหลือใครเลยที่จัดการผู้ใช้ได้
   * ถ้าเกิดขึ้นจริง จะไม่มีใครแก้สิทธิ์ได้อีกนอกจากเข้าฐานข้อมูลตรง
   */
  if v_managed_before and not v_manages_after
     and public.other_active_user_managers(p_user_id) < 1 then
    raise exception 'ต้องเหลือผู้ที่จัดการผู้ใช้ได้อย่างน้อยหนึ่งคนเสมอ มิฉะนั้นจะไม่มีใครแก้สิทธิ์ได้อีกเลย'
      using errcode = 'restrict_violation';
  end if;

  delete from public.user_roles
  where user_id = p_user_id and role_code <> all (p_role_codes);

  insert into public.user_roles (user_id, role_code, granted_by)
  select p_user_id, code, v_actor
  from unnest(p_role_codes) as code
  on conflict (user_id, role_code) do nothing;

  insert into public.audit_events (
    request_id, actor_id, action, entity_type, entity_id, before_json, after_json, metadata_json
  ) values (
    p_request_id, v_actor, 'user.roles_change', 'profile', p_user_id::text,
    jsonb_build_object('role_codes', to_jsonb(v_before)),
    jsonb_build_object('role_codes', to_jsonb(p_role_codes)),
    jsonb_build_object('manages_users_after', v_manages_after)
  );

  return array_length(p_role_codes, 1);
end;
$$;

comment on function public.user_set_roles(uuid, text[], text) is
  'แทนที่ชุดบทบาทของผู้ใช้ พร้อม audit — กันไม่ให้เหลือระบบที่ไม่มีผู้ดูแล';

-- -----------------------------------------------------------------------------
-- user_set_active — เปิดหรือปิดบัญชี
--
-- ไม่มีการลบผู้ใช้ (ข้อ 4.2) เพราะโปรไฟล์ถูกอ้างโดยประวัติการอนุมัติและ ledger
-- การลบจะทำให้ประวัติที่ตรวจสอบได้กลายเป็นประวัติที่ชี้ไปที่ว่างเปล่า
-- -----------------------------------------------------------------------------

create or replace function public.user_set_active(
  p_user_id uuid,
  p_is_active boolean,
  p_request_id text default 'system'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_before boolean;
begin
  if v_actor is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนดำเนินการ' using errcode = 'insufficient_privilege';
  end if;

  if not public.has_permission('users.manage') then
    raise exception 'คุณไม่มีสิทธิ์ดำเนินการนี้' using errcode = 'insufficient_privilege';
  end if;

  /*
   * ปิดบัญชีตัวเองไม่ได้
   *
   * ผู้ดูแลคนเดียวที่เผลอปิดบัญชีตัวเอง จะเข้าระบบไม่ได้อีกและไม่มีใครเปิดคืนให้
   * แม้จะมีผู้ดูแลคนอื่นอยู่ การปิดบัญชีตัวเองก็ไม่ใช่สิ่งที่ตั้งใจทำอยู่ดี
   */
  if not p_is_active and p_user_id = v_actor then
    raise exception 'ปิดบัญชีของตัวเองไม่ได้ ให้ผู้ดูแลระบบคนอื่นเป็นผู้ปิดบัญชีนี้แทน'
      using errcode = 'restrict_violation';
  end if;

  select is_active into v_before from public.profiles where id = p_user_id for update;

  if not found then
    raise exception 'ไม่พบผู้ใช้ที่ระบุ' using errcode = 'no_data_found';
  end if;

  /*
   * กันไว้อีกชั้น — ปัจจุบันเงื่อนไขนี้ไปไม่ถึงโดยโครงสร้าง ไม่ใช่โดยบังเอิญ
   *
   * ผู้เรียกต้องผ่าน has_permission('users.manage') ซึ่งบังคับ `p.is_active` อยู่แล้ว
   * ผู้เรียกจึงเป็นผู้ดูแลที่ยัง active เสมอ และกฎ "ปิดบัญชีตัวเองไม่ได้" ด้านบน
   * ตัดกรณี p_user_id = v_actor ออกไปแล้ว ดังนั้นผู้เรียกจะถูกนับเป็น
   * "ผู้ดูแลคนอื่นที่ยัง active" ของเป้าหมายเสมอ ค่าที่ได้จึง >= 1 ตลอด
   *
   * เก็บไว้เพราะอะไรก็ตามที่ทำให้ข้อสมมติข้างบนเปลี่ยน — has_permission เลิกเช็ค
   * is_active, มีเส้นทางที่ข้ามกฎปิดบัญชีตัวเอง, หรือมีผู้เรียกที่ใช้ service role —
   * จะทำให้ระบบเหลือผู้ดูแลศูนย์คนได้ทันทีโดยไม่มีอะไรฟ้อง ราคาของการเก็บไว้คือ
   * การอ่านตารางหนึ่งครั้งต่อการปิดบัญชีหนึ่งครั้ง
   *
   * **ไม่มี test ที่พิสูจน์สาขานี้ เพราะเรียกให้เข้าเงื่อนไขไม่ได้จริง** สิ่งที่ test
   * พิสูจน์คือ *ผลลัพธ์* ที่กฎนี้เฝ้าอยู่ — ไม่ว่าจะทำอะไรตามที่ระบบอนุญาต
   * ต้องเหลือผู้ดูแลที่ยัง active อย่างน้อยหนึ่งคนเสมอ
   */
  if not p_is_active
     and public.user_manages_users(p_user_id)
     and public.other_active_user_managers(p_user_id) < 1 then
    raise exception 'ต้องเหลือผู้ที่จัดการผู้ใช้ได้อย่างน้อยหนึ่งคนเสมอ มิฉะนั้นจะไม่มีใครแก้สิทธิ์ได้อีกเลย'
      using errcode = 'restrict_violation';
  end if;

  update public.profiles set is_active = p_is_active where id = p_user_id;

  insert into public.audit_events (
    request_id, actor_id, action, entity_type, entity_id, before_json, after_json
  ) values (
    p_request_id, v_actor, 'user.active_change', 'profile', p_user_id::text,
    jsonb_build_object('is_active', v_before),
    jsonb_build_object('is_active', p_is_active)
  );

  return p_is_active;
end;
$$;

comment on function public.user_set_active(uuid, boolean, text) is
  'เปิดหรือปิดบัญชีผู้ใช้ พร้อม audit — ปิดบัญชีตัวเองไม่ได้ และต้องเหลือผู้ดูแลเสมอ';

revoke all on function public.user_set_roles(uuid, text[], text) from public, anon;
revoke all on function public.user_set_active(uuid, boolean, text) from public, anon;
grant execute on function public.user_set_roles(uuid, text[], text) to authenticated;
grant execute on function public.user_set_active(uuid, boolean, text) to authenticated;

/*
 * ฟังก์ชันช่วยนับไม่เปิดให้เรียกตรง
 *
 * ทั้งสองเป็น security definer ที่อ่านข้ามผู้ใช้ได้ การเปิดให้เรียกตรงจะทำให้ผู้ใช้ทั่วไป
 * สำรวจได้ว่าใครถือสิทธิ์จัดการผู้ใช้บ้าง ซึ่งเป็นข้อมูลที่ใช้เลือกเป้าหมายโจมตีได้
 */
revoke all on function public.user_manages_users(uuid) from public, anon, authenticated;
revoke all on function public.other_active_user_managers(uuid) from public, anon, authenticated;
