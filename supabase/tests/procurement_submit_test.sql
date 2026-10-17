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

-- ตาราง procurements / procurement_items / procurement_funding_allocations ปิดการเขียนตรงจาก authenticated
-- แล้ว (F-08) test นี้ทดสอบกติกาตอนส่งอนุมัติ จึงจัดข้อมูลตั้งต้นด้วยตัวช่วยที่รันด้วยสิทธิ์เจ้าของ
-- (การสร้าง/บันทึกร่างจริงทดสอบใน procurement_draft_atomic_test.sql)
create or replace function pg_temp.fx(stmt text) returns void
language plpgsql security definer as $$ begin execute stmt; end; $$;

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

-- เตรียมรายการทดสอบเป็นข้อมูลตั้งต้น (superuser) — ตาราง procurements/รายการย่อย/แหล่งเงินปิดการเขียนตรง
-- จาก authenticated แล้ว (F-08) การสร้างจริงทดสอบใน procurement_draft_atomic_test.sql
-- ที่นี่ทดสอบกติกาตอนส่งอนุมัติ
select pg_temp.fx($fx$
insert into public.procurements (
  id, subject, purpose, tax_mode, fiscal_year_id, request_date, report_date,
  classification, procurement_method, created_by
) values (
  'd0000000-0000-4000-8000-000000000001', 'จัดซื้อวัสดุสำนักงาน (ตัวอย่าง)',
  'ใช้ในงานสำนักงานประจำภาคเรียน', 'EXEMPT',
  'f0000000-0000-4000-8000-000000000001', '2026-01-05', '2026-01-06',
  'GOODS', 'SPECIFIC', 'a1111111-1111-4111-8111-111111111111'
)
$fx$);

select pg_temp.fx($fx$
insert into public.procurement_items
  (procurement_id, line_no, description, quantity, unit_price, tax_rate)
values ('d0000000-0000-4000-8000-000000000001', 1, 'กระดาษ A4 (ตัวอย่าง)', 10, 250.00, 0)
$fx$);

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

select pg_temp.fx($fx$
insert into public.procurement_funding_allocations
  (procurement_id, line_no, budget_account_id, amount)
values ('d0000000-0000-4000-8000-000000000001', 1,
        'b0000000-0000-4000-8000-000000000001', 2000.00)
$fx$);

select pg_temp.assert_eq(
  pg_temp.has_rule('d0000000-0000-4000-8000-000000000001', 'FUNDING_TOTAL_MISMATCH'), true,
  'F-02: ผูกไม่ครบยอด ถูกตรวจพบ');

select pg_temp.assert_fails($$
  select pg_temp.submit_now('d0000000-0000-4000-8000-000000000001')
$$, 'ยังมีข้อที่ต้องแก้', 'ส่งอนุมัติทั้งที่ยอดแหล่งเงินไม่ตรงไม่ได้');

select pg_temp.fx($fx$
update public.procurement_funding_allocations set amount = 2500.00
where procurement_id = 'd0000000-0000-4000-8000-000000000001'
$fx$);

select pg_temp.assert_eq(
  pg_temp.error_count('d0000000-0000-4000-8000-000000000001'), 0,
  'ผูกแหล่งเงินครบยอดแล้วไม่มีข้อผิดพลาดเหลือ');

-- ---------------------------------------------------------------------------
-- ช่องบังคับของรายงานขอซื้อ/ขอจ้าง
-- ---------------------------------------------------------------------------

-- รายการนี้เป็น "ซื้อ" ไม่เกิน 50,000 บาท ซึ่งใช้รายงาน 3 รายการ (ว804) ไม่บังคับเหตุผลความจำเป็น
-- จึงเปลี่ยนเป็นงานจ้างก่อน — ขั้นตอนย่อใช้กับการซื้อเท่านั้น ส่วนการทดสอบขั้นตอนย่อโดยตรงอยู่ท้ายไฟล์
-- กำหนดเวลาที่ต้องการใช้พัสดุใส่ไว้ด้วย เพื่อให้การทดสอบที่ตามมาไม่ติดช่องนี้
select pg_temp.fx($fx$
update public.procurements
set purpose = null, classification = 'SERVICE', required_date = '2026-02-10'
where id = 'd0000000-0000-4000-8000-000000000001'
$fx$);

select pg_temp.assert_eq(
  pg_temp.has_rule('d0000000-0000-4000-8000-000000000001', 'REQUIRED_REPORT_FIELD_MISSING'), true,
  'ขาดเหตุผลความจำเป็น (งานจ้าง) ถูกตรวจพบ');

select pg_temp.fx($fx$
update public.procurements set purpose = 'ใช้ในงานสำนักงานประจำภาคเรียน', procurement_method = null
where id = 'd0000000-0000-4000-8000-000000000001'
$fx$);

select pg_temp.assert_eq(
  pg_temp.has_rule('d0000000-0000-4000-8000-000000000001', 'REQUIRED_REPORT_FIELD_MISSING'), true,
  'ขาดวิธีจัดหา ถูกตรวจพบ');

select pg_temp.fx($fx$
update public.procurements set procurement_method = 'SPECIFIC'
where id = 'd0000000-0000-4000-8000-000000000001'
$fx$);

-- ---------------------------------------------------------------------------
-- F-04: วันส่งมอบเกิดก่อนวันขออนุมัติ
-- ---------------------------------------------------------------------------

select pg_temp.fx($fx$
update public.procurements
set request_date = '2026-02-02', report_date = '2026-02-02', delivery_or_service_date = '2026-01-31'
where id = 'd0000000-0000-4000-8000-000000000001'
$fx$);

select pg_temp.assert_eq(
  pg_temp.has_rule('d0000000-0000-4000-8000-000000000001', 'DATE_REQUEST_AFTER_DELIVERY'), true,
  'F-04: วันส่งมอบก่อนวันขอ ถูกตรวจพบด้วยรหัสที่ตรงกับเหตุการณ์');

-- ผู้ขอไม่มีสิทธิ์ยกเว้น จึงส่งไม่ได้แม้จะระบุเหตุผลมาก็ตาม
select pg_temp.assert_fails($$
  select pg_temp.submit_now('d0000000-0000-4000-8000-000000000001', 'เร่งด่วน ใช้บริการไปก่อน')
$$, 'ยังมีข้อที่ต้องแก้', 'ผู้ไม่มีสิทธิ์ยกเว้น ส่งอนุมัติไม่ได้แม้ระบุเหตุผล');

-- ขั้นกลางว่างก็ยังจับได้ — จุดสำคัญของการเทียบทุกคู่
select pg_temp.fx($fx$
update public.procurements
set delivery_or_service_date = null, sent_to_finance_date = '2026-01-01'
where id = 'd0000000-0000-4000-8000-000000000001'
$fx$);

select pg_temp.assert_eq(
  pg_temp.has_rule('d0000000-0000-4000-8000-000000000001', 'DATE_OUT_OF_ORDER'), true,
  'จับลำดับผิดได้แม้ขั้นกลางจะว่าง');

select pg_temp.fx($fx$
update public.procurements
set sent_to_finance_date = null, delivery_or_service_date = '2026-01-31'
where id = 'd0000000-0000-4000-8000-000000000001'
$fx$);

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

select pg_temp.fx($fx$
insert into public.procurements (
  id, subject, purpose, tax_mode, fiscal_year_id, request_date, report_date,
  classification, procurement_method, created_by
) values (
  'd0000000-0000-4000-8000-000000000002', 'จัดซื้อรอบสอง (ตัวอย่าง)', 'ทดสอบ version',
  'EXEMPT', 'f0000000-0000-4000-8000-000000000001', '2026-01-05', '2026-01-06',
  'GOODS', 'SPECIFIC', 'a2222222-2222-4222-8222-222222222222'
)
$fx$);

select pg_temp.assert_fails($$
  select public.procurement_submit('d0000000-0000-4000-8000-000000000002', 99)
$$, 'มีผู้อื่นแก้ไขรายการนี้ไปแล้ว', 'ส่งด้วย version เก่าไม่ได้');

-- ---------------------------------------------------------------------------
-- กฎตามวงเงิน (กฎกระทรวงวงเงินฯ 2560, ระเบียบ ข้อ 22 และข้อ 79 วรรคสอง, ว804)
--
-- ต้องตรงกับ tests/unit/submit-rules.test.ts กรณีต่อกรณี เพราะกฎอยู่สองที่
-- ---------------------------------------------------------------------------

reset role;

-- ต้องสร้างในบทบาทเจ้าของ (ไม่ใช่ authenticated) เพราะ security definer รันด้วยสิทธิ์ผู้สร้าง
-- สร้างรายการพร้อมรายการย่อยหนึ่งบรรทัดและแหล่งเงินเท่ายอด
create or replace function pg_temp.mk(
  p_id uuid, p_class text, p_method text, p_amount numeric,
  p_emergency boolean default false, p_purpose text default null, p_required date default null,
  p_order date default null, p_report date default '2026-01-06', p_basis text default null
) returns void language plpgsql security definer as $$
begin
  insert into public.procurements (
    id, subject, purpose, tax_mode, fiscal_year_id, request_date, report_date, required_date,
    order_or_agreement_date, delivery_or_service_date, inspection_date,
    classification, procurement_method, is_emergency, method_legal_basis_code, created_by
  ) values (
    p_id, 'ทดสอบวงเงิน (ตัวอย่าง)', p_purpose, 'EXEMPT', 'f0000000-0000-4000-8000-000000000001',
    '2026-01-05', p_report, p_required, p_order, p_order, p_order,
    p_class::public.procurement_classification, p_method::public.procurement_method,
    p_emergency, p_basis, 'a2222222-2222-4222-8222-222222222222'
  );
  insert into public.procurement_items (procurement_id, line_no, description, quantity, unit_price, tax_rate)
  values (p_id, 1, 'พัสดุ (ตัวอย่าง)', 1, p_amount, 0);
  insert into public.procurement_funding_allocations (procurement_id, line_no, budget_account_id, amount)
  values (p_id, 1, 'b0000000-0000-4000-8000-000000000001', p_amount);
end;
$$;

set local request.jwt.claim.sub = 'a3333333-3333-4333-8333-333333333333';
set local role authenticated;
select public.budget_post_movement(
  'b0000000-0000-4000-8000-000000000001', 'ALLOCATION', 900000000.00, '2026-01-02', 'ตั้งงบกว้างสำหรับทดสอบวงเงิน'
) is not null as allocated;
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a2222222-2222-4222-8222-222222222222';

create or replace function pg_temp.has_field(p_id uuid, p_code text, p_field text)
returns boolean language sql as $$
  select exists (
    select 1 from public.procurement_check_submit(p_id)
    where rule_code = p_code and field = p_field
  );
$$;

create or replace function pg_temp.severity_of(p_id uuid, p_code text)
returns text language sql as $$
  select severity::text from public.procurement_check_submit(p_id) where rule_code = p_code limit 1;
$$;

-- ซื้อไม่เกิน 50,000 บาท: ไม่บังคับเหตุผลและกำหนดเวลาใช้พัสดุ
select pg_temp.mk('d0000000-0000-4000-8000-0000000000a1', 'GOODS', 'SPECIFIC', 50000.00);
select pg_temp.assert_eq(
  pg_temp.error_count('d0000000-0000-4000-8000-0000000000a1'), 0,
  'ซื้อ 50,000.00 พอดี ไม่ต้องมีเหตุผลและกำหนดเวลาใช้พัสดุ (ว804)');

-- เกิน 50,000 บาทเพียงหนึ่งสตางค์ ต้องมีทั้งสองช่อง
select pg_temp.mk('d0000000-0000-4000-8000-0000000000a2', 'GOODS', 'SPECIFIC', 50000.01);
select pg_temp.assert_eq(
  pg_temp.has_field('d0000000-0000-4000-8000-0000000000a2', 'REQUIRED_REPORT_FIELD_MISSING', 'purpose'),
  true, 'ซื้อ 50,000.01 ต้องมีเหตุผลความจำเป็น');
select pg_temp.assert_eq(
  pg_temp.has_field('d0000000-0000-4000-8000-0000000000a2', 'REQUIRED_REPORT_FIELD_MISSING', 'requiredDate'),
  true, 'ซื้อ 50,000.01 ต้องมีกำหนดเวลาใช้พัสดุ');

-- งานจ้างไม่ใช้ขั้นตอนย่อ แม้วงเงินน้อย
select pg_temp.mk('d0000000-0000-4000-8000-0000000000a3', 'SERVICE', 'SPECIFIC', 10000.00);
select pg_temp.assert_eq(
  pg_temp.has_field('d0000000-0000-4000-8000-0000000000a3', 'REQUIRED_REPORT_FIELD_MISSING', 'purpose'),
  true, 'งานจ้างไม่ใช้ขั้นตอนย่อ ต้องมีเหตุผลความจำเป็น');

-- ฉุกเฉิน: ต้องมีเหตุผล แต่ตัดกำหนดเวลาใช้พัสดุได้ (ข้อ 22 วรรคสอง)
select pg_temp.mk('d0000000-0000-4000-8000-0000000000a4', 'GOODS', 'SPECIFIC', 120000.00, true);
select pg_temp.assert_eq(
  pg_temp.has_field('d0000000-0000-4000-8000-0000000000a4', 'REQUIRED_REPORT_FIELD_MISSING', 'purpose'),
  true, 'ฉุกเฉินต้องมีเหตุผลเสมอ');
select pg_temp.assert_eq(
  pg_temp.has_field('d0000000-0000-4000-8000-0000000000a4', 'REQUIRED_REPORT_FIELD_MISSING', 'requiredDate'),
  false, 'ฉุกเฉินตัดกำหนดเวลาใช้พัสดุได้');

-- วิธีเฉพาะเจาะจงกับ 500,000 บาท
select pg_temp.mk('d0000000-0000-4000-8000-0000000000b1', 'GOODS', 'SPECIFIC', 500000.00,
  false, 'เหตุผล', '2026-02-01');
select pg_temp.assert_eq(
  pg_temp.has_rule('d0000000-0000-4000-8000-0000000000b1', 'METHOD_EXCEEDS_LIMIT'), false,
  '500,000.00 พอดี ใช้เฉพาะเจาะจงได้');

select pg_temp.mk('d0000000-0000-4000-8000-0000000000b2', 'GOODS', 'SPECIFIC', 500000.01,
  false, 'เหตุผล', '2026-02-01');
select pg_temp.assert_eq(
  pg_temp.severity_of('d0000000-0000-4000-8000-0000000000b2', 'METHOD_EXCEEDS_LIMIT'), 'ERROR',
  'เกิน 500,000 บาท ใช้เฉพาะเจาะจงไม่ได้');

select pg_temp.assert_eq(
  public.is_overridable_rule('METHOD_EXCEEDS_LIMIT'), false,
  'METHOD_EXCEEDS_LIMIT ยกเว้นไม่ได้');

select pg_temp.assert_fails($$
  select pg_temp.submit_now('d0000000-0000-4000-8000-0000000000b2', 'ขอยกเว้น')
$$, 'ยังมีข้อที่ต้องแก้', 'ผู้มีสิทธิ์ยกเว้นก็ส่งเฉพาะเจาะจงเกิน 500,000 บาทไม่ได้');

select pg_temp.mk('d0000000-0000-4000-8000-0000000000b3', 'GOODS', 'SPECIFIC', 900000.00,
  true, 'เหตุผลฉุกเฉิน');
select pg_temp.assert_eq(
  pg_temp.has_rule('d0000000-0000-4000-8000-0000000000b3', 'METHOD_EXCEEDS_LIMIT'), false,
  'เกิน 500,000 บาทแต่ฉุกเฉิน ผ่านข้อนี้');

select pg_temp.mk('d0000000-0000-4000-8000-0000000000b4', 'GOODS', 'SPECIFIC', 900000.00,
  false, 'เหตุผล', '2026-02-01', null, '2026-01-06', 'ม.56(2)(ซ)');
select pg_temp.assert_eq(
  pg_temp.has_rule('d0000000-0000-4000-8000-0000000000b4', 'METHOD_EXCEEDS_LIMIT'), false,
  'เกิน 500,000 บาทแต่ระบุฐานกฎหมาย ผ่านข้อนี้');

select pg_temp.mk('d0000000-0000-4000-8000-0000000000b5', 'GOODS', 'SELECTION', 200000.00,
  false, 'เหตุผล', '2026-02-01');
select pg_temp.assert_eq(
  pg_temp.severity_of('d0000000-0000-4000-8000-0000000000b5', 'METHOD_NOT_SPECIFIC_FOR_SMALL'), 'WARNING',
  'วิธีคัดเลือกที่วงเงินไม่เกิน 500,000 บาท เตือนแต่ไม่บล็อก');

-- ซื้อก่อนรายงานตามหลัง
-- 2026-01-05 (จันทร์) ซื้อ → 2026-01-12 (จันทร์) = 5 วันทำการ
select pg_temp.mk('d0000000-0000-4000-8000-0000000000c1', 'GOODS', 'SPECIFIC', 20000.00,
  false, null, null, '2026-01-05', '2026-01-12');
select pg_temp.assert_eq(
  pg_temp.error_count('d0000000-0000-4000-8000-0000000000c1'), 0,
  'ซื้อไม่เกิน 50,000 บาท รายงานภายใน 5 วันทำการ ไม่มีข้อผิดพลาด');
select pg_temp.assert_eq(
  pg_temp.severity_of('d0000000-0000-4000-8000-0000000000c1', 'BUY_FIRST_REPORT_DEADLINE'), 'INFO',
  'ซื้อก่อนรายงานภายในกำหนด แจ้งเป็น INFO');

select pg_temp.mk('d0000000-0000-4000-8000-0000000000c2', 'GOODS', 'SPECIFIC', 20000.00,
  false, null, null, '2026-01-05', '2026-01-13');
select pg_temp.assert_eq(
  pg_temp.error_count('d0000000-0000-4000-8000-0000000000c2'), 0,
  'รายงานเกิน 5 วันทำการ ไม่บล็อก');
select pg_temp.assert_eq(
  pg_temp.severity_of('d0000000-0000-4000-8000-0000000000c2', 'BUY_FIRST_REPORT_DEADLINE'), 'WARNING',
  'รายงานเกิน 5 วันทำการ เตือน');

select pg_temp.mk('d0000000-0000-4000-8000-0000000000c3', 'GOODS', 'SPECIFIC', 80000.00,
  false, 'เหตุผล', '2026-02-01', '2026-01-05', '2026-01-12');
select pg_temp.assert_eq(
  pg_temp.has_rule('d0000000-0000-4000-8000-0000000000c3', 'DATE_OUT_OF_ORDER'), true,
  'เกิน 50,000 บาทและไม่ฉุกเฉิน ซื้อก่อนรายงานไม่ได้');

select pg_temp.mk('d0000000-0000-4000-8000-0000000000c4', 'GOODS', 'SPECIFIC', 80000.00,
  true, 'เหตุผลฉุกเฉิน', null, '2026-01-05', '2026-02-20');
select pg_temp.assert_eq(
  pg_temp.error_count('d0000000-0000-4000-8000-0000000000c4'), 0,
  'ฉุกเฉิน ซื้อก่อนรายงานได้ (ข้อ 79 วรรคสอง ไม่กำหนดจำนวนวัน)');
select pg_temp.assert_eq(
  pg_temp.severity_of('d0000000-0000-4000-8000-0000000000c4', 'BUY_FIRST_REPORT_DEADLINE'), 'INFO',
  'ฉุกเฉินแจ้งเป็น INFO ไม่มีคำเตือนเรื่องจำนวนวัน');

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
