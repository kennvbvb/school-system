-- =============================================================================
-- ทดสอบ F-05 — รายชื่อผู้เบิก/ผู้อนุมัติของคลัง และการตรวจอำนาจผู้อนุมัติในฐานข้อมูล
--
--   * inventory_staff_directory(): เปิดเฉพาะผู้ถือ inventory.issue/adjust, คืนเฉพาะ
--     id/ชื่อ/รหัสพนักงาน/can_approve ของผู้ใช้ที่ active (ไม่มีอีเมล/บทบาท), anon เรียกไม่ได้
--   * stock_post_movement: เบิก/ปรับยอดต้องมีผู้อนุมัติที่ active และถือ inventory.approve
--     ผู้เบิกต้อง active และต้องไม่ใช่คนเดียวกับผู้อนุมัติ — เรียก RPC ตรงก็เลี่ยงไม่ได้
--
-- รันแล้ว rollback ทั้งหมด ไม่ทิ้งข้อมูล
-- =============================================================================

\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_fails(stmt text, expect text, label text)
returns void language plpgsql as $$
declare v_msg text;
begin
  begin execute stmt;
  exception when others then
    v_msg := sqlerrm;
    if position(expect in v_msg) = 0 then
      raise exception 'FAIL % — ล้มด้วยเหตุผลอื่น: %', label, v_msg;
    end if;
    raise notice 'ok   %', label; return;
  end;
  raise exception 'FAIL % — คำสั่งนี้ควรล้มแต่กลับสำเร็จ', label;
end; $$;

create or replace function pg_temp.assert_eq(actual anyelement, expected anyelement, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL % — ได้ % แต่ต้องการ %', label, actual, expected;
  end if;
  raise notice 'ok   % (%)', label, actual;
end; $$;

-- ตัวช่วยทำงานแทนเจ้าของฐานข้อมูล (fixture DML ต้องข้าม RLS)
create or replace function pg_temp.fx(stmt text) returns void
language plpgsql security definer as $$ begin execute stmt; end; $$;

-- ---------------------------------------------------------------------------
-- ข้อมูลสมมติ
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('c1111111-1111-4111-8111-111111111111', 'sa-officer@example.test'),
  ('c2222222-2222-4222-8222-222222222222', 'sa-teacher@example.test'),
  ('c3333333-3333-4333-8333-333333333333', 'sa-approver@example.test'),
  ('c4444444-4444-4444-8444-444444444444', 'sa-inactive-approver@example.test'),
  ('c5555555-5555-4555-8555-555555555555', 'sa-inactive-teacher@example.test'),
  ('c6666666-6666-4666-8666-666666666666', 'sa-nobody@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, employee_code, is_active) values
  ('c1111111-1111-4111-8111-111111111111', 'sa-officer@example.test', 'ทดสอบ', 'เจ้าหน้าที่คลัง', 'SA-001', true),
  ('c2222222-2222-4222-8222-222222222222', 'sa-teacher@example.test', 'ทดสอบ', 'ครูผู้เบิก', 'SA-002', true),
  ('c3333333-3333-4333-8333-333333333333', 'sa-approver@example.test', 'ทดสอบ', 'ผู้อนุมัติ', 'SA-003', true),
  ('c4444444-4444-4444-8444-444444444444', 'sa-inactive-approver@example.test', 'ทดสอบ', 'ผู้อนุมัติที่ปิดบัญชี', 'SA-004', false),
  ('c5555555-5555-4555-8555-555555555555', 'sa-inactive-teacher@example.test', 'ทดสอบ', 'ครูที่ปิดบัญชี', 'SA-005', false),
  ('c6666666-6666-4666-8666-666666666666', 'sa-nobody@example.test', 'ทดสอบ', 'ไม่มีสิทธิ์', 'SA-006', true);

insert into public.user_roles (user_id, role_code) values
  ('c1111111-1111-4111-8111-111111111111', 'INVENTORY_OFFICER'),
  ('c2222222-2222-4222-8222-222222222222', 'REQUESTER'),
  ('c3333333-3333-4333-8333-333333333333', 'APPROVER'),
  ('c4444444-4444-4444-8444-444444444444', 'APPROVER'),
  ('c6666666-6666-4666-8666-666666666666', 'REQUESTER');

insert into public.units (id, code, name_th) values
  ('c0000000-0000-4000-8000-000000000001', 'UNIT-SA-T', 'ชิ้น (ทดสอบ)');

insert into public.inventory_items (id, code, name_th, unit_id) values
  ('ca000000-0000-4000-8000-00000000000a', 'SA-T-A', 'พัสดุทดสอบอนุมัติ', 'c0000000-0000-4000-8000-000000000001');

create or replace function pg_temp.mv(
  p_type public.stock_movement_type, p_qty numeric, p_ref text,
  p_requested uuid default null, p_approved uuid default null, p_reason text default null
) returns uuid language sql as $$
  select public.stock_post_movement(
    p_item_id => 'ca000000-0000-4000-8000-00000000000a', p_type => p_type, p_quantity => p_qty,
    p_effective_date => date '2026-10-07', p_reference => p_ref, p_reason => p_reason,
    p_requested_by => p_requested, p_approved_by => p_approved, p_request_id => 'sa-test'
  );
$$;

create or replace function pg_temp.as_user(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
end; $$;

grant execute on all functions in schema pg_temp to public;

-- ---------------------------------------------------------------------------
-- สิทธิ์ inventory.approve
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select array_agg(role_code order by role_code) from public.role_permissions
    where permission_code = 'inventory.approve'),
  array['APPROVER', 'SYSTEM_ADMIN']::text[],
  'inventory.approve เป็นค่าเริ่มต้นของ APPROVER และ SYSTEM_ADMIN เท่านั้น');

-- ---------------------------------------------------------------------------
-- รายชื่อผู้เบิก/ผู้อนุมัติ
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.as_user('c1111111-1111-4111-8111-111111111111');

select pg_temp.assert_eq(
  (select count(*) from public.inventory_staff_directory()
    where id in ('c1111111-1111-4111-8111-111111111111', 'c2222222-2222-4222-8222-222222222222',
                 'c3333333-3333-4333-8333-333333333333', 'c4444444-4444-4444-8444-444444444444',
                 'c5555555-5555-4555-8555-555555555555', 'c6666666-6666-4666-8666-666666666666')),
  4::bigint,
  'รายชื่อเห็นผู้ใช้ที่ active ของชุดทดสอบครบ 4 คน (ไม่รวมบัญชีที่ปิด)');

select pg_temp.assert_eq(
  (select bool_or(true) from public.inventory_staff_directory()
    where id in ('c4444444-4444-4444-8444-444444444444', 'c5555555-5555-4555-8555-555555555555')),
  null::boolean,
  'บัญชีที่ปิดใช้งานไม่อยู่ในรายชื่อ');

select pg_temp.assert_eq(
  (select can_approve from public.inventory_staff_directory()
    where id = 'c3333333-3333-4333-8333-333333333333'),
  true, 'ผู้ถือ APPROVER มี can_approve = true');

select pg_temp.assert_eq(
  (select can_approve from public.inventory_staff_directory()
    where id = 'c2222222-2222-4222-8222-222222222222'),
  false, 'ครูผู้เบิกมี can_approve = false');

-- คอลัมน์ที่คืนมีเท่านี้ — ไม่รั่วอีเมล บทบาท หรือสถานะ
select pg_temp.assert_eq(
  (select array_agg(k order by k) from jsonb_object_keys(
     (select to_jsonb(d) from public.inventory_staff_directory() d limit 1)) k),
  array['can_approve', 'display_name', 'employee_code', 'id']::text[],
  'รายชื่อคืนเฉพาะ id/display_name/employee_code/can_approve');

-- ผู้ไม่มีสิทธิ์คลังเรียกไม่ได้ (ครูผู้เบิกทั่วไปก็ไม่ใช่เจ้าหน้าที่คลัง)
select pg_temp.as_user('c6666666-6666-4666-8666-666666666666');
select pg_temp.assert_fails(
  'select * from public.inventory_staff_directory()',
  'ไม่มีสิทธิ์ดูรายชื่อ', 'ผู้ไม่มี inventory.issue/adjust ดูรายชื่อไม่ได้');

-- anon เรียกไม่ได้
reset role;
set local role anon;
select pg_temp.assert_fails(
  'select * from public.inventory_staff_directory()',
  'permission denied', 'anon เรียก inventory_staff_directory ไม่ได้');
reset role;

-- ฟังก์ชันตรวจสิทธิ์ภายในต้องไม่เปิดให้ client เรียกตรง (ใช้ถามว่าใครมีสิทธิ์อะไรได้)
set local role authenticated;
select pg_temp.as_user('c1111111-1111-4111-8111-111111111111');
select pg_temp.assert_fails(
  $$ select public.profile_has_permission('c3333333-3333-4333-8333-333333333333', 'inventory.approve') $$,
  'permission denied', 'client เรียก profile_has_permission ตรงไม่ได้');

-- ---------------------------------------------------------------------------
-- stock_post_movement: ตรวจผู้เบิก/ผู้อนุมัติในฐานข้อมูล
-- ---------------------------------------------------------------------------

select pg_temp.as_user('c1111111-1111-4111-8111-111111111111');
select pg_temp.mv('RECEIPT', 100, 'RC-SA-1');

-- ผ่าน: ผู้เบิก (ครู) ≠ ผู้อนุมัติ (APPROVER ที่ active)
select pg_temp.mv('ISSUE', 5, 'REQ-SA-OK',
  'c2222222-2222-4222-8222-222222222222', 'c3333333-3333-4333-8333-333333333333');
select pg_temp.assert_eq(
  (select count(*) from public.stock_movements where reference = 'REQ-SA-OK'), 1::bigint,
  'เบิกที่ผู้เบิก/ผู้อนุมัติถูกต้องลงสำเร็จ');

-- ผู้อนุมัติไม่มี inventory.approve (ครู)
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ISSUE', 1, 'REQ-SA-1',
       'c3333333-3333-4333-8333-333333333333', 'c2222222-2222-4222-8222-222222222222') $$,
  'ไม่มีอำนาจอนุมัติ', 'เบิก: ผู้อนุมัติที่ไม่มี inventory.approve ถูกปฏิเสธ');

-- ผู้อนุมัติมีบทบาทแต่บัญชีปิดใช้งาน
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ISSUE', 1, 'REQ-SA-2',
       'c2222222-2222-4222-8222-222222222222', 'c4444444-4444-4444-8444-444444444444') $$,
  'ไม่มีอำนาจอนุมัติ', 'เบิก: ผู้อนุมัติที่ปิดบัญชีแล้วถูกปฏิเสธ');

-- ผู้อนุมัติไม่มีตัวตนในระบบ
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ISSUE', 1, 'REQ-SA-3',
       'c2222222-2222-4222-8222-222222222222', 'cffffff0-0000-4000-8000-000000000000') $$,
  'ไม่มีอำนาจอนุมัติ', 'เบิก: ผู้อนุมัติที่ไม่มีอยู่จริงถูกปฏิเสธ');

-- ผู้เบิกปิดบัญชี / ไม่มีอยู่จริง
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ISSUE', 1, 'REQ-SA-4',
       'c5555555-5555-4555-8555-555555555555', 'c3333333-3333-4333-8333-333333333333') $$,
  'ผู้เบิกที่ระบุไม่มีอยู่', 'เบิก: ผู้เบิกที่ปิดบัญชีแล้วถูกปฏิเสธ');
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ISSUE', 1, 'REQ-SA-5',
       'cffffff0-0000-4000-8000-000000000000', 'c3333333-3333-4333-8333-333333333333') $$,
  'ผู้เบิกที่ระบุไม่มีอยู่', 'เบิก: ผู้เบิกที่ไม่มีอยู่จริงถูกปฏิเสธ');

-- ผู้เบิก = ผู้อนุมัติ (แม้เป็น APPROVER ก็อนุมัติใบเบิกของตัวเองไม่ได้)
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ISSUE', 1, 'REQ-SA-6',
       'c3333333-3333-4333-8333-333333333333', 'c3333333-3333-4333-8333-333333333333') $$,
  'คนละคน', 'เบิก: ผู้เบิกกับผู้อนุมัติเป็นคนเดียวกันถูกปฏิเสธ');

-- ไม่ระบุผู้เบิก/ผู้อนุมัติเลย
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ISSUE', 1, 'REQ-SA-7', null, 'c3333333-3333-4333-8333-333333333333') $$,
  'ผู้เบิก', 'เบิก: ไม่ระบุผู้เบิกถูกปฏิเสธ');
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ISSUE', 1, 'REQ-SA-8', 'c2222222-2222-4222-8222-222222222222', null) $$,
  'ผู้อนุมัติ', 'เบิก: ไม่ระบุผู้อนุมัติถูกปฏิเสธ');

-- ปรับยอด: ผู้อนุมัติต้องมีอำนาจเช่นกัน
select pg_temp.mv('ADJUSTMENT_DECREASE', 2, 'ADJ-SA-OK', null,
  'c3333333-3333-4333-8333-333333333333', 'นับสต็อกไม่ตรง');
select pg_temp.assert_eq(
  (select count(*) from public.stock_movements where reference = 'ADJ-SA-OK'), 1::bigint,
  'ปรับยอดที่ผู้อนุมัติถูกต้องลงสำเร็จ');

select pg_temp.assert_fails(
  $$ select pg_temp.mv('ADJUSTMENT_INCREASE', 2, 'ADJ-SA-1', null,
       'c2222222-2222-4222-8222-222222222222', 'นับสต็อกไม่ตรง') $$,
  'ไม่มีอำนาจอนุมัติ', 'ปรับยอด: ผู้อนุมัติที่ไม่มี inventory.approve ถูกปฏิเสธ');
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ADJUSTMENT_INCREASE', 2, 'ADJ-SA-2', null,
       'c4444444-4444-4444-8444-444444444444', 'นับสต็อกไม่ตรง') $$,
  'ไม่มีอำนาจอนุมัติ', 'ปรับยอด: ผู้อนุมัติที่ปิดบัญชีแล้วถูกปฏิเสธ');
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ADJUSTMENT_INCREASE', 2, 'ADJ-SA-3', null, null, 'นับสต็อกไม่ตรง') $$,
  'ผู้อนุมัติ', 'ปรับยอด: ไม่ระบุผู้อนุมัติถูกปฏิเสธ');

-- รับเข้าไม่ต้องมีผู้อนุมัติ (ไม่เปลี่ยนพฤติกรรมเดิม)
select pg_temp.mv('RECEIPT', 3, 'RC-SA-2');
select pg_temp.assert_eq(
  (select count(*) from public.stock_movements where reference = 'RC-SA-2'), 1::bigint,
  'รับเข้ายังลงได้โดยไม่ต้องมีผู้อนุมัติ');

-- ถอนอำนาจออกจากบทบาทแล้วต้องมีผลทันที (ตรวจสิทธิ์จริง ไม่ใช่ค่าที่แคชไว้)
reset role;
select pg_temp.fx($$ delete from public.role_permissions
  where role_code = 'APPROVER' and permission_code = 'inventory.approve' $$);
set local role authenticated;
select pg_temp.as_user('c1111111-1111-4111-8111-111111111111');
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ISSUE', 1, 'REQ-SA-9',
       'c2222222-2222-4222-8222-222222222222', 'c3333333-3333-4333-8333-333333333333') $$,
  'ไม่มีอำนาจอนุมัติ', 'ถอน inventory.approve ออกจาก APPROVER แล้วอนุมัติไม่ได้ทันที');

reset role;
rollback;
