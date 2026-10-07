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
--
-- F-07 (migration 20261006000300) — record_audit_event เป็น "ช่องทางแอปรายงาน" ที่ถูกจำกัด:
--   * รับเฉพาะคู่ (action, entity_type) ที่แอปรายงานจริง และต้องมีสิทธิ์ของงานนั้น
--   * อ้างถึงแถวที่มีอยู่จริงเท่านั้น
--   * action ที่ RPC ธุรกรรมเขียนเอง (user.roles_change ฯลฯ) เขียนผ่านช่องทางนี้ไม่ได้
--   * แถวที่ผ่านช่องทางนี้ติด provenance = APP_REPORTED แยกจาก DB_TRUSTED ของ RPC ธุรกรรม
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

-- A และ B เป็นผู้ดูแลระบบ (มี masters.manage ฯลฯ) ส่วน D เป็นผู้ขอ (ไม่มีสิทธิ์จัดการข้อมูลหลัก)
-- E เป็นเจ้าหน้าที่พัสดุ (มี reports.export)
insert into auth.users (id, email) values
  ('f4444444-4444-4444-8444-444444444444', 'sec-requester@example.test'),
  ('f5555555-5555-4555-8555-555555555555', 'sec-officer@example.test');
insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('f4444444-4444-4444-8444-444444444444', 'sec-requester@example.test', 'ทดสอบ', 'ผู้ขอ', true),
  ('f5555555-5555-4555-8555-555555555555', 'sec-officer@example.test', 'ทดสอบ', 'พัสดุ', true);
insert into public.user_roles (user_id, role_code) values
  ('f1111111-1111-4111-8111-111111111111', 'SYSTEM_ADMIN'),
  ('f2222222-2222-4222-8222-222222222222', 'SYSTEM_ADMIN'),
  ('f4444444-4444-4444-8444-444444444444', 'REQUESTER'),
  ('f5555555-5555-4555-8555-555555555555', 'PROCUREMENT_OFFICER');

insert into public.vendors (id, vendor_code, name) values
  ('f0000000-0000-4000-8000-0000000000e1', 'VD-SEC1', 'ร้านทดสอบ audit (ตัวอย่าง)');

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
    'req-sec-a', 'entity.create', 'vendor', 'f0000000-0000-4000-8000-0000000000e1', null,
    '{"name_th": "ผู้ขาย เอ"}'::jsonb, null, null, null
  ) is not null), true, 'ผู้ใช้ A เรียก record_audit_event สำเร็จ');

-- ตรวจ actor_id ต้องอ่านด้วย role ที่ไม่ถูกจำกัดด้วย audit_events_select
-- (ซึ่งกรองด้วย has_permission('audit.read') — ไม่ใช่สิ่งที่ PR นี้เปลี่ยน)
-- ผู้ใช้ทดสอบในไฟล์นี้ไม่มีสิทธิ์นั้น ถ้าไม่ reset role การอ่านจะได้ 0 แถวเสมอ
-- ไม่ว่า insert จะถูกหรือผิด ทำให้ assert_eq เทียบกับ NULL ผิดเหตุผล
reset role;

select pg_temp.assert_eq(
  (select actor_id from public.audit_events where request_id = 'req-sec-a'),
  'f1111111-1111-4111-8111-111111111111'::uuid,
  'actor_id ของแถวที่ A เรียกเป็น A จริง ไม่ใช่ค่าที่ปลอมได้');

set local role authenticated;
set local request.jwt.claim.sub = 'f2222222-2222-4222-8222-222222222222';

select pg_temp.assert_eq(
  (select public.record_audit_event(
    'req-sec-b', 'entity.create', 'vendor', 'f0000000-0000-4000-8000-0000000000e1', null,
    '{"name_th": "ผู้ขาย บี"}'::jsonb, null, null, null
  ) is not null), true, 'ผู้ใช้ B เรียก record_audit_event สำเร็จ');

reset role;

select pg_temp.assert_eq(
  (select actor_id from public.audit_events where request_id = 'req-sec-b'),
  'f2222222-2222-4222-8222-222222222222'::uuid,
  'actor_id ของแถวที่ B เรียกเป็น B จริง — คนละคนได้ actor_id คนละค่าตามผู้เรียกจริง');

set local role authenticated;

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


-- ---------------------------------------------------------------------------
-- F-07 — ช่องทางแอปรายงานถูกจำกัด
-- ---------------------------------------------------------------------------

reset role;

-- แถวที่ผ่านช่องทางนี้ติด APP_REPORTED
select pg_temp.assert_eq(
  (select provenance from public.audit_events where request_id = 'req-sec-a'),
  'APP_REPORTED', 'แถวที่แอปรายงานติด provenance = APP_REPORTED');

-- แถวที่ RPC ธุรกรรมเขียนเอง (user_set_roles) ติด DB_TRUSTED
set local role authenticated;
set local request.jwt.claim.sub = 'f1111111-1111-4111-8111-111111111111';
select public.user_set_roles('f4444444-4444-4444-8444-444444444444', array['REQUESTER'], 'req-sec-trusted');
reset role;
select pg_temp.assert_eq(
  (select provenance from public.audit_events
   where request_id = 'req-sec-trusted' and action = 'user.roles_change'),
  'DB_TRUSTED', 'แถวที่ RPC ธุรกรรมเขียนเองติด provenance = DB_TRUSTED');

set local role authenticated;
set local request.jwt.claim.sub = 'f1111111-1111-4111-8111-111111111111';

-- action ที่ RPC ธุรกรรมเขียนเอง แอปรายงานปลอมไม่ได้ แม้เป็นผู้ดูแลระบบ
select pg_temp.assert_fails(
  $$select public.record_audit_event('req-forge-1', 'user.roles_change', 'profile',
      'f4444444-4444-4444-8444-444444444444')$$,
  'แอปรายงานเองไม่ได้', 'ปลอมเหตุการณ์เปลี่ยนสิทธิ์ (user.roles_change) ไม่ได้');
select pg_temp.assert_fails(
  $$select public.record_audit_event('req-forge-2', 'procurement.disburse', 'procurement',
      'f0000000-0000-4000-8000-0000000000e1')$$,
  'แอปรายงานเองไม่ได้', 'ปลอมเหตุการณ์เบิกจ่าย (procurement.disburse) ไม่ได้');
select pg_temp.assert_fails(
  $$select public.record_audit_event('req-forge-3', 'entity.create', 'stock_movement',
      'f0000000-0000-4000-8000-0000000000e1')$$,
  'แอปรายงานเองไม่ได้', 'ปลอมรายการเคลื่อนไหวคลัง (stock_movement) ไม่ได้');
select pg_temp.assert_fails(
  $$select public.record_audit_event('req-forge-4', 'document.issue', 'procurement',
      'f0000000-0000-4000-8000-0000000000e1')$$,
  'แอปรายงานเองไม่ได้', 'ปลอมเหตุการณ์ออกเอกสาร (document.issue) ไม่ได้');

-- ต้องมีสิทธิ์ของงานนั้น: ผู้ขอรายงานการสร้างข้อมูลหลักไม่ได้
set local request.jwt.claim.sub = 'f4444444-4444-4444-8444-444444444444';
select pg_temp.assert_fails(
  $$select public.record_audit_event('req-forge-5', 'entity.create', 'vendor',
      'f0000000-0000-4000-8000-0000000000e1')$$,
  'ไม่มีสิทธิ์รายงานเหตุการณ์', 'ผู้ที่ไม่มี masters.manage รายงานการสร้างผู้ขายไม่ได้');

-- ผู้ดูแลระบบ: อ้างถึงของที่ไม่มีอยู่/รูปแบบผิดไม่ได้
set local request.jwt.claim.sub = 'f1111111-1111-4111-8111-111111111111';
select pg_temp.assert_fails(
  $$select public.record_audit_event('req-forge-6', 'entity.create', 'vendor',
      'f0000000-0000-4000-8000-00000000dead')$$,
  'ไม่พบ vendor', 'อ้างผู้ขายที่ไม่มีอยู่ไม่ได้');
select pg_temp.assert_fails(
  $$select public.record_audit_event('req-forge-7', 'entity.create', 'vendor', 'not-a-uuid')$$,
  'ต้องเป็น UUID', 'entity_id ที่ไม่ใช่ UUID ถูกปฏิเสธ');
select pg_temp.assert_fails(
  $$select public.record_audit_event('req-forge-8', 'entity.create', 'vendor',
      'f0000000-0000-4000-8000-0000000000e1', null, null,
      jsonb_build_object('blob', repeat('x', 40000)))$$,
  'ใหญ่เกินกำหนด', 'payload ขนาดผิดปกติถูกปฏิเสธ');

-- auth.password_set: รายงานได้เฉพาะของตนเอง
select pg_temp.assert_eq(
  (select public.record_audit_event('req-pw-self', 'auth.password_set', 'profile',
     'f1111111-1111-4111-8111-111111111111') is not null),
  true, 'รายงานการตั้งรหัสผ่านของตนเองได้');
select pg_temp.assert_fails(
  $$select public.record_audit_event('req-pw-other', 'auth.password_set', 'profile',
      'f2222222-2222-4222-8222-222222222222')$$,
  'เฉพาะของตนเอง', 'รายงานการตั้งรหัสผ่านของคนอื่นไม่ได้');

-- report.export: ต้องมี reports.export และเป็นรายงานที่ระบบมีจริง (checksum เป็นคำบอกเล่าของแอป)
set local request.jwt.claim.sub = 'f4444444-4444-4444-8444-444444444444';
select pg_temp.assert_fails(
  $$select public.record_audit_event('req-exp-1', 'report.export', 'report_export', 'budget-report')$$,
  'ไม่มีสิทธิ์รายงานเหตุการณ์', 'ผู้ที่ไม่มี reports.export อ้างว่า export รายงานไม่ได้');

set local request.jwt.claim.sub = 'f5555555-5555-4555-8555-555555555555';
select pg_temp.assert_fails(
  $$select public.record_audit_event('req-exp-2', 'report.export', 'report_export', 'secret-report')$$,
  'ไม่รู้จักรายงาน', 'รายงานที่ไม่มีในระบบถูกปฏิเสธ');
select pg_temp.assert_eq(
  (select public.record_audit_event('req-exp-3', 'report.export', 'report_export', 'procurement-register',
     null, null, jsonb_build_object('format', 'csv', 'checksum', 'abc')) is not null),
  true, 'ผู้มี reports.export รายงานการ export รายงานที่มีจริงได้');

reset role;
select pg_temp.assert_eq(
  (select provenance from public.audit_events where request_id = 'req-exp-3'),
  'APP_REPORTED', 'การ export ที่แอปรายงานติด APP_REPORTED (checksum เป็นคำบอกเล่า ไม่ใช่ข้อพิสูจน์)');

-- ความพยายามที่ถูกปฏิเสธไม่ทิ้งแถวใด ๆ
select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events where request_id like 'req-forge-%'),
  0, 'ความพยายามปลอมที่ถูกปฏิเสธไม่ทิ้งแถวใดไว้');

rollback;
