-- =============================================================================
-- ทดสอบ budget ledger บน PostgreSQL จริง
--
-- ทดสอบสิ่งที่ unit test ในโดเมนพิสูจน์ไม่ได้: constraint, RLS, การล็อกแถว
-- และการที่ audit event เกิดในทรานแซกชันเดียวกับ movement
--
-- รันหลัง migration และ seed ทั้งสองไฟล์ ดู .github/workflows/ci.yml
-- ทุกกรณีที่ "ต้องล้ม" ใช้ assert_fails() เพื่อไม่ให้การล้มที่ไม่เกี่ยวข้อง
-- ถูกนับว่าผ่าน
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ผู้ใช้สมมติสำหรับทดสอบ ไม่แตะข้อมูลจริง
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'finance@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'requester@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('11111111-1111-1111-1111-111111111111', 'finance@example.test', 'ทดสอบ', 'การเงิน', true),
  ('22222222-2222-2222-2222-222222222222', 'requester@example.test', 'ทดสอบ', 'ผู้ขอ', true);

insert into public.user_roles (user_id, role_code) values
  ('11111111-1111-1111-1111-111111111111', 'FINANCE'),
  ('22222222-2222-2222-2222-222222222222', 'REQUESTER');

-- constraint fiscal_years_closed_consistency บังคับว่า CLOSED ต้องมี closed_at
-- จึงใส่มาพร้อมกันในคำสั่งเดียว ไม่ใช่ update ตามหลัง
insert into public.fiscal_years (id, code, year_be, start_date, end_date, status, closed_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'FY2569', 2569, '2025-10-01', '2026-09-30', 'OPEN', null),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'FY2568', 2568, '2024-10-01', '2025-09-30', 'CLOSED', now());

-- บัญชีงบต้องมี scope ต่างกัน มิฉะนั้นชน budget_accounts_scope_unique
-- ซึ่งเป็นพฤติกรรมที่ต้องการ: หนึ่ง scope ต้องมีบัญชีเดียวเท่านั้น
insert into public.projects (id, code, name_th, fiscal_year_id, budget_amount) values
  ('cccccccc-0000-0000-0000-000000000001', 'PRJ-A', 'โครงการทดสอบ ก (ตัวอย่าง)',
   'aaaaaaaa-0000-0000-0000-000000000001', 6000.00),
  ('cccccccc-0000-0000-0000-000000000002', 'PRJ-B', 'โครงการทดสอบ ข (ตัวอย่าง)',
   'aaaaaaaa-0000-0000-0000-000000000001', 5000.00),
  ('cccccccc-0000-0000-0000-000000000003', 'PRJ-OLD', 'โครงการปีก่อน (ตัวอย่าง)',
   'aaaaaaaa-0000-0000-0000-000000000002', 1000.00);

insert into public.budget_accounts (id, code, fiscal_year_id, project_id) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'ACC-A',
   'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ACC-B',
   'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'ACC-CLOSED',
   'aaaaaaaa-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003');


-- ตัวช่วยยืนยันว่าคำสั่ง "ล้มด้วยเหตุผลที่คาดไว้" จริง ๆ
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

create or replace function pg_temp.assert_eq(actual numeric, expected numeric, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL % — ได้ % แต่ต้องการ %', label, actual, expected;
  end if;
  raise notice 'ok   % (%)', label, actual;
end;
$$;

-- บัญชีงบต้องมี scope ต้องสร้างแบบไร้ scope ไม่ได้
select pg_temp.assert_fails($$
  insert into public.budget_accounts (code, fiscal_year_id)
  values ('ACC-NO-SCOPE', 'aaaaaaaa-0000-0000-0000-000000000001')
$$, 'budget_accounts_scope_required', 'บัญชีงบที่ไม่ผูก scope ใดเลยสร้างไม่ได้');

-- หนึ่ง scope มีบัญชีงบได้บัญชีเดียว
select pg_temp.assert_fails($$
  insert into public.budget_accounts (code, fiscal_year_id, project_id)
  values ('ACC-DUP', 'aaaaaaaa-0000-0000-0000-000000000001',
          'cccccccc-0000-0000-0000-000000000001')
$$, 'budget_accounts_scope_unique', 'บัญชีงบซ้ำ scope เดิมสร้างไม่ได้');

-- สวมบทบาทเจ้าหน้าที่การเงิน (มี budget.manage ไม่มี budget.override)
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- ---------------------------------------------------------------------------
-- F-01: จัดสรร 6,000 แล้วกันยอด 6,199 ต้องถูกบล็อก
-- ---------------------------------------------------------------------------
select public.budget_post_movement(
  'bbbbbbbb-0000-0000-0000-000000000001', 'ALLOCATION', 6000.00, '2026-01-15', 'จัดสรรตั้งต้น'
);

select pg_temp.assert_eq(public.budget_available('bbbbbbbb-0000-0000-0000-000000000001'), 6000.00,
  'จัดสรรแล้วยอดที่ใช้ได้เท่ากับที่จัดสรร');

select pg_temp.assert_fails($$
  select public.budget_post_movement(
    'bbbbbbbb-0000-0000-0000-000000000001', 'RESERVE', 6199.00, '2026-01-20', 'ทดสอบเกินงบ')
$$, 'ยอดงบคงเหลือไม่พอ', 'F-01 กันยอด 6,199 จากงบ 6,000 ถูกบล็อก');

select pg_temp.assert_eq(public.budget_available('bbbbbbbb-0000-0000-0000-000000000001'), 6000.00,
  'ยอดไม่เปลี่ยนหลังถูกปฏิเสธ');

-- ใช้พอดีทำได้
select public.budget_post_movement(
  'bbbbbbbb-0000-0000-0000-000000000001', 'RESERVE', 6000.00, '2026-01-20', 'กันยอดเต็มจำนวน'
);
select pg_temp.assert_eq(public.budget_available('bbbbbbbb-0000-0000-0000-000000000001'), 0.00,
  'กันยอดเต็มจำนวนแล้วเหลือศูนย์');

-- ---------------------------------------------------------------------------
-- append-only: แก้และลบไม่ได้
-- ---------------------------------------------------------------------------
select pg_temp.assert_fails(
  $$update public.budget_movements set amount = 1 where movement_type = 'ALLOCATION'$$,
  'permission denied', 'ผู้ใช้ทั่วไปไม่มี privilege แก้รายการเคลื่อนไหว');

select pg_temp.assert_fails(
  $$delete from public.budget_movements$$,
  'permission denied', 'ผู้ใช้ทั่วไปไม่มี privilege ลบรายการเคลื่อนไหว');

select pg_temp.assert_fails(
  $$insert into public.budget_movements (budget_account_id, movement_type, amount, effective_date)
    values ('bbbbbbbb-0000-0000-0000-000000000001', 'ALLOCATION', 1, '2026-01-15')$$,
  'permission denied', 'ลง movement ตรงไม่ได้ ต้องผ่าน function ที่ล็อกบัญชี');

-- ---------------------------------------------------------------------------
-- ปีงบที่ปิดแล้ว และวันที่นอกช่วง
-- ---------------------------------------------------------------------------
select pg_temp.assert_fails($$
  select public.budget_post_movement(
    'bbbbbbbb-0000-0000-0000-000000000003', 'ALLOCATION', 100.00, '2025-01-15', 'ทดสอบ')
$$, 'ปิดแล้ว', 'ปีงบที่ปิดแล้วปฏิเสธรายการใหม่');

select pg_temp.assert_fails($$
  select public.budget_post_movement(
    'bbbbbbbb-0000-0000-0000-000000000002', 'ALLOCATION', 100.00, '2027-01-15', 'ทดสอบ')
$$, 'อยู่นอกช่วงปีงบประมาณ', 'วันที่นอกช่วงปีงบถูกปฏิเสธ');

-- ---------------------------------------------------------------------------
-- การโอน: ต้องเป็นคู่ ยอดสุทธิศูนย์ และชี้หากัน
-- ---------------------------------------------------------------------------
select public.budget_post_movement(
  'bbbbbbbb-0000-0000-0000-000000000002', 'ALLOCATION', 5000.00, '2026-01-15', 'จัดสรรตั้งต้น B'
);

select public.budget_transfer(
  'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
  1000.00, '2026-02-01', 'โอนสนับสนุนโครงการ'
);

select pg_temp.assert_eq(public.budget_available('bbbbbbbb-0000-0000-0000-000000000002'), 4000.00,
  'บัญชีต้นทางลดลงตามยอดโอน');
select pg_temp.assert_eq(public.budget_available('bbbbbbbb-0000-0000-0000-000000000001'), 1000.00,
  'บัญชีปลายทางเพิ่มขึ้นตามยอดโอน');

select pg_temp.assert_eq(
  (select sum(case when movement_type = 'TRANSFER_IN' then amount else -amount end)
   from public.budget_movements where source_type = 'BUDGET_TRANSFER'),
  0.00, 'ยอดสุทธิของการโอนเป็นศูนย์');

select pg_temp.assert_eq(
  (select count(*) from public.budget_movements a
   join public.budget_movements b on b.id = a.paired_movement_id
   where a.source_type = 'BUDGET_TRANSFER' and b.paired_movement_id = a.id),
  2, 'คู่โอนชี้หากันครบทั้งสองทาง');

select pg_temp.assert_fails($$
  select public.budget_transfer(
    'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
    100.00, '2026-02-01', 'ทดสอบ')
$$, 'บัญชีเดียวกัน', 'โอนเข้าบัญชีเดียวกันไม่ได้');

select pg_temp.assert_fails($$
  select public.budget_transfer(
    'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
    100.00, '2026-02-01', '')
$$, 'ต้องระบุเหตุผล', 'การโอนงบต้องมีเหตุผล');

-- ---------------------------------------------------------------------------
-- audit event เกิดในทรานแซกชันเดียวกับ movement
-- ---------------------------------------------------------------------------
-- ต้องอ่านในฐานะผู้มีสิทธิ์เต็ม เพราะ RLS ของ audit_events กรองตาม audit.read
-- ซึ่งบทบาทการเงินไม่มี การนับในฐานะการเงินจะได้ 0 เสมอไม่ว่าจะเขียนสำเร็จหรือไม่
reset role;

select pg_temp.assert_eq(
  (select count(*) from public.audit_events where entity_type = 'budget_movement'),
  (select count(*) from public.budget_movements),
  'ทุก movement มี audit event คู่กัน');

-- audit ต้องบันทึกยอดคงเหลือหลังลงรายการไว้ด้วย เพื่อให้ตรวจย้อนหลังได้ว่า
-- ตอนนั้นระบบเห็นยอดเท่าไร ไม่ใช่คำนวณใหม่จากข้อมูลปัจจุบัน
select pg_temp.assert_eq(
  (select count(*) from public.audit_events
   where entity_type = 'budget_movement' and metadata_json ? 'available_after'),
  (select count(*) from public.budget_movements),
  'audit ทุกแถวบันทึกยอดคงเหลือหลังลงรายการ');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- RLS: ผู้ที่ไม่มีสิทธิ์งบ อ่านไม่ได้และลงรายการไม่ได้
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select pg_temp.assert_eq((select count(*) from public.budget_accounts), 0,
  'ผู้ไม่มี budget.read มองไม่เห็นบัญชีงบเลย');
select pg_temp.assert_eq((select count(*) from public.budget_movements), 0,
  'ผู้ไม่มี budget.read มองไม่เห็นรายการเคลื่อนไหวเลย');

select pg_temp.assert_fails($$
  select public.budget_post_movement(
    'bbbbbbbb-0000-0000-0000-000000000001', 'ALLOCATION', 100.00, '2026-01-15', 'ทดสอบ')
$$, 'ไม่มีสิทธิ์', 'ผู้ไม่มี budget.manage ลงรายการไม่ได้');

rollback;

\echo 'budget ledger: ทุกกรณีผ่าน'
