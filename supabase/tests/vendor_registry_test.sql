-- =============================================================================
-- ทดสอบทะเบียนผู้ขายบน PostgreSQL จริง (FR-MST-005, FR-MST-009)
--
-- หน้าจอผู้ขายบังคับกฎ "ซ้ำ" สองระดับ: BLOCK เมื่อเลขประจำตัวผู้เสียภาษีและสาขา
-- ตรงกัน และ WARN เมื่อชื่อคล้ายกัน ระดับ BLOCK มีฐานข้อมูลเป็นชั้นบังคับสุดท้าย
-- ผ่าน unique index ส่วนระดับ WARN เป็นดุลพินิจ จึงไม่มีและไม่ควรมีใน constraint
--
-- ไฟล์นี้พิสูจน์ว่าชั้นฐานข้อมูลทำตามที่ชั้นโดเมนสมมติไว้จริง โดยเฉพาะข้อที่ว่า
-- "ไม่ระบุสาขา" กับ "สาขา 00000" เป็นค่าเดียวกัน — ถ้าสองชั้นนี้ไม่ตรงกัน
-- ผู้ใช้จะเจอกรณีที่หน้าจอบอกว่าซ้ำแต่ฐานข้อมูลยอมรับ หรือกลับกัน
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

-- ผู้ใช้สมมติสองคน: ผู้ดูแลข้อมูลพื้นฐาน และผู้ขอที่ไม่มีสิทธิ์จัดการ
insert into auth.users (id, email) values
  ('30000000-0000-0000-0000-000000000001', 'masters@example.test'),
  ('30000000-0000-0000-0000-000000000002', 'requester@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('30000000-0000-0000-0000-000000000001', 'masters@example.test', 'ทดสอบ', 'ผู้ดูแล', true),
  ('30000000-0000-0000-0000-000000000002', 'requester@example.test', 'ทดสอบ', 'ผู้ขอ', true);

insert into public.user_roles (user_id, role_code) values
  ('30000000-0000-0000-0000-000000000001', 'SYSTEM_ADMIN'),
  ('30000000-0000-0000-0000-000000000002', 'REQUESTER');

set local role authenticated;
set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000001';

-- -----------------------------------------------------------------------------
-- รูปแบบของข้อมูล
-- -----------------------------------------------------------------------------

insert into public.vendors (id, vendor_code, name, tax_id, branch_no)
values ('31000000-0000-0000-0000-000000000001', 'V-T01', 'ร้านหนึ่ง (ตัวอย่าง)',
        '1000000000001', '00000');

select pg_temp.assert_fails(
  $$insert into public.vendors (vendor_code, name, tax_id)
    values ('V-T02', 'ร้านสอง (ตัวอย่าง)', '100000000000')$$,
  'vendors_tax_id_format',
  'เลขประจำตัวผู้เสียภาษี 12 หลักถูกปฏิเสธที่ constraint');

select pg_temp.assert_fails(
  $$insert into public.vendors (vendor_code, name, tax_id)
    values ('V-T02', 'ร้านสอง (ตัวอย่าง)', '100000000000ก')$$,
  'vendors_tax_id_format',
  'เลขประจำตัวผู้เสียภาษีที่มีตัวอักษรถูกปฏิเสธ');

select pg_temp.assert_fails(
  $$insert into public.vendors (vendor_code, name) values ('V-T03', '   ')$$,
  'vendors_name_not_blank',
  'ชื่อผู้ขายที่เป็นช่องว่างล้วนถูกปฏิเสธ');

select pg_temp.assert_fails(
  $$insert into public.vendors (vendor_code, name, email)
    values ('V-T04', 'ร้านสี่ (ตัวอย่าง)', 'MiXeD@Example.Test')$$,
  'vendors_email_format',
  'อีเมลตัวพิมพ์ใหญ่ถูกปฏิเสธ — แอปต้องแปลงเป็นตัวพิมพ์เล็กก่อนเขียน');

-- -----------------------------------------------------------------------------
-- กฎ BLOCK — เลขประจำตัวผู้เสียภาษีและสาขาซ้ำ
-- -----------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$insert into public.vendors (vendor_code, name, tax_id, branch_no)
    values ('V-T05', 'ร้านหนึ่งเขียนใหม่ (ตัวอย่าง)', '1000000000001', '00000')$$,
  'vendors_tax_id_branch_unique',
  'BLOCK: เลขผู้เสียภาษีและสาขาซ้ำถูกปฏิเสธที่ฐานข้อมูล');

/*
 * ข้อที่ชั้นโดเมนสมมติไว้ และเป็นเหตุผลหลักที่ไฟล์นี้มีอยู่
 *
 * `normalizeBranch()` ใน src/domain/master-data/vendor.ts แปลงสาขาที่ไม่ระบุ
 * เป็น '00000' ก่อนเทียบ ส่วนฐานข้อมูลใช้ `coalesce(branch_no, '00000')`
 * ใน unique index ถ้าค่า default สองที่นี้ไม่ตรงกัน หน้าจอจะบอกว่าไม่ซ้ำ
 * แล้วฐานข้อมูลปฏิเสธ ซึ่งผู้ใช้แก้ตามไม่ได้เลย
 */
select pg_temp.assert_fails(
  $$insert into public.vendors (vendor_code, name, tax_id)
    values ('V-T06', 'ร้านหนึ่งไม่ระบุสาขา (ตัวอย่าง)', '1000000000001')$$,
  'vendors_tax_id_branch_unique',
  'BLOCK: ไม่ระบุสาขาถือเป็นสาขา 00000 เหมือนที่โดเมนแปลง');

-- คนละสาขาของนิติบุคคลเดียวกันเป็นคนละแถวได้
insert into public.vendors (vendor_code, name, tax_id, branch_no)
values ('V-T07', 'ร้านหนึ่ง สาขา 2 (ตัวอย่าง)', '1000000000001', '00002');
select pg_temp.assert_eq(
  (select count(*)::int from public.vendors where tax_id = '1000000000001'),
  2, 'คนละสาขาของเลขผู้เสียภาษีเดียวกันบันทึกได้');

-- ผู้ขายที่ยังไม่ทราบเลขผู้เสียภาษีบันทึกได้หลายราย เพราะ index ข้าม null
insert into public.vendors (vendor_code, name) values
  ('V-T08', 'ร้านไม่ทราบเลข ก (ตัวอย่าง)'),
  ('V-T09', 'ร้านไม่ทราบเลข ข (ตัวอย่าง)');
select pg_temp.assert_eq(
  (select count(*)::int from public.vendors where tax_id is null),
  2, 'ผู้ขายที่ยังไม่ทราบเลขผู้เสียภาษีบันทึกได้หลายราย');

/*
 * WARN ไม่ใช่กฎของฐานข้อมูล
 *
 * ชื่อคล้ายกันมากแต่เลขผู้เสียภาษีต่างกันต้องบันทึกได้ เพราะร้านคนละแห่งอาจ
 * ชื่อคล้ายกันจริง การทำให้เป็น constraint จะบล็อกข้อมูลที่ถูกต้อง
 * การเตือนและการให้ผู้ใช้ยืนยันจึงอยู่ที่ชั้นแอปเท่านั้น
 */
insert into public.vendors (vendor_code, name, tax_id)
values ('V-T10', 'ร้านหนึ่ง (ตัวอย่าง)', '1000000000002');
select pg_temp.assert_eq(
  (select count(*)::int from public.vendors where name = 'ร้านหนึ่ง (ตัวอย่าง)'),
  2, 'ชื่อซ้ำแต่เลขผู้เสียภาษีต่างกันบันทึกได้ — WARN เป็นดุลพินิจของแอป');

-- ผู้ขายที่ถูกลบแล้วไม่กันไม่ให้บันทึกรายเดิมเข้ามาใหม่ (index เป็น partial)
update public.vendors
set deleted_at = now(), deleted_by = '30000000-0000-0000-0000-000000000001'
where vendor_code = 'V-T07';

insert into public.vendors (vendor_code, name, tax_id, branch_no)
values ('V-T11', 'ร้านหนึ่ง สาขา 2 กลับมา (ตัวอย่าง)', '1000000000001', '00002');
select pg_temp.assert_eq(
  (select count(*)::int from public.vendors
   where tax_id = '1000000000001' and branch_no = '00002' and deleted_at is null),
  1, 'ผู้ขายที่ถูกลบแล้วไม่กันการบันทึกรายเดิมเข้ามาใหม่');

-- -----------------------------------------------------------------------------
-- สิทธิ์ — ผู้ที่ไม่มี masters.manage เขียนไม่ได้
-- -----------------------------------------------------------------------------

set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000002';

select pg_temp.assert_eq(
  (select public.has_permission('masters.manage')),
  false, 'ผู้ขอไม่มีสิทธิ์ masters.manage');

select pg_temp.assert_fails(
  $$insert into public.vendors (vendor_code, name) values ('V-T90', 'ร้านลักลอบ (ตัวอย่าง)')$$,
  'row-level security',
  'ผู้ที่ไม่มีสิทธิ์เพิ่มผู้ขายไม่ได้');

-- update ที่ถูก policy ปฏิเสธจะไม่ error แต่ต้องไม่กระทบแถวใดเลย
update public.vendors set name = 'ถูกแก้โดยผู้ไม่มีสิทธิ์' where vendor_code = 'V-T01';
select pg_temp.assert_eq(
  (select name from public.vendors where vendor_code = 'V-T01'),
  'ร้านหนึ่ง (ตัวอย่าง)', 'ผู้ที่ไม่มีสิทธิ์แก้ไขผู้ขายไม่ได้');

-- ผู้ขอยังต้องเห็นผู้ขายที่ยังไม่ถูกลบ เพราะฟอร์มรายการจัดซื้อต้องเลือกผู้ขายได้
select pg_temp.assert_eq(
  (select count(*)::int > 0 from public.vendors where vendor_code = 'V-T01'),
  true, 'ผู้ขออ่านผู้ขายที่ยังไม่ถูกลบได้');

-- แต่ไม่เห็นรายที่ถูกลบแล้ว — เห็นได้เฉพาะผู้ถือ masters.manage
select pg_temp.assert_eq(
  (select count(*)::int from public.vendors where vendor_code = 'V-T07'),
  0, 'ผู้ขอไม่เห็นผู้ขายที่ถูกลบแล้ว');

set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000001';
select pg_temp.assert_eq(
  (select count(*)::int from public.vendors where vendor_code = 'V-T07'),
  1, 'ผู้ถือ masters.manage เห็นผู้ขายที่ถูกลบแล้ว');

/*
 * ลบจริงไม่ได้ ไม่ว่าจะมีสิทธิ์อะไร
 *
 * migration 0004 เพิกถอน delete ที่ระดับ table privilege นอกเหนือจากการไม่ประกาศ
 * policy ทำให้ยังปลอดภัยแม้จะมีใครเผลอเพิ่ม policy สำหรับ delete ในอนาคต
 */
select pg_temp.assert_fails(
  $$delete from public.vendors where vendor_code = 'V-T01'$$,
  'permission denied',
  'ลบผู้ขายออกจากฐานข้อมูลไม่ได้แม้เป็นผู้ดูแล');

rollback;
