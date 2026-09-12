-- =============================================================================
-- ทดสอบการจัดการผู้ใช้และบทบาทบน PostgreSQL จริง (PR-05a)
--
-- สิ่งที่ unit test พิสูจน์ไม่ได้และต้องรันที่นี่:
--
--   * **กันการล็อกทุกคนออกจากระบบ** — ถอดสิทธิ์จัดการผู้ใช้จากคนสุดท้ายไม่ได้
--     และปิดบัญชีคนสุดท้ายไม่ได้ ทั้งสองเป็นความผิดพลาดที่แก้จากหน้าจอไม่ได้เลย
--   * ปิดบัญชีตัวเองไม่ได้
--   * กฎดูจาก **สิทธิ์** ไม่ใช่ชื่อบทบาท — ย้ายสิทธิ์ไปบทบาทอื่นแล้วกฎต้องตามไป
--   * ผู้ที่ไม่มีสิทธิ์ users.manage ทำอะไรไม่ได้เลย
--   * audit บันทึกบทบาทก่อนและหลัง
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

create or replace function pg_temp.roles_of(p_user uuid)
returns text language sql as $$
  select coalesce(string_agg(role_code, ',' order by role_code), '')
  from public.user_roles where user_id = p_user;
$$;

/*
 * นับผู้ดูแลที่เหลือด้วยเควรีตรงในชุดทดสอบ ไม่เรียก other_active_user_managers()
 *
 * ฟังก์ชันนั้นถูกเพิกถอนสิทธิ์จาก authenticated โดยเจตนา (มี assertion ยืนยันด้านล่าง)
 * ถ้า test เรียกมันเพื่อตรวจ ก็จะต้องเปิดสิทธิ์ให้ ซึ่งเท่ากับทดสอบระบบที่ไม่ใช่ของจริง
 */
create or replace function pg_temp.other_managers(p_excluding uuid)
returns integer language sql as $$
  select count(distinct p.id)::integer
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
  join public.role_permissions rp on rp.role_code = ur.role_code
  where p.is_active and p.id <> p_excluding and rp.permission_code = 'users.manage';
$$;

-- ---------------------------------------------------------------------------
-- ผู้ใช้สมมติ — ผู้ดูแลสองคน และผู้ใช้ทั่วไปหนึ่งคน
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('a1111111-1111-4111-8111-111111111111', 'ua-admin1@example.test'),
  ('a2222222-2222-4222-8222-222222222222', 'ua-admin2@example.test'),
  ('a3333333-3333-4333-8333-333333333333', 'ua-staff@example.test'),
  ('a4444444-4444-4444-8444-444444444444', 'ua-auditor@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('a1111111-1111-4111-8111-111111111111', 'ua-admin1@example.test', 'ทดสอบ', 'ผู้ดูแลหนึ่ง', true),
  ('a2222222-2222-4222-8222-222222222222', 'ua-admin2@example.test', 'ทดสอบ', 'ผู้ดูแลสอง', true),
  ('a3333333-3333-4333-8333-333333333333', 'ua-staff@example.test', 'ทดสอบ', 'เจ้าหน้าที่', true),
  ('a4444444-4444-4444-8444-444444444444', 'ua-auditor@example.test', 'ทดสอบ', 'ผู้ตรวจสอบภายใน', true);

insert into public.user_roles (user_id, role_code) values
  ('a1111111-1111-4111-8111-111111111111', 'SYSTEM_ADMIN'),
  ('a2222222-2222-4222-8222-222222222222', 'SYSTEM_ADMIN'),
  ('a3333333-3333-4333-8333-333333333333', 'REQUESTER'),
  ('a4444444-4444-4444-8444-444444444444', 'AUDITOR');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- ต้องมีสิทธิ์ users.manage
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'a3333333-3333-4333-8333-333333333333';

select pg_temp.assert_eq(
  (select public.has_permission('users.manage')), false, 'เจ้าหน้าที่ทั่วไปไม่มีสิทธิ์จัดการผู้ใช้');

select pg_temp.assert_fails(
  $$select public.user_set_roles(
      'a3333333-3333-4333-8333-333333333333', array['SYSTEM_ADMIN'])$$,
  'คุณไม่มีสิทธิ์',
  'ผู้ที่ไม่มีสิทธิ์ยกระดับตัวเองไม่ได้');

select pg_temp.assert_fails(
  $$select public.user_set_active('a1111111-1111-4111-8111-111111111111', false)$$,
  'คุณไม่มีสิทธิ์',
  'ผู้ที่ไม่มีสิทธิ์ปิดบัญชีผู้ดูแลไม่ได้');

-- ---------------------------------------------------------------------------
-- การเปลี่ยนบทบาทตามปกติ
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'a1111111-1111-4111-8111-111111111111';

select public.user_set_roles(
  'a3333333-3333-4333-8333-333333333333', array['REQUESTER', 'REVIEWER']);

select pg_temp.assert_eq(
  pg_temp.roles_of('a3333333-3333-4333-8333-333333333333'),
  'REQUESTER,REVIEWER', 'เพิ่มบทบาทได้');

/* เขียนทับทั้งชุด — บทบาทที่ไม่ได้ส่งมาต้องหายไป ไม่ใช่ค้างอยู่ */
select public.user_set_roles('a3333333-3333-4333-8333-333333333333', array['REVIEWER']);

select pg_temp.assert_eq(
  pg_temp.roles_of('a3333333-3333-4333-8333-333333333333'),
  'REVIEWER', 'บทบาทที่ไม่ได้ส่งมาถูกถอดออก');

select pg_temp.assert_fails(
  $$select public.user_set_roles('a3333333-3333-4333-8333-333333333333', array[]::text[])$$,
  'อย่างน้อยหนึ่งบทบาท',
  'ผู้ใช้ที่ไม่มีบทบาทเลยบันทึกไม่ได้');

select pg_temp.assert_fails(
  $$select public.user_set_roles(
      'a3333333-3333-4333-8333-333333333333', array['ไม่มีบทบาทนี้'])$$,
  'ไม่พบบทบาท',
  'บทบาทที่ไม่มีจริงบันทึกไม่ได้');

-- ---------------------------------------------------------------------------
-- ปิดบัญชีตัวเองไม่ได้
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$select public.user_set_active('a1111111-1111-4111-8111-111111111111', false)$$,
  'ปิดบัญชีของตัวเองไม่ได้',
  'ปิดบัญชีตัวเองไม่ได้แม้จะมีผู้ดูแลคนอื่นอยู่');

-- ปิดบัญชีคนอื่นได้ตามปกติ
select public.user_set_active('a3333333-3333-4333-8333-333333333333', false);

select pg_temp.assert_eq(
  (select is_active from public.profiles where id = 'a3333333-3333-4333-8333-333333333333'),
  false, 'ปิดบัญชีผู้ใช้คนอื่นได้');

select public.user_set_active('a3333333-3333-4333-8333-333333333333', true);

-- ---------------------------------------------------------------------------
-- **กันการล็อกทุกคนออกจากระบบ**
--
-- ตอนนี้มีผู้ดูแลสองคน — ถอดคนหนึ่งได้ แต่ถอดคนสุดท้ายไม่ได้
-- ---------------------------------------------------------------------------

select public.user_set_roles('a2222222-2222-4222-8222-222222222222', array['REQUESTER']);

select pg_temp.assert_eq(
  pg_temp.roles_of('a2222222-2222-4222-8222-222222222222'),
  'REQUESTER', 'ถอดสิทธิ์ผู้ดูแลคนที่สองได้เมื่อยังเหลืออีกคน');

/*
 * เหลือผู้ดูแลคนเดียวแล้ว — ถอดสิทธิ์ตัวเองไม่ได้
 *
 * ถ้าปล่อยให้ทำได้ จะไม่มีใครแก้สิทธิ์ได้อีกเลยนอกจากเข้าฐานข้อมูลตรง
 * ซึ่งโรงเรียนทำเองไม่ได้
 */
select pg_temp.assert_fails(
  $$select public.user_set_roles('a1111111-1111-4111-8111-111111111111', array['REQUESTER'])$$,
  'ต้องเหลือผู้ที่จัดการผู้ใช้ได้อย่างน้อยหนึ่งคน',
  'ถอดสิทธิ์ผู้ดูแลคนสุดท้ายไม่ได้');

select pg_temp.assert_eq(
  pg_temp.roles_of('a1111111-1111-4111-8111-111111111111'),
  'SYSTEM_ADMIN', 'บทบาทของผู้ดูแลคนสุดท้ายไม่เปลี่ยน');

-- ---------------------------------------------------------------------------
-- กฎดูจาก "สิทธิ์" ไม่ใช่ชื่อบทบาท
--
-- ถ้าผูกกฎไว้กับชื่อ 'SYSTEM_ADMIN' การย้ายสิทธิ์ไปบทบาทอื่นจะทำให้กฎเฝ้าของ
-- ที่ไม่สำคัญแล้ว — test นี้ย้ายสิทธิ์จริงแล้วดูว่ากฎตามไปหรือไม่
-- ---------------------------------------------------------------------------

insert into public.role_permissions (role_code, permission_code)
values ('AUDITOR', 'users.manage');

select pg_temp.assert_eq(
  pg_temp.other_managers('a1111111-1111-4111-8111-111111111111'),
  1, 'ผู้ตรวจสอบภายในนับเป็นผู้ดูแลได้เมื่อได้รับสิทธิ์');

-- ตอนนี้มีคนอื่นถือสิทธิ์แล้ว จึงถอดสิทธิ์ตัวเองได้
select public.user_set_roles('a1111111-1111-4111-8111-111111111111', array['REQUESTER']);

select pg_temp.assert_eq(
  pg_temp.roles_of('a1111111-1111-4111-8111-111111111111'),
  'REQUESTER', 'ถอดสิทธิ์ตัวเองได้เมื่อมีบทบาทอื่นถือสิทธิ์แทน');

-- ---------------------------------------------------------------------------
-- ปิดบัญชีผู้ดูแลคนสุดท้ายไม่ได้
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'a4444444-4444-4444-8444-444444444444';

select pg_temp.assert_eq(
  (select public.has_permission('users.manage')), true,
  'ผู้ตรวจสอบภายในได้สิทธิ์จัดการผู้ใช้แล้ว');

/* ตัวเองเป็นคนสุดท้าย — ติดทั้งกฎ "ปิดบัญชีตัวเองไม่ได้" ก่อน */
select pg_temp.assert_fails(
  $$select public.user_set_active('a4444444-4444-4444-8444-444444444444', false)$$,
  'ปิดบัญชีของตัวเองไม่ได้',
  'ผู้ดูแลคนสุดท้ายปิดบัญชีตัวเองไม่ได้');

/*
 * ทางตันจริง — เมื่อเหลือผู้ดูแลคนเดียว ไม่มีลำดับคำสั่งใดที่ทำให้เหลือศูนย์คน
 *
 * **สิ่งที่พิสูจน์ที่นี่คือผลลัพธ์ ไม่ใช่บรรทัด if ใดบรรทัดหนึ่ง** สาขา
 * "ปิดบัญชีผู้ดูแลคนสุดท้าย" ใน user_set_active() เรียกให้เข้าเงื่อนไขไม่ได้จริง
 * เพราะผู้เรียกต้องเป็นผู้ดูแลที่ยัง active (has_permission บังคับ is_active)
 * และปิดบัญชีตัวเองไม่ได้ ผู้เรียกจึงถูกนับเป็นผู้ดูแลที่เหลืออยู่เสมอ —
 * ดูคำอธิบายเต็มใน migration 0018
 *
 * การเขียน test ให้ "ผ่าน" โดยยิงไปที่บรรทัดนั้นตรง ๆ ต้องปลอมสภาพที่ระบบจริง
 * สร้างไม่ได้ ซึ่งจะกลายเป็น test ที่ทดสอบระบบที่ไม่มีอยู่ จึงไล่ปิดทุกทางออก
 * ที่ **มีจริง** แทน
 */
select public.user_set_roles('a2222222-2222-4222-8222-222222222222', array['SYSTEM_ADMIN']);

set local request.jwt.claim.sub = 'a2222222-2222-4222-8222-222222222222';

-- ถอดสิทธิ์ผู้ตรวจสอบภายในออก เหลือผู้ดูแลคนเดียวคือ admin2
delete from public.role_permissions where role_code = 'AUDITOR' and permission_code = 'users.manage';

select pg_temp.assert_eq(
  pg_temp.other_managers('a2222222-2222-4222-8222-222222222222'),
  0, 'เหลือผู้ดูแลคนเดียว');

-- ทางออกที่ 1 — ปิดบัญชีตัวเอง
select pg_temp.assert_fails(
  $$select public.user_set_active('a2222222-2222-4222-8222-222222222222', false)$$,
  'ปิดบัญชีของตัวเองไม่ได้',
  'ทางออกที่ 1 ปิด — ผู้ดูแลคนเดียวที่เหลือปิดบัญชีตัวเองไม่ได้');

-- ทางออกที่ 2 — ถอดบทบาทที่ถือสิทธิ์ออกจากตัวเอง
select pg_temp.assert_fails(
  $$select public.user_set_roles('a2222222-2222-4222-8222-222222222222', array['REQUESTER'])$$,
  'ต้องเหลือผู้ที่จัดการผู้ใช้ได้อย่างน้อยหนึ่งคน',
  'ทางออกที่ 2 ปิด — ถอดบทบาทที่ถือสิทธิ์ออกจากตัวเองไม่ได้');

/*
 * ทางออกที่ 3 — ให้คนอื่นเป็นผู้ปิดบัญชีให้
 *
 * คนอื่นทุกคนไม่มีสิทธิ์ users.manage แล้ว (เพิ่งถอดออกจาก AUDITOR ไป)
 * จึงเรียกฟังก์ชันไม่ผ่านตั้งแต่ด่านตรวจสิทธิ์
 */
set local request.jwt.claim.sub = 'a4444444-4444-4444-8444-444444444444';

select pg_temp.assert_fails(
  $$select public.user_set_active('a2222222-2222-4222-8222-222222222222', false)$$,
  'คุณไม่มีสิทธิ์ดำเนินการนี้',
  'ทางออกที่ 3 ปิด — คนที่ไม่มีสิทธิ์ปิดบัญชีผู้ดูแลคนสุดท้ายแทนไม่ได้');

/*
 * ผลลัพธ์ที่ต้องการ — ยังเหลือผู้ดูแลที่ยัง active อย่างน้อยหนึ่งคน
 *
 * ต้องนับในนามของผู้ที่อ่าน profiles ได้ ไม่ใช่ในนามของ a4444444 ที่เพิ่งเสียสิทธิ์ไป
 * มิฉะนั้นจะได้ 0 เพราะ RLS กรองแถวออก ไม่ใช่เพราะไม่มีผู้ดูแลเหลือจริง
 */
set local request.jwt.claim.sub = 'a2222222-2222-4222-8222-222222222222';

select pg_temp.assert_eq(
  (select count(distinct p.id)::integer
     from public.profiles p
     join public.user_roles ur on ur.user_id = p.id
     join public.role_permissions rp on rp.role_code = ur.role_code
    where p.is_active and rp.permission_code = 'users.manage'),
  1, 'หลังพยายามทุกทางแล้ว ยังเหลือผู้ดูแลที่ใช้งานได้');

-- ---------------------------------------------------------------------------
-- ฟังก์ชันช่วยนับไม่เปิดให้ผู้ใช้ทั่วไปเรียก
--
-- ทั้งสองอ่านข้ามผู้ใช้ได้ การเปิดให้เรียกตรงทำให้สำรวจได้ว่าใครถือสิทธิ์จัดการผู้ใช้
-- ซึ่งเป็นข้อมูลที่ใช้เลือกเป้าหมายโจมตีได้
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  has_function_privilege('authenticated', 'public.user_manages_users(uuid)', 'execute'),
  false, 'authenticated เรียก user_manages_users ตรงไม่ได้');

select pg_temp.assert_eq(
  has_function_privilege('authenticated', 'public.other_active_user_managers(uuid)', 'execute'),
  false, 'authenticated เรียก other_active_user_managers ตรงไม่ได้');

-- ---------------------------------------------------------------------------
-- audit
-- ---------------------------------------------------------------------------

-- อ่าน audit ด้วยผู้ตรวจสอบภายใน เพราะ RLS ของ audit_events ต้องการสิทธิ์ audit.read
-- ซึ่งบทบาท AUDITOR มีอยู่แล้วจาก seed
set local request.jwt.claim.sub = 'a4444444-4444-4444-8444-444444444444';

select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events where action = 'user.roles_change'),
  5, 'ทุกการเปลี่ยนบทบาทมี audit');

select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events where action = 'user.active_change'),
  2, 'ทุกการเปลี่ยนสถานะบัญชีมี audit');

/*
 * audit ต้องเก็บบทบาท "ก่อน" ไว้ด้วย
 *
 * ถ้าเก็บแต่ค่าหลัง ผู้ตรวจสอบจะรู้ว่าตอนนี้มีสิทธิ์อะไร แต่ไม่รู้ว่าได้เพิ่มมาจากอะไร
 * ซึ่งเป็นคำถามหลักของการตรวจสอบการเปลี่ยนสิทธิ์
 */
select pg_temp.assert_eq(
  (select before_json -> 'role_codes' ->> 0 from public.audit_events
   where action = 'user.roles_change' and entity_id = 'a3333333-3333-4333-8333-333333333333'
   order by created_at limit 1),
  'REQUESTER', 'audit เก็บบทบาทก่อนเปลี่ยนไว้ด้วย');

rollback;
