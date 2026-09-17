-- =============================================================================
-- ทดสอบการอ่านและความเป็น append-only ของ audit log บน PostgreSQL จริง (PR-05b)
--
-- สิ่งที่ unit test พิสูจน์ไม่ได้และต้องรันที่นี่:
--
--   * ผู้ไม่มีสิทธิ์ audit.read มองไม่เห็นแม้แต่แถวเดียว — ไม่ใช่เห็นแล้วหน้าจอซ่อน
--   * ผู้มีสิทธิ์เห็นครบทุกแถว รวมถึงของคนอื่น
--   * แก้และลบไม่ได้ แม้จะเป็นผู้มีสิทธิ์อ่าน
--   * การเชื่อมกับ profiles ที่หน้าจอใช้ (audit_events_actor_id_fkey) มีอยู่จริง
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
-- ผู้ใช้สมมติ — ผู้ตรวจสอบภายในมี audit.read ส่วนผู้ขอไม่มี
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('e1111111-1111-4111-8111-111111111111', 'au-auditor@example.test'),
  ('e2222222-2222-4222-8222-222222222222', 'au-requester@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('e1111111-1111-4111-8111-111111111111', 'au-auditor@example.test',
   'ทดสอบ', 'ผู้ตรวจสอบภายใน', true),
  ('e2222222-2222-4222-8222-222222222222', 'au-requester@example.test',
   'ทดสอบ', 'ผู้ขอ', true);

insert into public.user_roles (user_id, role_code) values
  ('e1111111-1111-4111-8111-111111111111', 'AUDITOR'),
  ('e2222222-2222-4222-8222-222222222222', 'REQUESTER');

-- เหตุการณ์ของทั้งสองคน เพื่อพิสูจน์ว่าผู้มีสิทธิ์เห็นของคนอื่นด้วย
insert into public.audit_events (request_id, actor_id, action, entity_type, entity_id, after_json)
values
  ('req-au-1', 'e1111111-1111-4111-8111-111111111111', 'auth.login', 'session', null, null),
  ('req-au-2', 'e2222222-2222-4222-8222-222222222222', 'entity.update', 'vendor',
   '00000000-0000-4000-8000-0000000000aa', '{"name_th": "ตัวอย่าง"}'::jsonb);

set local role authenticated;

-- ---------------------------------------------------------------------------
-- ผู้ไม่มีสิทธิ์มองไม่เห็นแม้แต่แถวเดียว รวมถึงแถวของตัวเอง
--
-- **รวมถึงแถวของตัวเอง** เป็นข้อที่ตั้งใจ — ประวัติการตรวจสอบไม่ใช่ข้อมูลส่วนตัว
-- ที่เจ้าตัวมีสิทธิ์เรียกดู การเปิดให้ดูของตัวเองทำให้ผู้ที่ทำผิดรู้ว่าตัวเองถูกบันทึกอะไรไว้
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'e2222222-2222-4222-8222-222222222222';

select pg_temp.assert_eq(
  (select public.has_permission('audit.read')), false, 'ผู้ขอไม่มีสิทธิ์อ่าน audit');

select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events), 0,
  'ผู้ไม่มีสิทธิ์มองไม่เห็นแม้แต่แถวเดียว');

select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events
   where actor_id = 'e2222222-2222-4222-8222-222222222222'),
  0, 'ผู้ไม่มีสิทธิ์มองไม่เห็นแม้แต่แถวของตัวเอง');

-- ---------------------------------------------------------------------------
-- ผู้มีสิทธิ์เห็นครบ รวมถึงของคนอื่น
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'e1111111-1111-4111-8111-111111111111';

select pg_temp.assert_eq(
  (select public.has_permission('audit.read')), true, 'ผู้ตรวจสอบภายในมีสิทธิ์อ่าน audit');

select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events where request_id like 'req-au-%'),
  2, 'ผู้มีสิทธิ์เห็นทั้งของตัวเองและของคนอื่น');

-- ---------------------------------------------------------------------------
-- **append-only** — แก้และลบไม่ได้ แม้จะเป็นผู้มีสิทธิ์อ่าน (FR-AUD-002)
--
-- ถูกเพิกถอนที่ระดับ table privilege ไม่ใช่แค่ไม่มี policy การเพิ่ม policy
-- ผิดพลาดในอนาคตจึงยังเปิดช่องไม่ได้
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$update public.audit_events set action = 'admin.action' where request_id = 'req-au-1'$$,
  'permission denied', 'แก้ audit ไม่ได้');

select pg_temp.assert_fails(
  $$delete from public.audit_events where request_id = 'req-au-1'$$,
  'permission denied', 'ลบ audit ไม่ได้');

select pg_temp.assert_eq(
  has_table_privilege('authenticated', 'public.audit_events', 'update'),
  false, 'authenticated ไม่มีสิทธิ์ update ที่ระดับตาราง');

select pg_temp.assert_eq(
  has_table_privilege('authenticated', 'public.audit_events', 'delete'),
  false, 'authenticated ไม่มีสิทธิ์ delete ที่ระดับตาราง');

-- ---------------------------------------------------------------------------
-- การเชื่อมกับ profiles ที่หน้าจอใช้ต้องมีอยู่จริง
--
-- repository ฝั่งแอป embed ด้วยชื่อ constraint ตรง ๆ
-- (`actor:profiles!audit_events_actor_id_fkey`) ถ้าชื่อเปลี่ยน query จะพัง
-- ตอนรันเท่านั้น ไม่ใช่ตอน build — test นี้จับได้ก่อน
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select count(*)::integer from pg_constraint
   where conrelid = 'public.audit_events'::regclass
     and contype = 'f' and conname = 'audit_events_actor_id_fkey'),
  1, 'foreign key ที่หน้าจอใช้ embed มีอยู่จริง');

-- ---------------------------------------------------------------------------
-- **แถวที่เวลาเท่ากันต้องไม่ถูกข้ามตอนแบ่งหน้า**
--
-- `now()` คืนเวลาเริ่มทรานแซกชัน แถวที่เขียนในทรานแซกชันเดียวกันจึงมีเวลา
-- เท่ากันเป๊ะ — ซึ่งเป็นเรื่องปกติเพราะ RPC ทุกตัวเขียน audit ในทรานแซกชัน
-- เดียวกับข้อมูล ถ้า cursor ใช้เวลาอย่างเดียวแล้วขอบหน้าตกกลางกลุ่มนี้
-- แถวที่เหลือจะหายไปเงียบ ๆ จึงต้องใช้คู่ (created_at, id)
--
-- test นี้จำลองการแบ่งหน้าขนาด 1 แถว แล้วนับว่าครบทั้งสามแถวหรือไม่
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select count(distinct created_at)::integer from public.audit_events
   where request_id like 'req-au-%'),
  1, 'สองแถวที่เขียนพร้อมกันมีเวลาเท่ากันเป๊ะ');

reset role;
insert into public.audit_events (request_id, actor_id, action, entity_type, after_json)
select 'req-au-3', 'e1111111-1111-4111-8111-111111111111', 'auth.logout', 'session', null;
set local role authenticated;
set local request.jwt.claim.sub = 'e1111111-1111-4111-8111-111111111111';

/* ไล่ทีละหน้าด้วยกติกาเดียวกับ repository แล้วนับว่าเห็นครบสามแถว */
create or replace function pg_temp.paged_count() returns integer language plpgsql as $$
declare
  v_at timestamptz := 'infinity';
  v_id uuid := '11111111-1111-1111-1111-111111111111';
  v_row record;
  v_seen integer := 0;
  v_first boolean := true;
begin
  loop
    select created_at, id into v_row
    from public.audit_events
    where request_id like 'req-au-%'
      and (v_first or created_at < v_at or (created_at = v_at and id < v_id))
    order by created_at desc, id desc
    limit 1;

    exit when not found;

    v_seen := v_seen + 1;
    v_at := v_row.created_at;
    v_id := v_row.id;
    v_first := false;
  end loop;

  return v_seen;
end; $$;

select pg_temp.assert_eq(
  pg_temp.paged_count(), 3,
  'แบ่งหน้าทีละแถวแล้วยังเห็นครบทุกแถว แม้เวลาจะเท่ากัน');

/*
 * เรียงตามเวลาจริง — ต้องใส่แถวที่เวลาต่างกันจริงจึงจะทดสอบข้อนี้ได้
 *
 * แถวก่อนหน้าทั้งสามเขียนในทรานแซกชันเดียวกันจึงมีเวลาเท่ากันหมด
 * การถามว่า "แถวไหนใหม่สุด" ในกลุ่มนั้นตอบด้วย id ซึ่งเป็น uuid สุ่ม
 * ไม่ได้พิสูจน์อะไรเกี่ยวกับการเรียงตามเวลา
 */
reset role;
insert into public.audit_events
  (request_id, actor_id, action, entity_type, after_json, created_at)
values
  ('req-au-old', 'e1111111-1111-4111-8111-111111111111', 'auth.login', 'session', null,
   now() - interval '2 days');
set local role authenticated;
set local request.jwt.claim.sub = 'e1111111-1111-4111-8111-111111111111';

select pg_temp.assert_eq(
  (select request_id from public.audit_events
   where request_id like 'req-au-%' order by created_at asc, id asc limit 1),
  'req-au-old', 'แถวที่เก่ากว่าอยู่ท้ายสุดเมื่อเรียงจากใหม่ไปเก่า');

select pg_temp.assert_eq(
  pg_temp.paged_count(), 4, 'แบ่งหน้าทีละแถวยังเห็นครบเมื่อมีทั้งเวลาซ้ำและเวลาต่าง');

rollback;
