-- =============================================================================
-- ทดสอบรายการจัดซื้อจัดจ้าง (Draft) บน PostgreSQL จริง
--
-- ทดสอบสิ่งที่ unit test ในโดเมนพิสูจน์ไม่ได้: RLS, constraint, trigger
-- และที่สำคัญที่สุด — ยอดที่ view คำนวณต้องตรงกับที่โดเมนคำนวณทุกสตางค์
--
-- ค่าคาดหวังในหัวข้อ "ยอดเงิน" มาจาก src/domain/money/calculation.ts
-- และถูกตรวจซ้ำโดย tests/unit/procurement-calculation-parity.test.ts
-- ซึ่งอ่านไฟล์นี้แล้วยืนยันว่าโดเมนให้ค่าเดียวกัน
-- ถ้าฝั่งใดฝั่งหนึ่งเปลี่ยนกติกาการปัดเศษ จะล้มทั้งสองฝั่งพร้อมกัน
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

-- procurements / procurement_items / procurement_funding_allocations ปิดการเขียนตรงจาก authenticated
-- แล้ว (F-08) ไฟล์นี้ทดสอบ "ยอดเงินจาก view / constraint / RLS ฝั่งอ่าน / trigger version" จึงจัดข้อมูลด้วย
-- ตัวช่วยที่รันด้วยสิทธิ์เจ้าของ ส่วนเส้นทางเขียนจริง (RPC สร้าง/บันทึกร่าง) ทดสอบใน
-- procurement_draft_atomic_test.sql
create or replace function pg_temp.fx(stmt text) returns void
language plpgsql security definer as $$ begin execute stmt; end; $$;

-- ผู้ใช้สมมติ: เจ้าหน้าที่พัสดุ (read.all) และผู้ขอสองคน (read.own)
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'officer@example.test'),
  ('10000000-0000-0000-0000-000000000002', 'req-a@example.test'),
  ('10000000-0000-0000-0000-000000000003', 'req-b@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('10000000-0000-0000-0000-000000000001', 'officer@example.test', 'ทดสอบ', 'พัสดุ', true),
  ('10000000-0000-0000-0000-000000000002', 'req-a@example.test', 'ทดสอบ', 'ผู้ขอ ก', true),
  ('10000000-0000-0000-0000-000000000003', 'req-b@example.test', 'ทดสอบ', 'ผู้ขอ ข', true);

insert into public.user_roles (user_id, role_code) values
  ('10000000-0000-0000-0000-000000000001', 'PROCUREMENT_OFFICER'),
  ('10000000-0000-0000-0000-000000000002', 'REQUESTER'),
  ('10000000-0000-0000-0000-000000000003', 'REQUESTER');

insert into public.fiscal_years (id, code, year_be, start_date, end_date, status) values
  ('20000000-0000-0000-0000-000000000001', 'FYPROC', 2569, '2025-10-01', '2026-09-30', 'OPEN');

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------------------
-- สร้าง draft
-- ---------------------------------------------------------------------------
select pg_temp.fx($fx$
insert into public.procurements (id, subject, fiscal_year_id, request_date, created_by)
values ('30000000-0000-0000-0000-000000000001', 'ซื้อวัสดุสำนักงาน (ตัวอย่าง)',
        '20000000-0000-0000-0000-000000000001', '2026-01-15',
        '10000000-0000-0000-0000-000000000002')
$fx$);

select pg_temp.assert_eq(
  (select left(reference, 2) from public.procurements
   where id = '30000000-0000-0000-0000-000000000001'),
  'D-', 'ระบบสร้างเลขอ้างอิงภายในให้เอง (F-16)');

select pg_temp.assert_eq(
  (select version from public.procurements where id = '30000000-0000-0000-0000-000000000001'),
  1, 'draft ใหม่เริ่มที่ version 1');

select pg_temp.assert_fails($$
  insert into public.procurements (subject, fiscal_year_id, request_date, created_by)
  values ('สร้างในนามคนอื่น', '20000000-0000-0000-0000-000000000001', '2026-01-15',
          '10000000-0000-0000-0000-000000000003')
$$, 'permission denied for table procurements',
   'สร้างรายการในนามคนอื่นผ่านตารางตรงไม่ได้ (เขียนได้ทางเดียวคือ RPC — F-08)');

select pg_temp.assert_fails($$
  insert into public.procurements (subject, status, fiscal_year_id, request_date, created_by)
  values ('สร้างเป็นอนุมัติแล้ว', 'APPROVED', '20000000-0000-0000-0000-000000000001',
          '2026-01-15', '10000000-0000-0000-0000-000000000002')
$$, 'permission denied for table procurements',
   'สร้างรายการที่อนุมัติแล้วมาตรง ๆ ผ่านตารางไม่ได้');

-- ---------------------------------------------------------------------------
-- ยอดเงิน — ค่าคาดหวังมาจากโดเมน (หน่วยสตางค์)
-- GOLDEN: EXEMPT | 3@250.50 d0 t0 ; 1@1000 d0 t0 | 175150 | 0 | 0 | 175150
-- GOLDEN: EXCLUSIVE | 7@123.45 d50.00 t7 ; 2.5@99.99 d0 t7 | 111413 | 5000 | 7449 | 113862
-- GOLDEN: INCLUSIVE | 3@107 d0 t7 ; 1@0.03 d0 t7 | 30003 | 0 | 2100 | 32103
-- GOLDEN: EXCLUSIVE | 1@0.125 d0 t7 ; 3@33.335 d0 t7 | 10014 | 0 | 701 | 10715
-- ---------------------------------------------------------------------------
select pg_temp.fx($fx$
insert into public.procurement_items
  (procurement_id, line_no, description, quantity, unit_price, discount_amount, tax_rate) values
  ('30000000-0000-0000-0000-000000000001', 1, 'กระดาษ A4 (ตัวอย่าง)', 3, 250.50, 0, 0),
  ('30000000-0000-0000-0000-000000000001', 2, 'หมึกพิมพ์ (ตัวอย่าง)', 1, 1000, 0, 0)
$fx$);

select pg_temp.assert_eq(
  (select (grand_total * 100)::bigint from public.procurement_totals
   where procurement_id = '30000000-0000-0000-0000-000000000001'),
  175150::bigint, 'EXEMPT: ยอดรวมตรงกับโดเมน');

-- EXCLUSIVE VAT 7 พร้อมส่วนลด
select pg_temp.fx($fx$
insert into public.procurements (id, subject, tax_mode, fiscal_year_id, request_date, created_by)
values ('30000000-0000-0000-0000-000000000002', 'จ้างบริการ (ตัวอย่าง)', 'EXCLUSIVE',
        '20000000-0000-0000-0000-000000000001', '2026-01-15',
        '10000000-0000-0000-0000-000000000002')
$fx$);

select pg_temp.fx($fx$
insert into public.procurement_items
  (procurement_id, line_no, description, quantity, unit_price, discount_amount, tax_rate) values
  ('30000000-0000-0000-0000-000000000002', 1, 'บรรทัด 1', 7, 123.45, 50.00, 7),
  ('30000000-0000-0000-0000-000000000002', 2, 'บรรทัด 2', 2.5, 99.99, 0, 7)
$fx$);

select pg_temp.assert_eq(
  (select (subtotal * 100)::bigint from public.procurement_totals
   where procurement_id = '30000000-0000-0000-0000-000000000002'),
  111413::bigint, 'EXCLUSIVE: subtotal ตรงกับโดเมน');
select pg_temp.assert_eq(
  (select (tax_total * 100)::bigint from public.procurement_totals
   where procurement_id = '30000000-0000-0000-0000-000000000002'),
  7449::bigint, 'EXCLUSIVE: ภาษีตรงกับโดเมน');
select pg_temp.assert_eq(
  (select (grand_total * 100)::bigint from public.procurement_totals
   where procurement_id = '30000000-0000-0000-0000-000000000002'),
  113862::bigint, 'EXCLUSIVE: ยอดรวมตรงกับโดเมน');

-- INCLUSIVE — ราคารวมภาษีแล้ว ต้องถอดภาษีออกได้ถูก
select pg_temp.fx($fx$
insert into public.procurements (id, subject, tax_mode, fiscal_year_id, request_date, created_by)
values ('30000000-0000-0000-0000-000000000003', 'ซื้อรวมภาษี (ตัวอย่าง)', 'INCLUSIVE',
        '20000000-0000-0000-0000-000000000001', '2026-01-15',
        '10000000-0000-0000-0000-000000000002')
$fx$);

select pg_temp.fx($fx$
insert into public.procurement_items
  (procurement_id, line_no, description, quantity, unit_price, discount_amount, tax_rate) values
  ('30000000-0000-0000-0000-000000000003', 1, 'บรรทัด 1', 3, 107, 0, 7),
  ('30000000-0000-0000-0000-000000000003', 2, 'บรรทัด 2', 1, 0.03, 0, 7)
$fx$);

select pg_temp.assert_eq(
  (select (grand_total * 100)::bigint from public.procurement_totals
   where procurement_id = '30000000-0000-0000-0000-000000000003'),
  32103::bigint, 'INCLUSIVE: ยอดรวมตรงกับโดเมน');

-- เศษครึ่งสตางค์ — จุดที่กติกาการปัดเศษต่างกันจะเห็นผลทันที
select pg_temp.fx($fx$
insert into public.procurements (id, subject, tax_mode, fiscal_year_id, request_date, created_by)
values ('30000000-0000-0000-0000-000000000004', 'เศษครึ่งสตางค์ (ตัวอย่าง)', 'EXCLUSIVE',
        '20000000-0000-0000-0000-000000000001', '2026-01-15',
        '10000000-0000-0000-0000-000000000002')
$fx$);

select pg_temp.fx($fx$
insert into public.procurement_items
  (procurement_id, line_no, description, quantity, unit_price, discount_amount, tax_rate) values
  ('30000000-0000-0000-0000-000000000004', 1, 'บรรทัด 1', 1, 0.125, 0, 7),
  ('30000000-0000-0000-0000-000000000004', 2, 'บรรทัด 2', 3, 33.335, 0, 7)
$fx$);

select pg_temp.assert_eq(
  (select (subtotal * 100)::bigint from public.procurement_totals
   where procurement_id = '30000000-0000-0000-0000-000000000004'),
  10014::bigint, 'เศษครึ่งสตางค์: subtotal ตรงกับโดเมน');
select pg_temp.assert_eq(
  (select (grand_total * 100)::bigint from public.procurement_totals
   where procurement_id = '30000000-0000-0000-0000-000000000004'),
  10715::bigint, 'เศษครึ่งสตางค์: ยอดรวมตรงกับโดเมน');

-- ---------------------------------------------------------------------------
-- ยอดรวมไม่มีคอลัมน์ให้เขียน จึงส่งยอดปลอมเข้ามาไม่ได้
-- ---------------------------------------------------------------------------
select pg_temp.assert_fails($$
  update public.procurements set grand_total = 1 where id = '30000000-0000-0000-0000-000000000001'
$$, 'column "grand_total"', 'ไม่มีคอลัมน์ยอดรวมให้ client เขียน');

-- ---------------------------------------------------------------------------
-- constraint ของรายการย่อย
-- ---------------------------------------------------------------------------
select pg_temp.assert_fails($$
  select pg_temp.fx($fx$
    insert into public.procurement_items (procurement_id, line_no, description, quantity, unit_price)
    values ('30000000-0000-0000-0000-000000000001', 3, 'จำนวนเป็นศูนย์', 0, 100)
  $fx$)
$$, 'procurement_items_quantity_positive', 'จำนวนต้องมากกว่าศูนย์');

select pg_temp.assert_fails($$
  select pg_temp.fx($fx$
    insert into public.procurement_items
      (procurement_id, line_no, description, quantity, unit_price, discount_amount)
    values ('30000000-0000-0000-0000-000000000001', 3, 'ส่วนลดเกินมูลค่า', 1, 100, 200)
  $fx$)
$$, 'procurement_items_discount_within_line', 'ส่วนลดเกินมูลค่าบรรทัดไม่ได้');

select pg_temp.assert_fails($$
  select pg_temp.fx($fx$
    insert into public.procurement_items (procurement_id, line_no, description, quantity, unit_price)
    values ('30000000-0000-0000-0000-000000000001', 1, 'เลขบรรทัดซ้ำ', 1, 100)
  $fx$)
$$, 'procurement_items_procurement_id_line_no_key', 'เลขบรรทัดซ้ำในรายการเดียวกันไม่ได้');

-- ---------------------------------------------------------------------------
-- optimistic concurrency
--
-- การแก้รายการย่อยนับเป็นการแก้รายการแม่ด้วย จึงเพิ่ม version ของแม่
-- ตั้งใจให้เป็นแบบนี้: ถ้าไม่นับ สองคนที่แก้คนละบรรทัดพร้อมกันจะไม่ชนกันเลย
-- ทั้งที่ยอดรวมเปลี่ยนไปแล้ว และคนที่บันทึกทีหลังจะเห็นยอดที่ไม่ตรงกับที่ตัวเองกรอก
--
-- ถึงจุดนี้รายการแรกถูกเพิ่มรายการย่อย 2 บรรทัด version จึงเป็น 3
-- ---------------------------------------------------------------------------
select pg_temp.assert_eq(
  (select version from public.procurements where id = '30000000-0000-0000-0000-000000000001'),
  3, 'การเพิ่มรายการย่อย 2 บรรทัดเพิ่ม version ของรายการแม่ด้วย');

select pg_temp.fx($fx$
update public.procurements set subject = 'แก้ครั้งที่ 1'
where id = '30000000-0000-0000-0000-000000000001'
$fx$);

select pg_temp.assert_eq(
  (select version from public.procurements where id = '30000000-0000-0000-0000-000000000001'),
  4, 'trigger เพิ่ม version ให้เองเมื่อแก้รายการแม่');

-- client ส่ง version มาเองก็ถูกเขียนทับ ปลอมไม่ได้
select pg_temp.fx($fx$
update public.procurements set subject = 'แก้ครั้งที่ 2', version = 99
where id = '30000000-0000-0000-0000-000000000001'
$fx$);

select pg_temp.assert_eq(
  (select version from public.procurements where id = '30000000-0000-0000-0000-000000000001'),
  5, 'client ตั้ง version เองไม่ได้ trigger เขียนทับเสมอ');

-- การแก้ด้วย version เก่า (conflict) ทดสอบผ่าน RPC procurement_save_draft ใน procurement_draft_atomic_test.sql

-- ---------------------------------------------------------------------------
-- แก้ไขได้เฉพาะสถานะที่กำหนด และเปลี่ยนสถานะเองผ่านการแก้ไขไม่ได้
-- ---------------------------------------------------------------------------
select pg_temp.assert_fails($$
  update public.procurements set status = 'APPROVED'
  where id = '30000000-0000-0000-0000-000000000001'
$$, 'permission denied for table procurements',
   'เปลี่ยนสถานะเป็นอนุมัติผ่านการแก้ไขตารางตรงไม่ได้');

reset role;
select pg_temp.fx($fx$
update public.procurements set status = 'PENDING_APPROVAL'
where id = '30000000-0000-0000-0000-000000000002'
$fx$);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';

select pg_temp.assert_fails($$
  update public.procurements set subject = 'แก้ตอนรออนุมัติ'
  where id = '30000000-0000-0000-0000-000000000002'
$$, 'permission denied for table procurements', 'รายการที่รออนุมัติแล้วแก้ผ่านตารางตรงไม่ได้');

select pg_temp.assert_fails($$
  insert into public.procurement_items (procurement_id, line_no, description, quantity, unit_price)
  values ('30000000-0000-0000-0000-000000000002', 9, 'เพิ่มบรรทัดตอนรออนุมัติ', 1, 100)
$$, 'permission denied for table procurement_items', 'เพิ่มรายการย่อยผ่านตารางตรงไม่ได้');

-- ---------------------------------------------------------------------------
-- RLS: ผู้ขออีกคนต้องมองไม่เห็น
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';

select pg_temp.assert_eq((select count(*) from public.procurements)::integer, 0,
  'ผู้ขออีกคนมองไม่เห็นรายการของคนอื่นเลย');
select pg_temp.assert_eq((select count(*) from public.procurement_items)::integer, 0,
  'ผู้ขออีกคนมองไม่เห็นรายการย่อยของคนอื่นเลย');

select pg_temp.assert_fails($$
  update public.procurements set subject = 'แก้ของคนอื่น'
  where id = '30000000-0000-0000-0000-000000000001'
$$, 'permission denied for table procurements', 'ผู้ขออีกคนแก้รายการของคนอื่นไม่ได้');

-- เจ้าหน้าที่พัสดุมี read.all จึงเห็นทั้งหมด
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select pg_temp.assert_eq((select count(*) from public.procurements)::integer, 4,
  'ผู้ถือ read.all เห็นทุกรายการ');

-- ---------------------------------------------------------------------------
-- แหล่งเงินหลายบรรทัด (F-02)
-- ---------------------------------------------------------------------------
reset role;
insert into public.projects (id, code, name_th, fiscal_year_id, budget_amount) values
  ('40000000-0000-0000-0000-000000000001', 'PRJ-1', 'โครงการ ก (ตัวอย่าง)',
   '20000000-0000-0000-0000-000000000001', 5000),
  ('40000000-0000-0000-0000-000000000002', 'PRJ-2', 'โครงการ ข (ตัวอย่าง)',
   '20000000-0000-0000-0000-000000000001', 5000);
insert into public.budget_accounts (id, code, fiscal_year_id, project_id) values
  ('50000000-0000-0000-0000-000000000001', 'ACC-1',
   '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', 'ACC-2',
   '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002');
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';

select pg_temp.fx($fx$
insert into public.procurement_funding_allocations
  (procurement_id, budget_account_id, line_no, amount) values
  ('30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 1, 1000.00),
  ('30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', 2, 751.50)
$fx$);

select pg_temp.assert_eq(
  (select (funding_total * 100)::bigint from public.procurement_totals
   where procurement_id = '30000000-0000-0000-0000-000000000001'),
  175150::bigint, 'ผลรวมแหล่งเงินสองบรรทัดเท่ากับยอดรวมของรายการ');

select pg_temp.assert_fails($$
  select pg_temp.fx($fx$
    insert into public.procurement_funding_allocations
      (procurement_id, budget_account_id, line_no, amount)
    values ('30000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001', 3, 10.00)
  $fx$)
$$, 'procurement_id_budget_account',
   'บัญชีงบเดียวกันซ้ำสองบรรทัดในรายการเดียวไม่ได้');

rollback;

\echo 'procurement draft: ทุกกรณีผ่าน'
