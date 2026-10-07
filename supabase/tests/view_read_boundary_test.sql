-- =============================================================================
-- ทดสอบ F-06 — view และฟังก์ชันอ่านต้องไม่ข้ามสิทธิ์/RLS ที่ตารางตั้งไว้
--
-- เดิม view ทั้งสี่ตัวรันด้วยสิทธิ์เจ้าของ ผู้ใช้ที่ login แล้วทุกคนอ่านยอดของทุกรายการได้
-- แม้ไม่มีสิทธิ์อ่านรายการนั้น และ anon/PUBLIC มี execute ฟังก์ชันใน public โดยค่าเริ่มต้น
--
-- ชุดนี้พิสูจน์:
--   * view ทั้งสี่ตัวเป็น security_invoker และให้ผลตามสิทธิ์ของผู้เรียกจริง
--     (ไม่มีสิทธิ์ = 0 แถว, read.own = เฉพาะของตน, read.all = ทั้งหมด)
--   * budget_available() / stock_on_hand() เป็นฟังก์ชันภายใน client เรียกตรงไม่ได้
--   * anon ไม่มีสิทธิ์ execute ฟังก์ชันใดเลยใน schema public และไม่มีสิทธิ์ใน
--     ตาราง/view/sequence ใด ๆ — ตรวจทั้ง schema เพื่อให้ฟังก์ชันที่เพิ่มในอนาคตแล้วลืม revoke
--     ทำให้ CI แดง (บน Supabase จริง anon ได้ execute เป็นค่าเริ่มต้น)
--   * RPC ธุรกรรมที่อ่าน view ภายในยังทำงานในนามผู้ใช้ที่ไม่มีสิทธิ์อ่าน view โดยตรง
--     (ครอบคลุมใน procurement_submit_test / budget tests ที่รันในนาม requester)
--
-- ใช้ปีงบ พ.ศ. 2540/2541 (ไม่ซ้ำกับ test อื่น และห่างจากปีที่ครอบวันนี้)
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
-- ผู้ใช้สมมติ: ไม่มีสิทธิ์เลย / ผู้ขอ (read.own) / เจ้าหน้าที่พัสดุ (read.all + budget.read +
-- inventory.read) / เจ้าหน้าที่คลัง / ผู้ขอคนที่สอง (เจ้าของรายการอีกใบ)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('d1111111-1111-4111-8111-111111111111', 'vb-nobody@example.test'),
  ('d2222222-2222-4222-8222-222222222222', 'vb-requester@example.test'),
  ('d3333333-3333-4333-8333-333333333333', 'vb-officer@example.test'),
  ('d4444444-4444-4444-8444-444444444444', 'vb-stock@example.test'),
  ('d5555555-5555-4555-8555-555555555555', 'vb-requester2@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('d1111111-1111-4111-8111-111111111111', 'vb-nobody@example.test', 'ทดสอบ', 'ไม่มีสิทธิ์', true),
  ('d2222222-2222-4222-8222-222222222222', 'vb-requester@example.test', 'ทดสอบ', 'ผู้ขอ', true),
  ('d3333333-3333-4333-8333-333333333333', 'vb-officer@example.test', 'ทดสอบ', 'พัสดุ', true),
  ('d4444444-4444-4444-8444-444444444444', 'vb-stock@example.test', 'ทดสอบ', 'คลัง', true),
  ('d5555555-5555-4555-8555-555555555555', 'vb-requester2@example.test', 'ทดสอบ', 'ผู้ขอสอง', true);

insert into public.user_roles (user_id, role_code) values
  ('d2222222-2222-4222-8222-222222222222', 'REQUESTER'),
  ('d3333333-3333-4333-8333-333333333333', 'PROCUREMENT_OFFICER'),
  ('d4444444-4444-4444-8444-444444444444', 'INVENTORY_OFFICER'),
  ('d5555555-5555-4555-8555-555555555555', 'REQUESTER');

insert into public.fiscal_years (id, code, year_be, start_date, end_date, status) values
  ('d0000000-0000-4000-8000-0000000000f1', 'FYVB1', 2540, '1996-10-01', '1997-09-30', 'OPEN');

insert into public.departments (id, code, name_th) values
  ('d0000000-0000-4000-8000-0000000000d1', 'DP-VB1', 'ฝ่ายทดสอบ (ตัวอย่าง)');

insert into public.budget_accounts (id, code, fiscal_year_id, department_id, status) values
  ('d0000000-0000-4000-8000-0000000000b1', 'ACC-VB1',
   'd0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000d1', 'OPEN');

insert into public.budget_movements (id, budget_account_id, movement_type, amount, effective_date) values
  ('d0000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-0000000000b1',
   'ALLOCATION', 10000.00, '1996-11-01');

-- สองรายการจัดซื้อ: ของผู้ขอ (d2) และของผู้ขอสอง (d5)
insert into public.procurements
  (id, reference, subject, status, classification, procurement_method, is_emergency,
   fiscal_year_id, request_date, created_by)
values
  ('d0000000-0000-4000-8000-0000000000c1', 'VB-0001', 'รายการของผู้ขอ (ตัวอย่าง)',
   'DRAFT', 'GOODS', 'SPECIFIC', false, 'd0000000-0000-4000-8000-0000000000f1',
   '1996-12-01', 'd2222222-2222-4222-8222-222222222222'),
  ('d0000000-0000-4000-8000-0000000000c2', 'VB-0002', 'รายการของผู้ขอสอง (ตัวอย่าง)',
   'DRAFT', 'GOODS', 'SPECIFIC', false, 'd0000000-0000-4000-8000-0000000000f1',
   '1996-12-02', 'd5555555-5555-4555-8555-555555555555');

insert into public.procurement_items (procurement_id, line_no, description, quantity, unit_price) values
  ('d0000000-0000-4000-8000-0000000000c1', 1, 'กระดาษ (ตัวอย่าง)', 10, 100),
  ('d0000000-0000-4000-8000-0000000000c2', 1, 'หมึก (ตัวอย่าง)', 2, 250);

insert into public.procurement_funding_allocations (procurement_id, budget_account_id, line_no, amount) values
  ('d0000000-0000-4000-8000-0000000000c1', 'd0000000-0000-4000-8000-0000000000b1', 1, 1000),
  ('d0000000-0000-4000-8000-0000000000c2', 'd0000000-0000-4000-8000-0000000000b1', 1, 500);

insert into public.units (id, code, name_th) values
  ('d0000000-0000-4000-8000-0000000000a0', 'UNIT-VB', 'ชิ้น (ทดสอบ)');
insert into public.inventory_items (id, code, name_th, unit_id) values
  ('d0000000-0000-4000-8000-0000000000a1', 'INV-VB-1', 'พัสดุทดสอบ (ตัวอย่าง)',
   'd0000000-0000-4000-8000-0000000000a0');
insert into public.stock_movements
  (item_id, sequence_no, movement_type, quantity, balance_after, effective_date, reference) values
  ('d0000000-0000-4000-8000-0000000000a1', 1, 'OPENING_BALANCE', 5, 5, '1996-11-01', 'ยกมา-VB');

-- ---------------------------------------------------------------------------
-- 1) view เป็น security_invoker ทั้งสี่ตัว (ตรวจที่ catalog — ตัวที่ลืมตั้งจะทำให้ข้อถัดไปรั่วเงียบ ๆ)
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select count(*)::integer from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and coalesce('security_invoker=true' = any (c.reloptions), false)),
  (select count(*)::integer from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'),
  'view ทุกตัวใน public เป็น security_invoker');

select pg_temp.assert_eq(
  (select count(*)::integer from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and c.relname in ('procurement_item_amounts', 'procurement_totals',
                       'budget_account_balances', 'stock_item_balances')),
  4, 'view ทั้งสี่ตัวที่ F-06 ระบุอยู่ครบ');

-- ---------------------------------------------------------------------------
-- 2) ผู้ไม่มีสิทธิ์อะไรเลย: ทุก view ว่าง
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'd1111111-1111-4111-8111-111111111111';

select pg_temp.assert_eq((select count(*)::integer from public.procurement_totals), 0,
  'ไม่มีสิทธิ์: procurement_totals ว่าง');
select pg_temp.assert_eq((select count(*)::integer from public.procurement_item_amounts), 0,
  'ไม่มีสิทธิ์: procurement_item_amounts ว่าง');
select pg_temp.assert_eq((select count(*)::integer from public.budget_account_balances), 0,
  'ไม่มีสิทธิ์: budget_account_balances ว่าง');
select pg_temp.assert_eq((select count(*)::integer from public.stock_item_balances), 0,
  'ไม่มีสิทธิ์: stock_item_balances ว่าง');

-- ---------------------------------------------------------------------------
-- 3) ผู้ขอ (read.own): เห็นเฉพาะรายการของตน ไม่เห็นของคนอื่น และไม่เห็นงบ/คลัง
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'd2222222-2222-4222-8222-222222222222';

select pg_temp.assert_eq(
  (select array_agg(procurement_id::text order by procurement_id) from public.procurement_totals),
  array['d0000000-0000-4000-8000-0000000000c1'],
  'read.own: procurement_totals เห็นเฉพาะรายการของตน');
select pg_temp.assert_eq(
  (select grand_total from public.procurement_totals
   where procurement_id = 'd0000000-0000-4000-8000-0000000000c1'),
  1000.00::numeric(18, 2), 'read.own: ยอดของรายการตนเองถูกต้อง (ไม่เพี้ยนจากการกรอง)');
select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_item_amounts
   where procurement_id = 'd0000000-0000-4000-8000-0000000000c2'),
  0, 'read.own: ยอดรายการย่อยของรายการคนอื่นไม่ถูกเปิด');
select pg_temp.assert_eq((select count(*)::integer from public.budget_account_balances), 0,
  'ผู้ขอไม่มี budget.read: budget_account_balances ว่าง');
select pg_temp.assert_eq((select count(*)::integer from public.stock_item_balances), 0,
  'ผู้ขอไม่มี inventory.read: stock_item_balances ว่าง');

-- ---------------------------------------------------------------------------
-- 4) เจ้าหน้าที่พัสดุ (read.all + budget.read + inventory.read): เห็นครบ
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'd3333333-3333-4333-8333-333333333333';

select pg_temp.assert_eq((select count(*)::integer from public.procurement_totals
                          where procurement_id in ('d0000000-0000-4000-8000-0000000000c1',
                                                   'd0000000-0000-4000-8000-0000000000c2')),
  2, 'read.all: procurement_totals เห็นทั้งสองรายการ');
select pg_temp.assert_eq(
  (select available_amount from public.budget_account_balances
   where budget_account_id = 'd0000000-0000-4000-8000-0000000000b1'),
  10000.00::numeric, 'budget.read: เห็นยอดงบ');
select pg_temp.assert_eq(
  (select on_hand from public.stock_item_balances
   where item_id = 'd0000000-0000-4000-8000-0000000000a1'),
  5::numeric, 'inventory.read: เห็นยอดสต็อก');

-- ---------------------------------------------------------------------------
-- 5) เจ้าหน้าที่คลัง: เห็นสต็อก แต่ไม่เห็นยอดงบ (ไม่มี budget.read)
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'd4444444-4444-4444-8444-444444444444';

select pg_temp.assert_eq((select count(*)::integer from public.stock_item_balances), 1,
  'เจ้าหน้าที่คลังเห็นสต็อก');
select pg_temp.assert_eq((select count(*)::integer from public.budget_account_balances), 0,
  'เจ้าหน้าที่คลังไม่มี budget.read: budget_account_balances ว่าง');

-- ---------------------------------------------------------------------------
-- 6) ฟังก์ชันภายใน client เรียกตรงไม่ได้ (แม้มีสิทธิ์อ่าน — ต้องอ่านผ่าน view)
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'd3333333-3333-4333-8333-333333333333';

select pg_temp.assert_fails(
  $$ select public.budget_available('d0000000-0000-4000-8000-0000000000b1') $$,
  'permission denied', 'budget_available เรียกตรงจาก authenticated ไม่ได้');
select pg_temp.assert_fails(
  $$ select public.stock_on_hand('d0000000-0000-4000-8000-0000000000a1') $$,
  'permission denied', 'stock_on_hand เรียกตรงจาก authenticated ไม่ได้');

reset role;

-- เจ้าของ (RPC แบบ definer) ยังเรียกใช้ภายในได้
select pg_temp.assert_eq(public.budget_available('d0000000-0000-4000-8000-0000000000b1'),
  10000.00::numeric, 'budget_available ยังใช้ภายในได้ (เจ้าของ/definer)');
select pg_temp.assert_eq(public.stock_on_hand('d0000000-0000-4000-8000-0000000000a1'),
  5::numeric, 'stock_on_hand ยังใช้ภายในได้ (เจ้าของ/definer)');

-- ---------------------------------------------------------------------------
-- 7) anon: ไม่มีสิทธิ์อะไรเลยใน schema public — ตรวจทั้ง schema
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', '), '')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'execute')),
  '', 'anon ไม่มีสิทธิ์ execute ฟังก์ชันใดใน public');

select pg_temp.assert_eq(
  (select coalesce(string_agg(c.relname, ', '), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
     and (has_table_privilege('anon', c.oid, 'select')
       or has_table_privilege('anon', c.oid, 'insert')
       or has_table_privilege('anon', c.oid, 'update')
       or has_table_privilege('anon', c.oid, 'delete'))),
  '', 'anon ไม่มีสิทธิ์ในตาราง/view ใดใน public');

select pg_temp.assert_eq(
  (select coalesce(string_agg(c.relname, ', '), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S'
     and (has_sequence_privilege('anon', c.oid, 'usage')
       or has_sequence_privilege('anon', c.oid, 'select'))),
  '', 'anon ไม่มีสิทธิ์ในลำดับ (sequence) ใดใน public');

-- authenticated ยังเรียกฟังก์ชันที่แอปต้องใช้ได้ (การเพิกถอนไม่ทำให้ผู้ใช้ที่ login แล้วเสียสิทธิ์)
select pg_temp.assert_eq(
  (select count(*)::integer from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('has_permission', 'current_profile_is_active', 'can_read_procurement',
                       'can_edit_procurement', 'record_audit_event', 'procurement_submit',
                       'procurement_transition', 'budget_post_movement', 'stock_post_movement',
                       'procurement_register_result')
     and has_function_privilege('authenticated', p.oid, 'execute')),
  10, 'ฟังก์ชันหลักที่แอปเรียกยัง execute ได้โดย authenticated');

rollback;
