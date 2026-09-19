-- =============================================================================
-- ทดสอบฟังก์ชันรวมยอดงบสำหรับรายงานบน PostgreSQL จริง (PR-09a)
--
-- สิ่งที่ unit test พิสูจน์ไม่ได้และต้องรันที่นี่:
--
--   * ยอดที่ฟังก์ชันคืน **ตรงกับ view budget_account_balances ทุกบัญชี**
--     ซึ่งเป็นเกณฑ์ตรวจรับข้อแรกของ PR-09 ("ยอดรวม report เท่ากับ ledger")
--   * granted − reserved − used เท่ากับ available_amount ของ view
--     — พิสูจน์ว่านิยาม "ยอดที่ใช้ได้" ของทั้งสองทางเป็นเลขเดียวกันจริง
--   * ตัวกรองปีงบไม่ปล่อยข้อมูลข้าม scope
--   * ยอด "ณ วันที่" ตัดตามวันมีผล และแถวย้อนยังรู้ชนิดของแถวต้นทางเสมอ
--   * บัญชีที่ยังไม่มีรายการ และบัญชีที่ไม่ได้ผูกโครงการ **ต้องไม่หายไป**
--   * ผู้ไม่มีสิทธิ์ budget.read ได้ศูนย์แถว — RLS เป็นตัวบังคับ ไม่ใช่หน้าจอ
--
-- ใช้ปีงบ พ.ศ. 2500/2501 เพราะ run-reservation-tests.sh **commit** ปีงบที่ครอบ
-- วันนี้ไว้ และ fiscal_years_no_overlap เป็น exclusion constraint
-- ปีที่ห่างออกไปมากจึงเป็นค่าเดียวที่ปลอดภัยไม่ว่าลำดับการรันจะเป็นอย่างไร
-- =============================================================================

\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_eq(actual anyelement, expected anyelement, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL % — ได้ % แต่ต้องการ %', label, actual, expected;
  end if;
  raise notice 'ok   % (%)', label, actual;
end; $$;

-- ---------------------------------------------------------------------------
-- ผู้ใช้สมมติ — การเงินมี budget.read ส่วนผู้ขอไม่มี
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('b1111111-1111-4111-8111-111111111111', 'rp-finance@example.test'),
  ('b2222222-2222-4222-8222-222222222222', 'rp-requester@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('b1111111-1111-4111-8111-111111111111', 'rp-finance@example.test',
   'ทดสอบ', 'การเงิน', true),
  ('b2222222-2222-4222-8222-222222222222', 'rp-requester@example.test',
   'ทดสอบ', 'ผู้ขอ', true);

insert into public.user_roles (user_id, role_code) values
  ('b1111111-1111-4111-8111-111111111111', 'FINANCE'),
  ('b2222222-2222-4222-8222-222222222222', 'REQUESTER');

-- ---------------------------------------------------------------------------
-- ข้อมูลพื้นฐาน — สองปีงบ เพื่อพิสูจน์ว่าตัวกรองปีไม่ปล่อยข้อมูลข้าม scope
-- ---------------------------------------------------------------------------

insert into public.fiscal_years (id, code, year_be, start_date, end_date, status) values
  ('b0000000-0000-4000-8000-0000000000f1', 'FYRP1', 2500, '1956-10-01', '1957-09-30', 'OPEN'),
  ('b0000000-0000-4000-8000-0000000000f2', 'FYRP2', 2501, '1957-10-01', '1958-09-30', 'OPEN');

insert into public.projects (id, code, name_th, fiscal_year_id) values
  ('b0000000-0000-4000-8000-0000000000a1', 'PRJ-RP1', 'โครงการพัฒนาห้องสมุด (ตัวอย่าง)',
   'b0000000-0000-4000-8000-0000000000f1'),
  ('b0000000-0000-4000-8000-0000000000a2', 'PRJ-RP2', 'โครงการอาหารกลางวัน (ตัวอย่าง)',
   'b0000000-0000-4000-8000-0000000000f1'),
  ('b0000000-0000-4000-8000-0000000000a3', 'PRJ-RP3', 'โครงการปีถัดไป (ตัวอย่าง)',
   'b0000000-0000-4000-8000-0000000000f2');

insert into public.funding_sources (id, code, name_th) values
  ('b0000000-0000-4000-8000-0000000000b1', 'FS-RP1', 'เงินอุดหนุนทดสอบ (ตัวอย่าง)'),
  ('b0000000-0000-4000-8000-0000000000b2', 'FS-RP2', 'เงินรายได้ทดสอบ (ตัวอย่าง)');

insert into public.departments (id, code, name_th) values
  ('b0000000-0000-4000-8000-0000000000c1', 'DP-RP1', 'ฝ่ายทดสอบ (ตัวอย่าง)'),
  ('b0000000-0000-4000-8000-0000000000c2', 'DP-RP2', 'ฝ่ายทดสอบสอง (ตัวอย่าง)');

/*
 * บัญชีงบครบทุกรูปทรงที่รายงานต้องรับมือ
 *
 * A3 ผูกกับแหล่งเงินอย่างเดียวไม่มีโครงการ และ A4 ยังไม่มีรายการเคลื่อนไหวเลย
 * สองบัญชีนี้คือรูปทรงที่ทำให้ยอดรวมน้อยกว่าความจริงได้ง่ายที่สุด
 * ถ้าใช้ inner join หรือกรองบัญชีที่ไม่มี movement ทิ้ง
 */
insert into public.budget_accounts
  (id, code, fiscal_year_id, project_id, funding_source_id, department_id, status,
   closed_at) values
  ('b0000000-0000-4000-8000-0000000000d1', 'ACC-RP-A1',
   'b0000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000a1',
   'b0000000-0000-4000-8000-0000000000b1', null, 'OPEN', null),
  ('b0000000-0000-4000-8000-0000000000d2', 'ACC-RP-A2',
   'b0000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000a2',
   null, null, 'OPEN', null),
  ('b0000000-0000-4000-8000-0000000000d3', 'ACC-RP-A3',
   'b0000000-0000-4000-8000-0000000000f1', null,
   'b0000000-0000-4000-8000-0000000000b1', null, 'OPEN', null),
  ('b0000000-0000-4000-8000-0000000000d4', 'ACC-RP-A4',
   'b0000000-0000-4000-8000-0000000000f1', null, null,
   'b0000000-0000-4000-8000-0000000000c1', 'OPEN', null),
  ('b0000000-0000-4000-8000-0000000000d5', 'ACC-RP-A5',
   'b0000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000a1',
   'b0000000-0000-4000-8000-0000000000b2', null, 'OPEN', null),
  ('b0000000-0000-4000-8000-0000000000d6', 'ACC-RP-A6',
   'b0000000-0000-4000-8000-0000000000f2', 'b0000000-0000-4000-8000-0000000000a3',
   null, null, 'OPEN', null),
  ('b0000000-0000-4000-8000-0000000000d7', 'ACC-RP-A7',
   'b0000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000a2',
   'b0000000-0000-4000-8000-0000000000b2', null, 'CLOSED', now()),
  -- ผูกกับฝ่ายงานเพราะบัญชีงบต้องมี scope อย่างน้อยหนึ่งอย่างเสมอ
  ('b0000000-0000-4000-8000-0000000000d8', 'ACC-RP-A8',
   'b0000000-0000-4000-8000-0000000000f1', null, null,
   'b0000000-0000-4000-8000-0000000000c2', 'OPEN', null);

/*
 * ลงรายการตรงลงตาราง ไม่ผ่าน budget_post_movement โดยตั้งใจ
 *
 * ที่นี่ทดสอบ **การอ่าน** ไม่ใช่การเขียน จึงต้องคุมวันที่มีผลและยอดติดลบได้เอง
 * โดยไม่ต้องสร้างสิทธิ์ยกเว้นให้ครบทุกกรณี การเขียนมีชุดทดสอบของตัวเองอยู่แล้ว
 * (budget_ledger_test, budget_integrity_test)
 */
insert into public.budget_movements
  (id, budget_account_id, movement_type, amount, effective_date, reason,
   reverses_movement_id, releases_movement_id) values
  -- A1: ได้ 10,000 กัน 2,000 จ่ายจริง 3,000 → ใช้ได้ 5,000
  ('b0000000-0000-4000-8000-0000000000e1', 'b0000000-0000-4000-8000-0000000000d1',
   'ALLOCATION', 10000.00, '1956-11-01', null, null, null),
  ('b0000000-0000-4000-8000-0000000000e2', 'b0000000-0000-4000-8000-0000000000d1',
   'RESERVE', 2000.00, '1957-01-15', null, null, null),
  ('b0000000-0000-4000-8000-0000000000e3', 'b0000000-0000-4000-8000-0000000000d1',
   'ACTUAL', 3000.00, '1957-02-01', null, null, null),
  -- A2: ได้ 5,000 จ่ายจริง 6,000 → ติดลบ 1,000 (รูปทรงเดียวกับข้อค้นพบ F-01)
  ('b0000000-0000-4000-8000-0000000000e4', 'b0000000-0000-4000-8000-0000000000d2',
   'ALLOCATION', 5000.00, '1956-11-01', null, null, null),
  ('b0000000-0000-4000-8000-0000000000e5', 'b0000000-0000-4000-8000-0000000000d2',
   'ACTUAL', 6000.00, '1957-03-01', null, null, null),
  -- A3: บัญชีที่ไม่มีโครงการ
  ('b0000000-0000-4000-8000-0000000000e6', 'b0000000-0000-4000-8000-0000000000d3',
   'ALLOCATION', 7000.00, '1956-12-01', null, null, null),
  -- A1: ปรับเพิ่ม ปรับลด และคืนยอดที่กันไว้บางส่วน
  ('b0000000-0000-4000-8000-0000000000e0', 'b0000000-0000-4000-8000-0000000000d1',
   'INCREASE', 1000.00, '1957-01-05', 'ได้รับจัดสรรเพิ่ม (ตัวอย่าง)', null, null),
  ('b0000000-0000-4000-8000-0000000000ec', 'b0000000-0000-4000-8000-0000000000d1',
   'DECREASE', 300.00, '1957-01-06', 'ถูกเรียกคืน (ตัวอย่าง)', null, null),
  ('b0000000-0000-4000-8000-0000000000ed', 'b0000000-0000-4000-8000-0000000000d1',
   'RELEASE', 500.00, '1957-02-10', null, null, 'b0000000-0000-4000-8000-0000000000e2'),
  -- A5: โครงการเดียวกับ A1 แต่คนละแหล่งเงิน — พิสูจน์ว่ากลุ่มรวมหลายบัญชีจริง
  ('b0000000-0000-4000-8000-0000000000e7', 'b0000000-0000-4000-8000-0000000000d5',
   'ALLOCATION', 1500.00, '1956-11-15', null, null, null),
  ('b0000000-0000-4000-8000-0000000000ee', 'b0000000-0000-4000-8000-0000000000d5',
   'COMMIT', 400.00, '1957-02-15', null, null, null),
  -- A6: อยู่คนละปีงบ
  ('b0000000-0000-4000-8000-0000000000e8', 'b0000000-0000-4000-8000-0000000000d6',
   'ALLOCATION', 9000.00, '1957-11-01', null, null, null),
  -- A7: บัญชีที่ปิดแล้วแต่ยังถือยอดของปีนั้นไว้
  ('b0000000-0000-4000-8000-0000000000e9', 'b0000000-0000-4000-8000-0000000000d7',
   'ALLOCATION', 1000.00, '1956-11-01', null, null, null);

/*
 * การโอนงบจาก A1 ไป A5 — ต้องเป็นคู่ที่ชี้หากัน
 *
 * ใส่ครบทุกชนิดรายการในชุดทดสอบนี้โดยตั้งใจ เพราะข้อที่เทียบกับ view จับความ
 * ต่างได้เฉพาะชนิดที่มีอยู่จริงในข้อมูล ชนิดที่ไม่มีใครลงไว้เลยจะเปลี่ยนสูตร
 * ผิดได้โดยไม่มี test ใดล้ม
 */
insert into public.budget_movements
  (id, budget_account_id, movement_type, amount, effective_date, reason) values
  ('b0000000-0000-4000-8000-0000000000ef', 'b0000000-0000-4000-8000-0000000000d5',
   'TRANSFER_IN', 200.00, '1957-01-20', 'รับโอนจาก A1 (ตัวอย่าง)');

insert into public.budget_movements
  (id, budget_account_id, movement_type, amount, effective_date, reason,
   paired_movement_id) values
  ('b0000000-0000-4000-8000-00000000000f', 'b0000000-0000-4000-8000-0000000000d1',
   'TRANSFER_OUT', 200.00, '1957-01-20', 'โอนไป A5 (ตัวอย่าง)',
   'b0000000-0000-4000-8000-0000000000ef');

update public.budget_movements
set paired_movement_id = 'b0000000-0000-4000-8000-00000000000f'
where id = 'b0000000-0000-4000-8000-0000000000ef';

/*
 * A8: รายการย้อนที่ลงวันมีผล **ก่อน** แถวที่มันย้อน
 *
 * เกิดได้จริงเมื่อพบภายหลังว่ารายการหนึ่งลงผิด แล้วย้อนโดยใช้วันที่ที่ความผิดพลาด
 * มีผลจริง ไม่ใช่วันที่ค้นพบ — รูปนี้เป็นรูปเดียวที่พิสูจน์ได้ว่า join หาแถวต้นทาง
 * ไม่ถูกกรองด้วย p_as_of ถ้าถูกกรอง แถวย้อนจะกลายเป็นชนิด REVERSAL ที่ไม่เข้ากลุ่มใด
 * แล้วเงินก้อนนั้นจะหายจากยอดเงียบ ๆ
 */
insert into public.budget_movements
  (id, budget_account_id, movement_type, amount, effective_date, reason,
   reverses_movement_id) values
  ('b0000000-0000-4000-8000-0000000000ea', 'b0000000-0000-4000-8000-0000000000d8',
   'ALLOCATION', 4000.00, '1957-05-20', null, null);

insert into public.budget_movements
  (id, budget_account_id, movement_type, amount, effective_date, reason,
   reverses_movement_id) values
  ('b0000000-0000-4000-8000-0000000000eb', 'b0000000-0000-4000-8000-0000000000d8',
   'REVERSAL', 4000.00, '1957-05-10', 'ลงผิดบัญชี ย้อนตามวันที่มีผลจริง (ตัวอย่าง)',
   'b0000000-0000-4000-8000-0000000000ea');

set local role authenticated;
set local request.jwt.claim.sub = 'b1111111-1111-4111-8111-111111111111';

select pg_temp.assert_eq(
  (select public.has_permission('budget.read')), true, 'การเงินมีสิทธิ์อ่านงบ');

-- ---------------------------------------------------------------------------
-- **เกณฑ์ตรวจรับข้อแรก** — ยอดที่รายงานคืนต้องตรงกับ ledger ทุกบัญชี
--
-- เทียบกับ view budget_account_balances ซึ่งเป็นนิยามที่หน้าบัญชีงบใช้อยู่แล้ว
-- ถ้าสองทางนี้ตอบไม่ตรงกัน แปลว่ามีตัวเลขสองชุดในระบบเดียวและไม่มีใครรู้ว่า
-- ชุดไหนถูก — นับแถวที่ไม่ตรง ไม่ใช่ตรวจทีละบัญชี เพื่อให้บัญชีใหม่ที่เพิ่ม
-- ในอนาคตถูกตรวจไปด้วยโดยไม่ต้องแก้ test
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select count(*)::integer
   from public.budget_report_rows() r
   join public.budget_account_balances v on v.budget_account_id = r.budget_account_id
   where r.granted_amount is distinct from v.granted_amount
      or r.reserved_amount is distinct from v.reserved_amount
      or r.used_amount is distinct from v.used_amount),
  0, 'ยอดทุกบัญชีตรงกับ view budget_account_balances');

/*
 * นิยามของ "ยอดที่ใช้ได้" ต้องเป็นผลลบของสามยอดจริง ๆ
 *
 * ใน view ยอดนี้เขียนเป็นสูตรแยกอีกชุดหนึ่ง ไม่ได้ลบจากสามช่องข้างบน
 * จึงเป็นไปได้ที่สองสูตรจะเพี้ยนจากกันเมื่อเพิ่มชนิดรายการใหม่
 * ฝั่งแอปคิดด้วยการลบที่ availableOf() จุดเดียว — ข้อนี้ยืนยันว่าทั้งสองตรงกัน
 */
select pg_temp.assert_eq(
  (select count(*)::integer
   from public.budget_report_rows() r
   join public.budget_account_balances v on v.budget_account_id = r.budget_account_id
   where (r.granted_amount - r.reserved_amount - r.used_amount)
         is distinct from v.available_amount),
  0, 'granted − reserved − used เท่ากับ available_amount ของ view ทุกบัญชี');

-- ---------------------------------------------------------------------------
-- ยอดรายบัญชีตามที่ตั้งใจ
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select r.granted_amount from public.budget_report_rows() r
   where r.account_code = 'ACC-RP-A1'), 10500.00,
  'A1 งบที่ได้รับ = จัดสรร 10,000 + เพิ่ม 1,000 − ลด 300 − โอนออก 200');

select pg_temp.assert_eq(
  (select r.reserved_amount from public.budget_report_rows() r
   where r.account_code = 'ACC-RP-A1'), 1500.00,
  'A1 ยอดที่กันไว้ = กัน 2,000 − คืน 500');

select pg_temp.assert_eq(
  (select r.used_amount from public.budget_report_rows() r
   where r.account_code = 'ACC-RP-A1'), 3000.00, 'A1 ยอดที่ใช้ไป');

select pg_temp.assert_eq(
  (select r.project_name from public.budget_report_rows() r
   where r.account_code = 'ACC-RP-A1'), 'โครงการพัฒนาห้องสมุด (ตัวอย่าง)',
  'ชื่อโครงการถูกดึงมาให้รายงานจัดกลุ่ม');

-- ยอดติดลบต้องแสดงออกมาเป็นค่าติดลบ ไม่ถูกปัดเป็นศูนย์ (ข้อค้นพบ F-01)
select pg_temp.assert_eq(
  (select r.granted_amount - r.reserved_amount - r.used_amount
   from public.budget_report_rows() r where r.account_code = 'ACC-RP-A2'),
  -1000.00, 'A2 ยอดคงเหลือติดลบถูกรายงานตามจริง');

-- ---------------------------------------------------------------------------
-- **บัญชีที่หายง่ายที่สุด** — ไม่มีรายการเลย และไม่ได้ผูกโครงการ
--
-- ทั้งสองรูปนี้ยังต้องอยู่ในผลลัพธ์ มิฉะนั้นยอดรวมของรายงานจะน้อยกว่าความจริง
-- โดยที่หน้าจอดูปกติทุกอย่าง ซึ่งเป็นความเงียบที่อันตรายที่สุดของรายงาน
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select r.granted_amount from public.budget_report_rows() r
   where r.account_code = 'ACC-RP-A4'), 0.00,
  'บัญชีที่ยังไม่มีรายการยังอยู่ในผลลัพธ์ด้วยยอดศูนย์');

select pg_temp.assert_eq(
  (select r.project_id is null from public.budget_report_rows() r
   where r.account_code = 'ACC-RP-A3'), true,
  'บัญชีที่ไม่ได้ผูกโครงการยังอยู่ในผลลัพธ์');

select pg_temp.assert_eq(
  (select r.granted_amount from public.budget_report_rows() r
   where r.account_code = 'ACC-RP-A3'), 7000.00,
  'ยอดของบัญชีที่ไม่ได้ผูกโครงการยังถูกนับ');

-- ---------------------------------------------------------------------------
-- ตัวกรองปีงบ — ไม่มีข้อมูลข้าม scope
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select count(*)::integer from public.budget_report_rows(
     'b0000000-0000-4000-8000-0000000000f1') r
   where r.account_code like 'ACC-RP-%'),
  7, 'กรองปีงบแรกได้ 7 บัญชี');

select pg_temp.assert_eq(
  (select count(*)::integer from public.budget_report_rows(
     'b0000000-0000-4000-8000-0000000000f1') r
   where r.account_code = 'ACC-RP-A6'),
  0, 'บัญชีของอีกปีงบไม่หลุดเข้ามา');

select pg_temp.assert_eq(
  (select r.fiscal_year_code from public.budget_report_rows(
     'b0000000-0000-4000-8000-0000000000f2') r
   where r.account_code = 'ACC-RP-A6'),
  'FYRP2', 'กรองปีงบที่สองได้บัญชีของปีนั้น');

-- ---------------------------------------------------------------------------
-- เฉพาะบัญชีที่เปิดอยู่
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select count(*)::integer from public.budget_report_rows(null, null, true) r
   where r.account_code = 'ACC-RP-A7'),
  0, 'บัญชีที่ปิดแล้วถูกตัดออกเมื่อเลือกเฉพาะที่เปิดอยู่');

select pg_temp.assert_eq(
  (select count(*)::integer from public.budget_report_rows() r
   where r.account_code = 'ACC-RP-A7'),
  1, 'ค่าเริ่มต้นยังนับบัญชีที่ปิดแล้ว จึงไม่ทำให้ยอดรวมหายไป');

-- ---------------------------------------------------------------------------
-- ยอด ณ วันที่ — ตัดตามวันมีผล
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select r.granted_amount from public.budget_report_rows(null, '1956-12-31') r
   where r.account_code = 'ACC-RP-A1'), 10000.00,
  'ยอด ณ 31 ธ.ค. นับรายการจัดสรรที่ลงก่อนหน้า');

select pg_temp.assert_eq(
  (select r.reserved_amount from public.budget_report_rows(null, '1956-12-31') r
   where r.account_code = 'ACC-RP-A1'), 0.00,
  'ยอด ณ 31 ธ.ค. ยังไม่นับการกันยอดที่มีผลปีถัดไป');

select pg_temp.assert_eq(
  (select r.used_amount from public.budget_report_rows(null, '1957-02-01') r
   where r.account_code = 'ACC-RP-A1'), 3000.00,
  'วันตัดยอดนับรวมรายการที่มีผลวันนั้นพอดี');

-- ---------------------------------------------------------------------------
-- **แถวย้อนต้องรู้ชนิดของแถวต้นทางเสมอ แม้แถวต้นทางจะอยู่นอกช่วงวันที่**
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select r.granted_amount from public.budget_report_rows(null, '1957-05-15') r
   where r.account_code = 'ACC-RP-A8'), -4000.00,
  'แถวย้อนที่อยู่ในช่วงยังหักยอดได้ แม้แถวต้นทางจะอยู่นอกช่วง');

select pg_temp.assert_eq(
  (select r.granted_amount from public.budget_report_rows(null, '1957-05-25') r
   where r.account_code = 'ACC-RP-A8'), 0.00,
  'เมื่อทั้งคู่อยู่ในช่วง ยอดหักล้างกันเป็นศูนย์');

select pg_temp.assert_eq(
  (select r.granted_amount from public.budget_report_rows() r
   where r.account_code = 'ACC-RP-A8'), 0.00,
  'เมื่อไม่จำกัดวันที่ ยอดหักล้างกันเป็นศูนย์');

-- ---------------------------------------------------------------------------
-- **RLS เป็นตัวบังคับสิทธิ์ ไม่ใช่หน้าจอ**
--
-- ยอดงบทั้งโรงเรียนรวมอยู่ในคำตอบเดียว จึงเป็นสิ่งที่ไม่ควรหลุดไปหาผู้ไม่มีสิทธิ์
-- มากที่สุดในบรรดาข้อมูลที่ระบบนี้มี
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'b2222222-2222-4222-8222-222222222222';

select pg_temp.assert_eq(
  (select public.has_permission('budget.read')), false, 'ผู้ขอไม่มีสิทธิ์อ่านงบ');

select pg_temp.assert_eq(
  (select count(*)::integer from public.budget_report_rows()),
  0, 'ผู้ไม่มีสิทธิ์อ่านงบได้ศูนย์แถว');

select pg_temp.assert_eq(
  (select count(*)::integer from public.budget_report_rows(
     'b0000000-0000-4000-8000-0000000000f1')),
  0, 'ผู้ไม่มีสิทธิ์ระบุปีงบเองก็ยังได้ศูนย์แถว');

/*
 * ข้อที่ทำให้สองข้อบนมีความหมาย
 *
 * ถ้าฟังก์ชันถูกเปลี่ยนเป็น security definer วันหนึ่ง สองข้อบนจะกลายเป็นเท็จทันที
 * และไม่มีอะไรอื่นในระบบที่ฟ้อง เพราะ definer เป็นค่าที่ function อื่นในโปรเจกต์นี้
 * ใช้กันเป็นปกติ — จึงตรวจตรง ๆ ที่ catalog
 */
reset role;
select pg_temp.assert_eq(
  (select p.prosecdef from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'budget_report_rows'),
  false, 'ฟังก์ชันเป็น security invoker เพื่อให้ RLS เป็นตัวบังคับ');

rollback;
