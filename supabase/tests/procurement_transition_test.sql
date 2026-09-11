-- =============================================================================
-- ทดสอบสายอนุมัติบน PostgreSQL จริง (PR-04a)
--
-- สิ่งที่ unit test พิสูจน์ไม่ได้และต้องรันที่นี่:
--
--   * การเรียก RPC ตรงโดยไม่ผ่านหน้าจอถูกปฏิเสธด้วยกติกาชุดเดียวกัน
--   * separation of duties — ผู้สร้างรายการอนุมัติรายการของตัวเองไม่ได้
--   * ประวัติที่แช่แข็งไว้ ไม่เปลี่ยนตามตำแหน่งปัจจุบันของผู้ใช้
--   * สถานะกับประวัติเปลี่ยนพร้อมกันหรือไม่เปลี่ยนเลย
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

/* ดำเนินการด้วย version ปัจจุบัน — เหตุผลเดียวกับ submit_now ใน test ของ PR-03 */
create or replace function pg_temp.act(p_id uuid, p_action text, p_reason text default null)
returns text language plpgsql as $$
declare v_version integer;
begin
  select version into v_version from public.procurements where id = p_id;
  return public.procurement_transition(p_id, p_action, v_version, p_reason)::text;
end; $$;

create or replace function pg_temp.status_of(p_id uuid)
returns text language sql as $$
  select status::text from public.procurements where id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- ผู้ใช้สมมติ
--
-- ผู้ขอถือสิทธิ์ตรวจสอบและอนุมัติด้วย เพื่อพิสูจน์ว่า separation of duties กันได้จริง
-- ถ้าผู้ขอไม่มีสิทธิ์เหล่านั้นอยู่แล้ว การทดสอบจะผ่านเพราะขาดสิทธิ์ ไม่ใช่เพราะกฎ SoD
-- ซึ่งจะไม่ได้ทดสอบสิ่งที่ตั้งใจเลย
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('d1111111-1111-4111-8111-111111111111', 'tr-requester@example.test'),
  ('d2222222-2222-4222-8222-222222222222', 'tr-reviewer@example.test'),
  ('d3333333-3333-4333-8333-333333333333', 'tr-approver@example.test'),
  ('d4444444-4444-4444-8444-444444444444', 'tr-finance@example.test'),
  ('d5555555-5555-4555-8555-555555555555', 'tr-auditor@example.test');

insert into public.positions (id, code, name_th) values
  ('d9000000-0000-4000-8000-000000000001', 'POS-TR', 'ครู (ตัวอย่าง)');

insert into public.profiles (id, email, title_th, first_name_th, last_name_th, position_id, is_active)
values
  ('d1111111-1111-4111-8111-111111111111', 'tr-requester@example.test',
   'นาย', 'ทดสอบ', 'ผู้ขอ', null, true),
  ('d2222222-2222-4222-8222-222222222222', 'tr-reviewer@example.test',
   'นาง', 'ทดสอบ', 'ผู้ตรวจสอบ', null, true),
  ('d3333333-3333-4333-8333-333333333333', 'tr-approver@example.test',
   'นาย', 'ทดสอบ', 'ผู้อนุมัติ', 'd9000000-0000-4000-8000-000000000001', true),
  ('d4444444-4444-4444-8444-444444444444', 'tr-finance@example.test',
   'นาง', 'ทดสอบ', 'การเงิน', null, true),
  ('d5555555-5555-4555-8555-555555555555', 'tr-auditor@example.test',
   'นาง', 'ทดสอบ', 'ผู้ตรวจสอบภายใน', null, true);

insert into public.user_roles (user_id, role_code) values
  ('d1111111-1111-4111-8111-111111111111', 'REQUESTER'),
  -- ผู้ขอถือสิทธิ์ตรวจสอบและอนุมัติด้วยโดยเจตนา (ดูหมายเหตุด้านบน)
  ('d1111111-1111-4111-8111-111111111111', 'REVIEWER'),
  ('d1111111-1111-4111-8111-111111111111', 'APPROVER'),
  -- ต้องมี PROCUREMENT_OFFICER ด้วยจึงจะมีสิทธิ์ procurement.cancel
  -- (REQUESTER ล้วน ๆ ยกเลิกคำขอของตัวเองไม่ได้ — ดูหมายเหตุที่หัวข้อการยกเลิก)
  ('d1111111-1111-4111-8111-111111111111', 'PROCUREMENT_OFFICER'),
  ('d2222222-2222-4222-8222-222222222222', 'REVIEWER'),
  ('d3333333-3333-4333-8333-333333333333', 'APPROVER'),
  ('d4444444-4444-4444-8444-444444444444', 'FINANCE'),
  ('d5555555-5555-4555-8555-555555555555', 'AUDITOR');

insert into public.fiscal_years (id, code, year_be, start_date, end_date) values
  ('d0000000-0000-4000-8000-000000000001', 'FYTR', 2569, '2025-10-01', '2026-09-30');

insert into public.projects (id, code, name_th, fiscal_year_id) values
  ('d0000000-0000-4000-8000-000000000002', 'PRJ-TR', 'โครงการทดสอบสายอนุมัติ (ตัวอย่าง)',
   'd0000000-0000-4000-8000-000000000001');

insert into public.budget_accounts (id, code, fiscal_year_id, project_id) values
  ('d0000000-0000-4000-8000-000000000003', 'ACC-TR',
   'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002');

-- รายการที่กรอกครบและส่งอนุมัติได้
insert into public.procurements (
  id, subject, purpose, fiscal_year_id, request_date, report_date,
  classification, procurement_method, tax_mode, created_by
) values (
  'daaaaaaa-0000-4000-8000-000000000001', 'จัดซื้อทดสอบสายอนุมัติ (ตัวอย่าง)',
  'ใช้ทดสอบ (ตัวอย่าง)', 'd0000000-0000-4000-8000-000000000001',
  '2026-01-05', '2026-01-06', 'GOODS', 'SPECIFIC', 'EXEMPT',
  'd1111111-1111-4111-8111-111111111111'
);

insert into public.procurement_items (procurement_id, line_no, description, quantity, unit_price)
values ('daaaaaaa-0000-4000-8000-000000000001', 1, 'กระดาษ (ตัวอย่าง)', 10, 250.00);

insert into public.procurement_funding_allocations
  (procurement_id, line_no, budget_account_id, amount)
values ('daaaaaaa-0000-4000-8000-000000000001', 1,
        'd0000000-0000-4000-8000-000000000003', 2500.00);

set local role authenticated;

-- ตั้งงบให้พอ แล้วส่งอนุมัติในฐานะผู้ขอ
set local request.jwt.claim.sub = 'd4444444-4444-4444-8444-444444444444';
select public.budget_post_movement(
  'd0000000-0000-4000-8000-000000000003', 'ALLOCATION', 500000.00, '2026-01-01', 'ตั้งต้น');

set local request.jwt.claim.sub = 'd1111111-1111-4111-8111-111111111111';
select pg_temp.assert_eq(
  (select public.procurement_submit('daaaaaaa-0000-4000-8000-000000000001',
     (select version from public.procurements where id = 'daaaaaaa-0000-4000-8000-000000000001'))::text),
  'PENDING_REVIEW', 'ส่งอนุมัติแล้วอยู่สถานะรอตรวจสอบ');

-- ---------------------------------------------------------------------------
-- submit ต้องไม่มีทางลัด
-- ---------------------------------------------------------------------------

/*
 * ถ้า procurement_transition รับ 'submit' ได้ จะมีทางเปลี่ยนสถานะเป็น
 * PENDING_REVIEW โดยข้ามการตรวจกฎทั้งชุดของ procurement_submit
 * ซึ่งทำให้งานทั้งหมดของ PR-03 ถูกเลี่ยงได้ด้วยการเรียก RPC อีกตัว
 */
select pg_temp.assert_fails(
  $$select pg_temp.act('daaaaaaa-0000-4000-8000-000000000001', 'submit')$$,
  'ต้องผ่าน procurement_submit',
  'submit ผ่าน procurement_transition ไม่ได้');

-- ---------------------------------------------------------------------------
-- Separation of duties
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select public.has_permission('procurement.review')
      and public.has_permission('procurement.approve')),
  true, 'ผู้ขอในการทดสอบนี้ถือสิทธิ์ตรวจสอบและอนุมัติจริง');

/*
 * ผู้ขอยังอยู่ในบทบาทตัวเอง และมีสิทธิ์อนุมัติ — ที่กันไว้คือความเป็นเจ้าของรายการ
 * ไม่ใช่การขาดสิทธิ์ ถ้าข้อความที่ได้เป็นเรื่องสิทธิ์แปลว่ากฎ SoD ไม่ได้ทำงาน
 */
select pg_temp.assert_fails(
  $$select pg_temp.act('daaaaaaa-0000-4000-8000-000000000001', 'review_pass')$$,
  'ผู้สร้างรายการตรวจสอบหรืออนุมัติรายการของตัวเองไม่ได้',
  'SoD: ผู้สร้างรายการตรวจสอบรายการของตัวเองไม่ได้');

-- ---------------------------------------------------------------------------
-- สิทธิ์
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'd3333333-3333-4333-8333-333333333333';

-- ผู้อนุมัติไม่มีสิทธิ์ตรวจสอบ จึงข้ามขั้นตรวจสอบไปอนุมัติเลยไม่ได้
select pg_temp.assert_fails(
  $$select pg_temp.act('daaaaaaa-0000-4000-8000-000000000001', 'review_pass')$$,
  'คุณไม่มีสิทธิ์ดำเนินการนี้',
  'ผู้อนุมัติไม่มีสิทธิ์ตรวจสอบ');

-- และรายการที่ยังไม่ผ่านการตรวจสอบก็อนุมัติไม่ได้เพราะสถานะไม่ตรง
select pg_temp.assert_fails(
  $$select pg_temp.act('daaaaaaa-0000-4000-8000-000000000001', 'approve')$$,
  'สถานะนี้ทำรายการดังกล่าวไม่ได้',
  'ข้ามขั้นตรวจสอบไปอนุมัติเลยไม่ได้');

-- ---------------------------------------------------------------------------
-- เหตุผลที่บังคับ
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'd2222222-2222-4222-8222-222222222222';

select pg_temp.assert_fails(
  $$select pg_temp.act('daaaaaaa-0000-4000-8000-000000000001', 'review_return')$$,
  'ต้องระบุเหตุผล',
  'ส่งกลับแก้ไขโดยไม่ระบุเหตุผลไม่ได้');

-- เคาะวรรคไม่นับเป็นเหตุผล มิฉะนั้นการบังคับจะเลี่ยงได้ทันที
select pg_temp.assert_fails(
  $$select pg_temp.act('daaaaaaa-0000-4000-8000-000000000001', 'review_return', '    ')$$,
  'ต้องระบุเหตุผล',
  'เหตุผลที่เป็นช่องว่างล้วนไม่นับ');

-- ---------------------------------------------------------------------------
-- เส้นทางที่ถูกต้อง
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  pg_temp.act('daaaaaaa-0000-4000-8000-000000000001', 'review_pass'),
  'PENDING_APPROVAL', 'ผู้ตรวจสอบส่งต่อให้ผู้อนุมัติได้');

set local request.jwt.claim.sub = 'd3333333-3333-4333-8333-333333333333';

select pg_temp.assert_eq(
  pg_temp.act('daaaaaaa-0000-4000-8000-000000000001', 'approve'),
  'APPROVED', 'ผู้อนุมัติอนุมัติได้');

-- วันอนุมัติถูกตั้งโดย workflow ไม่ใช่ให้กรอกเอง
select pg_temp.assert_eq(
  (select approved_date is not null from public.procurements
   where id = 'daaaaaaa-0000-4000-8000-000000000001'),
  true, 'workflow ตั้งวันอนุมัติให้เอง');

-- ---------------------------------------------------------------------------
-- ประวัติที่แช่แข็งไว้
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select count(*)::int from public.procurement_approvals
   where procurement_id = 'daaaaaaa-0000-4000-8000-000000000001'),
  2, 'มีประวัติสองขั้นตอน');

select pg_temp.assert_eq(
  (select array_agg(step_no order by step_no) from public.procurement_approvals
   where procurement_id = 'daaaaaaa-0000-4000-8000-000000000001'),
  array[1, 2], 'ลำดับขั้นตอนต่อเนื่องไม่ข้าม');

select pg_temp.assert_eq(
  (select actor_role_code from public.procurement_approvals
   where procurement_id = 'daaaaaaa-0000-4000-8000-000000000001' and step_no = 1),
  'REVIEWER', 'บันทึกบทบาทที่ใช้ดำเนินการจริง');

select pg_temp.assert_eq(
  (select actor_position_th from public.procurement_approvals
   where procurement_id = 'daaaaaaa-0000-4000-8000-000000000001' and step_no = 2),
  'ครู (ตัวอย่าง)', 'บันทึกตำแหน่ง ณ เวลาที่กด');

/*
 * หัวใจของการแช่แข็ง — เปลี่ยนตำแหน่งและชื่อของผู้อนุมัติหลังอนุมัติไปแล้ว
 *
 * ถ้าหน้าจอ join กลับไปที่ profiles ประวัติเมื่อปีที่แล้วจะกลายเป็นตำแหน่งใหม่
 * ทำให้เอกสารย้อนหลังผิด ตารางนี้จึงเก็บสำเนาไว้ตั้งแต่แรก
 */
set local role postgres;
insert into public.positions (id, code, name_th)
  values ('d9000000-0000-4000-8000-000000000002', 'POS-TR2', 'รองผู้อำนวยการ (ตัวอย่าง)');
update public.profiles
set position_id = 'd9000000-0000-4000-8000-000000000002', last_name_th = 'นามสกุลใหม่'
where id = 'd3333333-3333-4333-8333-333333333333';
set local role authenticated;
set local request.jwt.claim.sub = 'd3333333-3333-4333-8333-333333333333';

select pg_temp.assert_eq(
  (select actor_position_th from public.procurement_approvals
   where procurement_id = 'daaaaaaa-0000-4000-8000-000000000001' and step_no = 2),
  'ครู (ตัวอย่าง)', 'เปลี่ยนตำแหน่งภายหลังแล้วประวัติเดิมไม่เปลี่ยน');

select pg_temp.assert_eq(
  (select actor_name_th from public.procurement_approvals
   where procurement_id = 'daaaaaaa-0000-4000-8000-000000000001' and step_no = 2),
  'นาย ทดสอบ ผู้อนุมัติ', 'เปลี่ยนนามสกุลภายหลังแล้วประวัติเดิมไม่เปลี่ยน');

-- ---------------------------------------------------------------------------
-- ประวัติแก้ไม่ได้
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$update public.procurement_approvals set reason = 'แก้ประวัติ' where step_no = 1$$,
  'permission denied',
  'แก้ประวัติการอนุมัติไม่ได้');

select pg_temp.assert_fails(
  $$delete from public.procurement_approvals where step_no = 1$$,
  'permission denied',
  'ลบประวัติการอนุมัติไม่ได้');

select pg_temp.assert_fails(
  $$insert into public.procurement_approvals
      (procurement_id, step_no, action, from_status, to_status, actor_id,
       actor_name_th, actor_role_code)
    values ('daaaaaaa-0000-4000-8000-000000000001', 99, 'approve', 'DRAFT', 'APPROVED',
            'd3333333-3333-4333-8333-333333333333', 'ปลอม', 'APPROVER')$$,
  'permission denied',
  'เขียนประวัติการอนุมัติตรงไม่ได้');

-- ---------------------------------------------------------------------------
-- optimistic concurrency
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$select public.procurement_transition('daaaaaaa-0000-4000-8000-000000000001',
      'issue', 1, null)$$,
  'มีผู้อื่นแก้ไขรายการนี้ไปแล้ว',
  'ดำเนินการด้วย version เก่าไม่ได้');

-- ---------------------------------------------------------------------------
-- สถานะปลายทางไปต่อไม่ได้
-- ---------------------------------------------------------------------------

/*
 * cancel ไม่อยู่ในรายการที่กฎ SoD ห้าม — เจ้าของยกเลิกรายการของตัวเองได้
 *
 * **ข้อสังเกตที่พบระหว่างเขียน test นี้:** ผู้ที่ถือบทบาท REQUESTER ล้วน ๆ
 * ไม่มีสิทธิ์ `procurement.cancel` เลย จึงยกเลิกคำขอของตัวเองไม่ได้
 * ผู้ใช้ในการทดสอบนี้จึงต้องถือ PROCUREMENT_OFFICER ด้วย
 * เป็นเรื่องของการผูกสิทธิ์เริ่มต้น ไม่ใช่ของสายอนุมัติ จึงไม่แก้ใน PR นี้
 * แต่บันทึกไว้ใน assumptions ข้อ 2.8 ให้โรงเรียนตัดสิน
 */
set local request.jwt.claim.sub = 'd1111111-1111-4111-8111-111111111111';
select pg_temp.assert_eq(
  pg_temp.act('daaaaaaa-0000-4000-8000-000000000001', 'cancel', 'ยกเลิกเพื่อทดสอบ (ตัวอย่าง)'),
  'CANCELLED', 'เจ้าของยกเลิกรายการของตัวเองได้ — cancel ไม่ติดกฎ SoD');

select pg_temp.assert_fails(
  $$select pg_temp.act('daaaaaaa-0000-4000-8000-000000000001', 'cancel', 'ยกเลิกซ้ำ')$$,
  'สถานะนี้ทำรายการดังกล่าวไม่ได้',
  'ยกเลิกซ้ำไม่ได้');

-- ---------------------------------------------------------------------------
-- ล้มแล้วต้องไม่ทิ้งอะไรไว้ครึ่ง ๆ กลาง ๆ
-- ---------------------------------------------------------------------------

/*
 * สถานะกับประวัติต้องเปลี่ยนพร้อมกันหรือไม่เปลี่ยนเลย
 * ทุกครั้งที่ถูกปฏิเสธข้างบน จำนวนประวัติต้องยังเป็น 3 (ตรวจ ผ่าน อนุมัติ ยกเลิก)
 */
select pg_temp.assert_eq(
  (select count(*)::int from public.procurement_approvals
   where procurement_id = 'daaaaaaa-0000-4000-8000-000000000001'),
  3, 'การกระทำที่ถูกปฏิเสธไม่ทิ้งประวัติไว้');

select pg_temp.assert_eq(
  pg_temp.status_of('daaaaaaa-0000-4000-8000-000000000001'),
  'CANCELLED', 'สถานะสุดท้ายตรงกับประวัติขั้นสุดท้าย');

-- ---------------------------------------------------------------------------
-- audit
-- ---------------------------------------------------------------------------

/*
 * อ่าน audit ในฐานะผู้ตรวจสอบภายใน ไม่ใช่ในฐานะผู้ขอ
 *
 * `audit_events` มี RLS ที่ต้องการสิทธิ์ `audit.read` การนับในฐานะผู้ขอจะได้ 0
 * เสมอเพราะถูก RLS กรอง ไม่ใช่เพราะไม่มี event — ซึ่งจะทำให้ test ผ่านหรือล้ม
 * ด้วยเหตุผลที่ไม่เกี่ยวกับสิ่งที่ตั้งใจตรวจ
 */
set local request.jwt.claim.sub = 'd5555555-5555-4555-8555-555555555555';

select pg_temp.assert_eq(
  (select count(*)::int from public.audit_events
   where entity_id = 'daaaaaaa-0000-4000-8000-000000000001'
     and action = 'procurement.status_change'),
  4, 'ทุกการเปลี่ยนสถานะมี audit event (รวมการส่งอนุมัติ)');

-- ผู้ที่ไม่มีสิทธิ์ audit.read ต้องไม่เห็นประวัติการตรวจสอบ
set local request.jwt.claim.sub = 'd1111111-1111-4111-8111-111111111111';
select pg_temp.assert_eq(
  (select count(*)::int from public.audit_events
   where entity_id = 'daaaaaaa-0000-4000-8000-000000000001'),
  0, 'ผู้ที่ไม่มีสิทธิ์ audit.read อ่าน audit ไม่ได้');

rollback;
