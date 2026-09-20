-- =============================================================================
-- ทดสอบฟังก์ชันรายงานสถานะเอกสารบน PostgreSQL จริง (PR-09c)
--
-- สิ่งที่ unit test พิสูจน์ไม่ได้และต้องรันที่นี่:
--
--   * **เลขที่ยกเลิกแล้วไม่นับเป็นช่องว่าง** เพราะมันถูกใช้ไปแล้วและนำกลับมา
--     ใช้ไม่ได้ ถ้านับเป็นช่องว่าง รายงานจะชวนให้คนไปกรอกเลขที่ระบบจะปฏิเสธ
--   * **เลขของรายการที่ถูกลบแบบ soft delete ยังกินที่ในลำดับ** แต่ไม่อยู่ใน
--     รายการข้อยกเว้น — สองฟังก์ชันตั้งใจปฏิบัติต่างกัน
--   * ช่วงที่กว้างเกินไปต้องไม่ทำให้ query ระเบิด แต่จำนวนเลขที่ขาดยังถูกต้อง
--   * เลขที่แยกลำดับไม่ได้ถูกนับแยก ไม่ถูกกลืนหายไปในตัวเลขอื่น
--   * ขอบเขตแถวมาจาก RLS — ผู้ที่มีเพียง procurement.read.own เห็นเฉพาะของตน
--     ส่วนผู้ถือ documents.issue เห็นทั้งเล่มตาม policy ของ migration 0014
--
-- ใช้ปีงบ พ.ศ. 2520/2521 เพราะ run-reservation-tests.sh **commit** ปีงบที่ครอบ
-- วันนี้ไว้ และ fiscal_years_no_overlap เป็น exclusion constraint
-- (budget_report_test ใช้ 2500/2501 · procurement_register_test ใช้ 2510/2511)
--
-- **ทุกข้อที่นับจำนวนจำกัดขอบเขตไว้ที่ข้อมูลของไฟล์นี้เอง** เพราะ CI รัน test
-- ชุดอื่นที่ commit ข้อมูลไว้ก่อนหน้า การนับ "ทุกแถวที่เห็น" จะได้ตัวเลขที่ขึ้นกับ
-- ลำดับการรัน ไม่ใช่ขึ้นกับสิ่งที่ไฟล์นี้ตั้งใจพิสูจน์
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
-- ผู้ใช้สมมติ — เจ้าหน้าที่พัสดุมี documents.issue ส่วนผู้ขอมีเพียง read.own
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('e1111111-1111-4111-8111-111111111111', 'ds-officer@example.test'),
  ('e2222222-2222-4222-8222-222222222222', 'ds-requester@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('e1111111-1111-4111-8111-111111111111', 'ds-officer@example.test',
   'ทดสอบ', 'พัสดุ', true),
  ('e2222222-2222-4222-8222-222222222222', 'ds-requester@example.test',
   'ทดสอบ', 'ผู้ขอ', true);

insert into public.user_roles (user_id, role_code) values
  ('e1111111-1111-4111-8111-111111111111', 'PROCUREMENT_OFFICER'),
  ('e2222222-2222-4222-8222-222222222222', 'REQUESTER');

insert into public.fiscal_years (id, code, year_be, start_date, end_date, status) values
  ('e0000000-0000-4000-8000-0000000000f1', 'FYDS1', 2520, '1976-10-01', '1977-09-30', 'OPEN'),
  ('e0000000-0000-4000-8000-0000000000f2', 'FYDS2', 2521, '1977-10-01', '1978-09-30', 'OPEN');

/*
 * หนึ่งรายการมีเลขที่ยังใช้งานอยู่ได้ฉบับละหนึ่งเลขเท่านั้น
 * (document_numbers_active_per_kind_idx) ลำดับหนึ่งลำดับจึงต้องกระจายอยู่บน
 * หลายรายการ เหมือนกับในงานจริงที่เลขเดินไปตามเอกสารของคนละเรื่อง
 */
insert into public.procurements
  (id, reference, subject, status, fiscal_year_id, request_date, created_by,
   deleted_at, deleted_by)
values
  ('e0000000-0000-4000-8000-0000000000a1', 'DS-0001', 'รายการที่หนึ่ง (ตัวอย่าง)',
   'ISSUED', 'e0000000-0000-4000-8000-0000000000f1', '1977-01-01',
   'e1111111-1111-4111-8111-111111111111', null, null),
  ('e0000000-0000-4000-8000-0000000000a2', 'DS-0002', 'รายการที่สอง (ตัวอย่าง)',
   'ISSUED', 'e0000000-0000-4000-8000-0000000000f1', '1977-01-02',
   'e1111111-1111-4111-8111-111111111111', null, null),
  ('e0000000-0000-4000-8000-0000000000a3', 'DS-0003', 'รายการที่สาม (ตัวอย่าง)',
   'ISSUED', 'e0000000-0000-4000-8000-0000000000f1', '1977-01-03',
   'e1111111-1111-4111-8111-111111111111', null, null),
  ('e0000000-0000-4000-8000-0000000000a4', 'DS-0004', 'รายการที่ถูกลบแล้ว (ตัวอย่าง)',
   'DRAFT', 'e0000000-0000-4000-8000-0000000000f1', '1977-01-04',
   'e1111111-1111-4111-8111-111111111111', now(), 'e1111111-1111-4111-8111-111111111111'),
  ('e0000000-0000-4000-8000-0000000000a5', 'DS-0005', 'รายการของผู้ขอ (ตัวอย่าง)',
   'DRAFT', 'e0000000-0000-4000-8000-0000000000f2', '1978-01-05',
   'e2222222-2222-4222-8222-222222222222', null, null);

/*
 * ลำดับ PURCHASE_ORDER ของปีงบแรก — รูปร่างเดียวกับข้อค้นพบ F-12 และ F-13
 *
 *   13  ออกเลขแล้ว (เลขไทยเหมือนในไฟล์จริง)
 *   91  ออกเลขแล้ว                          <- กระโดดจาก 13 ขาด 14–90 (F-13)
 *   91  ออกเลขแล้ว ข้อความต่างกัน            <- เลขลำดับซ้ำ (F-12)
 *
 * ทั้งสองแถวที่ลำดับ 91 บันทึกได้จริงเพราะ unique index เทียบจาก **ข้อความ**
 * ที่ทำให้เป็นมาตรฐานแล้ว ไม่ใช่จากเลขลำดับที่ระบบเดา — ซึ่งเป็นเหตุผลที่
 * รายงานนี้ต้องมีอยู่
 */
insert into public.document_numbers
  (procurement_id, document_kind, fiscal_year_id, status, document_no, running_no,
   issued_date, reason, created_by, voided_at, voided_by)
values
  ('e0000000-0000-4000-8000-0000000000a1', 'PURCHASE_ORDER',
   'e0000000-0000-4000-8000-0000000000f1', 'ISSUED', '๑๓/๒๕๒๐', 13,
   '1977-01-10', null, 'e1111111-1111-4111-8111-111111111111', null, null),
  ('e0000000-0000-4000-8000-0000000000a2', 'PURCHASE_ORDER',
   'e0000000-0000-4000-8000-0000000000f1', 'ISSUED', '91/2520', 91,
   '1977-01-11', null, 'e1111111-1111-4111-8111-111111111111', null, null),
  ('e0000000-0000-4000-8000-0000000000a3', 'PURCHASE_ORDER',
   'e0000000-0000-4000-8000-0000000000f1', 'ISSUED', 'ศธ04/91/2520', 91,
   '1977-01-12', null, 'e1111111-1111-4111-8111-111111111111', null, null);

/*
 * ลำดับ REQUEST_MEMO ของปีงบแรก — ใช้พิสูจน์สามเรื่องพร้อมกัน
 *
 *   1  ออกเลขแล้ว
 *   2  **ยกเลิกแล้ว** ต้องไม่นับเป็นช่องว่าง
 *   3  ออกเลขแล้วบนรายการที่ **ถูกลบ** ต้องยังกินที่ในลำดับ
 *
 * ถ้าทั้งสองข้อถูกนับเป็นช่องว่าง รายงานจะบอกว่าขาดเลข 2 และ 3 ทั้งที่ทั้งคู่
 * ถูกใช้ไปแล้วและนำกลับมาใช้ไม่ได้
 */
insert into public.document_numbers
  (procurement_id, document_kind, fiscal_year_id, status, document_no, running_no,
   issued_date, reason, created_by, voided_at, voided_by)
values
  ('e0000000-0000-4000-8000-0000000000a1', 'REQUEST_MEMO',
   'e0000000-0000-4000-8000-0000000000f1', 'ISSUED', '1/2520', 1,
   '1977-01-05', null, 'e1111111-1111-4111-8111-111111111111', null, null),
  ('e0000000-0000-4000-8000-0000000000a2', 'REQUEST_MEMO',
   'e0000000-0000-4000-8000-0000000000f1', 'VOIDED', '2/2520', 2,
   '1977-01-06', 'พิมพ์เลขผิด', 'e1111111-1111-4111-8111-111111111111',
   now(), 'e1111111-1111-4111-8111-111111111111'),
  ('e0000000-0000-4000-8000-0000000000a4', 'REQUEST_MEMO',
   'e0000000-0000-4000-8000-0000000000f1', 'ISSUED', '3/2520', 3,
   '1977-01-07', null, 'e1111111-1111-4111-8111-111111111111', null, null);

/*
 * ลำดับ INSPECTION_REPORT — เอกสารที่ยังไม่ได้เลข และที่ไม่ต้องมีเลข
 *
 * ลำดับนี้ไม่มีเลขสักเลข จึงเป็นรูปทรงที่หายไปจากรายงานได้ง่ายที่สุดถ้าใช้
 * ตารางของ "ขอบเขตเลข" เป็นแกนแทนที่จะใช้จำนวนเอกสาร
 */
insert into public.document_numbers
  (procurement_id, document_kind, fiscal_year_id, status, document_no, running_no,
   issued_date, reason, created_by, voided_at, voided_by)
values
  ('e0000000-0000-4000-8000-0000000000a1', 'INSPECTION_REPORT',
   'e0000000-0000-4000-8000-0000000000f1', 'PENDING', null, null,
   null, 'ยังไม่ได้รับเลขจากงานธุรการ', 'e1111111-1111-4111-8111-111111111111', null, null),
  ('e0000000-0000-4000-8000-0000000000a2', 'INSPECTION_REPORT',
   'e0000000-0000-4000-8000-0000000000f1', 'NOT_REQUIRED', null, null,
   null, 'เป็นค่าสาธารณูปโภคที่ไม่ต้องออกใบตรวจรับ',
   'e1111111-1111-4111-8111-111111111111', null, null);

/*
 * ลำดับ OTHER — เลขที่แยกลำดับไม่ได้ และช่วงที่กว้างเกินเพดาน
 *
 * แถวแรกไม่มีตัวเลขเลย running_no จึงเป็น null และต้องถูกนับแยก
 * อีกสองแถวเป็น 1 กับ 50000 ซึ่งทำให้ช่วงกว้าง 49,999 — เกินเพดาน 10,000
 * การ generate_series ข้ามช่วงนั้นจะสร้างแถวจำนวนมหาศาล
 */
insert into public.document_numbers
  (procurement_id, document_kind, fiscal_year_id, status, document_no, running_no,
   issued_date, reason, created_by, voided_at, voided_by)
values
  ('e0000000-0000-4000-8000-0000000000a1', 'OTHER',
   'e0000000-0000-4000-8000-0000000000f1', 'ISSUED', 'ไม่มีตัวเลขในเลขนี้', null,
   '1977-02-01', null, 'e1111111-1111-4111-8111-111111111111', null, null),
  ('e0000000-0000-4000-8000-0000000000a2', 'OTHER',
   'e0000000-0000-4000-8000-0000000000f1', 'ISSUED', 'A-1', 1,
   '1977-02-02', null, 'e1111111-1111-4111-8111-111111111111', null, null),
  ('e0000000-0000-4000-8000-0000000000a3', 'OTHER',
   'e0000000-0000-4000-8000-0000000000f1', 'ISSUED', 'A-50000', 50000,
   '1977-02-03', null, 'e1111111-1111-4111-8111-111111111111', null, null);

/*
 * เอกสารที่ยังไม่ได้เลข **บนรายการที่ถูกลบแล้ว**
 *
 * ต้องเป็นสถานะที่ไม่ใช่ ISSUED จึงจะพิสูจน์ตัวกรอง deleted_at ของรายการ
 * ข้อยกเว้นได้จริง — ถ้าใช้แถว ISSUED ตัวกรอง `status <> 'ISSUED'` จะตัดทิ้ง
 * ไปก่อนอยู่แล้ว แล้วข้อทดสอบจะผ่านด้วยเหตุผลที่ผิด
 */
insert into public.document_numbers
  (procurement_id, document_kind, fiscal_year_id, status, document_no, running_no,
   issued_date, reason, created_by, voided_at, voided_by)
values
  ('e0000000-0000-4000-8000-0000000000a4', 'PURCHASE_ORDER',
   'e0000000-0000-4000-8000-0000000000f1', 'PENDING', null, null,
   null, 'ค้างไว้ก่อนรายการจะถูกลบ', 'e1111111-1111-4111-8111-111111111111', null, null);

/* ลำดับของปีงบที่สอง บนรายการของผู้ขอ — ใช้พิสูจน์ตัวกรองปีและขอบเขตของ RLS */
insert into public.document_numbers
  (procurement_id, document_kind, fiscal_year_id, status, document_no, running_no,
   issued_date, reason, created_by, voided_at, voided_by)
values
  ('e0000000-0000-4000-8000-0000000000a5', 'REQUEST_MEMO',
   'e0000000-0000-4000-8000-0000000000f2', 'PENDING', null, null,
   null, 'รอเลขของปีงบใหม่', 'e1111111-1111-4111-8111-111111111111', null, null);

-- ---------------------------------------------------------------------------
-- อ่านในนามเจ้าหน้าที่พัสดุ (documents.issue + procurement.read.all)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'e1111111-1111-4111-8111-111111111111';

select pg_temp.assert_eq(
  (select public.has_permission('documents.issue')), true,
  'เจ้าหน้าที่พัสดุมีสิทธิ์ออกเลขเอกสาร');

-- ---------------------------------------------------------------------------
-- F-13 — เลขกระโดด
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select missing_count from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'PURCHASE_ORDER')),
  77, 'เลขกระโดดจาก 13 ไป 91 ขาด 77 เลข');

select pg_temp.assert_eq(
  (select missing_sample[1] from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'PURCHASE_ORDER')),
  14, 'เลขแรกที่ขาดคือ 14');

/* เพดานตัวอย่างคือ 200 ซึ่งมากกว่า 77 จึงต้องได้ครบทั้งหมดในกรณีนี้ */
select pg_temp.assert_eq(
  (select array_length(missing_sample, 1) from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'PURCHASE_ORDER')),
  77, 'ตัวอย่างเลขที่ขาดครบทั้ง 77 เลขเมื่อไม่เกินเพดาน');

-- ---------------------------------------------------------------------------
-- F-12 — เลขลำดับซ้ำ
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select duplicate_running from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'PURCHASE_ORDER')),
  array[91], 'ลำดับ 91 ปรากฏสองแถว และคืนมาเลขละหนึ่งครั้ง');

select pg_temp.assert_eq(
  (select issued_count from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'PURCHASE_ORDER')),
  3, 'นับเอกสารที่ออกเลขแล้วครบทั้งสามฉบับ');

select pg_temp.assert_eq(
  (select used_running_count from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'PURCHASE_ORDER')),
  2, 'เลขลำดับที่ไม่ซ้ำกันมีสองเลข ทั้งที่เอกสารมีสามฉบับ');

-- ---------------------------------------------------------------------------
-- เลขที่ยกเลิกแล้วและเลขของรายการที่ถูกลบ ต้องไม่นับเป็นช่องว่าง
--
-- ลำดับ REQUEST_MEMO ของปีงบแรกมีเลข 1 (ออกแล้ว), 2 (ยกเลิก), 3 (บนรายการที่ถูกลบ)
-- ถ้าฟังก์ชันนับเฉพาะ ISSUED ของรายการที่ยังอยู่ จะประกาศว่าขาดเลข 2
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select missing_count from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'REQUEST_MEMO')),
  0, 'เลขที่ยกเลิกแล้วและเลขของรายการที่ถูกลบไม่นับเป็นช่องว่าง');

select pg_temp.assert_eq(
  (select voided_count from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'REQUEST_MEMO')),
  1, 'นับเลขที่ยกเลิกแล้วแยกไว้');

select pg_temp.assert_eq(
  (select max_running from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'REQUEST_MEMO')),
  3, 'เลขของรายการที่ถูกลบยังเป็นขอบบนของลำดับ');

-- ---------------------------------------------------------------------------
-- ลำดับที่ยังไม่มีเลขสักเลข ต้องไม่หายไป
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select pending_count from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'INSPECTION_REPORT')),
  1, 'ลำดับที่ยังไม่มีเลขสักเลขยังอยู่ในรายงาน');

select pg_temp.assert_eq(
  (select not_required_count from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'INSPECTION_REPORT')),
  1, 'นับเอกสารที่ไม่ต้องมีเลขแยกไว้');

select pg_temp.assert_eq(
  (select min_running from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'INSPECTION_REPORT')),
  null::integer, 'ลำดับที่ไม่มีเลขเลยไม่มีขอบล่าง');

select pg_temp.assert_eq(
  (select missing_count from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'INSPECTION_REPORT')),
  0, 'ลำดับที่ไม่มีเลขเลยไม่ถือว่าขาดเลข');

-- ---------------------------------------------------------------------------
-- เลขที่แยกลำดับไม่ได้ และช่วงที่กว้างเกินเพดาน
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select unparsed_count from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'OTHER')),
  1, 'เลขที่แยกลำดับไม่ได้ถูกนับแยก');

select pg_temp.assert_eq(
  (select issued_count from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'OTHER')),
  3, 'เลขที่แยกลำดับไม่ได้ยังนับเป็นเอกสารที่ออกเลขแล้ว');

/*
 * จำนวนเลขที่ขาดต้องถูกต้องแม้ช่วงจะกว้างเกินกว่าจะไล่รายตัว
 * 50000 − 1 + 1 − 2 = 49,998
 */
select pg_temp.assert_eq(
  (select missing_count from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'OTHER')),
  49998, 'จำนวนเลขที่ขาดคิดด้วยเลขคณิต จึงถูกต้องแม้ช่วงจะกว้างมาก');

select pg_temp.assert_eq(
  (select coalesce(array_length(missing_sample, 1), 0)
   from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'OTHER')),
  0, 'ช่วงที่กว้างเกินเพดานไม่ไล่ตัวอย่างให้ แทนที่จะสร้างแถวมหาศาล');

-- ---------------------------------------------------------------------------
-- ตัวกรอง
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select count(*)::integer from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1')),
  4, 'ปีงบแรกมีสี่ลำดับ');

select pg_temp.assert_eq(
  (select count(*)::integer from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f2')),
  1, 'ปีงบที่สองมีลำดับเดียว');

select pg_temp.assert_eq(
  (select string_agg(document_kind::text, ',' order by document_kind::text)
   from public.document_sequence_rows(null, 'PURCHASE_ORDER')
   where fiscal_year_code like 'FYDS%'),
  'PURCHASE_ORDER', 'กรองชนิดเอกสารได้');

-- ---------------------------------------------------------------------------
-- รายการข้อยกเว้น
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select count(*)::integer from public.document_number_exceptions()
   where fiscal_year_code like 'FYDS%'),
  4, 'ข้อยกเว้นทั้งหมดสี่ฉบับ (รอเลข 2 · ไม่ต้องมีเลข 1 · ยกเลิก 1)');

select pg_temp.assert_eq(
  (select count(*)::integer from public.document_number_exceptions(null, null, 'PENDING')
   where fiscal_year_code like 'FYDS%'),
  2, 'กรองเฉพาะที่รอออกเลข');

select pg_temp.assert_eq(
  (select count(*)::integer from public.document_number_exceptions()
   where fiscal_year_code like 'FYDS%' and status = 'ISSUED'),
  0, 'เอกสารที่ออกเลขแล้วไม่ใช่ข้อยกเว้น');

select pg_temp.assert_eq(
  (select document_no from public.document_number_exceptions(null, 'REQUEST_MEMO', 'VOIDED')
   where fiscal_year_code like 'FYDS%'),
  '2/2520', 'เลขเดิมของฉบับที่ยกเลิกยังอ่านได้ในรายการข้อยกเว้น');

/*
 * เอกสารของรายการที่ถูกลบไม่อยู่ในรายการข้อยกเว้น
 *
 * ตรงข้ามกับการวิเคราะห์ลำดับด้านบนโดยตั้งใจ — ลำดับต้องนับเลขที่ถูกกินไปแล้ว
 * ทุกเลขจึงจะไม่ประกาศช่องว่างปลอม ส่วนรายการข้อยกเว้นเป็นงานที่ต้องตามต่อ
 * และไม่มีใครต้องตามเอกสารของรายการที่ถูกลบไปแล้ว
 */
select pg_temp.assert_eq(
  (select count(*)::integer from public.document_number_exceptions()
   where procurement_reference = 'DS-0004'),
  0, 'เอกสารของรายการที่ถูกลบไม่อยู่ในรายการข้อยกเว้น');

/*
 * ข้อคู่กับข้อบน — แถวเดียวกันนั้น **ยังถูกนับในการวิเคราะห์ลำดับ**
 *
 * สองฟังก์ชันตั้งใจปฏิบัติกับรายการที่ถูกลบต่างกัน ถ้าวันหนึ่งมีใครทำให้
 * เหมือนกัน ข้อใดข้อหนึ่งในสองข้อนี้จะล้มเสมอ
 */
select pg_temp.assert_eq(
  (select pending_count from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1', 'PURCHASE_ORDER')),
  1, 'เอกสารที่ค้างของรายการที่ถูกลบยังถูกนับในการวิเคราะห์ลำดับ');

select pg_temp.assert_eq(
  (select count(*)::integer from public.document_number_exceptions(
     null, null, null, 1)
   where fiscal_year_code like 'FYDS%'),
  1, 'เพดานจำนวนแถวมีผลจริง');

select pg_temp.assert_eq(
  (select count(*)::integer from public.document_number_exceptions(
     null, null, null, 0)
   where fiscal_year_code like 'FYDS%'),
  1, 'เพดานที่ต่ำกว่าหนึ่งถูกดึงขึ้นเป็นหนึ่ง');

select pg_temp.assert_eq(
  (select procurement_reference from public.document_number_exceptions(
     null, 'INSPECTION_REPORT', 'PENDING')
   where fiscal_year_code like 'FYDS%'),
  'DS-0001', 'ข้อยกเว้นผูกกับรายการต้นทางที่ถูกต้อง');

-- ---------------------------------------------------------------------------
-- ขอบเขตแถวมาจาก RLS ไม่ใช่จากหน้าจอ
--
-- ผู้ขอมีเพียง procurement.read.own และไม่มี documents.issue จึงเห็นเฉพาะ
-- เลขของรายการที่ตนสร้าง — ลำดับที่เขาเห็นจึงไม่ใช่ลำดับทั้งเล่ม
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'e2222222-2222-4222-8222-222222222222';

select pg_temp.assert_eq(
  (select public.has_permission('documents.issue')), false,
  'ผู้ขอไม่มีสิทธิ์ออกเลขเอกสาร');

select pg_temp.assert_eq(
  (select count(*)::integer from public.document_sequence_rows()
   where fiscal_year_code like 'FYDS%'),
  1, 'ผู้ขอเห็นเฉพาะลำดับที่มีเอกสารของตน');

select pg_temp.assert_eq(
  (select count(*)::integer from public.document_sequence_rows(
     'e0000000-0000-4000-8000-0000000000f1')),
  0, 'ผู้ขอระบุปีงบที่ไม่มีเอกสารของตนก็ยังได้ศูนย์แถว');

select pg_temp.assert_eq(
  (select count(*)::integer from public.document_number_exceptions()
   where fiscal_year_code like 'FYDS%'),
  1, 'ผู้ขอเห็นข้อยกเว้นเฉพาะของรายการตน');

-- ---------------------------------------------------------------------------
-- ข้อที่ทำให้ข้อบนทั้งหมดมีความหมาย
--
-- ถ้าฟังก์ชันถูกเปลี่ยนเป็น security definer วันหนึ่ง ข้อบนจะกลายเป็นเท็จทันที
-- และไม่มีอะไรอื่นในระบบที่ฟ้อง เพราะ definer เป็นค่าที่ function อื่นในโปรเจกต์นี้
-- ใช้กันเป็นปกติ — จึงตรวจตรง ๆ ที่ catalog
-- ---------------------------------------------------------------------------

reset role;

select pg_temp.assert_eq(
  (select bool_or(p.prosecdef) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('document_sequence_rows', 'document_number_exceptions')),
  false, 'ทั้งสองฟังก์ชันเป็น security invoker เพื่อให้ RLS เป็นตัวบังคับ');

select pg_temp.assert_eq(
  (select count(*)::integer from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('document_sequence_rows', 'document_number_exceptions')
     and has_function_privilege('authenticated', p.oid, 'execute')),
  2, 'ผู้ที่เข้าสู่ระบบแล้วเรียกได้ทั้งสองฟังก์ชัน');

/*
 * แม้ `anon` จะเรียกฟังก์ชันได้ ก็ต้องไม่ได้ข้อมูลสักแถว
 *
 * ให้ EXECUTE กับ `anon` ในทรานแซกชันนี้เองเพื่อจำลองสภาพของ Supabase จริง
 * ซึ่งให้สิทธิ์นั้นเป็นค่าเริ่มต้นกับฟังก์ชันใน schema public — grant นี้ย้อนกลับ
 * พร้อม rollback ท้ายไฟล์ ข้อนี้จึงให้คำตอบเดียวกันทั้งบน harness และบน CI
 *
 * สิ่งที่กันจริงคือ RLS ของ document_numbers ซึ่งเป็น `to authenticated`
 * ไม่ใช่ grant ระดับฟังก์ชัน
 */
grant execute on function public.document_sequence_rows(uuid, public.document_kind) to anon;

set local role anon;

select pg_temp.assert_eq(
  (select count(*)::integer from public.document_sequence_rows()),
  0, 'ผู้ที่ยังไม่เข้าสู่ระบบไม่ได้ข้อมูลสักแถว');

reset role;

rollback;
