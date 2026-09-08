-- =============================================================================
-- ทดสอบการส่งอนุมัติและกฎลำดับเวลาบน PostgreSQL จริง (PR-03)
--
-- ทุกกรณีในไฟล์นี้จำลอง **ข้อผิดพลาดที่พบในไฟล์จริง** ตามที่แผนข้อ PR-03 กำหนด
--
--   F-03  วันที่ 31/09/2568 ที่ไม่มีอยู่จริง
--   F-04  วันใช้บริการ 31 ม.ค. เกิดก่อนวันขออนุมัติ 2 ก.พ.
--   F-02  ยอดแหล่งเงินไม่ตรงกับยอดรวม
--
-- สิ่งที่ unit test พิสูจน์ไม่ได้และต้องรันที่นี่: การเรียก RPC ตรงโดยไม่ผ่าน
-- หน้าจอก็ถูกปฏิเสธเหมือนกัน และการยกเว้นต้องมีทั้งสิทธิ์และเหตุผล
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('a1111111-1111-4111-8111-111111111111', 'submit-requester@example.test'),
  ('a2222222-2222-4222-8222-222222222222', 'submit-approver@example.test'),
  ('a3333333-3333-4333-8333-333333333333', 'submit-finance@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('a1111111-1111-4111-8111-111111111111', 'submit-requester@example.test',
   'ทดสอบ', 'ผู้ขอ', true),
  ('a2222222-2222-4222-8222-222222222222', 'submit-approver@example.test',
   'ทดสอบ', 'ผู้อนุมัติ', true),
  ('a3333333-3333-4333-8333-333333333333', 'submit-finance@example.test',
   'ทดสอบ', 'การเงิน', true);

insert into public.user_roles (user_id, role_code) values
  ('a1111111-1111-4111-8111-111111111111', 'REQUESTER'),
  -- ผู้อนุมัติต้องส่งได้ด้วยจึงจะทดสอบการยกเว้นได้ในบทบาทเดียว
  ('a2222222-2222-4222-8222-222222222222', 'APPROVER'),
  ('a2222222-2222-4222-8222-222222222222', 'REQUESTER'),
  ('a3333333-3333-4333-8333-333333333333', 'FINANCE');

insert into public.fiscal_years (id, code, year_be, start_date, end_date) values
  ('f0000000-0000-4000-8000-000000000001', 'FYSUB', 2569, '2025-10-01', '2026-09-30');

insert into public.projects (id, code, name_th, fiscal_year_id) values
  ('c0000000-0000-4000-8000-000000000001', 'PRJ-SUB', 'โครงการทดสอบส่งอนุมัติ (ตัวอย่าง)',
   'f0000000-0000-4000-8000-000000000001');

insert into public.budget_accounts (id, code, fiscal_year_id, project_id) values
  ('b0000000-0000-4000-8000-000000000001', 'ACC-SUB',
   'f0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001');

create or replace function pg_temp.assert_fails(stmt text, expect text, label text)
returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    execute stmt;
  exception when others then
    v_msg := sqlerrm;
    if position(expect in v_msg) = 0 then
      raise exception 'FAIL % — ล้มด้วยเหตุผลอื่น: %', label, v_msg;
    end if;
    raise notice 'ok   %', label;
    return;
  end;
  raise exception 'FAIL % — คำสั่งนี้ควรล้มแต่กลับสำเร็จ', label;
end;
$$;

create or replace function pg_temp.assert_eq(actual anyelement, expected anyelement, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL % — ได้ % แต่ต้องการ %', label, actual, expected;
  end if;
  raise notice 'ok   % (%)', label, actual;
end;
$$;

/* จำนวนข้อผิดพลาดระดับ ERROR ที่กฎตรวจพบ */
create or replace function pg_temp.error_count(p_id uuid)
returns integer language sql as $$
  select count(*)::integer from public.procurement_check_submit(p_id) where severity = 'ERROR';
$$;

create or replace function pg_temp.has_rule(p_id uuid, p_code text)
returns boolean language sql as $$
  select exists (select 1 from public.procurement_check_submit(p_id) where rule_code = p_code);
$$;

/*
 * ส่งอนุมัติด้วย version ปัจจุบัน
 *
 * ไม่ใส่เลข version ตรง ๆ ในการทดสอบ เพราะทุก update ของรายการย่อยและของตัวรายการ
 * เพิ่ม version ผ่าน trigger การเขียนเลขคงที่จะทำให้ test พังทุกครั้งที่เพิ่ม
 * ขั้นตอนเตรียมข้อมูล ทั้งที่พฤติกรรมที่ทดสอบไม่ได้เปลี่ยน
 * (การทดสอบ version ที่ไม่ตรงมีแยกไว้ด้านล่างโดยเฉพาะ)
 */
create or replace function pg_temp.submit_now(p_id uuid, p_reason text default null)
returns text language plpgsql as $$
declare v_version integer;
begin
  select version into v_version from public.procurements where id = p_id;
  return public.procurement_submit(p_id, v_version, p_reason)::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- F-03: วันที่ที่ไม่มีอยู่จริงเข้าระบบไม่ได้เลย
--
-- ปิดที่ชนิดคอลัมน์ ไม่ใช่ที่กฎ — ไม่มีทางบันทึกค่านี้ไม่ว่าจะเรียกทางใด
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails($$
  insert into public.procurements
    (subject, fiscal_year_id, request_date, created_by)
  values ('ทดสอบวันที่ผิด (ตัวอย่าง)', 'f0000000-0000-4000-8000-000000000001',
          '2025-09-31', 'a1111111-1111-4111-8111-111111111111')
$$, 'date/time field value out of range', 'F-03: วันที่ 31 กันยายน บันทึกไม่ได้');

select pg_temp.assert_fails($$
  update public.procurements set delivery_or_service_date = '2026-02-30' where false
$$, 'date/time field value out of range', 'F-03: วันที่ 30 กุมภาพันธ์ บันทึกไม่ได้');

-- ---------------------------------------------------------------------------
-- เตรียมรายการที่ครบถ้วน แล้วค่อยทำให้ผิดทีละอย่าง
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'a1111111-1111-4111-8111-111111111111';

insert into public.procurements (
  id, subject, purpose, tax_mode, fiscal_year_id, request_date, report_date,
  classification, procurement_method, created_by
) values (
  'd0000000-0000-4000-8000-000000000001', 'จัดซื้อวัสดุสำนักงาน (ตัวอย่าง)',
  'ใช้ในงานสำนักงานประจำภาคเรียน', 'EXEMPT',
  'f0000000-0000-4000-8000-000000000001', '2026-01-05', '2026-01-06',
  'GOODS', 'SPECIFIC', 'a1111111-1111-4111-8111-111111111111'
);

insert into public.procurement_items
  (procurement_id, line_no, description, quantity, unit_price, tax_rate)
values ('d0000000-0000-4000-8000-000000000001', 1, 'กระดาษ A4 (ตัวอย่าง)', 10, 250.00, 0);

/*
 * จัดสรรงบในบทบาทเจ้าหน้าที่การเงิน
 *
 * `reset role` ไม่ช่วยที่นี่ เพราะ has_permission() อ่านผู้ใช้จาก JWT claim
 * ไม่ใช่จาก role ของ PostgreSQL — การกลับไปเป็น superuser จึงยังไม่มี budget.manage
 */
set local request.jwt.claim.sub = 'a3333333-3333-4333-8333-333333333333';
select public.budget_post_movement(
  'b0000000-0000-4000-8000-000000000001', 'ALLOCATION', 50000.00, '2026-01-02', 'จัดสรรตั้งต้น'
);
set local request.jwt.claim.sub = 'a1111111-1111-4111-8111-111111111111';

-- ---------------------------------------------------------------------------
-- F-02: ยอดแหล่งเงินไม่ตรงกับยอดรวม
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  pg_temp.has_rule('d0000000-0000-4000-8000-000000000001', 'FUNDING_TOTAL_MISMATCH'), true,
  'F-02: ยังไม่ผูกแหล่งเงินเลย ถูกตรวจพบ');

insert into public.procurement_funding_allocations
  (procurement_id, line_no, budget_account_id, amount)
values ('d0000000-0000-4000-8000-000000000001', 1,
        'b0000000-0000-4000-8000-000000000001', 2000.00);

select pg_temp.assert_eq(
  pg_temp.has_rule('d0000000-0000-4000-8000-000000000001', 'FUNDING_TOTAL_MISMATCH'), true,
  'F-02: ผูกไม่ครบยอด ถูกตรวจพบ');

select pg_temp.assert_fails($$
  select pg_temp.submit_now('d0000000-0000-4000-8000-000000000001')
$$, 'ยังมีข้อที่ต้องแก้', 'ส่งอนุมัติทั้งที่ยอดแหล่งเงินไม่ตรงไม่ได้');

update public.procurement_funding_allocations set amount = 2500.00
where procurement_id = 'd0000000-0000-4000-8000-000000000001';

select pg_temp.assert_eq(
  pg_temp.error_count('d0000000-0000-4000-8000-000000000001'), 0,
  'ผูกแหล่งเงินครบยอดแล้วไม่มีข้อผิดพลาดเหลือ');

-- ---------------------------------------------------------------------------
-- ช่องบังคับของรายงานขอซื้อ/ขอจ้าง
-- ---------------------------------------------------------------------------

update public.procurements set purpose = null
where id = 'd0000000-0000-4000-8000-000000000001';

select pg_temp.assert_eq(
  pg_temp.has_rule('d0000000-0000-4000-8000-000000000001', 'REQUIRED_REPORT_FIELD_MISSING'), true,
  'ขาดเหตุผลความจำเป็น ถูกตรวจพบ');

update public.procurements set purpose = 'ใช้ในงานสำนักงานประจำภาคเรียน', procurement_method = null
where id = 'd0000000-0000-4000-8000-000000000001';

select pg_temp.assert_eq(
  pg_temp.has_rule('d0000000-0000-4000-8000-000000000001', 'REQUIRED_REPORT_FIELD_MISSING'), true,
  'ขาดวิธีจัดหา ถูกตรวจพบ');

update public.procurements set procurement_method = 'SPECIFIC'
where id = 'd0000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- F-04: วันส่งมอบเกิดก่อนวันขออนุมัติ
-- ---------------------------------------------------------------------------

update public.procurements
set request_date = '2026-02-02', report_date = '2026-02-02', delivery_or_service_date = '2026-01-31'
where id = 'd0000000-0000-4000-8000-000000000001';

select pg_temp.assert_eq(
  pg_temp.has_rule('d0000000-0000-4000-8000-000000000001', 'DATE_REQUEST_AFTER_DELIVERY'), true,
  'F-04: วันส่งมอบก่อนวันขอ ถูกตรวจพบด้วยรหัสที่ตรงกับเหตุการณ์');

-- ผู้ขอไม่มีสิทธิ์ยกเว้น จึงส่งไม่ได้แม้จะระบุเหตุผลมาก็ตาม
select pg_temp.assert_fails($$
  select pg_temp.submit_now('d0000000-0000-4000-8000-000000000001', 'เร่งด่วน ใช้บริการไปก่อน')
$$, 'ยังมีข้อที่ต้องแก้', 'ผู้ไม่มีสิทธิ์ยกเว้น ส่งอนุมัติไม่ได้แม้ระบุเหตุผล');

-- ขั้นกลางว่างก็ยังจับได้ — จุดสำคัญของการเทียบทุกคู่
update public.procurements
set delivery_or_service_date = null, sent_to_finance_date = '2026-01-01'
where id = 'd0000000-0000-4000-8000-000000000001';

select pg_temp.assert_eq(
  pg_temp.has_rule('d0000000-0000-4000-8000-000000000001', 'DATE_OUT_OF_ORDER'), true,
  'จับลำดับผิดได้แม้ขั้นกลางจะว่าง');

update public.procurements
set sent_to_finance_date = null, delivery_or_service_date = '2026-01-31'
where id = 'd0000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- การยกเว้นต้องมีทั้งสิทธิ์และเหตุผล
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'a2222222-2222-4222-8222-222222222222';

select pg_temp.assert_fails($$
  select pg_temp.submit_now('d0000000-0000-4000-8000-000000000001')
$$, 'ต้องระบุเหตุผล', 'มีสิทธิ์ยกเว้นแต่ไม่ระบุเหตุผล ส่งไม่ได้');

select pg_temp.assert_eq(
  pg_temp.submit_now(
    'd0000000-0000-4000-8000-000000000001',
    'ใช้บริการเร่งด่วนตามบันทึกข้อความ แล้วจึงทำเอกสารย้อนหลัง (ตัวอย่าง)'),
  'PENDING_REVIEW',
  'มีทั้งสิทธิ์และเหตุผลแล้วส่งอนุมัติได้');

-- ---------------------------------------------------------------------------
-- สิ่งที่ต้องถูกบันทึกไว้หลังส่งอนุมัติ
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select exception_reason is not null and exception_granted_by is not null
          and exception_granted_at is not null
   from public.procurements where id = 'd0000000-0000-4000-8000-000000000001'),
  true, 'ข้อยกเว้นถูกบันทึกครบทั้งเหตุผล ผู้อนุมัติ และเวลา');

/*
 * คาดว่าได้ 2 ข้อ ไม่ใช่ 1
 *
 * วันขอและวันรายงานเป็น 2026-02-02 ทั้งคู่ ส่วนวันส่งมอบเป็น 2026-01-31
 * จึงผิดลำดับสองคู่จริง ๆ (ขอ>ส่งมอบ และ รายงาน>ส่งมอบ) การรายงานทั้งสองคู่
 * เป็นสิ่งที่ต้องการ เพราะผู้แก้ต้องรู้ว่าต้องแก้วันไหนบ้าง ไม่ใช่รู้แค่ข้อแรก
 */
select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_validations
   where procurement_id = 'd0000000-0000-4000-8000-000000000001'
     and stage = 'SUBMIT' and overridden),
  2, 'ผลตรวจที่ถูกยกเว้นถูกบันทึกไว้ครบทุกข้อให้ผู้ตรวจสอบอ่านย้อนหลังได้');

reset role;
select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events
   where entity_id = 'd0000000-0000-4000-8000-000000000001'
     and action = 'procurement.status_change'),
  1, 'มี audit event ของการเปลี่ยนสถานะ');

set local role authenticated;
set local request.jwt.claim.sub = 'a2222222-2222-4222-8222-222222222222';

-- ส่งซ้ำไม่ได้ เพราะไม่ได้อยู่ในสถานะร่างแล้ว
select pg_temp.assert_fails($$
  select pg_temp.submit_now('d0000000-0000-4000-8000-000000000001')
$$, 'ส่งอนุมัติซ้ำไม่ได้', 'ส่งอนุมัติซ้ำไม่ได้');

-- ---------------------------------------------------------------------------
-- optimistic concurrency ตอนส่งอนุมัติ
-- ---------------------------------------------------------------------------

insert into public.procurements (
  id, subject, purpose, tax_mode, fiscal_year_id, request_date, report_date,
  classification, procurement_method, created_by
) values (
  'd0000000-0000-4000-8000-000000000002', 'จัดซื้อรอบสอง (ตัวอย่าง)', 'ทดสอบ version',
  'EXEMPT', 'f0000000-0000-4000-8000-000000000001', '2026-01-05', '2026-01-06',
  'GOODS', 'SPECIFIC', 'a2222222-2222-4222-8222-222222222222'
);

select pg_temp.assert_fails($$
  select public.procurement_submit('d0000000-0000-4000-8000-000000000002', 99)
$$, 'มีผู้อื่นแก้ไขรายการนี้ไปแล้ว', 'ส่งด้วย version เก่าไม่ได้');

-- ---------------------------------------------------------------------------
-- ผลตรวจเขียนตรงไม่ได้ ต้องผ่าน function เท่านั้น
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails($$
  insert into public.procurement_validations
    (procurement_id, stage, rule_code, severity, message)
  values ('d0000000-0000-4000-8000-000000000002', 'SUBMIT', 'FAKE', 'INFO', 'ปลอม')
$$, 'permission denied', 'เขียนผลตรวจตรงไม่ได้');

rollback;

\echo 'procurement submit: ทุกกรณีผ่าน'
