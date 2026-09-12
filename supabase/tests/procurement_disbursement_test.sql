-- =============================================================================
-- ทดสอบการเบิกจ่ายบน PostgreSQL จริง (PR-04d)
--
-- สิ่งที่ unit test พิสูจน์ไม่ได้และต้องรันที่นี่:
--
--   * การจ่ายลด "ยอดที่กันไว้" และเพิ่ม "จ่ายจริง" พร้อมกัน — ยอดที่ใช้ได้
--     จึงไม่เปลี่ยนจากการจ่าย ซึ่งเป็นหัวใจของ PR นี้
--   * จ่ายหลายงวดจนครบแล้วยอดที่กันไว้เหลือศูนย์ — ปิดอาการ "กันไว้ตลอดกาล"
--   * จ่ายเกินยอดที่กันไว้ไม่ได้
--   * แบ่งยอดข้ามบัญชีงบตามสัดส่วน และเศษสตางค์ไม่หาย
--   * ยกเลิกการเบิกจ่ายแล้วยอดกลับไปเป็น "กันไว้" ตามเดิม
--   * ยกเลิกรายการที่จ่ายเงินไปแล้วไม่ได้
--   * ผู้ไม่มีสิทธิ์ procurement.disburse ทำไม่ได้
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

/* ยอดที่ยังกันไว้ของรายการหนึ่ง — ฟังก์ชันจริงถูกเพิกถอนจาก authenticated
   จึงห่อด้วย security definer ใน pg_temp แทนการเปิดสิทธิ์ให้ของจริง */
create or replace function pg_temp.outstanding(p_procurement uuid)
returns numeric language sql security definer as $$
  select coalesce(sum(outstanding), 0) from public.procurement_outstanding_reserve(p_procurement);
$$;

-- ---------------------------------------------------------------------------
-- ผู้ใช้สมมติ
--
-- **การเงินถือแค่บทบาท FINANCE** ซึ่งได้ procurement.disburse จาก seed
-- ส่วนพัสดุไม่มีสิทธิ์นี้ ใช้พิสูจน์ว่าการจ่ายเงินไม่ใช่สิ่งที่ใครก็ทำได้
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('d1111111-1111-4111-8111-111111111111', 'db-requester@example.test'),
  ('d2222222-2222-4222-8222-222222222222', 'db-reviewer@example.test'),
  ('d3333333-3333-4333-8333-333333333333', 'db-approver@example.test'),
  ('d4444444-4444-4444-8444-444444444444', 'db-finance@example.test'),
  ('d5555555-5555-4555-8555-555555555555', 'db-officer@example.test'),
  ('d6666666-6666-4666-8666-666666666666', 'db-auditor@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('d1111111-1111-4111-8111-111111111111', 'db-requester@example.test', 'ทดสอบ', 'ผู้ขอ', true),
  ('d2222222-2222-4222-8222-222222222222', 'db-reviewer@example.test', 'ทดสอบ', 'ผู้ตรวจสอบ', true),
  ('d3333333-3333-4333-8333-333333333333', 'db-approver@example.test', 'ทดสอบ', 'ผู้อนุมัติ', true),
  ('d4444444-4444-4444-8444-444444444444', 'db-finance@example.test', 'ทดสอบ', 'การเงิน', true),
  ('d5555555-5555-4555-8555-555555555555', 'db-officer@example.test', 'ทดสอบ', 'พัสดุ', true),
  ('d6666666-6666-4666-8666-666666666666', 'db-auditor@example.test',
   'ทดสอบ', 'ผู้ตรวจสอบภายใน', true);

insert into public.user_roles (user_id, role_code) values
  ('d1111111-1111-4111-8111-111111111111', 'REQUESTER'),
  ('d2222222-2222-4222-8222-222222222222', 'REVIEWER'),
  ('d3333333-3333-4333-8333-333333333333', 'APPROVER'),
  ('d4444444-4444-4444-8444-444444444444', 'FINANCE'),
  ('d5555555-5555-4555-8555-555555555555', 'PROCUREMENT_OFFICER'),
  ('d6666666-6666-4666-8666-666666666666', 'AUDITOR');

/* ผู้อนุมัติต้องยกเลิกรายการได้ด้วย เพื่อทดสอบ guard ตอนท้าย */
insert into public.role_permissions (role_code, permission_code) values
  ('APPROVER', 'procurement.cancel')
on conflict do nothing;

insert into public.fiscal_years (id, code, year_be, start_date, end_date) values
  ('d0000000-0000-4000-8000-000000000001', 'FYDB', 2569, '2025-10-01', '2026-09-30');

/* สองโครงการ เพราะบัญชีงบหนึ่งบัญชีผูกได้หนึ่ง scope (budget_accounts_scope_unique) */
insert into public.projects (id, code, name_th, fiscal_year_id) values
  ('d0000000-0000-4000-8000-000000000002', 'PRJ-DB-A', 'โครงการทดสอบการเบิกจ่าย ก (ตัวอย่าง)',
   'd0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000005', 'PRJ-DB-B', 'โครงการทดสอบการเบิกจ่าย ข (ตัวอย่าง)',
   'd0000000-0000-4000-8000-000000000001');

/* สองบัญชีงบ เพื่อพิสูจน์การแบ่งยอดตามสัดส่วน */
insert into public.budget_accounts (id, code, fiscal_year_id, project_id) values
  ('d0000000-0000-4000-8000-000000000003', 'ACC-DB-A',
   'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000004', 'ACC-DB-B',
   'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005');

insert into public.procurements (
  id, subject, purpose, fiscal_year_id, request_date, report_date,
  classification, procurement_method, tax_mode, created_by
) values
  ('dbaaaaaa-0000-4000-8000-000000000001', 'จัดซื้อทดสอบการเบิกจ่าย (ตัวอย่าง)',
   'ใช้ทดสอบ (ตัวอย่าง)', 'd0000000-0000-4000-8000-000000000001', '2026-01-05', '2026-01-06',
   'GOODS', 'SPECIFIC', 'EXEMPT', 'd1111111-1111-4111-8111-111111111111');

insert into public.procurement_items (procurement_id, line_no, description, quantity, unit_price)
values ('dbaaaaaa-0000-4000-8000-000000000001', 1, 'กระดาษ (ตัวอย่าง)', 10, 300.00);

/* 3,000 บาท แบ่งเป็น 2,000 กับ 1,000 — สัดส่วน 2:1 */
insert into public.procurement_funding_allocations
  (procurement_id, line_no, budget_account_id, amount)
values
  ('dbaaaaaa-0000-4000-8000-000000000001', 1, 'd0000000-0000-4000-8000-000000000003', 2000.00),
  ('dbaaaaaa-0000-4000-8000-000000000001', 2, 'd0000000-0000-4000-8000-000000000004', 1000.00);

set local role authenticated;

set local request.jwt.claim.sub = 'd4444444-4444-4444-8444-444444444444';
select public.budget_post_movement(
  'd0000000-0000-4000-8000-000000000003', 'ALLOCATION', 5000.00, '2026-01-01', 'ตั้งต้น');
select public.budget_post_movement(
  'd0000000-0000-4000-8000-000000000004', 'ALLOCATION', 5000.00, '2026-01-01', 'ตั้งต้น');

-- ---------------------------------------------------------------------------
-- เดินรายการจนถึงสถานะรับของแล้ว
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'd1111111-1111-4111-8111-111111111111';
select public.procurement_submit('dbaaaaaa-0000-4000-8000-000000000001',
  (select version from public.procurements where id = 'dbaaaaaa-0000-4000-8000-000000000001'));

set local request.jwt.claim.sub = 'd2222222-2222-4222-8222-222222222222';
select pg_temp.act('dbaaaaaa-0000-4000-8000-000000000001', 'review_pass');

set local request.jwt.claim.sub = 'd3333333-3333-4333-8333-333333333333';
select pg_temp.act('dbaaaaaa-0000-4000-8000-000000000001', 'approve');

select pg_temp.assert_eq(
  pg_temp.available('d0000000-0000-4000-8000-000000000003'), 3000.00::numeric,
  'อนุมัติแล้วบัญชี ก กันไว้ 2,000 เหลือใช้ได้ 3,000');
select pg_temp.assert_eq(
  pg_temp.available('d0000000-0000-4000-8000-000000000004'), 4000.00::numeric,
  'อนุมัติแล้วบัญชี ข กันไว้ 1,000 เหลือใช้ได้ 4,000');
select pg_temp.assert_eq(
  pg_temp.outstanding('dbaaaaaa-0000-4000-8000-000000000001'), 3000.00::numeric,
  'ยอดที่กันไว้ทั้งรายการคือ 3,000');

-- ---------------------------------------------------------------------------
-- เบิกจ่ายก่อนรับของไม่ได้
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'd4444444-4444-4444-8444-444444444444';

select pg_temp.assert_fails(
  $$select public.procurement_disburse(
      'dbaaaaaa-0000-4000-8000-000000000001', 1000.00, '2026-02-01')$$,
  'เบิกจ่ายได้เมื่อรับของแล้วเท่านั้น',
  'สถานะ APPROVED เบิกจ่ายไม่ได้');

/*
 * รับบางส่วน ไม่ใช่รับครบ
 *
 * PARTIALLY_RECEIVED เป็นสถานะเดียวที่ทั้ง **เบิกจ่ายได้** และ **ยกเลิกได้**
 * (RECEIVED ยกเลิกไม่ได้อยู่แล้วตามตารางสถานะ) จึงเป็นสถานะเดียวที่ทำให้
 * guard "ยกเลิกรายการที่จ่ายเงินไปแล้วไม่ได้" ถูกเรียกใช้จริง
 * ถ้าใช้ receive_all การยกเลิกจะล้มเพราะไม่มีเส้นทาง ไม่ใช่เพราะ guard —
 * test จะผ่านด้วยเหตุผลที่ผิด
 */
set local request.jwt.claim.sub = 'd5555555-5555-4555-8555-555555555555';
select pg_temp.act('dbaaaaaa-0000-4000-8000-000000000001', 'issue');
select pg_temp.act('dbaaaaaa-0000-4000-8000-000000000001', 'receive_partial');

select pg_temp.assert_eq(
  (select status::text from public.procurements
   where id = 'dbaaaaaa-0000-4000-8000-000000000001'),
  'PARTIALLY_RECEIVED', 'อยู่ในสถานะรับบางส่วน');

-- ---------------------------------------------------------------------------
-- ผู้ไม่มีสิทธิ์เบิกจ่ายทำไม่ได้
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select public.has_permission('procurement.disburse')), false,
  'เจ้าหน้าที่พัสดุไม่มีสิทธิ์เบิกจ่าย');

/* ทั้งสองสถานะที่รับของแล้วเบิกจ่ายได้ ไม่ใช่แค่สถานะที่ fixture นี้ใช้ */
select pg_temp.assert_eq(
  public.status_allows_disbursement('RECEIVED'), true, 'RECEIVED เบิกจ่ายได้');
select pg_temp.assert_eq(
  public.status_allows_disbursement('PARTIALLY_RECEIVED'), true, 'PARTIALLY_RECEIVED เบิกจ่ายได้');
select pg_temp.assert_eq(
  public.status_allows_disbursement('ISSUED'), false, 'ISSUED ยังเบิกจ่ายไม่ได้');

select pg_temp.assert_fails(
  $$select public.procurement_disburse(
      'dbaaaaaa-0000-4000-8000-000000000001', 1000.00, '2026-02-01')$$,
  'คุณไม่มีสิทธิ์บันทึกการเบิกจ่าย',
  'ผู้ไม่มีสิทธิ์เบิกจ่ายถูกปฏิเสธ');

-- ---------------------------------------------------------------------------
-- **หัวใจของ PR นี้** — จ่ายแล้วยอดที่ใช้ได้ต้องไม่เปลี่ยน
--
-- เพราะ "กันไว้" ลดลงเท่ากับที่ "จ่ายจริง" เพิ่มขึ้น ถ้า RELEASE กับ ACTUAL
-- ไม่ได้ลงคู่กัน ยอดที่ใช้ได้จะขยับ ซึ่ง assertion นี้จะจับได้ทันที
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'd4444444-4444-4444-8444-444444444444';

select public.procurement_disburse(
  'dbaaaaaa-0000-4000-8000-000000000001', 1500.00, '2026-02-01', 'PAY-001', 'ร้านตัวอย่าง');

select pg_temp.assert_eq(
  pg_temp.available('d0000000-0000-4000-8000-000000000003'), 3000.00::numeric,
  'จ่ายงวดแรกแล้วยอดที่ใช้ได้ของบัญชี ก ไม่เปลี่ยน');
select pg_temp.assert_eq(
  pg_temp.available('d0000000-0000-4000-8000-000000000004'), 4000.00::numeric,
  'จ่ายงวดแรกแล้วยอดที่ใช้ได้ของบัญชี ข ไม่เปลี่ยน');

select pg_temp.assert_eq(
  pg_temp.outstanding('dbaaaaaa-0000-4000-8000-000000000001'), 1500.00::numeric,
  'ยอดที่กันไว้ลดลงเหลือ 1,500');

-- แบ่งตามสัดส่วน 2:1 — บัญชี ก ได้ 1,000 บัญชี ข ได้ 500
select pg_temp.assert_eq(
  (select sum(amount) from public.budget_movements
   where source_id = 'dbaaaaaa-0000-4000-8000-000000000001'
     and movement_type = 'ACTUAL'
     and budget_account_id = 'd0000000-0000-4000-8000-000000000003'),
  1000.00::numeric, 'บัญชี ก จ่ายจริง 1,000 ตามสัดส่วน 2:1');

select pg_temp.assert_eq(
  (select sum(amount) from public.budget_movements
   where source_id = 'dbaaaaaa-0000-4000-8000-000000000001'
     and movement_type = 'ACTUAL'
     and budget_account_id = 'd0000000-0000-4000-8000-000000000004'),
  500.00::numeric, 'บัญชี ข จ่ายจริง 500 ตามสัดส่วน 2:1');

-- ---------------------------------------------------------------------------
-- จ่ายเกินยอดที่กันไว้ไม่ได้
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$select public.procurement_disburse(
      'dbaaaaaa-0000-4000-8000-000000000001', 1500.01, '2026-02-05')$$,
  'เบิกจ่ายเกินยอดที่กันไว้ไม่ได้',
  'จ่ายเกินยอดที่กันไว้แม้แค่หนึ่งสตางค์ก็ไม่ได้');

-- ---------------------------------------------------------------------------
-- **ปิดอาการ "กันไว้ตลอดกาล"** — จ่ายจนครบแล้วยอดที่กันไว้ต้องเหลือศูนย์
-- ---------------------------------------------------------------------------

select public.procurement_disburse(
  'dbaaaaaa-0000-4000-8000-000000000001', 1500.00, '2026-02-10', 'PAY-002');

select pg_temp.assert_eq(
  pg_temp.outstanding('dbaaaaaa-0000-4000-8000-000000000001'), 0.00::numeric,
  'จ่ายครบแล้วไม่เหลือยอดที่กันไว้');

select pg_temp.assert_eq(
  pg_temp.available('d0000000-0000-4000-8000-000000000003'), 3000.00::numeric,
  'จ่ายครบแล้วยอดที่ใช้ได้ของบัญชี ก ยังเท่าเดิม');

select pg_temp.assert_eq(
  (select sum(amount) from public.budget_movements
   where source_id = 'dbaaaaaa-0000-4000-8000-000000000001'
     and movement_type = 'ACTUAL'),
  3000.00::numeric, 'จ่ายจริงรวม 3,000 เท่ากับยอดที่อนุมัติ');

select pg_temp.assert_fails(
  $$select public.procurement_disburse(
      'dbaaaaaa-0000-4000-8000-000000000001', 0.01, '2026-02-11')$$,
  'ไม่มียอดที่กันไว้เหลือ',
  'จ่ายซ้ำหลังจ่ายครบแล้วไม่ได้');

-- ---------------------------------------------------------------------------
-- ยกเลิกรายการที่จ่ายเงินไปแล้วไม่ได้
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'd3333333-3333-4333-8333-333333333333';

select pg_temp.assert_fails(
  $$select pg_temp.act('dbaaaaaa-0000-4000-8000-000000000001', 'cancel', 'ขอยกเลิก')$$,
  'ยกเลิกรายการที่จ่ายเงินไปแล้วไม่ได้',
  'ยกเลิกรายการที่จ่ายเงินไปแล้วไม่ได้');

-- ---------------------------------------------------------------------------
-- ยกเลิกการเบิกจ่าย — ยอดต้องกลับไปเป็น "กันไว้" ตามเดิม
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'd4444444-4444-4444-8444-444444444444';

select pg_temp.assert_fails(
  $$select public.procurement_disbursement_void(
      (select id from public.procurement_disbursements where document_no = 'PAY-002'), '  ')$$,
  'ต้องระบุเหตุผล',
  'ยกเลิกการเบิกจ่ายโดยไม่บอกเหตุผลไม่ได้');

select pg_temp.assert_eq(
  public.procurement_disbursement_void(
    (select id from public.procurement_disbursements where document_no = 'PAY-002'),
    'บันทึกผิดใบ'),
  4, 'ยกเลิกแล้วย้อนครบทุกแถว — สองบัญชี บัญชีละ RELEASE กับ ACTUAL');

select pg_temp.assert_eq(
  pg_temp.outstanding('dbaaaaaa-0000-4000-8000-000000000001'), 1500.00::numeric,
  'ยกเลิกแล้วยอดกลับไปเป็นกันไว้ 1,500');

select pg_temp.assert_eq(
  pg_temp.available('d0000000-0000-4000-8000-000000000003'), 3000.00::numeric,
  'ยกเลิกแล้วยอดที่ใช้ได้ยังเท่าเดิม');

select pg_temp.assert_fails(
  $$select public.procurement_disbursement_void(
      (select id from public.procurement_disbursements where document_no = 'PAY-002'), 'ซ้ำ')$$,
  'ถูกยกเลิกไปแล้ว',
  'ยกเลิกการเบิกจ่ายซ้ำไม่ได้');

-- ---------------------------------------------------------------------------
-- เศษสตางค์ต้องไม่หาย — แบ่ง 0.01 บาทข้ามสองบัญชี
-- ---------------------------------------------------------------------------

select public.procurement_disburse(
  'dbaaaaaa-0000-4000-8000-000000000001', 0.01, '2026-02-20', 'PAY-003');

select pg_temp.assert_eq(
  (select sum(amount) from public.budget_movements
   where source_id = 'dbaaaaaa-0000-4000-8000-000000000001'
     and movement_type = 'ACTUAL'
     and effective_date = '2026-02-20'),
  0.01::numeric, 'จ่าย 1 สตางค์แล้วลงจริง 1 สตางค์ ไม่หายและไม่งอก');

-- ---------------------------------------------------------------------------
-- audit ต้องมีครบทั้งการจ่ายและการยกเลิก
-- ---------------------------------------------------------------------------

/* อ่าน audit ในนามผู้ตรวจสอบภายใน ซึ่งได้ audit.read มาจาก seed อยู่แล้ว
   การเพิ่มสิทธิ์ให้ตัวเองระหว่าง test เท่ากับทดสอบระบบที่ไม่ใช่ระบบจริง */
set local request.jwt.claim.sub = 'd6666666-6666-4666-8666-666666666666';

select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events where action = 'procurement.disburse'),
  3, 'ทุกการเบิกจ่ายมี audit');

select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events where action = 'procurement.disburse_void'),
  1, 'การยกเลิกการเบิกจ่ายมี audit');

-- ---------------------------------------------------------------------------
-- ฟังก์ชันช่วยไม่เปิดให้ผู้ใช้ทั่วไปเรียกตรง
--
-- procurement_outstanding_reserve อ่าน budget_movements ข้าม RLS ได้
-- การเปิดให้เรียกตรงทำให้สำรวจยอดงบของรายการที่ตัวเองไม่มีสิทธิ์เห็นได้
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  has_function_privilege('authenticated',
    'public.procurement_outstanding_reserve(uuid)', 'execute'),
  false, 'authenticated เรียก procurement_outstanding_reserve ตรงไม่ได้');

select pg_temp.assert_eq(
  has_function_privilege('authenticated',
    'public.procurement_has_live_disbursement(uuid)', 'execute'),
  false, 'authenticated เรียก procurement_has_live_disbursement ตรงไม่ได้');

rollback;
