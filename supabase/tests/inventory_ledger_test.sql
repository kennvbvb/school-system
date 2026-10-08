-- =============================================================================
-- ทดสอบ stock ledger ของคลังพัสดุบน PostgreSQL จริง (F-02, F-03, F-04, F-10 ของรายงานตรวจ 6 ต.ค. 2569)
--
-- ก่อนไฟล์นี้ คลังพัสดุไม่มี SQL test เลย (ข้อค้นพบ F-10) มีเพียง unit test ของโดเมนที่ไม่เห็น
-- ฟังก์ชัน ล็อก หรือลำดับของแถวในฐานข้อมูล จึงไม่เคยจับ bug สี่ข้อนี้ได้
--
-- สิ่งที่พิสูจน์ที่นี่ (ทุกข้อเคยล้มก่อนมี migration 20261006000100):
--
--   F-04  พัสดุใหม่ที่ไม่เคยมียอดยกมา รับเข้าครั้งแรกได้ (0 -> รับ 7 -> เบิก 5 -> เหลือ 2)
--         ส่วนเบิกจากรายการว่างยังปฏิเสธด้วยกฎยอดไม่ติดลบ ไม่ใช่เพราะกฎ "ต้องมียอดยกมา"
--   F-03  ลำดับของแถวใน ledger ไม่ขึ้นกับ now() หรือ UUID — หลาย movement ใน transaction
--         เดียวกัน (now() เท่ากันทุกแถว) ยังได้ยอดล่าสุดถูกต้อง ทั้งใน view และใน RPC
--         ส่วนกรณี transaction ซ้อนกันจริงอยู่ใน run-inventory-tests.sh
--   F-02  ย้อนรายการต้องตรงต้นทางทั้งรายการพัสดุและจำนวน ย้อนข้ามรายการ/ปรับจำนวนไม่ได้
--         แม้เรียก RPC ตรง (เลี่ยง server action)
--   F-10  ยอด ledger รวม = ยอดคงเหลือ = balance_after ของแถวล่าสุด ทุกรายการ
--         และ audit event เกิดพร้อม movement ในทรานแซกชันเดียวกัน (ล้มแล้วไม่เหลือ audit)
--
-- รันแล้ว rollback ทั้งหมด ไม่ทิ้งข้อมูล
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
-- ข้อมูลสมมติ: เจ้าหน้าที่คลัง (มี inventory.*) ผู้ขอ ผู้อนุมัติ และผู้ใช้ที่ไม่มีสิทธิ์คลัง
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('b1111111-1111-4111-8111-111111111111', 'inv-officer@example.test'),
  ('b2222222-2222-4222-8222-222222222222', 'inv-requester@example.test'),
  ('b3333333-3333-4333-8333-333333333333', 'inv-approver@example.test'),
  ('b4444444-4444-4444-8444-444444444444', 'inv-nobody@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('b1111111-1111-4111-8111-111111111111', 'inv-officer@example.test', 'ทดสอบ', 'เจ้าหน้าที่คลัง', true),
  ('b2222222-2222-4222-8222-222222222222', 'inv-requester@example.test', 'ทดสอบ', 'ผู้เบิก', true),
  ('b3333333-3333-4333-8333-333333333333', 'inv-approver@example.test', 'ทดสอบ', 'ผู้อนุมัติ', true),
  ('b4444444-4444-4444-8444-444444444444', 'inv-nobody@example.test', 'ทดสอบ', 'ไม่มีสิทธิ์', true);

insert into public.user_roles (user_id, role_code) values
  ('b1111111-1111-4111-8111-111111111111', 'INVENTORY_OFFICER'),
  ('b3333333-3333-4333-8333-333333333333', 'PROCUREMENT_OFFICER'),
  ('b4444444-4444-4444-8444-444444444444', 'REQUESTER');

insert into public.units (id, code, name_th) values
  ('b0000000-0000-4000-8000-000000000001', 'UNIT-INV-T', 'ชิ้น (ทดสอบ)');

-- รายการพัสดุ: A มียอดยกมา B มียอดยกมาคนละจำนวน C ใหม่เอี่ยมไม่มีอะไรเลย
insert into public.inventory_items (id, code, name_th, unit_id) values
  ('ba000000-0000-4000-8000-00000000000a', 'INV-T-A', 'พัสดุทดสอบ ก', 'b0000000-0000-4000-8000-000000000001'),
  ('ba000000-0000-4000-8000-00000000000b', 'INV-T-B', 'พัสดุทดสอบ ข', 'b0000000-0000-4000-8000-000000000001'),
  ('ba000000-0000-4000-8000-00000000000c', 'INV-T-C', 'พัสดุทดสอบ ค (ใหม่)', 'b0000000-0000-4000-8000-000000000001');

-- ตัวช่วยลงรายการ — ห่อ stock_post_movement ให้ test อ่านง่าย และใช้ชื่อพารามิเตอร์เสมอ
-- (ลำดับพารามิเตอร์ของฟังก์ชันจริงยาวและสลับผิดง่าย)
create or replace function pg_temp.mv(
  p_item uuid, p_type public.stock_movement_type, p_qty numeric, p_ref text,
  p_reason text default null, p_requested uuid default null, p_approved uuid default null,
  p_reverses uuid default null
) returns uuid language sql as $$
  select public.stock_post_movement(
    p_item_id => p_item, p_type => p_type, p_quantity => p_qty,
    p_effective_date => date '2026-10-06', p_reference => p_ref, p_reason => p_reason,
    p_requested_by => p_requested, p_approved_by => p_approved,
    p_reverses_movement_id => p_reverses, p_request_id => 'inv-test'
  );
$$;

-- ผู้ตรวจ (ไม่ผ่าน RLS) — อ่านยอดจากสามทางต้องตรงกันเสมอ
create or replace function pg_temp.on_hand_view(p_item uuid) returns numeric
language sql security definer as $$
  select coalesce((select on_hand from public.stock_item_balances where item_id = p_item), 0);
$$;
create or replace function pg_temp.last_balance(p_item uuid) returns numeric
language sql security definer as $$
  select balance_after from public.stock_movements where item_id = p_item
  order by sequence_no desc limit 1;
$$;
-- ยอดรวมแบบมีเครื่องหมายจาก ledger — คำนวณอิสระจาก balance_after และจากลำดับแถวทั้งหมด
create or replace function pg_temp.ledger_sum(p_item uuid) returns numeric
language sql security definer as $$
  select coalesce(sum(case
    when m.movement_type in ('OPENING_BALANCE','RECEIPT','RETURN','ADJUSTMENT_INCREASE') then m.quantity
    when m.movement_type in ('ISSUE','ADJUSTMENT_DECREASE') then -m.quantity
    when m.movement_type = 'REVERSAL' then
      case when t.movement_type in ('OPENING_BALANCE','RECEIPT','RETURN','ADJUSTMENT_INCREASE')
           then -m.quantity else m.quantity end
  end), 0)
  from public.stock_movements m
  left join public.stock_movements t on t.id = m.reverses_movement_id
  where m.item_id = p_item;
$$;
grant execute on all functions in schema pg_temp to public;

set local role authenticated;
set local request.jwt.claim.sub = 'b1111111-1111-4111-8111-111111111111';

-- ---------------------------------------------------------------------------
-- F-04: ยอดยกมายังใช้ได้ แต่ไม่ใช่ข้อบังคับก่อนรับของครั้งแรก
-- ---------------------------------------------------------------------------

select pg_temp.mv('ba000000-0000-4000-8000-00000000000a', 'OPENING_BALANCE', 10, 'ยกมา-A');
reset role;
select pg_temp.assert_eq(pg_temp.on_hand_view('ba000000-0000-4000-8000-00000000000a'), 10::numeric,
  'F-04 ยอดยกมายังใช้ได้ตามเดิม');
set local role authenticated;
set local request.jwt.claim.sub = 'b1111111-1111-4111-8111-111111111111';

-- รายการ C ไม่เคยมีอะไรเลย: รับเข้า 7 ได้ทันที (เดิมล้มด้วย "ต้องลงยอดยกมาก่อน")
select pg_temp.mv('ba000000-0000-4000-8000-00000000000c', 'RECEIPT', 7, 'RC-C-1');
select pg_temp.mv('ba000000-0000-4000-8000-00000000000c', 'ISSUE', 5, 'ISS-C-1',
  null, 'b2222222-2222-4222-8222-222222222222', 'b3333333-3333-4333-8333-333333333333');
reset role;
select pg_temp.assert_eq(pg_temp.on_hand_view('ba000000-0000-4000-8000-00000000000c'), 2::numeric,
  'F-04 พัสดุใหม่: รับ 7 เบิก 5 เหลือ 2 (view)');
select pg_temp.assert_eq(pg_temp.last_balance('ba000000-0000-4000-8000-00000000000c'), 2::numeric,
  'F-04 พัสดุใหม่: balance_after ของแถวล่าสุด = 2');
select pg_temp.assert_eq(public.stock_on_hand('ba000000-0000-4000-8000-00000000000c'), 2::numeric,
  'F-04 stock_on_hand() ตรงกับ view');
set local role authenticated;
set local request.jwt.claim.sub = 'b1111111-1111-4111-8111-111111111111';

-- เมื่อมีรายการเคลื่อนไหวแล้ว ยอดยกมาลงซ้ำไม่ได้ (กันนับสองรอบ) — กฎนี้ยังอยู่
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ba000000-0000-4000-8000-00000000000c', 'OPENING_BALANCE', 3, 'ยกมา-C-ช้าเกิน') $$,
  'ลงยอดยกมาได้เฉพาะครั้งแรก',
  'F-04 ยอดยกมาหลังมีรายการอื่นแล้วต้องถูกปฏิเสธ');

-- ของที่ไม่มีอยู่เบิกไม่ได้ — ปฏิเสธด้วยกฎยอดไม่ติดลบ ไม่ใช่กฎ "ต้องมียอดยกมา"
-- (สร้างพัสดุว่างอีกรายการในฐานะผู้ดูแลทะเบียนก่อน)
reset role;
insert into public.inventory_items (id, code, name_th, unit_id) values
  ('ba000000-0000-4000-8000-00000000000d', 'INV-T-D', 'พัสดุว่าง', 'b0000000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claim.sub = 'b1111111-1111-4111-8111-111111111111';
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ba000000-0000-4000-8000-00000000000d', 'ISSUE', 1, 'ISS-D-1',
       null, 'b2222222-2222-4222-8222-222222222222', 'b3333333-3333-4333-8333-333333333333') $$,
  'ยอดคงเหลือไม่พอ',
  'F-04 เบิกจากรายการว่างถูกปฏิเสธด้วยกฎยอดไม่ติดลบ');

-- ---------------------------------------------------------------------------
-- F-03: หลาย movement ใน transaction เดียว (now() เท่ากันทุกแถว) ต้องได้ยอดล่าสุดถูก
--
-- id ของแถวเป็น UUID สุ่ม ถ้าลำดับยังขึ้นกับ (created_at, id) แถว "ยกมา" จะถูกเลือกเป็น
-- แถวล่าสุดประมาณครึ่งหนึ่งของครั้ง ทดสอบ 30 รายการเพื่อให้โอกาสที่โค้ดผิดจะ "บังเอิญผ่าน"
-- ทั้งหมดเหลือประมาณหนึ่งในพันล้าน
-- ---------------------------------------------------------------------------

reset role;
insert into public.inventory_items (id, code, name_th, unit_id)
select gen_random_uuid(), 'INV-T-BULK-' || n, 'พัสดุทดสอบจำนวนมาก ' || n,
       'b0000000-0000-4000-8000-000000000001'
from generate_series(1, 30) n;
set local role authenticated;
set local request.jwt.claim.sub = 'b1111111-1111-4111-8111-111111111111';

do $$
declare
  r record;
begin
  for r in select id from public.inventory_items where code like 'INV-T-BULK-%' loop
    perform pg_temp.mv(r.id, 'OPENING_BALANCE', 7, 'ยกมา-bulk');
    perform pg_temp.mv(r.id, 'ISSUE', 5, 'ISS-bulk',
      null, 'b2222222-2222-4222-8222-222222222222', 'b3333333-3333-4333-8333-333333333333');
    perform pg_temp.mv(r.id, 'RECEIPT', 1, 'RC-bulk');
  end loop;
end $$;

reset role;
select pg_temp.assert_eq(
  (select count(*) from public.inventory_items i
   where i.code like 'INV-T-BULK-%' and pg_temp.on_hand_view(i.id) = 3),
  30::bigint, 'F-03 ทั้ง 30 รายการ: ยอดล่าสุดใน view = 3 (7 - 5 + 1) แม้ now() เท่ากันทุกแถว');
select pg_temp.assert_eq(
  (select count(*) from public.inventory_items i
   where i.code like 'INV-T-BULK-%' and pg_temp.last_balance(i.id) = 3),
  30::bigint, 'F-03 ทั้ง 30 รายการ: balance_after ของแถวล่าสุด = 3');
select pg_temp.assert_eq(
  (select count(*) from public.stock_movements m join public.inventory_items i on i.id = m.item_id
   where i.code like 'INV-T-BULK-%' and m.balance_after is distinct from
     case m.movement_type when 'OPENING_BALANCE' then 7 when 'ISSUE' then 2 else 3 end),
  0::bigint, 'F-03 balance_after ของทุกแถวสร้างต่อเนื่องจากแถวก่อนหน้าจริง (7 -> 2 -> 3)');
select pg_temp.assert_eq(
  (select count(*) from (
     select item_id, sequence_no from public.stock_movements group by 1, 2 having count(*) > 1
   ) d),
  0::bigint, 'F-03 (item_id, sequence_no) ไม่ซ้ำ');
select pg_temp.assert_eq(
  (select string_agg(sequence_no::text, ',' order by sequence_no)
   from public.stock_movements where item_id = 'ba000000-0000-4000-8000-00000000000c'),
  '1,2', 'F-03 sequence_no ของรายการ C เป็น 1,2 ต่อเนื่องไม่ข้าม');

-- ---------------------------------------------------------------------------
-- F-02: ย้อนรายการต้องตรงต้นทาง — แม้เรียก RPC ตรงไม่ผ่าน server action
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'b1111111-1111-4111-8111-111111111111';

-- รายการ B: ยกมา 5 แล้วเบิก 1
select pg_temp.mv('ba000000-0000-4000-8000-00000000000b', 'OPENING_BALANCE', 5, 'ยกมา-B');
create temp table t_issue as
  select pg_temp.mv('ba000000-0000-4000-8000-00000000000a', 'ISSUE', 1, 'ISS-A-1',
    null, 'b2222222-2222-4222-8222-222222222222', 'b3333333-3333-4333-8333-333333333333') as id;
grant select on t_issue to authenticated;

-- อ้างว่าย้อน ISSUE ของ A แต่ลงเพิ่มให้ B 100 ชิ้น
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ba000000-0000-4000-8000-00000000000b', 'REVERSAL', 100, 'ISS-A-1',
       'ย้อนข้ามรายการ', null, null, (select id from t_issue)) $$,
  'คนละรายการ',
  'F-02 ย้อนรายการของ A ลงที่ B ถูกปฏิเสธ');

-- ย้อน ISSUE 1 ชิ้นของ A แต่ระบุว่าเพิ่ม 100 ชิ้นใน A
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ba000000-0000-4000-8000-00000000000a', 'REVERSAL', 100, 'ISS-A-1',
       'ย้อนจำนวนไม่ตรง', null, null, (select id from t_issue)) $$,
  'จำนวนที่ย้อนต้องเท่ากับ',
  'F-02 ย้อนด้วยจำนวนไม่ตรงต้นฉบับถูกปฏิเสธ');

-- ย้อนโดยไม่ระบุเหตุผล
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ba000000-0000-4000-8000-00000000000a', 'REVERSAL', 1, 'ISS-A-1',
       null, null, null, (select id from t_issue)) $$,
  'ต้องระบุเหตุผล',
  'F-02 ย้อนโดยไม่มีเหตุผลถูกปฏิเสธ');

-- ชนิดที่ไม่ใช่ REVERSAL ห้ามอ้างแถวต้นทาง (ข้อความต้องอธิบายได้ ไม่ใช่ชื่อ constraint)
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ba000000-0000-4000-8000-00000000000a', 'RECEIPT', 1, 'RC-A-x',
       null, null, null, (select id from t_issue)) $$,
  'ระบุรายการต้นทางได้เฉพาะ',
  'F-02 RECEIPT ที่อ้างแถวต้นทางถูกปฏิเสธด้วยข้อความที่อ่านรู้เรื่อง');

reset role;
select pg_temp.assert_eq(pg_temp.on_hand_view('ba000000-0000-4000-8000-00000000000a'), 9::numeric,
  'F-02 ความพยายามที่ถูกปฏิเสธไม่ทิ้งผลต่อยอด A (10 - 1 = 9)');
select pg_temp.assert_eq(pg_temp.on_hand_view('ba000000-0000-4000-8000-00000000000b'), 5::numeric,
  'F-02 ความพยายามที่ถูกปฏิเสธไม่ทิ้งผลต่อยอด B (5)');

-- ย้อนถูกต้อง: item และจำนวนตรงต้นทาง
set local role authenticated;
set local request.jwt.claim.sub = 'b1111111-1111-4111-8111-111111111111';
create temp table t_rev as
  select pg_temp.mv('ba000000-0000-4000-8000-00000000000a', 'REVERSAL', 1, 'ISS-A-1',
    'ลงผิด', null, null, (select id from t_issue)) as id;
grant select on t_rev to authenticated;
reset role;
select pg_temp.assert_eq(pg_temp.on_hand_view('ba000000-0000-4000-8000-00000000000a'), 10::numeric,
  'F-02 ย้อนถูกต้องแล้วยอด A กลับเป็น 10');

set local role authenticated;
set local request.jwt.claim.sub = 'b1111111-1111-4111-8111-111111111111';
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ba000000-0000-4000-8000-00000000000a', 'REVERSAL', 1, 'ISS-A-1',
       'ย้อนซ้ำ', null, null, (select id from t_issue)) $$,
  'stock_movements_single_reversal',
  'F-02 ย้อนรายการเดิมซ้ำถูกปฏิเสธ');
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ba000000-0000-4000-8000-00000000000a', 'REVERSAL', 1, 'ISS-A-1',
       'ย้อนการย้อน', null, null, (select id from t_rev)) $$,
  'ย้อนรายการย้อนอีกชั้นไม่ได้',
  'F-02 ย้อนรายการที่เป็น REVERSAL ถูกปฏิเสธ');

-- ย้อนรายการรับเข้าที่ของถูกเบิกไปแล้ว: ยอดจะติดลบ ต้องปฏิเสธ (ของจริงติดลบไม่ได้)
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ba000000-0000-4000-8000-00000000000c', 'REVERSAL', 7, 'RC-C-1',
       'ย้อนรับเข้าที่ถูกเบิกไปแล้ว', null, null,
       (select id from public.stock_movements
        where item_id = 'ba000000-0000-4000-8000-00000000000c' and movement_type = 'RECEIPT')) $$,
  'ยอดคงเหลือไม่พอ',
  'F-02 ย้อนการรับเข้าที่ทำให้ยอดติดลบถูกปฏิเสธ');

-- ---------------------------------------------------------------------------
-- F-10: ความสอดคล้องของ ledger ทุกรายการ และ audit อยู่ในทรานแซกชันเดียวกับ movement
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.assert_eq(
  (select count(*) from public.inventory_items i
   where exists (select 1 from public.stock_movements m where m.item_id = i.id)
     and (pg_temp.ledger_sum(i.id) is distinct from pg_temp.on_hand_view(i.id)
          or pg_temp.on_hand_view(i.id) is distinct from pg_temp.last_balance(i.id)
          or public.stock_on_hand(i.id) is distinct from pg_temp.on_hand_view(i.id))),
  0::bigint, 'F-10 ทุกรายการ: ยอด ledger รวม = ยอดใน view = balance_after ล่าสุด = stock_on_hand()');

select pg_temp.assert_eq(
  (select count(*) from public.stock_movements m
   where not exists (
     select 1 from public.audit_events a
     where a.entity_type = 'stock_movement' and a.entity_id = m.id::text)),
  0::bigint, 'F-10 ทุก movement มี audit event ของตัวเอง');

select pg_temp.assert_eq(
  (select count(*) from public.audit_events a
   where a.entity_type = 'stock_movement'
     and not exists (select 1 from public.stock_movements m where m.id::text = a.entity_id)),
  0::bigint, 'F-10 ไม่มี audit ของ movement ที่ไม่มีอยู่จริง (ความพยายามที่ล้มไม่ทิ้ง audit)');

-- actor ใน audit คือผู้เรียกจริง ไม่ใช่ค่าที่ผู้เรียกส่งมา
select pg_temp.assert_eq(
  (select count(distinct actor_id) from public.audit_events where entity_type = 'stock_movement'),
  1::bigint, 'F-10 actor_id ใน audit ของ movement ทั้งหมดมาจากผู้เรียกจริงคนเดียว');

-- ---------------------------------------------------------------------------
-- สิทธิ์ และ append-only ยังเหมือนเดิม
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'b4444444-4444-4444-8444-444444444444';
select pg_temp.assert_fails(
  $$ select pg_temp.mv('ba000000-0000-4000-8000-00000000000a', 'RECEIPT', 1, 'RC-นอกสิทธิ์') $$,
  'ไม่มีสิทธิ์',
  'ผู้ไม่มีสิทธิ์คลังลงรายการไม่ได้');

-- anon เรียกไม่ได้ตั้งแต่ระดับสิทธิ์ ไม่ต้องรอไปถึงการตรวจใน function
reset role;
set local role anon;
select pg_temp.assert_fails(
  $$ select public.stock_post_movement(p_item_id => 'ba000000-0000-4000-8000-00000000000a',
       p_type => 'RECEIPT', p_quantity => 1, p_effective_date => date '2026-10-06',
       p_reference => 'x') $$,
  'permission denied',
  'anon เรียก stock_post_movement ไม่ได้ที่ระดับสิทธิ์');
select pg_temp.assert_fails(
  $$ select public.stock_on_hand('ba000000-0000-4000-8000-00000000000a') $$,
  'permission denied',
  'anon เรียก stock_on_hand ไม่ได้ที่ระดับสิทธิ์');
reset role;

select pg_temp.assert_fails(
  $$ update public.stock_movements set quantity = 999 $$,
  'แก้หรือลบไม่ได้',
  'append-only: update ถูกปฏิเสธแม้เป็นเจ้าของตาราง');
select pg_temp.assert_fails(
  $$ delete from public.stock_movements $$,
  'แก้หรือลบไม่ได้',
  'append-only: delete ถูกปฏิเสธแม้เป็นเจ้าของตาราง');

rollback;
