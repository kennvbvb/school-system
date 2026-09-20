-- =============================================================================
-- ทดสอบการผูกพันงบตอนออกใบสั่งซื้อบน PostgreSQL จริง (PR-04e)
--
-- สิ่งที่ unit test พิสูจน์ไม่ได้และต้องรันที่นี่:
--
--   * ออกใบสั่งซื้อแล้ว **ยอดที่ใช้ได้ไม่ขยับ** แต่ยอดย้ายจาก "กันไว้" ไป "ผูกพัน"
--   * ผู้กดออกใบสั่งซื้อถือ documents.issue เท่านั้น ไม่มี budget.manage
--     แต่การผูกพันงบยังต้องสำเร็จ — ถ้าลืมเปิดช่องให้ workflow ลง COMMIT
--     ปุ่มนี้จะใช้ไม่ได้เลยสำหรับเจ้าหน้าที่พัสดุ ซึ่งเป็นคนที่ต้องกดจริง
--   * ยกเลิกหลังออกใบสั่งซื้อแล้วคืนยอดผูกพันครบ — ปิดอาการ "ผูกพันตลอดกาล"
--   * เบิกจ่ายจากยอดผูกพันได้ (เดิมมองหาเฉพาะแถว RESERVE จึงจะเงียบ ไม่ใช่ล้ม)
--   * ผูกพันซ้ำไม่ได้แม้เรียกฟังก์ชันตรง ๆ
--   * ไม่มีสถานะใดถือทั้งยอดที่กันไว้และยอดผูกพันพร้อมกัน
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

create or replace function pg_temp.bal(p_account uuid, p_field text)
returns numeric language plpgsql as $$
declare v numeric;
begin
  execute format('select %I from public.budget_account_balances where budget_account_id = $1',
                 p_field)
  into v using p_account;
  return v;
end; $$;

/* ฟังก์ชันจริงถูกเพิกถอนจาก authenticated จึงห่อด้วย security definer ใน pg_temp */
create or replace function pg_temp.holds(p_procurement uuid, p_type text)
returns numeric language sql security definer as $$
  select coalesce(sum(outstanding), 0)
  from public.procurement_outstanding_hold(p_procurement)
  where p_type is null or hold_type::text = p_type;
$$;

create or replace function pg_temp.rows_of(p_procurement uuid, p_type text)
returns integer language sql as $$
  select count(*)::integer from public.budget_movements
  where source_type = 'PROCUREMENT' and source_id = p_procurement
    and movement_type::text = p_type;
$$;

-- ---------------------------------------------------------------------------
-- ผู้ใช้สมมติ
--
-- **พัสดุถือแค่ PROCUREMENT_OFFICER** ซึ่งได้ documents.issue และ budget.read
-- จาก seed แต่ **ไม่มี budget.manage** — เป็นหัวใจของการทดสอบสิทธิ์ด้านล่าง
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('c1111111-1111-4111-8111-111111111111', 'cm-requester@example.test'),
  ('c2222222-2222-4222-8222-222222222222', 'cm-reviewer@example.test'),
  ('c3333333-3333-4333-8333-333333333333', 'cm-approver@example.test'),
  ('c4444444-4444-4444-8444-444444444444', 'cm-finance@example.test'),
  ('c5555555-5555-4555-8555-555555555555', 'cm-officer@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('c1111111-1111-4111-8111-111111111111', 'cm-requester@example.test', 'ทดสอบ', 'ผู้ขอ', true),
  ('c2222222-2222-4222-8222-222222222222', 'cm-reviewer@example.test', 'ทดสอบ', 'ผู้ตรวจสอบ', true),
  ('c3333333-3333-4333-8333-333333333333', 'cm-approver@example.test', 'ทดสอบ', 'ผู้อนุมัติ', true),
  ('c4444444-4444-4444-8444-444444444444', 'cm-finance@example.test', 'ทดสอบ', 'การเงิน', true),
  ('c5555555-5555-4555-8555-555555555555', 'cm-officer@example.test', 'ทดสอบ', 'พัสดุ', true);

insert into public.user_roles (user_id, role_code) values
  ('c1111111-1111-4111-8111-111111111111', 'REQUESTER'),
  ('c2222222-2222-4222-8222-222222222222', 'REVIEWER'),
  ('c3333333-3333-4333-8333-333333333333', 'APPROVER'),
  ('c4444444-4444-4444-8444-444444444444', 'FINANCE'),
  ('c5555555-5555-4555-8555-555555555555', 'PROCUREMENT_OFFICER');

/* ใช้ปีงบที่ครอบวันนี้ ถ้ายังไม่มีจึงสร้าง — เหตุผลเดียวกับ migration 0019 test */
insert into public.fiscal_years (code, year_be, start_date, end_date, status)
select
  'FYCM-TEST',
  (select min(candidate)
   from generate_series(2560, 2700) as candidate
   where candidate not in (select year_be from public.fiscal_years)),
  date_trunc('year', current_date)::date,
  (date_trunc('year', current_date) + interval '1 year - 1 day')::date,
  'OPEN'
where not exists (
  select 1 from public.fiscal_years where current_date between start_date and end_date
);

create or replace function pg_temp.fy() returns uuid language sql stable as $fn$
  select id from public.fiscal_years
  where current_date between start_date and end_date and status = 'OPEN' limit 1;
$fn$;

create or replace function pg_temp.d0() returns date language sql stable as $fn$
  select greatest(start_date, current_date - 40) from public.fiscal_years
  where current_date between start_date and end_date and status = 'OPEN' limit 1;
$fn$;

insert into public.projects (id, code, name_th, fiscal_year_id) values
  ('c0000000-0000-4000-8000-000000000002', 'PRJ-CM', 'โครงการทดสอบการผูกพันงบ (ตัวอย่าง)',
   pg_temp.fy());

insert into public.projects (id, code, name_th, fiscal_year_id) values
  ('c0000000-0000-4000-8000-000000000006', 'PRJ-CM2', 'โครงการทดสอบงบตึง (ตัวอย่าง)',
   pg_temp.fy());

insert into public.budget_accounts (id, code, fiscal_year_id, project_id) values
  ('c0000000-0000-4000-8000-000000000003', 'ACC-CM',
   pg_temp.fy(), 'c0000000-0000-4000-8000-000000000002'),
  ('c0000000-0000-4000-8000-000000000007', 'ACC-CM2',
   pg_temp.fy(), 'c0000000-0000-4000-8000-000000000006');

insert into public.procurements (
  id, subject, purpose, fiscal_year_id, request_date, report_date,
  classification, procurement_method, tax_mode, created_by
) values
  ('caaaaaaa-0000-4000-8000-000000000001', 'จัดซื้อทดสอบการผูกพันงบ (ตัวอย่าง)',
   'ใช้ทดสอบ (ตัวอย่าง)', pg_temp.fy(), (pg_temp.d0()), (pg_temp.d0() + 1),
   'GOODS', 'SPECIFIC', 'EXEMPT', 'c1111111-1111-4111-8111-111111111111');

insert into public.procurement_items (procurement_id, line_no, description, quantity, unit_price)
values ('caaaaaaa-0000-4000-8000-000000000001', 1, 'กระดาษ (ตัวอย่าง)', 10, 250.00);

/*
 * รายการที่สองกินงบของบัญชีที่สองจนหมดพอดี
 *
 * **มีไว้พิสูจน์ลำดับของการแปลงยอด** ถ้าลง COMMIT ก่อนแล้วค่อยคืนยอดที่กันไว้
 * จะมีจังหวะที่ยอดถูกนับสองเท่า ยอดที่ใช้ได้กลายเป็นติดลบ และการออกใบสั่งซื้อ
 * จะถูกปฏิเสธว่างบไม่พอ ทั้งที่ยอดสุทธิไม่เปลี่ยนเลย
 *
 * บัญชีที่มีงบเหลือจะไม่จับข้อผิดพลาดนี้ เพราะสุดท้ายยอดกลับมาเท่าเดิมทั้งสองทาง
 */
insert into public.procurements (
  id, subject, purpose, fiscal_year_id, request_date, report_date,
  classification, procurement_method, tax_mode, created_by
) values
  ('caaaaaaa-0000-4000-8000-000000000002', 'จัดซื้อทดสอบงบตึง (ตัวอย่าง)',
   'ใช้ทดสอบ (ตัวอย่าง)', pg_temp.fy(), (pg_temp.d0()), (pg_temp.d0() + 1),
   'GOODS', 'SPECIFIC', 'EXEMPT', 'c1111111-1111-4111-8111-111111111111');

insert into public.procurement_items (procurement_id, line_no, description, quantity, unit_price)
values ('caaaaaaa-0000-4000-8000-000000000002', 1, 'หมึกพิมพ์ (ตัวอย่าง)', 4, 250.00);

insert into public.procurement_funding_allocations
  (procurement_id, line_no, budget_account_id, amount)
values ('caaaaaaa-0000-4000-8000-000000000002', 1,
        'c0000000-0000-4000-8000-000000000007', 1000.00);

insert into public.procurement_funding_allocations
  (procurement_id, line_no, budget_account_id, amount)
values ('caaaaaaa-0000-4000-8000-000000000001', 1,
        'c0000000-0000-4000-8000-000000000003', 2500.00);

set local role authenticated;

set local request.jwt.claim.sub = 'c4444444-4444-4444-8444-444444444444';
select public.budget_post_movement(
  'c0000000-0000-4000-8000-000000000003', 'ALLOCATION', 6000.00, (pg_temp.d0()), 'ตั้งต้น');
/* จัดสรรเท่ากับยอดที่จะถูกกันไว้พอดี — งบเหลือศูนย์หลังอนุมัติ */
select public.budget_post_movement(
  'c0000000-0000-4000-8000-000000000007', 'ALLOCATION', 1000.00, (pg_temp.d0()), 'ตั้งต้น');

-- ---------------------------------------------------------------------------
-- อนุมัติ — กันยอด
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'c1111111-1111-4111-8111-111111111111';
select public.procurement_submit('caaaaaaa-0000-4000-8000-000000000001',
  (select version from public.procurements where id = 'caaaaaaa-0000-4000-8000-000000000001'));

set local request.jwt.claim.sub = 'c2222222-2222-4222-8222-222222222222';
select pg_temp.act('caaaaaaa-0000-4000-8000-000000000001', 'review_pass');

set local request.jwt.claim.sub = 'c3333333-3333-4333-8333-333333333333';
select pg_temp.act('caaaaaaa-0000-4000-8000-000000000001', 'approve');

select pg_temp.assert_eq(
  pg_temp.available('c0000000-0000-4000-8000-000000000003'), 3500.00::numeric,
  'อนุมัติแล้วกันยอด 2,500 เหลือใช้ได้ 3,500');
select pg_temp.assert_eq(
  pg_temp.bal('c0000000-0000-4000-8000-000000000003', 'reserved_amount'), 2500.00::numeric,
  'ยอดอยู่ในช่องกันไว้');
select pg_temp.assert_eq(
  pg_temp.bal('c0000000-0000-4000-8000-000000000003', 'used_amount'), 0.00::numeric,
  'ยังไม่มียอดที่ใช้ไป');

-- ---------------------------------------------------------------------------
-- **ออกใบสั่งซื้อ — ผู้กดไม่มี budget.manage แต่ต้องผูกพันงบได้**
--
-- ถ้าลืมเปิดช่องให้ workflow ลง COMMIT ข้อนี้จะล้มด้วย "ไม่มีสิทธิ์ลงรายการ
-- เคลื่อนไหวงบ" และปุ่มออกใบสั่งซื้อจะใช้ไม่ได้เลยสำหรับเจ้าหน้าที่พัสดุ
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'c5555555-5555-4555-8555-555555555555';

select pg_temp.assert_eq(
  (select public.has_permission('budget.manage')), false,
  'เจ้าหน้าที่พัสดุไม่มีสิทธิ์ลงรายการงบเอง');

select pg_temp.assert_eq(
  pg_temp.act('caaaaaaa-0000-4000-8000-000000000001', 'issue'),
  'ISSUED', 'เจ้าหน้าที่พัสดุออกใบสั่งซื้อได้');

-- ---------------------------------------------------------------------------
-- **หัวใจของ PR นี้ — ยอดที่ใช้ได้ต้องไม่ขยับ แต่ยอดย้ายถัง**
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  pg_temp.available('c0000000-0000-4000-8000-000000000003'), 3500.00::numeric,
  'ออกใบสั่งซื้อแล้วยอดที่ใช้ได้ไม่ขยับ');

select pg_temp.assert_eq(
  pg_temp.bal('c0000000-0000-4000-8000-000000000003', 'reserved_amount'), 0.00::numeric,
  'ยอดที่กันไว้กลับเป็นศูนย์');

select pg_temp.assert_eq(
  pg_temp.bal('c0000000-0000-4000-8000-000000000003', 'used_amount'), 2500.00::numeric,
  'ยอดย้ายไปอยู่ช่องที่ใช้ไปแล้วในรูปของยอดผูกพัน');

select pg_temp.assert_eq(
  pg_temp.rows_of('caaaaaaa-0000-4000-8000-000000000001', 'COMMIT'), 1,
  'เกิดรายการผูกพันหนึ่งแถว');

select pg_temp.assert_eq(
  pg_temp.rows_of('caaaaaaa-0000-4000-8000-000000000001', 'RESERVE'), 1,
  'ไม่กันยอดซ้ำ — รายการกันยอดยังมีแถวเดียว');

select pg_temp.assert_eq(
  pg_temp.holds('caaaaaaa-0000-4000-8000-000000000001', 'RESERVE'), 0::numeric,
  'ยอดที่กันไว้ถูกคืนจนหมด');

select pg_temp.assert_eq(
  pg_temp.holds('caaaaaaa-0000-4000-8000-000000000001', 'COMMIT'), 2500.00::numeric,
  'ยอดผูกพันเท่ากับยอดที่เคยกันไว้');

/*
 * ผูกพันซ้ำไม่ได้แม้เรียกฟังก์ชันตรง ๆ
 *
 * ฟังก์ชันมองหาเฉพาะยอดที่ยังเป็น RESERVE ซึ่งคืนไปหมดแล้ว จึงไม่ทำอะไรเลย
 * ถ้าไม่กรองชนิด การเรียกซ้ำจะผูกพันทับของเดิมจนงบถูกกินสองเท่า
 */
reset role;
select pg_temp.assert_eq(
  public.procurement_commit_budget(
    'caaaaaaa-0000-4000-8000-000000000001', current_date, 'เรียกซ้ำ'),
  0, 'เรียกผูกพันซ้ำแล้วไม่เกิดรายการใหม่');
set local role authenticated;
set local request.jwt.claim.sub = 'c5555555-5555-4555-8555-555555555555';

select pg_temp.assert_eq(
  pg_temp.available('c0000000-0000-4000-8000-000000000003'), 3500.00::numeric,
  'เรียกผูกพันซ้ำแล้วยอดยังเท่าเดิม');

-- ---------------------------------------------------------------------------
-- รับของแล้วยังผูกพันอยู่ เพราะยังไม่ได้จ่ายเงิน
--
-- ใช้ `receive_partial` ไม่ใช่ `receive_all` เพราะ **ยกเลิกจากสถานะ RECEIVED
-- ไม่ได้** ตาม state machine ถ้าใช้ receive_all ข้อทดสอบการยกเลิกด้านล่าง
-- จะล้มด้วย "สถานะนี้ทำรายการดังกล่าวไม่ได้" แล้ว assertion ที่ตั้งใจตรวจ
-- guard เรื่องการเบิกจ่ายจะผ่านด้วยเหตุผลที่ผิด
-- (เป็นกับดักเดียวกับที่ PR-04d เคยตกไปแล้วครั้งหนึ่ง)
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  pg_temp.act('caaaaaaa-0000-4000-8000-000000000001', 'receive_partial'),
  'PARTIALLY_RECEIVED', 'รับของบางส่วน');

select pg_temp.assert_eq(
  pg_temp.holds('caaaaaaa-0000-4000-8000-000000000001', 'COMMIT'), 2500.00::numeric,
  'รับของแล้วยังผูกพันอยู่ครบ');

/* รับของครบแล้วก็ยังผูกพันอยู่ เพราะยังไม่ได้จ่ายเงินให้ผู้ขาย */
select pg_temp.assert_eq(
  (select public.status_holds_commitment('RECEIVED')), true,
  'สถานะรับของครบแล้วยังถือยอดผูกพัน');

-- ---------------------------------------------------------------------------
-- **เบิกจ่ายจากยอดผูกพันได้**
--
-- เดิมการเบิกจ่ายมองหาเฉพาะแถว RESERVE ซึ่งไม่เหลือแล้วหลังออกใบสั่งซื้อ
-- ถ้าไม่ได้แก้ให้มองยอดผูกพันด้วย ข้อนี้จะล้มด้วย "ไม่มียอดเหลือให้เบิกจ่าย"
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'c4444444-4444-4444-8444-444444444444';
select public.procurement_disburse(
  'caaaaaaa-0000-4000-8000-000000000001', 1000.00, (pg_temp.d0() + 10), 'PAY-CM-001');

select pg_temp.assert_eq(
  pg_temp.available('c0000000-0000-4000-8000-000000000003'), 3500.00::numeric,
  'จ่ายแล้วยอดที่ใช้ได้ยังไม่ขยับ');

select pg_temp.assert_eq(
  pg_temp.holds('caaaaaaa-0000-4000-8000-000000000001', 'COMMIT'), 1500.00::numeric,
  'ยอดผูกพันลดลงเท่าที่จ่าย');

select pg_temp.assert_eq(
  pg_temp.rows_of('caaaaaaa-0000-4000-8000-000000000001', 'ACTUAL'), 1,
  'มีรายการจ่ายจริงหนึ่งแถว');

/*
 * **การคืนยอดผูกพันต้องไม่ไปลดช่อง "กันไว้"**
 *
 * ถ้า RELEASE ถูกตรึงให้อยู่กลุ่มยอดที่กันไว้เสมอแบบเดิม ช่องนี้จะกลายเป็น -1,000
 * ยอดที่ใช้ได้ยังถูกอยู่ ความผิดจึงซ่อนอยู่เฉพาะในช่องที่คนอ่านรายงานใช้ตัดสินใจ
 * — เป็นความเงียบที่อันตรายที่สุดของการเปลี่ยนแปลงนี้
 */
select pg_temp.assert_eq(
  pg_temp.bal('c0000000-0000-4000-8000-000000000003', 'reserved_amount'), 0.00::numeric,
  'จ่ายจากยอดผูกพันแล้วช่องกันไว้ยังเป็นศูนย์ ไม่ติดลบ');

/* จ่ายจริง 1,000 + ผูกพันเหลือ 1,500 = 2,500 ยังอยู่ในช่องที่ใช้ไปแล้วครบ */
select pg_temp.assert_eq(
  pg_temp.bal('c0000000-0000-4000-8000-000000000003', 'used_amount'), 2500.00::numeric,
  'ยอดที่ใช้ไปยังเท่าเดิม เพราะผูกพันแปลงเป็นจ่ายจริงบางส่วน');

-- ---------------------------------------------------------------------------
-- ยกเลิกหลังออกใบสั่งซื้อ — ต้องยกเลิกการเบิกจ่ายก่อน แล้วคืนยอดผูกพันครบ
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'c5555555-5555-4555-8555-555555555555';
select pg_temp.assert_fails(
  $$select pg_temp.act('caaaaaaa-0000-4000-8000-000000000001', 'cancel', 'ยกเลิกทดสอบ')$$,
  'ต้องยกเลิกการเบิกจ่ายก่อน',
  'ยกเลิกรายการที่จ่ายเงินไปแล้วไม่ได้ แม้ยอดจะเป็นยอดผูกพัน');

set local request.jwt.claim.sub = 'c4444444-4444-4444-8444-444444444444';
select public.procurement_disbursement_void(
  (select id from public.procurement_disbursements
   where procurement_id = 'caaaaaaa-0000-4000-8000-000000000001' limit 1),
  'ยกเลิกเพื่อทดสอบ');

/* ย้อนการจ่ายแล้วยอดต้องกลับไปเป็นผูกพันเต็มจำนวน ไม่ใช่กลับไปเป็นยอดที่กันไว้ */
select pg_temp.assert_eq(
  pg_temp.holds('caaaaaaa-0000-4000-8000-000000000001', 'COMMIT'), 2500.00::numeric,
  'ยกเลิกการจ่ายแล้วยอดกลับไปเป็นผูกพันครบ');

select pg_temp.assert_eq(
  pg_temp.bal('c0000000-0000-4000-8000-000000000003', 'reserved_amount'), 0.00::numeric,
  'ยอดที่กันไว้ยังเป็นศูนย์ ไม่ถูกดันให้ติดลบจากการย้อน');

set local request.jwt.claim.sub = 'c5555555-5555-4555-8555-555555555555';
select pg_temp.assert_eq(
  pg_temp.act('caaaaaaa-0000-4000-8000-000000000001', 'cancel', 'ยกเลิกทดสอบ'),
  'CANCELLED', 'ยกเลิกได้หลังยกเลิกการเบิกจ่ายแล้ว');

select pg_temp.assert_eq(
  pg_temp.available('c0000000-0000-4000-8000-000000000003'), 6000.00::numeric,
  'ยกเลิกแล้วยอดกลับมาครบ 6,000');

select pg_temp.assert_eq(
  pg_temp.bal('c0000000-0000-4000-8000-000000000003', 'used_amount'), 0.00::numeric,
  'ยกเลิกแล้วยอดที่ใช้ไปกลับเป็นศูนย์ ไม่ค้างเป็นยอดผูกพัน');

select pg_temp.assert_eq(
  pg_temp.bal('c0000000-0000-4000-8000-000000000003', 'reserved_amount'), 0.00::numeric,
  'ยกเลิกแล้วช่องกันไว้เป็นศูนย์ ไม่ติดลบจากการคืนยอดผูกพัน');

select pg_temp.assert_eq(
  pg_temp.holds('caaaaaaa-0000-4000-8000-000000000001', null), 0::numeric,
  'ยกเลิกแล้วไม่เหลือยอดที่ถือไว้เลย');

-- ---------------------------------------------------------------------------
-- **ลำดับการแปลงยอด — คืนก่อน แล้วจึงผูกพัน**
--
-- บัญชีนี้ถูกกันยอดไว้จนเหลือศูนย์ ถ้าลง COMMIT ก่อนคืนยอด ยอดจะติดลบชั่วขณะ
-- แล้วการออกใบสั่งซื้อจะถูกปฏิเสธ ทั้งที่ยอดสุทธิไม่เปลี่ยน
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'c1111111-1111-4111-8111-111111111111';
select public.procurement_submit('caaaaaaa-0000-4000-8000-000000000002',
  (select version from public.procurements where id = 'caaaaaaa-0000-4000-8000-000000000002'));

set local request.jwt.claim.sub = 'c2222222-2222-4222-8222-222222222222';
select pg_temp.act('caaaaaaa-0000-4000-8000-000000000002', 'review_pass');

set local request.jwt.claim.sub = 'c3333333-3333-4333-8333-333333333333';
select pg_temp.act('caaaaaaa-0000-4000-8000-000000000002', 'approve');

select pg_temp.assert_eq(
  pg_temp.available('c0000000-0000-4000-8000-000000000007'), 0.00::numeric,
  'งบถูกกันไว้จนเหลือศูนย์');

set local request.jwt.claim.sub = 'c5555555-5555-4555-8555-555555555555';
select pg_temp.assert_eq(
  pg_temp.act('caaaaaaa-0000-4000-8000-000000000002', 'issue'),
  'ISSUED', 'ออกใบสั่งซื้อได้แม้งบเหลือศูนย์ เพราะคืนยอดก่อนผูกพัน');

select pg_temp.assert_eq(
  pg_temp.available('c0000000-0000-4000-8000-000000000007'), 0.00::numeric,
  'ยอดยังเป็นศูนย์ ไม่ติดลบและไม่งอก');

select pg_temp.assert_eq(
  pg_temp.holds('caaaaaaa-0000-4000-8000-000000000002', 'COMMIT'), 1000.00::numeric,
  'ผูกพันครบจำนวน');

-- ---------------------------------------------------------------------------
-- กติกาที่ต้องเป็นจริงเสมอ
-- ---------------------------------------------------------------------------

/*
 * สถานะที่ถือทั้งสองชนิดจะทำให้รายการเดียวกินงบสองเท่าโดยที่ทุกหน้าจอดูปกติ
 * และการยกเลิกจะคืนได้ก้อนเดียว อีกก้อนค้างตลอดกาล
 */
select pg_temp.assert_eq(
  (select count(*)::integer from unnest(enum_range(null::public.procurement_status)) s
   where public.status_holds_reservation(s) and public.status_holds_commitment(s)),
  0, 'ไม่มีสถานะใดถือทั้งยอดที่กันไว้และยอดผูกพันพร้อมกัน');

select pg_temp.assert_eq(
  (select count(*)::integer from unnest(enum_range(null::public.procurement_status)) s
   where public.status_holds_commitment(s)),
  3, 'สถานะที่ถือยอดผูกพันมีสามสถานะ');

/* ฟังก์ชันผูกพันงบเรียกตรงไม่ได้ ต้องผ่าน procurement_transition ที่ตรวจสิทธิ์มาก่อน */
select pg_temp.assert_eq(
  has_function_privilege('authenticated',
    'public.procurement_commit_budget(uuid, date, text, text)', 'execute'),
  false, 'authenticated เรียก procurement_commit_budget ตรงไม่ได้');

select pg_temp.assert_eq(
  has_function_privilege('authenticated',
    'public.procurement_outstanding_hold(uuid)', 'execute'),
  false, 'authenticated เรียก procurement_outstanding_hold ตรงไม่ได้');

rollback;
