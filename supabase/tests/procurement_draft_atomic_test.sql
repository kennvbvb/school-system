-- =============================================================================
-- ทดสอบ F-08 — สร้าง/บันทึกร่างจัดซื้อแบบ atomic และปิดการเขียนตรง
--
-- เดิม server action ทำหลายคำขอแยก (แม่ → ลบลูก → เพิ่มลูก → แหล่งเงิน → audit) ล้มกลางทางแล้ว
-- ร่างเหลือไม่ครบ และ policy ยอมให้แก้ทุกคอลัมน์ของร่างผ่าน Data API ตรง
--
-- ชุดนี้พิสูจน์:
--   * RPC สร้าง/บันทึกร่างเขียนแม่+ลูก+แหล่งเงิน+audit ใน transaction เดียว — ล้มตรงไหน rollback ทั้งหมด
--     (failure injection ทั้งตอนสร้างและตอนบันทึก ตรวจว่าของเดิมครบและไม่มี audit ค้าง)
--   * บันทึกหนึ่งครั้งเพิ่ม version หนึ่งครั้ง; version เก่าถูกปฏิเสธโดยไม่แก้อะไร
--   * ผู้สร้าง/สถานะ/ปีงบ/เวลา มาจากฐานข้อมูล payload ปลอมแปลงไม่ได้
--   * สิทธิ์: เจ้าของ/read.all+edit_draft แก้ได้ ผู้อื่นและผู้ไม่มีสิทธิ์แก้ไม่ได้ สถานะที่ส่งอนุมัติแล้วแก้ไม่ได้
--   * เขียนตารางตรง (insert/update/delete) ถูกปฏิเสธทุกคอลัมน์ ทั้งสามตาราง
--   * audit ของการสร้าง/แก้ติด DB_TRUSTED และปลอมผ่าน record_audit_event ไม่ได้
--
-- ใช้ปีงบ พ.ศ. 2580 (ไม่ซ้ำกับ test อื่น)
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

-- ตัวช่วยจัดข้อมูลตั้งต้น/อ่านค่าด้วยสิทธิ์เจ้าของ (ไม่ผ่าน RLS)
create or replace function pg_temp.fx(stmt text) returns void
language plpgsql security definer as $$ begin execute stmt; end; $$;
create or replace function pg_temp.q(stmt text) returns text
language plpgsql security definer as $$ declare v text; begin execute stmt into v; return v; end; $$;

insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-000000000001', 'da-officer@example.test'),
  ('a1000000-0000-4000-8000-000000000002', 'da-req-a@example.test'),
  ('a1000000-0000-4000-8000-000000000003', 'da-req-b@example.test'),
  ('a1000000-0000-4000-8000-000000000004', 'da-nobody@example.test'),
  ('a1000000-0000-4000-8000-000000000005', 'da-auditor@example.test');
insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('a1000000-0000-4000-8000-000000000001', 'da-officer@example.test', 'ทดสอบ', 'พัสดุ', true),
  ('a1000000-0000-4000-8000-000000000002', 'da-req-a@example.test', 'ทดสอบ', 'ผู้ขอ ก', true),
  ('a1000000-0000-4000-8000-000000000003', 'da-req-b@example.test', 'ทดสอบ', 'ผู้ขอ ข', true),
  ('a1000000-0000-4000-8000-000000000004', 'da-nobody@example.test', 'ทดสอบ', 'ไม่มีสิทธิ์', true),
  ('a1000000-0000-4000-8000-000000000005', 'da-auditor@example.test', 'ทดสอบ', 'ผู้ตรวจ', true);
insert into public.user_roles (user_id, role_code) values
  ('a1000000-0000-4000-8000-000000000001', 'PROCUREMENT_OFFICER'),
  ('a1000000-0000-4000-8000-000000000002', 'REQUESTER'),
  ('a1000000-0000-4000-8000-000000000003', 'REQUESTER'),
  ('a1000000-0000-4000-8000-000000000005', 'AUDITOR');

insert into public.fiscal_years (id, code, year_be, start_date, end_date, status) values
  ('a2000000-0000-4000-8000-0000000000f1', 'FYDA1', 2580, '2036-10-01', '2037-09-30', 'OPEN'),
  ('a2000000-0000-4000-8000-0000000000f2', 'FYDA2', 2581, '2037-10-01', '2038-09-30', 'OPEN');
insert into public.departments (id, code, name_th) values
  ('a2000000-0000-4000-8000-0000000000d1', 'DP-DA1', 'ฝ่ายทดสอบ (ตัวอย่าง)'),
  ('a2000000-0000-4000-8000-0000000000d2', 'DP-DA2', 'ฝ่ายทดสอบสอง (ตัวอย่าง)');
insert into public.budget_accounts (id, code, fiscal_year_id, department_id, status) values
  ('a2000000-0000-4000-8000-0000000000b1', 'ACC-DA1', 'a2000000-0000-4000-8000-0000000000f1',
   'a2000000-0000-4000-8000-0000000000d1', 'OPEN'),
  ('a2000000-0000-4000-8000-0000000000b2', 'ACC-DA2', 'a2000000-0000-4000-8000-0000000000f1',
   'a2000000-0000-4000-8000-0000000000d2', 'OPEN');

-- สร้าง payload — ใช้ชื่อคีย์เดียวกับที่ server action ส่ง
create or replace function pg_temp.payload(p_subject text, p_items jsonb, p_funding jsonb,
                                           p_extra jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'subject', p_subject, 'tax_mode', 'EXEMPT',
    'fiscal_year_id', 'a2000000-0000-4000-8000-0000000000f1',
    'request_date', '2037-01-10', 'is_emergency', false,
    'items', p_items, 'funding_allocations', p_funding
  ) || p_extra;
$$;

create or replace function pg_temp.two_items() returns jsonb language sql as $$
  select '[{"line_no":1,"description":"กระดาษ A4 (ตัวอย่าง)","quantity":"3","unit_price":"250.50"},
           {"line_no":2,"description":"หมึกพิมพ์ (ตัวอย่าง)","quantity":"1","unit_price":"1000"}]'::jsonb;
$$;
create or replace function pg_temp.two_funding() returns jsonb language sql as $$
  select '[{"line_no":1,"budget_account_id":"a2000000-0000-4000-8000-0000000000b1","amount":"1000.00"},
           {"line_no":2,"budget_account_id":"a2000000-0000-4000-8000-0000000000b2","amount":"751.50"}]'::jsonb;
$$;

-- ---------------------------------------------------------------------------
-- 1) สร้างร่างผ่าน RPC
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';

create temp table made as
  select public.procurement_create_draft(
    pg_temp.payload('ซื้อวัสดุสำนักงาน (ตัวอย่าง)', pg_temp.two_items(), pg_temp.two_funding(),
      -- ฟิลด์ระบบที่ผู้เรียกพยายามกำหนดเอง ต้องถูกเมินทั้งหมด
      jsonb_build_object('created_by', 'a1000000-0000-4000-8000-000000000003',
                         'status', 'APPROVED', 'version', 99, 'deleted_at', '2037-01-01')),
    'req-da-create') as r;
grant select on made to authenticated;

select pg_temp.assert_eq((select left(r ->> 'reference', 2) from made), 'D-',
  'สร้างร่างได้เลขอ้างอิงจากฐานข้อมูล');
select pg_temp.assert_eq((select (r ->> 'version')::integer from made), 1,
  'ร่างใหม่เริ่มที่ version 1 (ไม่ใช่ n+1 ตามจำนวนแถวย่อย)');

select pg_temp.assert_eq(
  (select created_by from public.procurements where id = (select (r ->> 'id')::uuid from made)),
  'a1000000-0000-4000-8000-000000000002'::uuid, 'ผู้สร้างมาจาก auth.uid() ไม่ใช่ payload');
select pg_temp.assert_eq(
  (select status::text from public.procurements where id = (select (r ->> 'id')::uuid from made)),
  'DRAFT', 'สถานะเริ่มต้น DRAFT เสมอ payload ปลอมเป็น APPROVED ไม่ได้');
select pg_temp.assert_eq(
  (select deleted_at is null from public.procurements where id = (select (r ->> 'id')::uuid from made)),
  true, 'payload ตั้ง deleted_at ไม่ได้');
select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_items where procurement_id = (select (r ->> 'id')::uuid from made)),
  2, 'สร้างรายการย่อยครบสองบรรทัด');
select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_funding_allocations where procurement_id = (select (r ->> 'id')::uuid from made)),
  2, 'สร้างแหล่งเงินครบสองบรรทัด');
select pg_temp.assert_eq(
  (select (grand_total * 100)::bigint from public.procurement_totals where procurement_id = (select (r ->> 'id')::uuid from made)),
  175150::bigint, 'ยอดรวมคำนวณจากรายการย่อยที่เขียนผ่าน RPC');

reset role;
select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events
   where request_id = 'req-da-create' and action = 'entity.create' and entity_type = 'procurement'
     and entity_id = (select r ->> 'id' from made) and provenance = 'DB_TRUSTED'),
  1, 'audit การสร้างเขียนใน RPC (DB_TRUSTED) หนึ่งแถว');

-- ---------------------------------------------------------------------------
-- 2) สิทธิ์สร้าง
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000004';
select pg_temp.assert_fails(
  $$select public.procurement_create_draft(pg_temp.payload('ไม่มีสิทธิ์', '[]', '[]'))$$,
  'ไม่มีสิทธิ์สร้าง', 'ผู้ไม่มี procurement.create สร้างร่างไม่ได้');

-- ---------------------------------------------------------------------------
-- 3) failure injection ตอนสร้าง: แม่เขียนแล้วแต่ลูกล้ม → ไม่มีอะไรค้าง
-- ---------------------------------------------------------------------------

reset role;
create temp table before_create as select
  (select count(*) from public.procurements) as p,
  (select count(*) from public.procurement_items) as i,
  (select count(*) from public.procurement_funding_allocations) as f,
  (select count(*) from public.audit_events where action = 'entity.create' and entity_type = 'procurement') as a;
grant select on before_create to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';

select pg_temp.assert_fails(
  $$select public.procurement_create_draft(pg_temp.payload('ล้มที่รายการย่อย',
      '[{"line_no":1,"description":"ดี","quantity":"1","unit_price":"10"},
        {"line_no":2,"description":"จำนวนเป็นศูนย์","quantity":"0","unit_price":"10"}]', '[]'))$$,
  'procurement_items_quantity_positive', 'สร้างร่างที่รายการย่อยบรรทัดที่สองผิด ล้มทั้งหมด');

select pg_temp.assert_fails(
  $$select public.procurement_create_draft(pg_temp.payload('ล้มที่แหล่งเงิน', pg_temp.two_items(),
      '[{"line_no":1,"budget_account_id":"a2000000-0000-4000-8000-0000000000b1","amount":"1000"},
        {"line_no":2,"budget_account_id":"a2000000-0000-4000-8000-0000000000b1","amount":"751.50"}]'))$$,
  'procurement_id_budget_account', 'บัญชีงบซ้ำสองบรรทัด ล้มทั้งหมด');

select pg_temp.assert_fails(
  $$select public.procurement_create_draft(pg_temp.payload('ปีงบไม่มีอยู่', '[]', '[]',
      jsonb_build_object('fiscal_year_id', 'a2000000-0000-4000-8000-00000000dead')))$$,
  'foreign key', 'ปีงบที่ไม่มีอยู่ ล้มทั้งหมด');

reset role;
select pg_temp.assert_eq(
  (select (select count(*) from public.procurements) - p from before_create), 0::bigint,
  'ล้มกลางทาง: ไม่มีแถวแม่ค้าง');
select pg_temp.assert_eq(
  (select (select count(*) from public.procurement_items) - i from before_create), 0::bigint,
  'ล้มกลางทาง: ไม่มีรายการย่อยค้าง');
select pg_temp.assert_eq(
  (select (select count(*) from public.procurement_funding_allocations) - f from before_create), 0::bigint,
  'ล้มกลางทาง: ไม่มีแหล่งเงินค้าง');
select pg_temp.assert_eq(
  (select (select count(*) from public.audit_events where action = 'entity.create' and entity_type = 'procurement') - a
   from before_create), 0::bigint,
  'ล้มกลางทาง: ไม่มี audit ค้าง');

-- ---------------------------------------------------------------------------
-- 4) บันทึกร่าง: เพิ่ม version หนึ่งครั้ง แทนที่ลูกทั้งชุด audit ใน transaction เดียวกัน
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';

create temp table saved as
  select public.procurement_save_draft(
    (select (r ->> 'id')::uuid from made), 1,
    pg_temp.payload('แก้เรื่องใหม่ (ตัวอย่าง)',
      '[{"line_no":1,"description":"ปากกา (ตัวอย่าง)","quantity":"10","unit_price":"15"}]',
      '[{"line_no":1,"budget_account_id":"a2000000-0000-4000-8000-0000000000b1","amount":"150"}]',
      -- ส่งปีงบเดิมมาตามที่ฟอร์มส่งเสมอ ไม่ถือว่าแก้ (ถ้าเป็นปีอื่นจะถูกปฏิเสธ — ดูข้างล่าง, F-11)
      jsonb_build_object('fiscal_year_id', 'a2000000-0000-4000-8000-0000000000f1')),
    'req-da-save') as r;
grant select on saved to authenticated;

select pg_temp.assert_eq((select (r ->> 'version')::integer from saved), 2,
  'บันทึกหนึ่งครั้งเพิ่ม version หนึ่งครั้ง (1 → 2) แม้เขียนลูกหลายแถว');
select pg_temp.assert_eq(
  (select subject from public.procurements where id = (select (r ->> 'id')::uuid from made)),
  'แก้เรื่องใหม่ (ตัวอย่าง)', 'หัวเอกสารถูกแก้');
select pg_temp.assert_eq(
  (select string_agg(description, ',' order by line_no) from public.procurement_items
   where procurement_id = (select (r ->> 'id')::uuid from made)),
  'ปากกา (ตัวอย่าง)', 'รายการย่อยถูกแทนที่ทั้งชุด (เหลือบรรทัดเดียว)');
select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_funding_allocations
   where procurement_id = (select (r ->> 'id')::uuid from made)),
  1, 'แหล่งเงินถูกแทนที่ทั้งชุด');
select pg_temp.assert_eq(
  (select fiscal_year_id from public.procurements where id = (select (r ->> 'id')::uuid from made)),
  'a2000000-0000-4000-8000-0000000000f1'::uuid, 'ปีงบประมาณไม่ถูกเปลี่ยนโดยการบันทึก');
select pg_temp.assert_eq(
  (select updated_by from public.procurements where id = (select (r ->> 'id')::uuid from made)),
  'a1000000-0000-4000-8000-000000000002'::uuid, 'updated_by มาจากผู้เรียกจริง');

-- F-11: ปีงบประมาณแก้ไม่ได้หลังสร้างร่าง — ปฏิเสธชัดเจน ไม่เมินเงียบ ๆ และไม่เพิ่ม version
select pg_temp.assert_fails(
  format($$select public.procurement_save_draft(%L::uuid, 2,
    pg_temp.payload('เปลี่ยนปี (ตัวอย่าง)',
      '[{"line_no":1,"description":"ปากกา (ตัวอย่าง)","quantity":"10","unit_price":"15"}]',
      '[{"line_no":1,"budget_account_id":"a2000000-0000-4000-8000-0000000000b1","amount":"150"}]',
      jsonb_build_object('fiscal_year_id', 'a2000000-0000-4000-8000-0000000000f2')),
    'req-da-fy')$$, (select (r ->> 'id') from made)),
  'ปีงบประมาณแก้ไม่ได้หลังสร้างร่าง', 'F-11 บันทึกพร้อมเปลี่ยนปีงบถูกปฏิเสธ');
select pg_temp.assert_eq(
  (select version from public.procurements where id = (select (r ->> 'id')::uuid from made)),
  2, 'F-11 คำขอที่ถูกปฏิเสธไม่เพิ่ม version และไม่แก้หัวเอกสาร');
select pg_temp.assert_eq(
  (select subject from public.procurements where id = (select (r ->> 'id')::uuid from made)),
  'แก้เรื่องใหม่ (ตัวอย่าง)', 'F-11 คำขอที่ถูกปฏิเสธไม่แก้หัวเอกสาร');

reset role;
select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events
   where request_id = 'req-da-save' and action = 'entity.update' and provenance = 'DB_TRUSTED'
     and (before_json ->> 'version')::integer = 1 and (after_json ->> 'version')::integer = 2),
  1, 'audit การบันทึกเขียนใน RPC หนึ่งแถว พร้อม version ก่อน/หลัง');

-- ---------------------------------------------------------------------------
-- 5) version เก่าถูกปฏิเสธ — ไม่แก้อะไรเลย
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';

select pg_temp.assert_fails(
  $$select public.procurement_save_draft((select (r ->> 'id')::uuid from made), 1,
      pg_temp.payload('แก้ด้วย version เก่า', pg_temp.two_items(), pg_temp.two_funding()), 'req-da-stale')$$,
  'มีผู้อื่นแก้ไขรายการนี้ไปแล้ว', 'บันทึกด้วย version เก่าถูกปฏิเสธ');

reset role;
select pg_temp.assert_eq(
  (select subject from public.procurements where id = (select (r ->> 'id')::uuid from made)),
  'แก้เรื่องใหม่ (ตัวอย่าง)', 'version เก่า: หัวเอกสารไม่ถูกแก้');
select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_items where procurement_id = (select (r ->> 'id')::uuid from made)),
  1, 'version เก่า: รายการย่อยไม่ถูกแตะ');
select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events where request_id = 'req-da-stale'),
  0, 'version เก่า: ไม่มี audit ค้าง');

-- ---------------------------------------------------------------------------
-- 6) failure injection ตอนบันทึก: ลบลูกเดิมแล้วลูกใหม่ล้ม → ของเดิมต้องครบ
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';

select pg_temp.assert_fails(
  $$select public.procurement_save_draft((select (r ->> 'id')::uuid from made), 2,
      pg_temp.payload('ล้มกลางการบันทึก',
        '[{"line_no":1,"description":"ดี","quantity":"1","unit_price":"10"},
          {"line_no":2,"description":"ส่วนลดเกินมูลค่า","quantity":"1","unit_price":"10","discount_amount":"99"}]',
        pg_temp.two_funding()), 'req-da-save-fail')$$,
  'procurement_items_discount_within_line', 'บันทึกที่รายการย่อยบรรทัดที่สองผิด ล้มทั้งหมด');

reset role;
select pg_temp.assert_eq(
  (select string_agg(description, ',' order by line_no) from public.procurement_items
   where procurement_id = (select (r ->> 'id')::uuid from made)),
  'ปากกา (ตัวอย่าง)', 'ล้มกลางการบันทึก: รายการย่อยเดิมยังครบ ไม่หายไปครึ่งทาง');
select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_funding_allocations
   where procurement_id = (select (r ->> 'id')::uuid from made)),
  1, 'ล้มกลางการบันทึก: แหล่งเงินเดิมยังครบ');
select pg_temp.assert_eq(
  (select version from public.procurements where id = (select (r ->> 'id')::uuid from made)),
  2, 'ล้มกลางการบันทึก: version ไม่เปลี่ยน');
select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events where request_id = 'req-da-save-fail'),
  0, 'ล้มกลางการบันทึก: ไม่มี audit ค้าง');

-- ---------------------------------------------------------------------------
-- 7) สิทธิ์ในการบันทึก
-- ---------------------------------------------------------------------------

set local role authenticated;

-- ผู้ขออีกคน: ไม่ใช่เจ้าของและไม่มี read.all
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';
select pg_temp.assert_fails(
  $$select public.procurement_save_draft((select (r ->> 'id')::uuid from made), 2,
      pg_temp.payload('แก้ของคนอื่น', '[]', '[]'))$$,
  'ไม่พบรายการนี้ หรือคุณไม่มีสิทธิ์แก้ไข', 'ผู้ขออีกคนแก้ร่างของคนอื่นไม่ได้ (ตอบเหมือน "ไม่พบ")');

-- ผู้ไม่มีสิทธิ์แก้ร่างเลย
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000004';
select pg_temp.assert_fails(
  $$select public.procurement_save_draft((select (r ->> 'id')::uuid from made), 2,
      pg_temp.payload('ไม่มีสิทธิ์', '[]', '[]'))$$,
  'ไม่มีสิทธิ์แก้ไข', 'ผู้ไม่มี procurement.edit_draft แก้ไม่ได้');

-- ผู้ตรวจสอบ (read.all แต่ไม่มี edit_draft) อ่านได้แต่แก้ไม่ได้
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000005';
select pg_temp.assert_fails(
  $$select public.procurement_save_draft((select (r ->> 'id')::uuid from made), 2,
      pg_temp.payload('ผู้ตรวจแก้', '[]', '[]'))$$,
  'ไม่มีสิทธิ์แก้ไข', 'ผู้มี read.all แต่ไม่มี edit_draft แก้ไม่ได้');

-- เจ้าหน้าที่พัสดุ (read.all + edit_draft) แก้ร่างของผู้ขอได้ — ตรงกับ policy เดิม
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select pg_temp.assert_eq(
  (public.procurement_save_draft((select (r ->> 'id')::uuid from made), 2,
     pg_temp.payload('เจ้าหน้าที่พัสดุแก้ (ตัวอย่าง)', pg_temp.two_items(), pg_temp.two_funding()),
     'req-da-officer') ->> 'version')::integer,
  3, 'เจ้าหน้าที่พัสดุ (read.all + edit_draft) บันทึกร่างของผู้ขอได้ และ version เป็น 3');

-- สถานะที่ส่งอนุมัติแล้วแก้ไม่ได้ แต่ NEEDS_REVISION แก้ได้
reset role;
select pg_temp.fx($fx$ update public.procurements set status = 'PENDING_REVIEW'
  where id = (select (r ->> 'id')::uuid from made) $fx$);
set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';
select pg_temp.assert_fails(
  $$select public.procurement_save_draft((select (r ->> 'id')::uuid from made),
      (select version from public.procurements where id = (select (r ->> 'id')::uuid from made)),
      pg_temp.payload('แก้ตอนรอตรวจ', '[]', '[]'))$$,
  'ถูกส่งเข้าสู่ขั้นตอนอนุมัติแล้ว', 'ร่างที่ส่งอนุมัติแล้วบันทึกไม่ได้');

reset role;
select pg_temp.fx($fx$ update public.procurements set status = 'NEEDS_REVISION'
  where id = (select (r ->> 'id')::uuid from made) $fx$);
set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';
select pg_temp.assert_eq(
  (public.procurement_save_draft((select (r ->> 'id')::uuid from made),
     (select version from public.procurements where id = (select (r ->> 'id')::uuid from made)),
     pg_temp.payload('แก้หลังถูกส่งกลับ (ตัวอย่าง)', pg_temp.two_items(), pg_temp.two_funding()),
     'req-da-revision') ->> 'version') is not null,
  true, 'สถานะ NEEDS_REVISION ยังบันทึกได้');

-- ไม่พบรายการ
select pg_temp.assert_fails(
  $$select public.procurement_save_draft('a2000000-0000-4000-8000-00000000dead', 1,
      pg_temp.payload('ไม่มีอยู่', '[]', '[]'))$$,
  'ไม่พบรายการนี้', 'บันทึกรายการที่ไม่มีอยู่ถูกปฏิเสธ');

-- ---------------------------------------------------------------------------
-- 8) เขียนตารางตรงถูกปฏิเสธทุกทางทั้งสามตาราง
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$update public.procurements set created_by = 'a1000000-0000-4000-8000-000000000003'
    where id = (select (r ->> 'id')::uuid from made)$$,
  'permission denied for table procurements', 'แก้ created_by ผ่านตารางตรงไม่ได้');
select pg_temp.assert_fails(
  $$update public.procurements set status = 'DRAFT' where id = (select (r ->> 'id')::uuid from made)$$,
  'permission denied for table procurements', 'แก้ status ผ่านตารางตรงไม่ได้');
select pg_temp.assert_fails(
  $$update public.procurements set deleted_at = now() where id = (select (r ->> 'id')::uuid from made)$$,
  'permission denied for table procurements', 'soft delete ผ่านตารางตรงไม่ได้');
select pg_temp.assert_fails(
  $$update public.procurements set fiscal_year_id = 'a2000000-0000-4000-8000-0000000000f2'
    where id = (select (r ->> 'id')::uuid from made)$$,
  'permission denied for table procurements', 'แก้ปีงบผ่านตารางตรงไม่ได้');
select pg_temp.assert_fails(
  $$update public.procurements set exception_reason = 'ยกเว้นเอง', exception_granted_by = created_by,
      exception_granted_at = now() where id = (select (r ->> 'id')::uuid from made)$$,
  'permission denied for table procurements', 'ตั้งข้อยกเว้นเองผ่านตารางตรงไม่ได้');
select pg_temp.assert_fails(
  $$insert into public.procurements (subject, fiscal_year_id, request_date, created_by)
    values ('เขียนตรง', 'a2000000-0000-4000-8000-0000000000f1', '2037-01-10',
            'a1000000-0000-4000-8000-000000000002')$$,
  'permission denied for table procurements', 'insert แม่ตรงไม่ได้');
select pg_temp.assert_fails(
  $$delete from public.procurements where id = (select (r ->> 'id')::uuid from made)$$,
  'permission denied for table procurements', 'delete แม่ตรงไม่ได้');
select pg_temp.assert_fails(
  $$insert into public.procurement_items (procurement_id, line_no, description, quantity, unit_price)
    values ((select (r ->> 'id')::uuid from made), 9, 'เขียนตรง', 1, 1)$$,
  'permission denied for table procurement_items', 'insert รายการย่อยตรงไม่ได้');
select pg_temp.assert_fails(
  $$update public.procurement_items set quantity = 999 where procurement_id = (select (r ->> 'id')::uuid from made)$$,
  'permission denied for table procurement_items', 'update รายการย่อยตรงไม่ได้');
select pg_temp.assert_fails(
  $$delete from public.procurement_items where procurement_id = (select (r ->> 'id')::uuid from made)$$,
  'permission denied for table procurement_items', 'delete รายการย่อยตรงไม่ได้');
select pg_temp.assert_fails(
  $$insert into public.procurement_funding_allocations (procurement_id, line_no, budget_account_id, amount)
    values ((select (r ->> 'id')::uuid from made), 9, 'a2000000-0000-4000-8000-0000000000b1', 1)$$,
  'permission denied for table procurement_funding_allocations', 'insert แหล่งเงินตรงไม่ได้');
select pg_temp.assert_fails(
  $$delete from public.procurement_funding_allocations where procurement_id = (select (r ->> 'id')::uuid from made)$$,
  'permission denied for table procurement_funding_allocations', 'delete แหล่งเงินตรงไม่ได้');

-- ยืนยันที่ระดับ catalog: ไม่มี privilege เขียนคอลัมน์ใดเลย (ไม่ใช่แค่ test ที่ลองบางแบบ)
reset role;
select pg_temp.assert_eq(
  (select string_agg(t || ':' || p, ', ')
   from unnest(array['procurements', 'procurement_items', 'procurement_funding_allocations']) t,
        unnest(array['insert', 'update', 'delete']) p
   where has_table_privilege('authenticated', 'public.' || t, p)
      or (p = 'update' and has_any_column_privilege('authenticated', 'public.' || t, 'update'))
      or (p = 'insert' and has_any_column_privilege('authenticated', 'public.' || t, 'insert'))),
  null::text, 'authenticated ไม่มี privilege เขียนสามตารางนี้เลยทั้งระดับตารางและคอลัมน์');

-- ---------------------------------------------------------------------------
-- 9) audit ของ procurement ปลอมผ่านช่องทางแอปรายงานไม่ได้อีก
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select pg_temp.assert_fails(
  $$select public.record_audit_event('req-da-forge', 'entity.update', 'procurement',
      (select r ->> 'id' from made))$$,
  'แอปรายงานเองไม่ได้', 'ปลอมเหตุการณ์แก้ร่างผ่าน record_audit_event ไม่ได้ (เขียนโดย RPC เท่านั้น)');
select pg_temp.assert_fails(
  $$select public.record_audit_event('req-da-forge2', 'procurement.status_change', 'procurement',
      (select r ->> 'id' from made))$$,
  'แอปรายงานเองไม่ได้', 'ปลอมเหตุการณ์เปลี่ยนสถานะผ่าน record_audit_event ไม่ได้');

-- ---------------------------------------------------------------------------
-- 10) สิทธิ์เรียกฟังก์ชัน
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$select public.procurement_write_draft_children((select (r ->> 'id')::uuid from made), '{}'::jsonb)$$,
  'permission denied', 'ตัวช่วยภายในเขียนลูกเรียกตรงจาก authenticated ไม่ได้');

reset role;
set local role anon;
select pg_temp.assert_fails(
  $$select public.procurement_create_draft('{}'::jsonb)$$,
  'permission denied', 'anon สร้างร่างไม่ได้');
select pg_temp.assert_fails(
  $$select public.procurement_save_draft('a2000000-0000-4000-8000-00000000dead', 1, '{}'::jsonb)$$,
  'permission denied', 'anon บันทึกร่างไม่ได้');

-- ---------------------------------------------------------------------------
-- 11) ห้ามฟังก์ชันใดใน public แจ้งความขัดแย้งด้วย SQLSTATE 40001 (serialization_failure)
-- PostgREST ลองซ้ำเมื่อเจอ 40001 จน HTTP ค้าง (ยืนยันกับ 12.2.3) — ใช้ PT409 เพื่อได้ 409 ทันที
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', '), '')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~* 'errcode\s*=\s*''serialization_failure'''),
  '', 'ไม่มีฟังก์ชันใน public ที่ใช้ errcode serialization_failure (40001) แจ้งความขัดแย้ง');


rollback;

\echo 'procurement draft atomic: ทุกกรณีผ่าน'
