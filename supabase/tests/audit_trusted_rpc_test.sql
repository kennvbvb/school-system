-- =============================================================================
-- ทดสอบ PR-S01 บน PostgreSQL จริง — ปิด direct insert ของ audit_events
-- และ record_audit_event() กำหนด actor_id จาก auth.uid() ของผู้เรียกเองเสมอ
--
-- สิ่งที่ unit test พิสูจน์ไม่ได้และต้องรันที่นี่:
--
--   * insert ตรงเข้า audit_events ถูกปฏิเสธ แม้จะเป็นผู้ใช้ที่ active ปกติ
--     (ปิดช่องโหว่เดิมที่ policy ตรวจแค่ "active" ไม่ตรวจว่า actor_id ตรงผู้เรียก)
--   * record_audit_event() ใส่ actor_id เป็นผู้เรียกจริงเสมอ ต่างคนเรียกได้ actor_id ต่างกัน
--   * ผู้ใช้ที่ถูกปิดใช้งาน (is_active = false) เรียก RPC ไม่ได้
--   * ผู้ที่ยังไม่ authenticated (ไม่มี auth.uid()) เรียกไม่ได้ แม้ role จะเป็น authenticated
--   * anon เรียกฟังก์ชันนี้ไม่ได้เลยที่ระดับสิทธิ์ ก่อนถึงเงื่อนไขในฟังก์ชันด้วยซ้ำ
--   * RPC เดิมที่ insert เข้า audit_events อยู่แล้ว (เช่น budget_post_movement) ไม่พัง
--     เพราะรันเป็นเจ้าของฟังก์ชัน ไม่ถูก grant/revoke ของ authenticated บังคับ
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

-- ---------------------------------------------------------------------------
-- ผู้ใช้สมมติ: สองคน active และหนึ่งคนถูกปิดใช้งาน
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('f1111111-1111-4111-8111-111111111111', 'sec-a@example.test'),
  ('f2222222-2222-4222-8222-222222222222', 'sec-b@example.test'),
  ('f3333333-3333-4333-8333-333333333333', 'sec-inactive@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('f1111111-1111-4111-8111-111111111111', 'sec-a@example.test', 'ทดสอบ', 'เอ', true),
  ('f2222222-2222-4222-8222-222222222222', 'sec-b@example.test', 'ทดสอบ', 'บี', true),
  ('f3333333-3333-4333-8333-333333333333', 'sec-inactive@example.test', 'ทดสอบ', 'ถูกปิด', false);

-- ---------------------------------------------------------------------------
-- ปิด insert ตรงแล้วจริง — ทั้งที่ระดับ policy และ table privilege
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  has_table_privilege('authenticated', 'public.audit_events', 'insert'),
  false, 'authenticated ไม่มีสิทธิ์ insert ที่ระดับตาราง (ต้องผ่าน RPC เท่านั้น)');

set local role authenticated;
set local request.jwt.claim.sub = 'f1111111-1111-4111-8111-111111111111';

select pg_temp.assert_fails(
  $$insert into public.audit_events (request_id, actor_id, action, entity_type)
    values ('req-sec-direct', 'f1111111-1111-4111-8111-111111111111', 'entity.create', 'vendor')$$,
  'permission denied', 'insert ตรงเข้า audit_events ถูกปฏิเสธ');

-- ---------------------------------------------------------------------------
-- **จุดสำคัญที่สุด**: ก่อนแก้ ผู้ใช้คนหนึ่งปลอม actor_id เป็นคนอื่นได้เพราะ
-- policy เดิมตรวจแค่ "active" — ตอนนี้ actor_id มาจาก auth.uid() ของผู้เรียก
-- เสมอ ไม่มีพารามิเตอร์ให้ระบุ actor เองเลย ทดสอบด้วยการให้สองคนเรียกคนละครั้ง
-- แล้วดูว่า actor_id ตรงกับผู้เรียกจริงของแต่ละคน ไม่ใช่ค่าที่ตั้งใจปลอม
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select public.record_audit_event(
    'req-sec-a', 'entity.create', 'vendor', 'v-1', null,
    '{"name_th": "ผู้ขาย เอ"}'::jsonb, null, null, null
  ) is not null), true, 'ผู้ใช้ A เรียก record_audit_event สำเร็จ');

select pg_temp.assert_eq(
  (select actor_id from public.audit_events where request_id = 'req-sec-a'),
  'f1111111-1111-4111-8111-111111111111'::uuid,
  'actor_id ของแถวที่ A เรียกเป็น A จริง ไม่ใช่ค่าที่ปลอมได้');

set local request.jwt.claim.sub = 'f2222222-2222-4222-8222-222222222222';

select pg_temp.assert_eq(
  (select public.record_audit_event(
    'req-sec-b', 'entity.create', 'vendor', 'v-2', null,
    '{"name_th": "ผู้ขาย บี"}'::jsonb, null, null, null
  ) is not null), true, 'ผู้ใช้ B เรียก record_audit_event สำเร็จ');

select pg_temp.assert_eq(
  (select actor_id from public.audit_events where request_id = 'req-sec-b'),
  'f2222222-2222-4222-8222-222222222222'::uuid,
  'actor_id ของแถวที่ B เรียกเป็น B จริง — คนละคนได้ actor_id คนละค่าตามผู้เรียกจริง');

-- ---------------------------------------------------------------------------
-- บัญชีที่ถูกปิดใช้งานเรียกไม่ได้ แม้จะมี auth.uid()
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'f3333333-3333-4333-8333-333333333333';

select pg_temp.assert_fails(
  $$select public.record_audit_event('req-sec-inactive', 'entity.create', 'vendor')$$,
  'บัญชีนี้ถูกปิดใช้งาน', 'บัญชีที่ถูกปิดใช้งานเรียก record_audit_event ไม่ได้');

-- ---------------------------------------------------------------------------
-- ไม่มี auth.uid() (ยังไม่ authenticated) เรียกไม่ได้ แม้ role จะเป็น authenticated
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = '';

select pg_temp.assert_fails(
  $$select public.record_audit_event('req-sec-anon-uid', 'entity.create', 'vendor')$$,
  'ต้องเข้าสู่ระบบก่อน', 'ไม่มี auth.uid() เรียก record_audit_event ไม่ได้');

-- ---------------------------------------------------------------------------
-- anon ไม่มีสิทธิ์เรียกฟังก์ชันนี้เลยที่ระดับ grant
-- ---------------------------------------------------------------------------

reset role;
set local role anon;

select pg_temp.assert_fails(
  $$select public.record_audit_event('req-sec-anon-role', 'entity.create', 'vendor')$$,
  'permission denied', 'anon เรียก record_audit_event ไม่ได้เลยที่ระดับสิทธิ์');

-- ---------------------------------------------------------------------------
-- RPC เดิมที่ insert เข้า audit_events เองอยู่แล้วไม่พัง — ตรวจแบบเบา ๆ ด้วย
-- current_profile_is_active() ซึ่งเป็น security definer แบบเดียวกัน เรียก
-- ผ่านได้แม้ authenticated จะไม่มีสิทธิ์ insert audit_events ตรง ๆ
-- (พิสูจน์หลักการเดียวกับที่ budget_post_movement/stock_post_movement ใช้)
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'f1111111-1111-4111-8111-111111111111';

select pg_temp.assert_eq(
  (select public.current_profile_is_active()), true,
  'security definer function อื่นยังเรียกได้ปกติแม้ authenticated ไม่มีสิทธิ์ insert audit_events ตรง');

rollback;
