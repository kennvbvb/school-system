-- =============================================================================
-- ทดสอบกฎความถูกต้องของ ledger ที่เพิ่มใน migration 0009
--
-- ทุกกรณีในไฟล์นี้ **เคยผ่านได้จริง** ก่อน migration 0009 เพราะกฎเหล่านี้อยู่
-- เฉพาะใน src/domain/budget/movement.ts ซึ่งเลี่ยงได้ด้วยการเรียก RPC ตรง
--
-- รันหลัง migration และ seed ทั้งสองไฟล์ ดู .github/workflows/ci.yml
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-4111-811111111111', 'integrity-finance@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('11111111-1111-1111-4111-811111111111', 'integrity-finance@example.test',
   'ทดสอบ', 'ความถูกต้อง', true);

insert into public.user_roles (user_id, role_code) values
  ('11111111-1111-1111-4111-811111111111', 'FINANCE');

insert into public.fiscal_years (id, code, year_be, start_date, end_date, status) values
  ('aaaaaaaa-0000-0000-4000-800000000011', 'FYINT', 2599, '2055-10-01', '2056-09-30', 'OPEN');

insert into public.projects (id, code, name_th, fiscal_year_id) values
  ('cccccccc-0000-0000-4000-800000000011', 'PRJ-INT-A', 'โครงการทดสอบ ก (ตัวอย่าง)',
   'aaaaaaaa-0000-0000-4000-800000000011'),
  ('cccccccc-0000-0000-4000-800000000012', 'PRJ-INT-B', 'โครงการทดสอบ ข (ตัวอย่าง)',
   'aaaaaaaa-0000-0000-4000-800000000011'),
  ('cccccccc-0000-0000-4000-800000000013', 'PRJ-INT-C', 'โครงการทดสอบ ค (ตัวอย่าง)',
   'aaaaaaaa-0000-0000-4000-800000000011');

insert into public.budget_accounts (id, code, fiscal_year_id, project_id) values
  ('bbbbbbbb-0000-0000-4000-800000000011', 'ACC-INT-A',
   'aaaaaaaa-0000-0000-4000-800000000011', 'cccccccc-0000-0000-4000-800000000011'),
  ('bbbbbbbb-0000-0000-4000-800000000012', 'ACC-INT-B',
   'aaaaaaaa-0000-0000-4000-800000000011', 'cccccccc-0000-0000-4000-800000000012'),
  -- บัญชีแยกสำหรับกรณีย้อนรายการ เพื่อไม่ให้ผลของการโอนในหัวข้อก่อนหน้า
  -- ทำให้การย้อนถูกปฏิเสธด้วยเหตุผล "ยอดไม่พอ" แทนเหตุผลที่กำลังทดสอบ
  ('bbbbbbbb-0000-0000-4000-800000000013', 'ACC-INT-C',
   'aaaaaaaa-0000-0000-4000-800000000011', 'cccccccc-0000-0000-4000-800000000013');

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

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-4111-811111111111';

select public.budget_post_movement(
  'bbbbbbbb-0000-0000-4000-800000000011', 'ALLOCATION', 10000.00, '2056-01-15', 'จัดสรรตั้งต้น'
);

-- ---------------------------------------------------------------------------
-- 1. โอนงบขาข้างเดียว
--
-- ก่อน migration 0009 คำสั่งนี้สำเร็จ ผลคือบัญชีได้งบเพิ่ม 5,000 โดยไม่มีบัญชีใด
-- ถูกหักคู่กัน เท่ากับสร้างเงินขึ้นจากระบบ
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails($$
  select public.budget_post_movement(
    'bbbbbbbb-0000-0000-4000-800000000012', 'TRANSFER_IN', 5000.00, '2056-01-15', 'รับโอน'
  )
$$, 'ต้องทำผ่าน budget_transfer', 'ลง TRANSFER_IN ขาเดียวไม่ได้');

select pg_temp.assert_fails($$
  select public.budget_post_movement(
    'bbbbbbbb-0000-0000-4000-800000000011', 'TRANSFER_OUT', 1000.00, '2056-01-15', 'โอนออก'
  )
$$, 'ต้องทำผ่าน budget_transfer', 'ลง TRANSFER_OUT ขาเดียวไม่ได้');

select pg_temp.assert_eq(
  public.budget_available('bbbbbbbb-0000-0000-4000-800000000012'), 0.00,
  'บัญชีปลายทางยังไม่มีงบหลังการโอนขาเดียวถูกปฏิเสธ');

-- การโอนที่ถูกต้องยังทำได้เหมือนเดิม — เครื่องหมายไม่ได้ปิดเส้นทางที่ถูกต้อง
select public.budget_transfer(
  'bbbbbbbb-0000-0000-4000-800000000011', 'bbbbbbbb-0000-0000-4000-800000000012',
  2000.00, '2056-01-15', 'โอนงบตามบันทึกข้อความ (ตัวอย่าง)'
);

select pg_temp.assert_eq(
  public.budget_available('bbbbbbbb-0000-0000-4000-800000000011'), 8000.00,
  'บัญชีต้นทางลดลงตามยอดที่โอน');
select pg_temp.assert_eq(
  public.budget_available('bbbbbbbb-0000-0000-4000-800000000012'), 2000.00,
  'บัญชีปลายทางเพิ่มขึ้นตามยอดที่โอน');

/*
 * เครื่องหมายต้องหมดผลหลังการโอนจบ
 *
 * ถ้าปล่อยค้าง การเรียกครั้งถัดไปในทรานแซกชันเดียวกัน (ซึ่งเป็นสิ่งที่เกิดขึ้น
 * จริงเมื่อ server action ทำหลายอย่างต่อกัน) จะลง TRANSFER ขาเดียวได้
 */
select pg_temp.assert_fails($$
  select public.budget_post_movement(
    'bbbbbbbb-0000-0000-4000-800000000012', 'TRANSFER_IN', 500.00, '2056-01-15', 'รับโอน'
  )
$$, 'ต้องทำผ่าน budget_transfer', 'เครื่องหมายการโอนหมดผลทันทีหลังโอนเสร็จ');

-- ---------------------------------------------------------------------------
-- 2. การย้อนรายการ
-- ---------------------------------------------------------------------------

/*
 * จัดสรรสองรอบ เพื่อให้ยอดยังเหลือพอหลังย้อนรอบแรก
 *
 * ถ้าจัดสรรรอบเดียว การย้อนซ้ำจะถูกปฏิเสธด้วยเหตุผล "ยอดไม่พอ" ตั้งแต่ก่อนถึง
 * unique index ทำให้ test ผ่านด้วยเหตุผลผิด และไม่ได้พิสูจน์ว่า index ทำงาน
 */
select public.budget_post_movement(
  'bbbbbbbb-0000-0000-4000-800000000013', 'ALLOCATION', 3000.00, '2056-01-15', 'จัดสรรตั้งต้น'
);
select public.budget_post_movement(
  'bbbbbbbb-0000-0000-4000-800000000013', 'INCREASE', 5000.00, '2056-01-15', 'ได้รับจัดสรรเพิ่ม'
);

-- ย้อนรายการของบัญชีอื่นไม่ได้ — ก่อน 0009 ทำได้ และทำให้ยอดสองบัญชีเพี้ยนพร้อมกัน
select pg_temp.assert_fails(
  format($$
    select public.budget_post_movement(
      'bbbbbbbb-0000-0000-4000-800000000013', 'REVERSAL', 10000.00, '2056-01-15',
      'ย้อนข้ามบัญชี', null, null, null, %L
    )
  $$, (select id from public.budget_movements
       where budget_account_id = 'bbbbbbbb-0000-0000-4000-800000000011'
         and movement_type = 'ALLOCATION')),
  'บัญชีงบเดียวกัน', 'ย้อนรายการของบัญชีอื่นไม่ได้');

-- การย้อนต้องมีเหตุผล เพราะแถวที่ถูกย้อนยังอยู่ในรายงานและผู้อ่านต้องรู้ว่าทำไม
select pg_temp.assert_fails(
  format($$
    select public.budget_post_movement(
      'bbbbbbbb-0000-0000-4000-800000000013', 'REVERSAL', 3000.00, '2056-01-15',
      null, null, null, null, %L
    )
  $$, (select id from public.budget_movements
       where budget_account_id = 'bbbbbbbb-0000-0000-4000-800000000013'
         and movement_type = 'ALLOCATION')),
  'ต้องระบุเหตุผล', 'การย้อนรายการต้องมีเหตุผล');

-- ย้อนการจัดสรรที่ลงผิดได้ และยอดลดลงเท่าที่ย้อน ไม่ใช่ถูกหักซ้ำ
select public.budget_post_movement(
  'bbbbbbbb-0000-0000-4000-800000000013', 'REVERSAL', 3000.00, '2056-01-15',
  'ย้อนการจัดสรรที่ลงผิด', null, null, null,
  (select id from public.budget_movements
   where budget_account_id = 'bbbbbbbb-0000-0000-4000-800000000013'
     and movement_type = 'ALLOCATION')
);

select pg_temp.assert_eq(
  public.budget_available('bbbbbbbb-0000-0000-4000-800000000013'), 5000.00,
  'ย้อนการจัดสรรแล้วเหลือเฉพาะยอดที่จัดสรรเพิ่ม');

-- ย้อนรายการย้อนอีกชั้นไม่ได้ — ไล่ต้นทางไม่จบและทิศทางตีความไม่ได้
select pg_temp.assert_fails(
  format($$
    select public.budget_post_movement(
      'bbbbbbbb-0000-0000-4000-800000000013', 'REVERSAL', 3000.00, '2056-01-15',
      'ย้อนซ้อน', null, null, null, %L
    )
  $$, (select id from public.budget_movements
       where budget_account_id = 'bbbbbbbb-0000-0000-4000-800000000013'
         and movement_type = 'REVERSAL')),
  'ย้อนรายการย้อนอีกชั้นไม่ได้', 'ย้อนรายการย้อนอีกชั้นไม่ได้');

-- ย้อนแถวเดิมซ้ำครั้งที่สองไม่ได้ (unique index จาก migration 0005)
select pg_temp.assert_fails(
  format($$
    select public.budget_post_movement(
      'bbbbbbbb-0000-0000-4000-800000000013', 'REVERSAL', 3000.00, '2056-01-15',
      'ย้อนซ้ำ', null, null, null, %L
    )
  $$, (select id from public.budget_movements
       where budget_account_id = 'bbbbbbbb-0000-0000-4000-800000000013'
         and movement_type = 'ALLOCATION')),
  'budget_movements_single_reversal', 'ย้อนรายการเดิมซ้ำไม่ได้');

-- ---------------------------------------------------------------------------
-- 3. การคืนยอด
-- ---------------------------------------------------------------------------

select public.budget_post_movement(
  'bbbbbbbb-0000-0000-4000-800000000012', 'RESERVE', 1500.00, '2056-01-15', 'กันยอด'
);

-- คืนยอดให้รายการที่ไม่ใช่การกันยอดไม่ได้
select pg_temp.assert_fails(
  format($$
    select public.budget_post_movement(
      'bbbbbbbb-0000-0000-4000-800000000012', 'RELEASE', 100.00, '2056-01-15',
      'คืนยอด', null, null, null, null, %L
    )
  $$, (select id from public.budget_movements
       where budget_account_id = 'bbbbbbbb-0000-0000-4000-800000000012'
         and movement_type = 'TRANSFER_IN')),
  'รายการกันยอดของบัญชีงบเดียวกัน', 'คืนยอดให้รายการที่ไม่ใช่การกันยอดไม่ได้');

-- คืนเกินยอดที่กันไว้ไม่ได้ — ยอดที่คืนเกินจะกลายเป็นงบที่งอกจากรายการที่ไม่มีจริง
select pg_temp.assert_fails(
  format($$
    select public.budget_post_movement(
      'bbbbbbbb-0000-0000-4000-800000000012', 'RELEASE', 1500.01, '2056-01-15',
      'คืนยอดเกิน', null, null, null, null, %L
    )
  $$, (select id from public.budget_movements
       where budget_account_id = 'bbbbbbbb-0000-0000-4000-800000000012'
         and movement_type = 'RESERVE')),
  'คืนยอดเกินจำนวนที่กันไว้ไม่ได้', 'คืนยอดเกินจำนวนที่กันไว้ไม่ได้');

-- คืนบางส่วนสองครั้งรวมกันเกินก็ไม่ได้ — สะสมจากทุกครั้ง ไม่ใช่ดูครั้งล่าสุด
select public.budget_post_movement(
  'bbbbbbbb-0000-0000-4000-800000000012', 'RELEASE', 1000.00, '2056-01-15',
  'คืนยอดบางส่วน', null, null, null, null,
  (select id from public.budget_movements
   where budget_account_id = 'bbbbbbbb-0000-0000-4000-800000000012'
     and movement_type = 'RESERVE')
);

select pg_temp.assert_fails(
  format($$
    select public.budget_post_movement(
      'bbbbbbbb-0000-0000-4000-800000000012', 'RELEASE', 600.00, '2056-01-15',
      'คืนยอดส่วนที่เหลือเกิน', null, null, null, null, %L
    )
  $$, (select id from public.budget_movements
       where budget_account_id = 'bbbbbbbb-0000-0000-4000-800000000012'
         and movement_type = 'RESERVE')),
  'คืนยอดเกินจำนวนที่กันไว้ไม่ได้', 'คืนยอดสะสมเกินจำนวนที่กันไว้ไม่ได้');

-- คืนส่วนที่เหลือพอดีได้
select public.budget_post_movement(
  'bbbbbbbb-0000-0000-4000-800000000012', 'RELEASE', 500.00, '2056-01-15',
  'คืนยอดส่วนที่เหลือ', null, null, null, null,
  (select id from public.budget_movements
   where budget_account_id = 'bbbbbbbb-0000-0000-4000-800000000012'
     and movement_type = 'RESERVE')
);

select pg_temp.assert_eq(
  public.budget_available('bbbbbbbb-0000-0000-4000-800000000012'), 2000.00,
  'คืนยอดครบแล้วยอดที่ใช้ได้กลับมาเท่าเดิม');

rollback;

\echo 'budget integrity: ทุกกรณีผ่าน'
