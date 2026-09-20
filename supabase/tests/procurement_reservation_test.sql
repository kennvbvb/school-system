-- =============================================================================
-- ทดสอบการกันยอดงบตอนอนุมัติบน PostgreSQL จริง (PR-04c)
--
-- สิ่งที่ unit test พิสูจน์ไม่ได้และต้องรันที่นี่:
--
--   * การอนุมัติลง RESERVE จริง และยอดที่ใช้ได้ลดลงทันที
--   * **ผู้อนุมัติที่ไม่มีสิทธิ์ budget.manage ก็อนุมัติได้** — การกันยอดมาจาก
--     workflow ไม่ใช่จากคน
--   * อนุมัติแล้วงบไม่พอ ต้องล้มทั้งชุด ไม่ใช่เปลี่ยนสถานะแล้วค้างไว้
--   * ยกเลิกแล้วคืนยอดครบ และการเดินหน้าภายในกลุ่มที่ถือยอดไม่กันซ้ำ
--   * เรียกฟังก์ชันกันยอด/คืนยอดตรงไม่ได้
--
-- การอนุมัติสองรายการ **พร้อมกัน** อยู่ใน run-reservation-tests.sh
-- เพราะต้องใช้สอง session ซึ่งเขียนในไฟล์ .sql ไฟล์เดียวไม่ได้
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

create or replace function pg_temp.act(p_id uuid, p_action text, p_reason text default null)
returns text language plpgsql as $$
declare v_version integer;
begin
  select version into v_version from public.procurements where id = p_id;
  return public.procurement_transition(p_id, p_action, v_version, p_reason)::text;
end; $$;

create or replace function pg_temp.available(p_account uuid)
returns numeric language sql as $$ select public.budget_available(p_account); $$;

-- ---------------------------------------------------------------------------
-- ผู้ใช้สมมติ
--
-- **ผู้อนุมัติถือแค่บทบาท APPROVER** ไม่มี budget.manage โดยเจตนา
-- ถ้าการกันยอดต้องการสิทธิ์ของผู้กด การอนุมัติจะล้มทุกครั้ง ซึ่งเป็นสิ่งที่ test นี้จับ
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('f1111111-1111-4111-8111-111111111111', 'rs-requester@example.test'),
  ('f2222222-2222-4222-8222-222222222222', 'rs-reviewer@example.test'),
  ('f3333333-3333-4333-8333-333333333333', 'rs-approver@example.test'),
  ('f4444444-4444-4444-8444-444444444444', 'rs-finance@example.test'),
  ('f5555555-5555-4555-8555-555555555555', 'rs-officer@example.test'),
  ('f6666666-6666-4666-8666-666666666666', 'rs-auditor@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('f1111111-1111-4111-8111-111111111111', 'rs-requester@example.test', 'ทดสอบ', 'ผู้ขอ', true),
  ('f2222222-2222-4222-8222-222222222222', 'rs-reviewer@example.test', 'ทดสอบ', 'ผู้ตรวจสอบ', true),
  ('f3333333-3333-4333-8333-333333333333', 'rs-approver@example.test', 'ทดสอบ', 'ผู้อนุมัติ', true),
  ('f4444444-4444-4444-8444-444444444444', 'rs-finance@example.test', 'ทดสอบ', 'การเงิน', true),
  ('f5555555-5555-4555-8555-555555555555', 'rs-officer@example.test', 'ทดสอบ', 'พัสดุ', true),
  ('f6666666-6666-4666-8666-666666666666', 'rs-auditor@example.test',
   'ทดสอบ', 'ผู้ตรวจสอบภายใน', true);

insert into public.user_roles (user_id, role_code) values
  ('f1111111-1111-4111-8111-111111111111', 'REQUESTER'),
  ('f2222222-2222-4222-8222-222222222222', 'REVIEWER'),
  ('f3333333-3333-4333-8333-333333333333', 'APPROVER'),
  ('f4444444-4444-4444-8444-444444444444', 'FINANCE'),
  ('f5555555-5555-4555-8555-555555555555', 'PROCUREMENT_OFFICER'),
  ('f6666666-6666-4666-8666-666666666666', 'AUDITOR');

insert into public.fiscal_years (id, code, year_be, start_date, end_date) values
  ('f0000000-0000-4000-8000-000000000001', 'FYRS', 2569, '2025-10-01', '2026-09-30');

insert into public.projects (id, code, name_th, fiscal_year_id) values
  ('f0000000-0000-4000-8000-000000000002', 'PRJ-RS', 'โครงการทดสอบการกันยอด (ตัวอย่าง)',
   'f0000000-0000-4000-8000-000000000001');

insert into public.budget_accounts (id, code, fiscal_year_id, project_id) values
  ('f0000000-0000-4000-8000-000000000003', 'ACC-RS',
   'f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002');

/* สองรายการ ใบละ 2,500 บาท บนบัญชีที่จะตั้งงบไว้ 4,000 — รวมกันเกินงบ */
insert into public.procurements (
  id, subject, purpose, fiscal_year_id, request_date, report_date,
  classification, procurement_method, tax_mode, created_by
) values
  ('faaaaaaa-0000-4000-8000-000000000001', 'จัดซื้อทดสอบการกันยอด ก (ตัวอย่าง)',
   'ใช้ทดสอบ (ตัวอย่าง)', 'f0000000-0000-4000-8000-000000000001', '2026-01-05', '2026-01-06',
   'GOODS', 'SPECIFIC', 'EXEMPT', 'f1111111-1111-4111-8111-111111111111'),
  ('faaaaaaa-0000-4000-8000-000000000002', 'จัดซื้อทดสอบการกันยอด ข (ตัวอย่าง)',
   'ใช้ทดสอบ (ตัวอย่าง)', 'f0000000-0000-4000-8000-000000000001', '2026-01-05', '2026-01-06',
   'GOODS', 'SPECIFIC', 'EXEMPT', 'f1111111-1111-4111-8111-111111111111');

insert into public.procurement_items (procurement_id, line_no, description, quantity, unit_price)
values
  ('faaaaaaa-0000-4000-8000-000000000001', 1, 'กระดาษ (ตัวอย่าง)', 10, 250.00),
  ('faaaaaaa-0000-4000-8000-000000000002', 1, 'หมึกพิมพ์ (ตัวอย่าง)', 10, 250.00);

insert into public.procurement_funding_allocations
  (procurement_id, line_no, budget_account_id, amount)
values
  ('faaaaaaa-0000-4000-8000-000000000001', 1, 'f0000000-0000-4000-8000-000000000003', 2500.00),
  ('faaaaaaa-0000-4000-8000-000000000002', 1, 'f0000000-0000-4000-8000-000000000003', 2500.00);

/* ยอดที่ยังถือไว้ของรายการหนึ่ง — ฟังก์ชันจริงถูกเพิกถอนจาก authenticated
   จึงห่อด้วย security definer ใน pg_temp แทนการเปิดสิทธิ์ให้ของจริง */
create or replace function pg_temp.holds(p_procurement uuid, p_type text)
returns numeric language sql security definer as $$
  select coalesce(sum(outstanding), 0)
  from public.procurement_outstanding_hold(p_procurement)
  where p_type is null or hold_type::text = p_type;
$$;

create or replace function pg_temp.hold_rows(p_procurement uuid)
returns integer language sql security definer as $$
  select count(*)::integer from public.procurement_outstanding_hold(p_procurement);
$$;

set local role authenticated;

-- ตั้งงบ 4,000 — พอสำหรับรายการเดียวเท่านั้น
set local request.jwt.claim.sub = 'f4444444-4444-4444-8444-444444444444';
select public.budget_post_movement(
  'f0000000-0000-4000-8000-000000000003', 'ALLOCATION', 4000.00, '2026-01-01', 'ตั้งต้น');

select pg_temp.assert_eq(
  pg_temp.available('f0000000-0000-4000-8000-000000000003'), 4000.00::numeric,
  'ยอดตั้งต้น 4,000');

-- ส่งอนุมัติทั้งสองใบ — **ทั้งคู่ผ่านการตรวจงบ** เพราะแต่ละใบ 2,500 ไม่เกิน 4,000
set local request.jwt.claim.sub = 'f1111111-1111-4111-8111-111111111111';
select public.procurement_submit('faaaaaaa-0000-4000-8000-000000000001',
  (select version from public.procurements where id = 'faaaaaaa-0000-4000-8000-000000000001'));
select public.procurement_submit('faaaaaaa-0000-4000-8000-000000000002',
  (select version from public.procurements where id = 'faaaaaaa-0000-4000-8000-000000000002'));

select pg_temp.assert_eq(
  pg_temp.available('f0000000-0000-4000-8000-000000000003'), 4000.00::numeric,
  'การส่งอนุมัติไม่แตะยอดงบ');

set local request.jwt.claim.sub = 'f2222222-2222-4222-8222-222222222222';
select pg_temp.act('faaaaaaa-0000-4000-8000-000000000001', 'review_pass');
select pg_temp.act('faaaaaaa-0000-4000-8000-000000000002', 'review_pass');

-- ---------------------------------------------------------------------------
-- ผู้อนุมัติไม่มีสิทธิ์จัดการงบ แต่อนุมัติได้
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'f3333333-3333-4333-8333-333333333333';

select pg_temp.assert_eq(
  (select public.has_permission('budget.manage')), false,
  'ผู้อนุมัติไม่มีสิทธิ์จัดการงบ');

select pg_temp.assert_eq(
  pg_temp.act('faaaaaaa-0000-4000-8000-000000000001', 'approve'),
  'APPROVED', 'อนุมัติใบแรกสำเร็จแม้ผู้อนุมัติไม่มีสิทธิ์จัดการงบ');

select pg_temp.assert_eq(
  pg_temp.available('f0000000-0000-4000-8000-000000000003'), 1500.00::numeric,
  'ยอดที่ใช้ได้ลดลงเหลือ 1,500 ทันทีที่อนุมัติ');

select pg_temp.assert_eq(
  (select count(*)::integer from public.budget_movements
   where source_type = 'PROCUREMENT'
     and source_id = 'faaaaaaa-0000-4000-8000-000000000001'
     and movement_type = 'RESERVE'),
  1, 'มีรายการกันยอดหนึ่งแถวต่อบัญชี');

-- ---------------------------------------------------------------------------
-- **ช่องโหว่ที่ PR นี้ปิด** — ใบที่สองอนุมัติไม่ได้เพราะงบไม่พอแล้ว
--
-- ก่อนหน้านี้ทั้งสองใบผ่านการตรวจตอนส่งอนุมัติ (แต่ละใบ 2,500 < 4,000) แล้วอนุมัติ
-- ได้ทั้งคู่ จนยอดจริงติดลบ 1,000 ซึ่งเป็นอาการเดียวกับ F-01
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$select pg_temp.act('faaaaaaa-0000-4000-8000-000000000002', 'approve')$$,
  'ยอดงบคงเหลือไม่พอ',
  'ใบที่สองอนุมัติไม่ได้เพราะยอดถูกกันไปแล้ว');

/*
 * การอนุมัติที่ล้มต้องไม่เปลี่ยนสถานะและไม่ทิ้งประวัติไว้
 *
 * ถ้าสถานะเปลี่ยนแต่ไม่มียอดกัน รายการจะกลายเป็น "อนุมัติแล้วแต่ไม่มีงบรองรับ"
 * ซึ่งแย่กว่าการอนุมัติไม่ผ่าน เพราะไม่มีใครเห็นว่าผิด
 */
select pg_temp.assert_eq(
  (select status::text from public.procurements
   where id = 'faaaaaaa-0000-4000-8000-000000000002'),
  'PENDING_APPROVAL', 'การอนุมัติที่ล้มไม่เปลี่ยนสถานะ');

select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_approvals
   where procurement_id = 'faaaaaaa-0000-4000-8000-000000000002' and action = 'approve'),
  0, 'การอนุมัติที่ล้มไม่ทิ้งประวัติไว้');

select pg_temp.assert_eq(
  pg_temp.available('f0000000-0000-4000-8000-000000000003'), 1500.00::numeric,
  'การอนุมัติที่ล้มไม่แตะยอดงบ');

-- ---------------------------------------------------------------------------
-- การเดินหน้าภายในกลุ่มที่ถือยอด ต้องไม่กันซ้ำ
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'f5555555-5555-4555-8555-555555555555';
select pg_temp.act('faaaaaaa-0000-4000-8000-000000000001', 'issue');

/*
 * ออกใบสั่งซื้อแล้ว **ยอดที่ใช้ได้ต้องไม่ขยับ** (PR-04e)
 *
 * ยอดถูกแปลงจาก "กันไว้" เป็น "ผูกพัน" ด้วยการคืนแล้วลงใหม่จำนวนเท่ากัน
 * ทั้งสองแถวหักล้างกันพอดี ถ้าลำดับผิดหรือจำนวนไม่ตรง ยอดตรงนี้จะเพี้ยนทันที
 */
select pg_temp.assert_eq(
  pg_temp.available('f0000000-0000-4000-8000-000000000003'), 1500.00::numeric,
  'ออกเอกสารแล้วยอดที่ใช้ได้ไม่ขยับ');

select pg_temp.assert_eq(
  (select count(*)::integer from public.budget_movements
   where source_id = 'faaaaaaa-0000-4000-8000-000000000001' and movement_type = 'RESERVE'),
  1, 'ไม่กันยอดซ้ำ — ยังมีรายการกันยอดเพียงแถวเดียว');

select pg_temp.assert_eq(
  (select count(*)::integer from public.budget_movements
   where source_id = 'faaaaaaa-0000-4000-8000-000000000001' and movement_type = 'COMMIT'),
  1, 'เกิดรายการผูกพันงบหนึ่งแถว');

/* ยอดที่กันไว้ถูกคืนจนหมด เหลือแต่ยอดผูกพัน — ถ้าเหลือทั้งคู่ เงินจะถูกนับสองเท่า */
select pg_temp.assert_eq(
  pg_temp.holds('faaaaaaa-0000-4000-8000-000000000001', 'RESERVE'), 0::numeric, 'ยอดที่กันไว้ถูกคืนจนหมดเมื่อแปลงเป็นยอดผูกพัน');

select pg_temp.assert_eq(
  pg_temp.holds('faaaaaaa-0000-4000-8000-000000000001', 'COMMIT'), 2500.00::numeric, 'ยอดผูกพันเท่ากับยอดที่เคยกันไว้');

/* ยอดผูกพันอยู่ในช่อง "ใช้ไปแล้ว" ไม่ใช่ช่อง "กันไว้" */
select pg_temp.assert_eq(
  (select reserved_amount from public.budget_account_balances
   where budget_account_id = 'f0000000-0000-4000-8000-000000000003'),
  0.00::numeric, 'ยอดที่กันไว้กลับเป็นศูนย์หลังแปลงเป็นยอดผูกพัน');

select pg_temp.assert_eq(
  (select used_amount from public.budget_account_balances
   where budget_account_id = 'f0000000-0000-4000-8000-000000000003'),
  2500.00::numeric, 'ยอดผูกพันไปอยู่ช่องยอดที่ใช้ไปแล้ว');

-- ---------------------------------------------------------------------------
-- ยกเลิกแล้วคืนยอดครบ
-- ---------------------------------------------------------------------------

select pg_temp.act('faaaaaaa-0000-4000-8000-000000000001', 'cancel', 'ยกเลิกเพื่อทดสอบการคืนยอด');

select pg_temp.assert_eq(
  pg_temp.available('f0000000-0000-4000-8000-000000000003'), 4000.00::numeric,
  'ยกเลิกแล้วยอดกลับมาครบ 4,000');

/*
 * คืนยอดสองแถว ไม่ใช่แถวเดียว (PR-04e)
 *
 * แถวแรกเกิดตอนออกใบสั่งซื้อ (คืนยอดที่กันไว้เพื่อแปลงเป็นยอดผูกพัน)
 * แถวที่สองเกิดตอนยกเลิก (คืนยอดผูกพัน) — ยอดที่ใช้ได้ข้างบนยืนยันแล้วว่าครบ
 */
select pg_temp.assert_eq(
  (select count(*)::integer from public.budget_movements
   where source_id = 'faaaaaaa-0000-4000-8000-000000000001' and movement_type = 'RELEASE'),
  2, 'มีรายการคืนยอดสองแถว — ตอนแปลงเป็นยอดผูกพัน และตอนยกเลิก');

/* ยกเลิกแล้วต้องไม่เหลือยอดที่ถือไว้เลย ไม่ว่าชนิดใด — อาการ "ผูกพันตลอดกาล" */
select pg_temp.assert_eq(
  pg_temp.hold_rows('faaaaaaa-0000-4000-8000-000000000001'), 0, 'ยกเลิกแล้วไม่เหลือยอดที่ถือไว้เลย');

select pg_temp.assert_eq(
  (select used_amount from public.budget_account_balances
   where budget_account_id = 'f0000000-0000-4000-8000-000000000003'),
  0.00::numeric, 'ยกเลิกแล้วยอดที่ใช้ไปกลับเป็นศูนย์ ไม่ค้างเป็นยอดผูกพัน');

-- เมื่อยอดว่างแล้ว ใบที่สองอนุมัติได้
set local request.jwt.claim.sub = 'f3333333-3333-4333-8333-333333333333';
select pg_temp.assert_eq(
  pg_temp.act('faaaaaaa-0000-4000-8000-000000000002', 'approve'),
  'APPROVED', 'ใบที่สองอนุมัติได้หลังยอดถูกคืน');

select pg_temp.assert_eq(
  pg_temp.available('f0000000-0000-4000-8000-000000000003'), 1500.00::numeric,
  'ยอดถูกกันใหม่ให้ใบที่สอง');

-- ---------------------------------------------------------------------------
-- การปฏิเสธและส่งกลับเกิดก่อนอนุมัติ จึงไม่มียอดให้คืน
-- ---------------------------------------------------------------------------

-- ยกเลิกด้วยเจ้าหน้าที่พัสดุ เพราะ APPROVER ไม่มีสิทธิ์ procurement.cancel
set local request.jwt.claim.sub = 'f5555555-5555-4555-8555-555555555555';
select pg_temp.act('faaaaaaa-0000-4000-8000-000000000002', 'cancel', 'คืนยอดแล้วทดสอบเส้นทางอื่น');

-- สร้างในฐานะผู้ขอ เพราะ RLS ของ procurements บังคับว่า created_by ต้องเป็นผู้สร้างจริง
set local request.jwt.claim.sub = 'f1111111-1111-4111-8111-111111111111';

insert into public.procurements (
  id, subject, purpose, fiscal_year_id, request_date, report_date,
  classification, procurement_method, tax_mode, created_by
) values (
  'faaaaaaa-0000-4000-8000-000000000003', 'จัดซื้อทดสอบการปฏิเสธ (ตัวอย่าง)',
  'ใช้ทดสอบ (ตัวอย่าง)', 'f0000000-0000-4000-8000-000000000001', '2026-01-05', '2026-01-06',
  'GOODS', 'SPECIFIC', 'EXEMPT', 'f1111111-1111-4111-8111-111111111111');

insert into public.procurement_items (procurement_id, line_no, description, quantity, unit_price)
values ('faaaaaaa-0000-4000-8000-000000000003', 1, 'แฟ้ม (ตัวอย่าง)', 4, 250.00);

insert into public.procurement_funding_allocations
  (procurement_id, line_no, budget_account_id, amount)
values ('faaaaaaa-0000-4000-8000-000000000003', 1,
        'f0000000-0000-4000-8000-000000000003', 1000.00);

set local request.jwt.claim.sub = 'f1111111-1111-4111-8111-111111111111';
select public.procurement_submit('faaaaaaa-0000-4000-8000-000000000003',
  (select version from public.procurements where id = 'faaaaaaa-0000-4000-8000-000000000003'));

set local request.jwt.claim.sub = 'f2222222-2222-4222-8222-222222222222';
select pg_temp.act('faaaaaaa-0000-4000-8000-000000000003', 'review_pass');

set local request.jwt.claim.sub = 'f3333333-3333-4333-8333-333333333333';
select pg_temp.act('faaaaaaa-0000-4000-8000-000000000003', 'reject', 'ไม่จำเป็นต้องซื้อ');

select pg_temp.assert_eq(
  pg_temp.available('f0000000-0000-4000-8000-000000000003'), 4000.00::numeric,
  'การปฏิเสธไม่แตะยอดงบ');

select pg_temp.assert_eq(
  (select count(*)::integer from public.budget_movements
   where source_id = 'faaaaaaa-0000-4000-8000-000000000003'),
  0, 'รายการที่ถูกปฏิเสธไม่มีรายการงบเลย');

-- ---------------------------------------------------------------------------
-- เรียกฟังก์ชันกันยอด/คืนยอดตรงไม่ได้
--
-- ถ้าเรียกตรงได้ จะกันยอดหรือคืนยอดโดยไม่เปลี่ยนสถานะได้ ทำให้ ledger กับสถานะ
-- ไม่ตรงกันโดยไม่มีอะไรฟ้อง
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$select public.procurement_reserve_budget(
      'faaaaaaa-0000-4000-8000-000000000003', current_date, 'กันเอง')$$,
  'permission denied',
  'เรียก procurement_reserve_budget ตรงไม่ได้');

select pg_temp.assert_fails(
  $$select public.procurement_release_budget(
      'faaaaaaa-0000-4000-8000-000000000003', current_date, 'คืนเอง')$$,
  'permission denied',
  'เรียก procurement_release_budget ตรงไม่ได้');

/*
 * ธงที่เปิดทางให้ workflow ลงรายการ ต้องตั้งเองจากฝั่งผู้เรียกไม่ได้
 *
 * `set_config` อยู่ใน pg_catalog ซึ่งไม่ได้ถูก expose เป็น RPC ผ่าน PostgREST
 * แต่ test นี้ยืนยันอีกชั้นว่าถึงตั้งได้ ก็ลงรายการที่ไม่ใช่ RESERVE/RELEASE ไม่ได้
 */
select set_config('app.budget_workflow_posting', 'on', true);

select pg_temp.assert_fails(
  $$select public.budget_post_movement(
      'f0000000-0000-4000-8000-000000000003', 'ALLOCATION', 999999.00, '2026-02-01', 'เพิ่มงบเอง')$$,
  'ไม่มีสิทธิ์ลงรายการเคลื่อนไหวงบ',
  'ธงของ workflow ใช้เพิ่มงบเองไม่ได้');

select set_config('app.budget_workflow_posting', 'off', true);

-- ---------------------------------------------------------------------------
-- audit
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'f6666666-6666-4666-8666-666666666666';

/*
 * audit บันทึก **ชนิดของยอดที่ถือก่อนและหลัง** ไม่ใช่แค่ว่ากันยอด/คืนยอด (PR-04e)
 *
 * ผู้ตรวจสอบจึงอ่านได้ว่าเงินเปลี่ยนจาก "กันไว้" เป็น "ผูกพัน" ตอนไหน
 * ซึ่งเป็นคำถามที่การตรวจสอบเงินกันเหลื่อมปีต้องตอบ
 */
select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events
   where action = 'procurement.status_change'
     and metadata_json ->> 'budget_hold_before' is null
     and metadata_json ->> 'budget_hold_after' = 'RESERVE'),
  2, 'audit บันทึกว่าการอนุมัติกันยอด');

select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events
   where action = 'procurement.status_change'
     and metadata_json ->> 'budget_hold_before' = 'RESERVE'
     and metadata_json ->> 'budget_hold_after' = 'COMMIT'),
  1, 'audit บันทึกว่าการออกใบสั่งซื้อแปลงยอดที่กันไว้เป็นยอดผูกพัน');

select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events
   where action = 'procurement.status_change'
     and metadata_json ->> 'budget_hold_before' is not null
     and metadata_json ->> 'budget_hold_after' is null),
  2, 'audit บันทึกว่าการยกเลิกคืนยอด');

/*
 * หกแถว ไม่ใช่สี่ (PR-04e)
 *
 * ใบแรก: กันยอด · คืนยอดตอนออกใบสั่งซื้อ · ผูกพัน · คืนยอดผูกพันตอนยกเลิก = 4
 * ใบที่สอง: กันยอด · คืนยอดตอนยกเลิก = 2
 *
 * ทุกแถวต้องถูกกำกับว่า workflow เป็นผู้ลง เพราะผู้กดปุ่มไม่ได้ถือ budget.manage
 * ถ้าแถวใดหลุดเครื่องหมายนี้ แปลว่ามีเส้นทางที่ลงรายการงบในนามของผู้ใช้โดยตรง
 */
select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events
   where entity_type = 'budget_movement'
     and metadata_json ->> 'posted_by_workflow' = 'true'),
  6, 'รายการงบที่ workflow ลงถูกกำกับไว้ใน audit');

rollback;
