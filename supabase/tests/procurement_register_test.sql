-- =============================================================================
-- ทดสอบฟังก์ชันทะเบียนจัดซื้อจัดจ้างบน PostgreSQL จริง (PR-09b)
--
-- สิ่งที่ unit test พิสูจน์ไม่ได้และต้องรันที่นี่:
--
--   * **ขอบเขตแถวมาจาก RLS ไม่ใช่จากหน้าจอ** — ผู้ที่มีเพียง
--     procurement.read.own เห็นเฉพาะรายการของตน แม้จะเรียก RPC ตรงก็ตาม
--     นี่คือข้อที่จะกลายเป็นเท็จทันทีถ้ามีใครเปลี่ยนฟังก์ชันเป็น security definer
--   * ยอดที่ฟังก์ชันคืน **ตรงกับ view procurement_totals ทุกรายการ**
--     ซึ่งเป็นเกณฑ์ตรวจรับข้อแรกของ PR-09 ("ยอดรวม report เท่ากับ query source")
--   * รายการที่ถูกลบแบบ soft delete ไม่อยู่ในทะเบียน
--   * ตัวกรองปีงบ ประเภท สถานะ และช่วงวันที่ ไม่ปล่อยข้อมูลข้าม scope
--   * เลขที่เอกสารหยิบฉบับที่ยังใช้งานอยู่ก่อน และไม่ข้ามชนิดเอกสารกัน
--   * รายการที่ยังไม่มีผู้ขาย ไม่มีรายการย่อย หรือไม่มีเลขเอกสาร **ต้องไม่หายไป**
--   * ลำดับและเพดานจำนวนแถวทำงานร่วมกันได้จริง
--
-- ใช้ปีงบ พ.ศ. 2510/2511 เพราะ run-reservation-tests.sh **commit** ปีงบที่ครอบ
-- วันนี้ไว้ และ fiscal_years_no_overlap เป็น exclusion constraint
-- ปีที่ห่างออกไปมากจึงเป็นค่าเดียวที่ปลอดภัยไม่ว่าลำดับการรันจะเป็นอย่างไร
-- (budget_report_test ใช้ 2500/2501 อยู่แล้ว จึงเลี่ยงไปอีกช่วงหนึ่ง)
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
-- ผู้ใช้สมมติ — เจ้าหน้าที่พัสดุมี read.all ส่วนผู้ขอมีเพียง read.own
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('c1111111-1111-4111-8111-111111111111', 'reg-officer@example.test'),
  ('c2222222-2222-4222-8222-222222222222', 'reg-requester@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('c1111111-1111-4111-8111-111111111111', 'reg-officer@example.test',
   'ทดสอบ', 'พัสดุ', true),
  ('c2222222-2222-4222-8222-222222222222', 'reg-requester@example.test',
   'ทดสอบ', 'ผู้ขอ', true);

insert into public.user_roles (user_id, role_code) values
  ('c1111111-1111-4111-8111-111111111111', 'PROCUREMENT_OFFICER'),
  ('c2222222-2222-4222-8222-222222222222', 'REQUESTER');

-- ---------------------------------------------------------------------------
-- ข้อมูลพื้นฐาน — สองปีงบ เพื่อพิสูจน์ว่าตัวกรองปีไม่ปล่อยข้อมูลข้าม scope
-- ---------------------------------------------------------------------------

insert into public.fiscal_years (id, code, year_be, start_date, end_date, status) values
  ('c0000000-0000-4000-8000-0000000000f1', 'FYRG1', 2510, '1966-10-01', '1967-09-30', 'OPEN'),
  ('c0000000-0000-4000-8000-0000000000f2', 'FYRG2', 2511, '1967-10-01', '1968-09-30', 'OPEN');

insert into public.departments (id, code, name_th) values
  ('c0000000-0000-4000-8000-0000000000d1', 'DP-RG1', 'ฝ่ายทดสอบทะเบียน (ตัวอย่าง)');

insert into public.vendors (id, vendor_code, name) values
  ('c0000000-0000-4000-8000-0000000000e1', 'VD-RG1', 'ร้านทดสอบทะเบียน (ตัวอย่าง)');

insert into public.budget_accounts (id, code, fiscal_year_id, department_id, status) values
  ('c0000000-0000-4000-8000-0000000000b1', 'ACC-RG1',
   'c0000000-0000-4000-8000-0000000000f1', 'c0000000-0000-4000-8000-0000000000d1', 'OPEN');

/*
 * รายการจัดซื้อครบทุกรูปทรงที่ทะเบียนต้องรับมือ
 *
 *   P1 ครบถ้วน ออกใบสั่งซื้อแล้ว มีเลขทั้งสองฉบับ ยอดตรงกับแหล่งเงิน
 *   P2 ออกใบสั่งซื้อแล้วแต่เลขถูกยกเลิก — ต้องยังเห็นว่าเคยมีเลขและถูกยกเลิก
 *   P3 ไม่มีผู้ขาย ไม่มีรายการย่อย ไม่มีเลขเอกสาร และยังเป็นฉบับร่าง
 *      — รูปทรงที่หายไปจากรายงานได้ง่ายที่สุดถ้าใช้ inner join
 *   P4 ของผู้ขอ ไม่ใช่ของเจ้าหน้าที่ — ใช้พิสูจน์ขอบเขตของ RLS
 *   P5 ปีงบถัดไป — ใช้พิสูจน์ตัวกรองปี
 *   P6 ถูกลบแบบ soft delete — ต้องไม่อยู่ในทะเบียน
 *
 * ตั้ง reference เองเพื่อให้ลำดับที่คาดหวังเป็นค่าที่แน่นอน ไม่ขึ้นกับ sequence
 * ที่อาจถูกเลื่อนไปแล้วจากการรัน test ชุดอื่นก่อนหน้า
 */
insert into public.procurements
  (id, reference, subject, status, classification, procurement_method, is_emergency,
   fiscal_year_id, department_id, vendor_id, request_date, order_or_agreement_date,
   created_by, deleted_at, deleted_by)
values
  ('c0000000-0000-4000-8000-0000000000c1', 'RG-0001', 'ซื้อวัสดุสำนักงาน (ตัวอย่าง)',
   'ISSUED', 'GOODS', 'SPECIFIC', false,
   'c0000000-0000-4000-8000-0000000000f1', 'c0000000-0000-4000-8000-0000000000d1',
   'c0000000-0000-4000-8000-0000000000e1', '1967-01-10', '1967-01-20',
   'c1111111-1111-4111-8111-111111111111', null, null),

  ('c0000000-0000-4000-8000-0000000000c2', 'RG-0002', 'จ้างซ่อมเครื่องปรับอากาศ (ตัวอย่าง)',
   'ISSUED', 'SERVICE', 'SPECIFIC', true,
   'c0000000-0000-4000-8000-0000000000f1', 'c0000000-0000-4000-8000-0000000000d1',
   'c0000000-0000-4000-8000-0000000000e1', '1967-02-10', '1967-02-20',
   'c1111111-1111-4111-8111-111111111111', null, null),

  ('c0000000-0000-4000-8000-0000000000c3', 'RG-0003', 'รายการที่ยังกรอกไม่ครบ (ตัวอย่าง)',
   'DRAFT', null, null, false,
   'c0000000-0000-4000-8000-0000000000f1', null, null, '1967-03-10', null,
   'c1111111-1111-4111-8111-111111111111', null, null),

  ('c0000000-0000-4000-8000-0000000000c4', 'RG-0004', 'รายการของผู้ขอ (ตัวอย่าง)',
   'PENDING_REVIEW', 'GOODS', 'SPECIFIC', false,
   'c0000000-0000-4000-8000-0000000000f1', null, null, '1967-04-10', null,
   'c2222222-2222-4222-8222-222222222222', null, null),

  ('c0000000-0000-4000-8000-0000000000c5', 'RG-0005', 'รายการปีงบถัดไป (ตัวอย่าง)',
   'ISSUED', 'GOODS', 'SPECIFIC', false,
   'c0000000-0000-4000-8000-0000000000f2', null,
   'c0000000-0000-4000-8000-0000000000e1', '1967-11-10', '1967-11-20',
   'c1111111-1111-4111-8111-111111111111', null, null),

  ('c0000000-0000-4000-8000-0000000000c6', 'RG-0006', 'รายการที่ถูกลบแล้ว (ตัวอย่าง)',
   'DRAFT', 'GOODS', 'SPECIFIC', false,
   'c0000000-0000-4000-8000-0000000000f1', null, null, '1967-05-10', null,
   'c1111111-1111-4111-8111-111111111111', now(), 'c1111111-1111-4111-8111-111111111111');

insert into public.procurement_items
  (procurement_id, line_no, description, quantity, unit_price) values
  ('c0000000-0000-4000-8000-0000000000c1', 1, 'กระดาษ A4 (ตัวอย่าง)', 10, 100),
  ('c0000000-0000-4000-8000-0000000000c2', 1, 'ค่าแรงซ่อม (ตัวอย่าง)', 1, 500),
  ('c0000000-0000-4000-8000-0000000000c4', 1, 'หมึกพิมพ์ (ตัวอย่าง)', 2, 250),
  ('c0000000-0000-4000-8000-0000000000c5', 1, 'โต๊ะทำงาน (ตัวอย่าง)', 1, 3000),
  ('c0000000-0000-4000-8000-0000000000c6', 1, 'รายการของที่ถูกลบ (ตัวอย่าง)', 1, 9999);

/* P1 แหล่งเงินตรงยอด · P2 ผูกแหล่งเงินไว้น้อยกว่ายอด (ข้อสังเกต F-02) */
insert into public.procurement_funding_allocations
  (procurement_id, budget_account_id, line_no, amount) values
  ('c0000000-0000-4000-8000-0000000000c1',
   'c0000000-0000-4000-8000-0000000000b1', 1, 1000),
  ('c0000000-0000-4000-8000-0000000000c2',
   'c0000000-0000-4000-8000-0000000000b1', 1, 300);

/*
 * เลขที่เอกสาร
 *
 * P1 มีครบทั้งสองฉบับ
 * P2 ออกเลขใบสั่งซื้อแล้วยกเลิก และ **ยังไม่ได้ออกใหม่**
 *    — แถว VOIDED ต้องยังปรากฏ ไม่ใช่กลายเป็นช่องว่างเหมือนรายการที่ไม่เคยมีเลข
 * P5 มีเฉพาะบันทึกขออนุมัติ ไม่มีใบสั่งซื้อ — ใช้พิสูจน์ว่าสองชนิดไม่ปนกัน
 */
insert into public.document_numbers
  (procurement_id, document_kind, fiscal_year_id, status, document_no, running_no,
   issued_date, reason, created_by, voided_at, voided_by)
values
  ('c0000000-0000-4000-8000-0000000000c1', 'REQUEST_MEMO',
   'c0000000-0000-4000-8000-0000000000f1', 'ISSUED', 'RG-MEMO-1', 1,
   '1967-01-11', null, 'c1111111-1111-4111-8111-111111111111', null, null),
  ('c0000000-0000-4000-8000-0000000000c1', 'PURCHASE_ORDER',
   'c0000000-0000-4000-8000-0000000000f1', 'ISSUED', 'RG-PO-1', 1,
   '1967-01-20', null, 'c1111111-1111-4111-8111-111111111111', null, null),
  ('c0000000-0000-4000-8000-0000000000c2', 'PURCHASE_ORDER',
   'c0000000-0000-4000-8000-0000000000f1', 'VOIDED', 'RG-PO-2', 2,
   '1967-02-20', 'พิมพ์เลขผิด ต้องออกใหม่', 'c1111111-1111-4111-8111-111111111111',
   now(), 'c1111111-1111-4111-8111-111111111111'),
  ('c0000000-0000-4000-8000-0000000000c5', 'REQUEST_MEMO',
   'c0000000-0000-4000-8000-0000000000f2', 'ISSUED', 'RG-MEMO-5', 5,
   '1967-11-11', null, 'c1111111-1111-4111-8111-111111111111', null, null);

/*
 * P1 มีเลขที่ถูกยกเลิกซึ่ง **ถูกบันทึกทีหลัง** เลขที่ใช้งานอยู่
 *
 * ในเส้นทางปกติของแอปเป็นไปไม่ได้ เพราะต้องยกเลิกเลขเดิมก่อนจึงออกเลขใหม่ได้
 * แต่การนำเข้าข้อมูลเดิมเข้าฐานข้อมูลตรง ๆ ทำให้เกิดขึ้นได้ และถ้าทะเบียนเรียง
 * ตามเวลาบันทึกอย่างเดียว มันจะแสดงเลขที่ถูกยกเลิกแทนเลขที่ใช้งานอยู่จริง
 * — ผู้อ่านจะเข้าใจว่ารายการนี้ยังไม่มีเลข ทั้งที่มี
 */
insert into public.document_numbers
  (procurement_id, document_kind, fiscal_year_id, status, document_no, running_no,
   issued_date, reason, created_by, created_at, voided_at, voided_by)
values
  ('c0000000-0000-4000-8000-0000000000c1', 'PURCHASE_ORDER',
   'c0000000-0000-4000-8000-0000000000f1', 'VOIDED', 'RG-PO-1-OLD', 9,
   '1967-01-15', 'เลขเดิมที่ถูกนำเข้าภายหลัง', 'c1111111-1111-4111-8111-111111111111',
   now() + interval '1 day', now(), 'c1111111-1111-4111-8111-111111111111');

-- ---------------------------------------------------------------------------
-- อ่านในนามเจ้าหน้าที่พัสดุ (procurement.read.all)
--
-- **ทุกข้อที่นับจำนวนต้องจำกัดขอบเขตไว้ที่ข้อมูลของไฟล์นี้เอง**
--
-- run-reservation-tests.sh **commit** รายการจัดซื้อไว้ในฐานข้อมูลเดียวกัน และ
-- CI รันไฟล์นั้นก่อนไฟล์นี้ การนับ "ทุกแถวที่เห็น" จึงได้ตัวเลขที่ขึ้นกับลำดับ
-- การรัน ไม่ใช่ขึ้นกับสิ่งที่ไฟล์นี้ตั้งใจพิสูจน์
--
-- จำกัดด้วยสองวิธีตามความเหมาะสม: `reference like 'RG-%'` สำหรับการนับแถว
-- และช่วงวันที่ พ.ศ. 2509–2512 สำหรับข้อที่ต้องส่งตัวกรองเข้าไปในฟังก์ชันเอง
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'c1111111-1111-4111-8111-111111111111';

select pg_temp.assert_eq(
  (select public.has_permission('procurement.read.all')), true,
  'เจ้าหน้าที่พัสดุมีสิทธิ์อ่านทุกรายการ');

-- แถวที่ควรได้: P1 P2 P3 P4 P5 (ไม่รวม P6 ที่ถูกลบ)
select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_register_rows()
   where reference like 'RG-%'),
  5, 'เห็นทุกรายการที่ยังไม่ถูกลบ');

select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_register_rows()
   where reference = 'RG-0006'),
  0, 'รายการที่ถูกลบแล้วไม่อยู่ในทะเบียน');

-- ---------------------------------------------------------------------------
-- ยอดเงินต้องตรงกับ view procurement_totals ทุกแถว
--
-- นี่คือเกณฑ์ตรวจรับข้อแรกของ PR-09 ถ้าวันหนึ่งมีใครคำนวณยอดซ้ำในฟังก์ชันนี้
-- แทนที่จะอ่านจาก view ข้อนี้จะล้มทันที
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select count(*)::integer
   from public.procurement_register_rows() r
   join public.procurement_totals t on t.procurement_id = r.procurement_id
   where r.grand_total is distinct from t.grand_total
      or r.funding_total is distinct from t.funding_total),
  0, 'ยอดทุกแถวตรงกับ view procurement_totals');

select pg_temp.assert_eq(
  (select grand_total from public.procurement_register_rows()
   where reference = 'RG-0001'),
  1000.00::numeric(18, 2), 'ยอดของรายการที่มีรายการย่อย');

select pg_temp.assert_eq(
  (select funding_total from public.procurement_register_rows()
   where reference = 'RG-0001'),
  1000.00::numeric(18, 2), 'แหล่งเงินของรายการที่ผูกครบ');

/* ยอดแหล่งเงินน้อยกว่ายอดรายการ — ข้อสังเกต F-02 ที่หน้าจอต้องยกขึ้นมา */
select pg_temp.assert_eq(
  (select funding_total from public.procurement_register_rows()
   where reference = 'RG-0002'),
  300.00::numeric(18, 2), 'แหล่งเงินที่ผูกไว้ไม่ครบยังคืนค่าจริง ไม่ปัดเป็นยอดรายการ');

/*
 * รายการที่ยังไม่มีรายการย่อยเลยต้องได้ศูนย์ ไม่ใช่ null และต้องไม่หายไป
 *
 * ถ้า join กับ procurement_totals แบบ inner join รายการแบบนี้จะหายทั้งแถว
 * ซึ่งเป็นแถวที่ผู้ตรวจต้องเห็นมากที่สุด
 */
select pg_temp.assert_eq(
  (select grand_total from public.procurement_register_rows()
   where reference = 'RG-0003'),
  0.00::numeric(18, 2), 'รายการที่ยังไม่มีรายการย่อยได้ยอดศูนย์ ไม่ใช่หายไป');

select pg_temp.assert_eq(
  (select vendor_name from public.procurement_register_rows()
   where reference = 'RG-0003'),
  null::text, 'รายการที่ยังไม่มีผู้ขายยังอยู่ในทะเบียน');

select pg_temp.assert_eq(
  (select vendor_name from public.procurement_register_rows()
   where reference = 'RG-0001'),
  'ร้านทดสอบทะเบียน (ตัวอย่าง)', 'ชื่อผู้ขายถูก join มาให้');

select pg_temp.assert_eq(
  (select department_name from public.procurement_register_rows()
   where reference = 'RG-0001'),
  'ฝ่ายทดสอบทะเบียน (ตัวอย่าง)', 'ชื่อฝ่ายงานถูก join มาให้');

select pg_temp.assert_eq(
  (select fiscal_year_code from public.procurement_register_rows()
   where reference = 'RG-0001'),
  'FYRG1', 'รหัสปีงบถูก join มาให้');

select pg_temp.assert_eq(
  (select is_emergency from public.procurement_register_rows()
   where reference = 'RG-0002'),
  true, 'ธงกรณีเร่งด่วนถูกส่งต่อ');

-- ---------------------------------------------------------------------------
-- เลขที่เอกสาร
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select purchase_order_no from public.procurement_register_rows()
   where reference = 'RG-0001'),
  'RG-PO-1', 'เลขใบสั่งซื้อที่ใช้งานอยู่');

select pg_temp.assert_eq(
  (select request_memo_no from public.procurement_register_rows()
   where reference = 'RG-0001'),
  'RG-MEMO-1', 'เลขบันทึกขออนุมัติที่ใช้งานอยู่');

/*
 * ฉบับที่ใช้งานอยู่ต้องชนะฉบับที่ยกเลิก แม้ฉบับที่ยกเลิกจะถูกบันทึกทีหลัง
 *
 * ถ้าลำดับใน lateral join เหลือเพียง created_at desc ข้อนี้จะล้มทันที
 */
select pg_temp.assert_eq(
  (select purchase_order_status from public.procurement_register_rows()
   where reference = 'RG-0001'),
  'ISSUED'::public.document_number_status,
  'ฉบับที่ใช้งานอยู่ชนะฉบับที่ยกเลิกซึ่งบันทึกทีหลัง');

/*
 * สองชนิดต้องไม่ปนกัน
 *
 * ถ้าเงื่อนไข document_kind ในฝั่งใดฝั่งหนึ่งหลุดไป ข้อนี้จะล้มทันที
 * เพราะ P5 มีเฉพาะบันทึกขออนุมัติ ไม่มีใบสั่งซื้อ
 */
select pg_temp.assert_eq(
  (select request_memo_no from public.procurement_register_rows()
   where reference = 'RG-0005'),
  'RG-MEMO-5', 'รายการที่มีเฉพาะบันทึกขออนุมัติ');

select pg_temp.assert_eq(
  (select purchase_order_no from public.procurement_register_rows()
   where reference = 'RG-0005'),
  null::text, 'ชนิดเอกสารไม่ปนกัน — ไม่มีใบสั่งซื้อก็ต้องเป็นค่าว่าง');

/*
 * เลขที่ถูกยกเลิกยังต้องเห็น
 *
 * ถ้าตัดแถว VOIDED ทิ้ง รายการนี้จะดูเหมือนรายการที่ไม่เคยมีใครแตะเลย
 * ทั้งที่ความจริงคือออกเลขไปแล้วและถูกยกเลิก ซึ่งเป็นเรื่องที่ค้างอยู่
 */
select pg_temp.assert_eq(
  (select purchase_order_status from public.procurement_register_rows()
   where reference = 'RG-0002'),
  'VOIDED'::public.document_number_status, 'เลขที่ยกเลิกแล้วยังปรากฏในทะเบียน');

select pg_temp.assert_eq(
  (select purchase_order_no from public.procurement_register_rows()
   where reference = 'RG-0002'),
  'RG-PO-2', 'เลขเดิมที่ถูกยกเลิกยังอ่านได้');

/*
 * ออกเลขใหม่หลังยกเลิก — ฉบับที่ใช้งานอยู่ต้องมาก่อนฉบับที่ยกเลิกเสมอ
 *
 * ถ้าลำดับใน lateral join ถูกเปลี่ยนเป็นเรียงตามเวลาอย่างเดียว ข้อนี้จะล้ม
 * เพราะแถวที่ยกเลิกถูกสร้างก่อนแต่ถูกยกเลิกทีหลัง
 */
reset role;
insert into public.document_numbers
  (procurement_id, document_kind, fiscal_year_id, status, document_no, running_no,
   issued_date, created_by)
values
  ('c0000000-0000-4000-8000-0000000000c2', 'PURCHASE_ORDER',
   'c0000000-0000-4000-8000-0000000000f1', 'ISSUED', 'RG-PO-2B', 3,
   '1967-02-25', 'c1111111-1111-4111-8111-111111111111');

set local role authenticated;
set local request.jwt.claim.sub = 'c1111111-1111-4111-8111-111111111111';

select pg_temp.assert_eq(
  (select purchase_order_no from public.procurement_register_rows()
   where reference = 'RG-0002'),
  'RG-PO-2B', 'ฉบับที่ใช้งานอยู่มาก่อนฉบับที่ยกเลิก');

select pg_temp.assert_eq(
  (select purchase_order_status from public.procurement_register_rows()
   where reference = 'RG-0002'),
  'ISSUED'::public.document_number_status, 'สถานะมาจากแถวเดียวกับเลขที่แสดง');

/* หนึ่งรายการต้องยังเป็นหนึ่งแถว แม้จะมีเลขหลายฉบับ — กันการนับยอดซ้ำ */
select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_register_rows()
   where reference = 'RG-0002'),
  1, 'รายการที่มีเลขหลายฉบับยังเป็นแถวเดียว');

-- ---------------------------------------------------------------------------
-- ตัวกรอง — ต้องไม่ปล่อยข้อมูลข้าม scope
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_register_rows(
     'c0000000-0000-4000-8000-0000000000f1')),
  4, 'กรองปีงบแรกได้สี่รายการ');

select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_register_rows(
     'c0000000-0000-4000-8000-0000000000f2')),
  1, 'กรองปีงบที่สองได้รายการเดียว');

select pg_temp.assert_eq(
  (select string_agg(reference, ',' order by reference)
   from public.procurement_register_rows(null, 'SERVICE')
   where reference like 'RG-%'),
  'RG-0002', 'กรองประเภทงานจ้างบริการ');

select pg_temp.assert_eq(
  (select string_agg(reference, ',' order by reference)
   from public.procurement_register_rows(null, null, 'ISSUED')
   where reference like 'RG-%'),
  'RG-0001,RG-0002,RG-0005', 'กรองสถานะออกเอกสารแล้ว');

select pg_temp.assert_eq(
  (select string_agg(reference, ',' order by reference)
   from public.procurement_register_rows(null, null, null, '1967-02-01', '1967-04-30')),
  'RG-0002,RG-0003,RG-0004', 'กรองช่วงวันที่ขอ');

/* ขอบของช่วงต้องรวมวันนั้นด้วย ไม่ใช่ตัดทิ้ง */
select pg_temp.assert_eq(
  (select string_agg(reference, ',' order by reference)
   from public.procurement_register_rows(null, null, null, '1967-02-10', '1967-02-10')),
  'RG-0002', 'ช่วงวันเดียวรวมวันนั้นด้วย');

/* ช่วงที่กลับด้านได้ศูนย์แถว — หน้าจอเป็นผู้เตือน ฐานข้อมูลไม่แก้ให้เอง */
select pg_temp.assert_eq(
  (select count(*)::integer
   from public.procurement_register_rows(null, null, null, '1967-04-30', '1967-02-01')),
  0, 'ช่วงวันที่กลับด้านได้ศูนย์แถว');

/* ตัวกรองหลายข้อพร้อมกันต้องตัดกัน ไม่ใช่รวมกัน */
select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_register_rows(
     'c0000000-0000-4000-8000-0000000000f1', 'GOODS', 'ISSUED')
   where reference like 'RG-%'),
  1, 'ตัวกรองหลายข้อทำงานร่วมกันแบบตัดกัน');

-- ---------------------------------------------------------------------------
-- ลำดับและเพดานจำนวนแถว
-- ---------------------------------------------------------------------------

/* วันที่ขอใหม่สุดขึ้นก่อน — เพดานจึงตัดรายการเก่าออก ไม่ใช่ตัดรายการล่าสุด */
select pg_temp.assert_eq(
  (select string_agg(reference, ',')
   from (select reference from public.procurement_register_rows(
           'c0000000-0000-4000-8000-0000000000f1')) ordered),
  'RG-0004,RG-0003,RG-0002,RG-0001', 'เรียงตามวันที่ขอจากใหม่ไปเก่า');

/*
 * ข้อที่เกี่ยวกับเพดานต้องส่งช่วงวันที่เข้าไปด้วย
 *
 * เพดานทำงานที่ฟังก์ชัน การกรอง `reference like 'RG-%'` ที่ชั้นนอกจึงช่วยไม่ได้
 * — ต้องกันไม่ให้แถวที่ test ชุดอื่น commit ไว้เข้ามากินโควตาของเพดานตั้งแต่ต้น
 */
select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_register_rows(
     null, null, null, '1966-01-01', '1969-01-01', 2)),
  2, 'เพดานจำนวนแถวมีผลจริง');

select pg_temp.assert_eq(
  (select string_agg(reference, ',')
   from (select reference from public.procurement_register_rows(
           null, null, null, '1966-01-01', '1969-01-01', 2)) ordered),
  'RG-0005,RG-0004', 'เพดานตัดจากท้าย จึงเหลือรายการล่าสุดไว้');

/* ค่าที่ไม่สมเหตุสมผลถูกดึงกลับเข้าในช่วง แทนที่จะคืนศูนย์แถวหรือ error */
select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_register_rows(
     null, null, null, '1966-01-01', '1969-01-01', 0)),
  1, 'เพดานที่ต่ำกว่าหนึ่งถูกดึงขึ้นเป็นหนึ่ง');

select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_register_rows(
     null, null, null, '1966-01-01', '1969-01-01', null)),
  5, 'เพดานที่เป็นค่าว่างใช้ค่าเริ่มต้น');

-- ---------------------------------------------------------------------------
-- ขอบเขตแถวมาจาก RLS ไม่ใช่จากหน้าจอ
--
-- ข้อสำคัญที่สุดของไฟล์นี้ — ผู้ขอมีเพียง procurement.read.own จึงต้องเห็น
-- เฉพาะรายการที่ตนสร้าง แม้จะเรียก RPC ตรงและระบุตัวกรองเองก็ตาม
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'c2222222-2222-4222-8222-222222222222';

select pg_temp.assert_eq(
  (select public.has_permission('procurement.read.all')), false,
  'ผู้ขอไม่มีสิทธิ์อ่านทุกรายการ');

select pg_temp.assert_eq(
  (select public.has_permission('procurement.read.own')), true,
  'ผู้ขอมีสิทธิ์อ่านรายการของตน');

select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_register_rows()
   where reference like 'RG-%'),
  1, 'ผู้ขอเห็นเฉพาะรายการของตน');

select pg_temp.assert_eq(
  (select reference from public.procurement_register_rows()
   where reference like 'RG-%'),
  'RG-0004', 'รายการที่ผู้ขอเห็นคือรายการที่ตนสร้าง');

select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_register_rows(
     'c0000000-0000-4000-8000-0000000000f1')),
  1, 'ผู้ขอระบุปีงบเองก็ยังเห็นเฉพาะของตน');

select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_register_rows(
     null, 'GOODS', 'ISSUED')
   where reference like 'RG-%'),
  0, 'ผู้ขอขอรายการที่ออกเอกสารแล้วของคนอื่นก็ไม่ได้');

/*
 * ข้อที่ทำให้ข้อบนทั้งหมดมีความหมาย
 *
 * ถ้าฟังก์ชันถูกเปลี่ยนเป็น security definer วันหนึ่ง ข้อบนจะกลายเป็นเท็จทันที
 * และไม่มีอะไรอื่นในระบบที่ฟ้อง เพราะ definer เป็นค่าที่ function อื่นในโปรเจกต์นี้
 * ใช้กันเป็นปกติ — จึงตรวจตรง ๆ ที่ catalog
 */
reset role;
select pg_temp.assert_eq(
  (select p.prosecdef from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'procurement_register_rows'),
  false, 'ฟังก์ชันเป็น security invoker เพื่อให้ RLS เป็นตัวบังคับ');

/*
 * สิทธิ์เรียกฟังก์ชันของ `authenticated` ต้องยังอยู่
 *
 * ถ้า grant นี้หลุดไป ทั้งหน้าจอจะพังพร้อมกันโดยที่ข้อทดสอบอื่นในไฟล์นี้
 * ยังผ่านหมด เพราะข้ออื่นรันในนาม `authenticated` อยู่แล้วและจะล้มด้วยกันทั้งหมด
 * จนอ่านไม่ออกว่าต้นเหตุคืออะไร
 *
 * **ไม่ตรวจว่า `anon` เรียกไม่ได้** เพราะไม่ใช่กลไกที่กันจริงในระบบนี้:
 * Supabase ให้ EXECUTE กับ `anon` เป็นค่าเริ่มต้นสำหรับฟังก์ชันใน schema public
 * (ต่างจาก local-harness.sql ที่ไม่ได้ตั้งค่านั้นไว้) การตรวจระดับ grant จึงเป็น
 * การตรวจว่า harness ตั้งค่าอย่างไร ไม่ใช่ตรวจว่าระบบกันได้จริงหรือไม่
 *
 * สิ่งที่กันจริงคือ RLS — ข้อถัดไปพิสูจน์ตรง ๆ
 */
select pg_temp.assert_eq(
  (select has_function_privilege('authenticated', p.oid, 'execute')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'procurement_register_rows'),
  true, 'ผู้ที่เข้าสู่ระบบแล้วเรียกฟังก์ชันนี้ได้');

/*
 * แม้ `anon` จะเรียกฟังก์ชันได้ ก็ต้องไม่ได้ข้อมูลสักแถว
 *
 * ให้ EXECUTE กับ `anon` ในทรานแซกชันนี้เองเพื่อจำลองสภาพของ Supabase จริง
 * และเพื่อให้ข้อนี้ให้คำตอบเดียวกันทั้งบน harness และบน CI — grant นี้ย้อนกลับ
 * พร้อม rollback ท้ายไฟล์ จึงไม่ค้างอยู่ในฐานข้อมูล
 *
 * ข้อนี้พิสูจน์ว่า **grant ไม่ใช่ด่านที่กัน** — policy ของ procurements เป็น
 * `to authenticated` ทั้งหมด ผู้เรียกที่ไม่ใช่ role นั้นจึงไม่เข้าเงื่อนไขใดเลย
 * แม้จะมี JWT ของผู้ใช้จริงค้างอยู่ใน session ก็ตาม (ตั้งไว้ตั้งแต่ข้อก่อนหน้า)
 */
grant execute on function public.procurement_register_rows(
  uuid, public.procurement_classification, public.procurement_status, date, date, integer
) to anon;

set local role anon;

select pg_temp.assert_eq(
  (select count(*)::integer from public.procurement_register_rows()),
  0, 'ผู้ที่ยังไม่เข้าสู่ระบบไม่ได้ข้อมูลสักแถว');

reset role;

rollback;
