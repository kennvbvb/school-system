-- =============================================================================
-- ทดสอบทะเบียนเลขที่เอกสารบน PostgreSQL จริง (PR-04b)
--
-- สิ่งที่ unit test พิสูจน์ไม่ได้และต้องรันที่นี่:
--
--   * เลขซ้ำถูกปฏิเสธที่ฐานข้อมูล ไม่ใช่แค่ที่หน้าจอ (F-12)
--   * **เลขไทยกับเลขอารบิกที่มีค่าเท่ากันถือว่าซ้ำกัน** — ไฟล์จริงใช้เลขไทย
--   * เลขที่ยกเลิกแล้วนำกลับมาใช้ไม่ได้ (เกณฑ์ตรวจรับของแผน PR-04)
--   * รายการที่ไม่ต้องมีเลขบันทึกได้ แต่ต้องมีเหตุผล (F-14)
--   * running_no ที่ฐานข้อมูลแยกเอง ตรงกับที่โดเมนแยก (F-13)
--   * เขียนตารางตรงไม่ได้ ต้องผ่าน RPC เท่านั้น
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
-- ผู้ใช้สมมติ
--
-- เจ้าหน้าที่พัสดุถือสิทธิ์ documents.issue ส่วนผู้ขอไม่ถือ เพื่อพิสูจน์ว่าการตรวจสิทธิ์
-- ทำงานจริง ไม่ใช่ผ่านเพราะทุกคนมีสิทธิ์เหมือนกันหมด
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('e1111111-1111-4111-8111-111111111111', 'dn-officer@example.test'),
  ('e2222222-2222-4222-8222-222222222222', 'dn-requester@example.test'),
  ('e3333333-3333-4333-8333-333333333333', 'dn-auditor@example.test');

insert into public.profiles (id, email, title_th, first_name_th, last_name_th, is_active) values
  ('e1111111-1111-4111-8111-111111111111', 'dn-officer@example.test',
   'นาง', 'ทดสอบ', 'เจ้าหน้าที่พัสดุ', true),
  ('e2222222-2222-4222-8222-222222222222', 'dn-requester@example.test',
   'นาย', 'ทดสอบ', 'ผู้ขอ', true),
  ('e3333333-3333-4333-8333-333333333333', 'dn-auditor@example.test',
   'นาง', 'ทดสอบ', 'ผู้ตรวจสอบภายใน', true);

insert into public.user_roles (user_id, role_code) values
  ('e1111111-1111-4111-8111-111111111111', 'PROCUREMENT_OFFICER'),
  ('e2222222-2222-4222-8222-222222222222', 'REQUESTER'),
  ('e3333333-3333-4333-8333-333333333333', 'AUDITOR');

insert into public.fiscal_years (id, code, year_be, start_date, end_date) values
  ('e0000000-0000-4000-8000-000000000001', 'FYDN1', 2569, '2025-10-01', '2026-09-30'),
  -- ปีงบที่สอง ใช้พิสูจน์ว่าขอบเขตความไม่ซ้ำแยกตามปี
  ('e0000000-0000-4000-8000-000000000002', 'FYDN2', 2570, '2026-10-01', '2027-09-30');

insert into public.procurements
  (id, subject, fiscal_year_id, request_date, created_by)
values
  ('eaaaaaaa-0000-4000-8000-000000000001', 'จัดซื้อทดสอบเลขเอกสาร ก (ตัวอย่าง)',
   'e0000000-0000-4000-8000-000000000001', '2026-01-05',
   'e2222222-2222-4222-8222-222222222222'),
  ('eaaaaaaa-0000-4000-8000-000000000002', 'จัดซื้อทดสอบเลขเอกสาร ข (ตัวอย่าง)',
   'e0000000-0000-4000-8000-000000000001', '2026-01-06',
   'e2222222-2222-4222-8222-222222222222'),
  ('eaaaaaaa-0000-4000-8000-000000000003', 'จัดซื้อทดสอบเลขเอกสาร ค (ตัวอย่าง)',
   'e0000000-0000-4000-8000-000000000001', '2026-01-07',
   'e2222222-2222-4222-8222-222222222222'),
  -- รายการของปีงบถัดไป
  ('eaaaaaaa-0000-4000-8000-000000000004', 'จัดซื้อทดสอบเลขเอกสาร ง (ตัวอย่าง)',
   'e0000000-0000-4000-8000-000000000002', '2026-11-05',
   'e2222222-2222-4222-8222-222222222222'),
  -- รายการสะอาดไว้ทดสอบการนำเลขที่ยกเลิกแล้วกลับมาใช้ ต้องอยู่ในปีงบและชนิดเดียวกัน
  -- กับเลขที่ถูกยกเลิก มิฉะนั้นจะผ่านเพราะอยู่คนละขอบเขต ไม่ใช่เพราะกฎที่ตั้งใจทดสอบ
  ('eaaaaaaa-0000-4000-8000-000000000005', 'จัดซื้อทดสอบเลขเอกสาร จ (ตัวอย่าง)',
   'e0000000-0000-4000-8000-000000000001', '2026-01-11',
   'e2222222-2222-4222-8222-222222222222');

-- ---------------------------------------------------------------------------
-- ฟังก์ชันช่วยแยกเลขลำดับ (F-13)
--
-- ตรวจก่อนอย่างอื่น เพราะถ้าฟังก์ชันนี้ผิด คอลัมน์ running_no ที่บันทึกไว้
-- จะโกหกทั้งตาราง โดยไม่มี test อื่นจับได้
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(public.normalize_document_number('๑๓/๒๕๖๙'), '13/2569',
  'เลขไทยถูกแปลงเป็นอารบิก');
select pg_temp.assert_eq(public.normalize_document_number('13 / 2569'), '13/2569',
  'ช่องว่างถูกตัดออก');
select pg_temp.assert_eq(public.document_running_no('๑๓/๒๕๖๙'), 13,
  'แยกเลขลำดับจากเลขไทยได้');
select pg_temp.assert_eq(public.document_running_no('ศธ04/0007/2569'), 7,
  'ข้ามตัวเลขในคำนำหน้า ไม่เอา 04 มาเป็นเลขลำดับ');
select pg_temp.assert_eq(public.document_running_no('ไม่มีตัวเลข'), null::integer,
  'เลขที่ไม่มีตัวเลขเลย คืนค่าว่าง');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- ต้องมีสิทธิ์ documents.issue จึงจะบันทึกได้
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'e2222222-2222-4222-8222-222222222222';

select pg_temp.assert_eq(
  (select public.has_permission('documents.issue')), false,
  'ผู้ขอไม่มีสิทธิ์ออกเลขเอกสาร');

select pg_temp.assert_fails(
  $$select public.document_number_record(
      'eaaaaaaa-0000-4000-8000-000000000001', 'REQUEST_MEMO', 'ISSUED', '1/2569', '2026-01-05')$$,
  'คุณไม่มีสิทธิ์',
  'ผู้ที่ไม่มีสิทธิ์บันทึกเลขไม่ได้');

-- ---------------------------------------------------------------------------
-- บันทึกเลขตามปกติ
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'e1111111-1111-4111-8111-111111111111';

select public.document_number_record(
  'eaaaaaaa-0000-4000-8000-000000000001', 'REQUEST_MEMO', 'ISSUED', '๑๓/๒๕๖๙', '2026-01-05');

select pg_temp.assert_eq(
  (select running_no from public.document_numbers
   where procurement_id = 'eaaaaaaa-0000-4000-8000-000000000001'),
  13, 'ฐานข้อมูลแยกเลขลำดับเก็บไว้เอง');

select pg_temp.assert_eq(
  (select document_no from public.document_numbers
   where procurement_id = 'eaaaaaaa-0000-4000-8000-000000000001'),
  '๑๓/๒๕๖๙', 'เก็บเลขตามที่โรงเรียนพิมพ์ ไม่แปลงเป็นอารบิก');

-- ---------------------------------------------------------------------------
-- เลขซ้ำ (F-12)
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$select public.document_number_record(
      'eaaaaaaa-0000-4000-8000-000000000002', 'REQUEST_MEMO', 'ISSUED', '๑๓/๒๕๖๙', '2026-01-06')$$,
  'ถูกใช้ไปแล้ว',
  'เลขเดียวกันเป๊ะ บันทึกซ้ำไม่ได้');

/*
 * กรณีที่สำคัญที่สุดของ test ชุดนี้
 *
 * ถ้าเทียบข้อความตรง ๆ โดยไม่ normalize `13/2569` จะไม่ชนกับ `๑๓/๒๕๖๙` เลย
 * แล้วทะเบียนจะมีสองแถวที่เป็นเลขเดียวกันในสายตาคน ซึ่งคือ F-12 ที่ยังไม่ได้ปิด
 */
select pg_temp.assert_fails(
  $$select public.document_number_record(
      'eaaaaaaa-0000-4000-8000-000000000002', 'REQUEST_MEMO', 'ISSUED', '13/2569', '2026-01-06')$$,
  'ถูกใช้ไปแล้ว',
  'เลขอารบิกที่มีค่าเท่ากับเลขไทยที่ใช้แล้ว ถือว่าซ้ำ');

select pg_temp.assert_fails(
  $$select public.document_number_record(
      'eaaaaaaa-0000-4000-8000-000000000002', 'REQUEST_MEMO', 'ISSUED', ' 13 / 2569 ', '2026-01-06')$$,
  'ถูกใช้ไปแล้ว',
  'ช่องว่างแทรกไม่ทำให้กลายเป็นเลขใหม่');

-- ---------------------------------------------------------------------------
-- ขอบเขตความไม่ซ้ำ — ต่างชนิดเอกสารและต่างปีงบ ใช้เลขเดียวกันได้
-- ---------------------------------------------------------------------------

select public.document_number_record(
  'eaaaaaaa-0000-4000-8000-000000000001', 'PURCHASE_ORDER', 'ISSUED', '๑๓/๒๕๖๙', '2026-01-08');

select pg_temp.assert_eq(
  (select count(*)::integer from public.document_numbers
   where procurement_id = 'eaaaaaaa-0000-4000-8000-000000000001'),
  2, 'เอกสารคนละชนิดใช้เลขเดียวกันได้');

select public.document_number_record(
  'eaaaaaaa-0000-4000-8000-000000000004', 'REQUEST_MEMO', 'ISSUED', '๑๓/๒๕๖๙', '2026-11-05');

select pg_temp.assert_eq(
  (select count(*)::integer from public.document_numbers where document_no = '๑๓/๒๕๖๙'),
  3, 'ปีงบคนละปีใช้เลขเดียวกันได้');

-- ---------------------------------------------------------------------------
-- รายการที่ไม่ต้องมีเลข (F-14)
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$select public.document_number_record(
      'eaaaaaaa-0000-4000-8000-000000000002', 'REQUEST_MEMO', 'NOT_REQUIRED')$$,
  'กรุณาระบุเหตุผล',
  'สถานะไม่ต้องมีเลข ต้องมีเหตุผล');

select pg_temp.assert_fails(
  $$select public.document_number_record(
      'eaaaaaaa-0000-4000-8000-000000000002', 'REQUEST_MEMO', 'NOT_REQUIRED', null, null, '   ')$$,
  'กรุณาระบุเหตุผล',
  'เหตุผลที่เป็นช่องว่างล้วนไม่นับ');

select public.document_number_record(
  'eaaaaaaa-0000-4000-8000-000000000002', 'REQUEST_MEMO', 'NOT_REQUIRED',
  null, null, 'ค่าสาธารณูปโภครายเดือน ไม่มีบันทึกขออนุมัติแยกฉบับ (ตัวอย่าง)');

select pg_temp.assert_eq(
  (select status::text from public.document_numbers
   where procurement_id = 'eaaaaaaa-0000-4000-8000-000000000002'),
  'NOT_REQUIRED', 'บันทึกว่าไม่ต้องมีเลขได้เมื่อมีเหตุผล');

-- ---------------------------------------------------------------------------
-- เลขที่ออกแล้วต้องมีวันที่
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$select public.document_number_record(
      'eaaaaaaa-0000-4000-8000-000000000003', 'REQUEST_MEMO', 'ISSUED', '20/2569')$$,
  'กรุณากรอกวันที่ออกเอกสาร',
  'ออกเลขแล้วต้องมีวันที่ออก');

select pg_temp.assert_fails(
  $$select public.document_number_record(
      'eaaaaaaa-0000-4000-8000-000000000003', 'REQUEST_MEMO', 'ISSUED', '   ', '2026-01-07')$$,
  'กรุณากรอกเลขที่เอกสาร',
  'เลขที่เป็นช่องว่างล้วนไม่นับ');

-- ---------------------------------------------------------------------------
-- หนึ่งรายการมีเลขที่ยังใช้งานอยู่ได้ชนิดละหนึ่งเลข
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$select public.document_number_record(
      'eaaaaaaa-0000-4000-8000-000000000001', 'REQUEST_MEMO', 'ISSUED', '99/2569', '2026-01-09')$$,
  'มีเลขที่เอกสารชนิดนี้อยู่แล้ว',
  'ออกเลขชนิดเดิมซ้ำให้รายการเดียวกันไม่ได้');

-- ---------------------------------------------------------------------------
-- การยกเลิก และเลขที่ยกเลิกแล้วห้ามนำกลับมาใช้
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$select public.document_number_record(
      'eaaaaaaa-0000-4000-8000-000000000003', 'REQUEST_MEMO', 'VOIDED', null, null, 'ยกเลิก')$$,
  'ต้องใช้ document_number_void',
  'สร้างแถวยกเลิกลอย ๆ เพื่อจองเลขไม่ได้');

select public.document_number_record(
  'eaaaaaaa-0000-4000-8000-000000000003', 'REQUEST_MEMO', 'ISSUED', '20/2569', '2026-01-07');

select pg_temp.assert_fails(
  $$select public.document_number_void(
      (select id from public.document_numbers where document_no = '20/2569'), '  ')$$,
  'ต้องระบุเหตุผล',
  'ยกเลิกโดยไม่ระบุเหตุผลไม่ได้');

select public.document_number_void(
  (select id from public.document_numbers where document_no = '20/2569'),
  'พิมพ์เลขผิด ออกใหม่เป็น 21/2569 (ตัวอย่าง)');

select pg_temp.assert_eq(
  (select status::text from public.document_numbers where document_no = '20/2569'),
  'VOIDED', 'ยกเลิกแล้วสถานะเปลี่ยน');

select pg_temp.assert_eq(
  (select document_no from public.document_numbers where document_no = '20/2569'),
  '20/2569', 'ยกเลิกแล้วเลขเดิมยังถูกเก็บไว้ ไม่ถูกล้างทิ้ง');

/*
 * เกณฑ์ตรวจรับของแผน PR-04: "void แล้วเลขเดิมไม่ถูกใช้ใหม่"
 *
 * ทำได้ด้วย unique index ที่ไม่กรอง VOIDED ออก ไม่ต้องมีตารางเลขต้องห้ามแยกอีกชุด
 *
 * ต้องทดสอบด้วยชนิดเอกสารและปีงบเดียวกับเลขที่ถูกยกเลิก — ครั้งแรกที่เขียน test นี้
 * ใช้ PURCHASE_ORDER แล้วบันทึกสำเร็จ ซึ่งถูกต้องตามขอบเขตความไม่ซ้ำ (คนละชนิด
 * ใช้เลขเดียวกันได้) แต่ไม่ได้ทดสอบสิ่งที่ตั้งใจเลย
 */
select pg_temp.assert_fails(
  $$select public.document_number_record(
      'eaaaaaaa-0000-4000-8000-000000000005', 'REQUEST_MEMO', 'ISSUED', '20/2569', '2026-01-11')$$,
  'ถูกใช้ไปแล้ว',
  'เลขที่ยกเลิกแล้วนำกลับมาใช้ไม่ได้');

/* เลขที่ยกเลิกในชนิดหนึ่ง ยังใช้ในชนิดอื่นได้ — ขอบเขตความไม่ซ้ำแยกตามชนิด */
select public.document_number_record(
  'eaaaaaaa-0000-4000-8000-000000000005', 'PURCHASE_ORDER', 'ISSUED', '20/2569', '2026-01-11');

-- ยกเลิกแล้วออกเลขใหม่ให้รายการเดิมได้
select public.document_number_record(
  'eaaaaaaa-0000-4000-8000-000000000003', 'REQUEST_MEMO', 'ISSUED', '21/2569', '2026-01-07');

select pg_temp.assert_eq(
  (select count(*)::integer from public.document_numbers
   where procurement_id = 'eaaaaaaa-0000-4000-8000-000000000003'),
  2, 'ยกเลิกแล้วออกเลขใหม่ให้รายการเดิมได้');

/* ระบุชนิดเอกสารด้วย เพราะถึงบรรทัดนี้ '20/2569' มีสองแถวแล้ว (คนละชนิด) */
select pg_temp.assert_fails(
  $$select public.document_number_void(
      (select id from public.document_numbers
       where document_no = '20/2569' and document_kind = 'REQUEST_MEMO'), 'ยกเลิกซ้ำ')$$,
  'ถูกยกเลิกไปแล้ว',
  'ยกเลิกซ้ำไม่ได้');

-- ---------------------------------------------------------------------------
-- เขียนตารางตรงไม่ได้
--
-- ถ้าเขียนตรงได้ การตรวจสิทธิ์ การกันเลขซ้ำ และ audit ทั้งหมดถูกข้ามได้ในคำสั่งเดียว
-- ---------------------------------------------------------------------------

select pg_temp.assert_fails(
  $$insert into public.document_numbers
      (procurement_id, document_kind, fiscal_year_id, status, document_no, issued_date, created_by)
    values ('eaaaaaaa-0000-4000-8000-000000000002', 'INSPECTION_REPORT',
            'e0000000-0000-4000-8000-000000000001', 'ISSUED', '77/2569', '2026-02-01',
            'e1111111-1111-4111-8111-111111111111')$$,
  'permission denied',
  'insert ตรงไม่ได้');

select pg_temp.assert_fails(
  $$update public.document_numbers set document_no = '78/2569' where document_no = '21/2569'$$,
  'permission denied',
  'update ตรงไม่ได้');

select pg_temp.assert_fails(
  $$delete from public.document_numbers where document_no = '21/2569'$$,
  'permission denied',
  'delete ตรงไม่ได้');

-- ---------------------------------------------------------------------------
-- audit
-- ---------------------------------------------------------------------------

/*
 * อ่าน audit ด้วยผู้ตรวจสอบภายใน ไม่ใช่เจ้าหน้าที่พัสดุ
 *
 * RLS ของ audit_events ต้องการสิทธิ์ audit.read ถ้าใช้บัญชีเจ้าหน้าที่พัสดุจะนับได้ 0
 * แล้วเข้าใจผิดว่า RPC ไม่ได้เขียน audit ทั้งที่เขียนแล้วแต่มองไม่เห็น
 */
set local request.jwt.claim.sub = 'e3333333-3333-4333-8333-333333333333';

select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events
   where entity_type = 'document_number' and action = 'document_number.record'),
  7, 'ทุกการบันทึกที่สำเร็จมี audit');

select pg_temp.assert_eq(
  (select count(*)::integer from public.audit_events
   where entity_type = 'document_number' and action = 'document_number.void'),
  1, 'การยกเลิกมี audit');

/*
 * การบันทึกที่ถูกปฏิเสธต้องไม่ทิ้งร่องรอยไว้
 *
 * ถ้าแถวที่ล้มยังค้างอยู่ ทะเบียนจะมีเลขที่ไม่เคยออกจริงปนอยู่ และเลขนั้นจะถูกกัน
 * ไม่ให้ใครใช้ตลอดไปทั้งที่ไม่มีเอกสารฉบับนั้น
 */
select pg_temp.assert_eq(
  (select count(*)::integer from public.document_numbers where document_no = '77/2569'),
  0, 'การบันทึกที่ถูกปฏิเสธไม่ทิ้งแถวไว้');

rollback;
