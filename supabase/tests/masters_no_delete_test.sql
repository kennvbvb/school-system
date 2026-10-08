-- =============================================================================
-- ทดสอบ F-11 — departments / positions: เพิ่ม/แก้ได้เมื่อมี masters.manage แต่ลบไม่ได้ (ปิดใช้งานแทน)
--
-- ก่อน migration 20261007000500 ทั้งสองตารางมี policy `for all` และไม่เพิกถอน delete
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

grant execute on all functions in schema pg_temp to public;

insert into auth.users (id, email) values
  ('d1111111-1111-4111-8111-111111111111', 'mnd-admin@example.test'),
  ('d2222222-2222-4222-8222-222222222222', 'mnd-user@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('d1111111-1111-4111-8111-111111111111', 'mnd-admin@example.test', 'ทดสอบ', 'ผู้ดูแล', true),
  ('d2222222-2222-4222-8222-222222222222', 'mnd-user@example.test', 'ทดสอบ', 'ผู้ใช้ทั่วไป', true);

insert into public.user_roles (user_id, role_code) values
  ('d1111111-1111-4111-8111-111111111111', 'SYSTEM_ADMIN'),
  ('d2222222-2222-4222-8222-222222222222', 'REQUESTER');

set local role authenticated;
set local request.jwt.claim.sub = 'd1111111-1111-4111-8111-111111111111';

-- ผู้ถือ masters.manage: เพิ่ม แก้ ปิดใช้งานได้
insert into public.departments (code, name_th) values ('MND-D1', 'ฝ่ายทดสอบ ก');
insert into public.positions (code, name_th) values ('MND-P1', 'ตำแหน่งทดสอบ ก');

update public.departments set name_th = 'ฝ่ายทดสอบ ก (แก้)' where code = 'MND-D1';
update public.positions set name_th = 'ตำแหน่งทดสอบ ก (แก้)' where code = 'MND-P1';
select pg_temp.assert_eq((select name_th from public.departments where code = 'MND-D1'),
  'ฝ่ายทดสอบ ก (แก้)', 'ผู้ถือ masters.manage แก้ departments ได้');
select pg_temp.assert_eq((select name_th from public.positions where code = 'MND-P1'),
  'ตำแหน่งทดสอบ ก (แก้)', 'ผู้ถือ masters.manage แก้ positions ได้');

update public.departments set is_active = false where code = 'MND-D1';
update public.positions set is_active = false where code = 'MND-P1';
select pg_temp.assert_eq((select is_active from public.departments where code = 'MND-D1'),
  false, 'ปิดใช้งาน departments ด้วย is_active = false ได้');

-- ลบไม่ได้ แม้เป็นผู้ดูแลระบบ และแถวต้องยังอยู่
select pg_temp.assert_fails($$delete from public.departments where code = 'MND-D1'$$,
  'permission denied', 'F-11 ผู้ถือ masters.manage ลบ departments ไม่ได้');
select pg_temp.assert_fails($$delete from public.positions where code = 'MND-P1'$$,
  'permission denied', 'F-11 ผู้ถือ masters.manage ลบ positions ไม่ได้');
select pg_temp.assert_eq((select count(*)::integer from public.departments where code = 'MND-D1'),
  1, 'แถว departments ยังอยู่หลังพยายามลบ');
select pg_temp.assert_eq((select count(*)::integer from public.positions where code = 'MND-P1'),
  1, 'แถว positions ยังอยู่หลังพยายามลบ');

-- ผู้ไม่มี masters.manage: เพิ่ม/แก้ไม่ได้ (RLS) — update ไม่เจอแถวที่แก้ได้ insert ล้ม
set local request.jwt.claim.sub = 'd2222222-2222-4222-8222-222222222222';

select pg_temp.assert_fails($$insert into public.departments (code, name_th) values ('MND-D2', 'x')$$,
  'row-level security', 'ผู้ไม่มี masters.manage เพิ่ม departments ไม่ได้');
select pg_temp.assert_fails($$insert into public.positions (code, name_th) values ('MND-P2', 'x')$$,
  'row-level security', 'ผู้ไม่มี masters.manage เพิ่ม positions ไม่ได้');

with changed as (
  update public.departments set name_th = 'ถูกแก้โดยผู้ไม่มีสิทธิ์' where code = 'MND-D1' returning 1
) select pg_temp.assert_eq((select count(*)::integer from changed), 0,
  'ผู้ไม่มี masters.manage แก้ departments ไม่ได้ (ไม่มีแถวถูกแก้)');

-- anon ลบ/เขียนไม่ได้
reset role;
set local role anon;
select pg_temp.assert_fails($$delete from public.departments where code = 'MND-D1'$$,
  'permission denied', 'anon ลบ departments ไม่ได้');
select pg_temp.assert_fails($$delete from public.positions where code = 'MND-P1'$$,
  'permission denied', 'anon ลบ positions ไม่ได้');

reset role;
rollback;
