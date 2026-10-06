-- =============================================================================
-- ทดสอบ F-01 — ทะเบียนต้องบอกได้เสมอว่าข้อมูลครบหรือถูกตัด ที่ขอบเขต 999/1000/1001
-- (เพดานหน้าจอ) และ 4999/5000/5001 (เพดาน export)
--
-- เดิม repository ขอ limit+1 แล้วเดา: SQL clamp ที่ 5,000 ทำให้ขอ 5,001 ได้ 5,000
-- จึงดูเหมือนครบ ตอนนี้ฐานข้อมูลคืน total_count (นับก่อน limit ใน statement เดียวกับ
-- แถวที่คืน) และ procurement_register_result ห่อเป็น jsonb ค่าเดียว
--
-- ไฟล์นี้พิสูจน์ที่ชั้น SQL (ไม่มี PostgREST) — ชั้น HTTP พิสูจน์ใน
-- run-register-http-tests.sh ซึ่งใช้ PostgREST จริงที่มี max_rows
--
-- ใช้ปีงบ พ.ศ. 2520 (ห่างจาก 2500/2501/2510/2511 ที่ test อื่นใช้ และจากปีที่ครอบวันนี้)
-- แต่ละขนาดกลุ่มใช้ request_date คนละวัน จึงเลือกขนาดผ่านตัวกรองวันที่ได้โดยไม่ต้องลบแถว
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

insert into auth.users (id, email) values
  ('c3111111-1111-4111-8111-111111111111', 'regc-officer@example.test');
insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('c3111111-1111-4111-8111-111111111111', 'regc-officer@example.test', 'ทดสอบ', 'พัสดุ', true);
insert into public.user_roles (user_id, role_code) values
  ('c3111111-1111-4111-8111-111111111111', 'PROCUREMENT_OFFICER');

insert into public.fiscal_years (id, code, year_be, start_date, end_date, status) values
  ('c3000000-0000-4000-8000-0000000000f1', 'FYRC1', 2520, '1976-10-01', '1977-09-30', 'OPEN');

-- กลุ่มขนาด n ที่ request_date = วันที่ d  (6 ขนาดที่ขอบเขตทั้งสองเพดาน)
create temp table sizes (d date, n integer);
insert into sizes values
  ('1977-01-01',  999), ('1977-01-02', 1000), ('1977-01-03', 1001),
  ('1977-02-01', 4999), ('1977-02-02', 5000), ('1977-02-03', 5001);

insert into public.procurements
  (reference, subject, status, classification, procurement_method, is_emergency,
   fiscal_year_id, request_date, created_by)
select
  'RC-' || to_char(s.d, 'MMDD') || '-' || lpad(g::text, 5, '0'),
  'ทะเบียนจำนวนมาก (ตัวอย่าง)', 'DRAFT', 'GOODS', 'SPECIFIC', false,
  'c3000000-0000-4000-8000-0000000000f1', s.d,
  'c3111111-1111-4111-8111-111111111111'
from sizes s, generate_series(1, s.n) g;

-- แถวที่เพิ่งเพิ่มจำนวนมากใน transaction เดียวยังไม่มีสถิติ — planner จึงประเมินว่า join กับ
-- procurement_totals ได้แถวเดียวแล้วเลือก nested loop เทียบ 5,000 × 5,000 จนช้าเป็นนาที
-- (ในระบบจริง autovacuum วิเคราะห์ให้เอง) ต้อง analyze เองให้ test วัดที่ความถูกต้อง ไม่ใช่สถิติ
analyze public.procurements;
analyze public.procurement_items;
analyze public.procurement_funding_allocations;
analyze public.document_numbers;

set local role authenticated;
set local request.jwt.claim.sub = 'c3111111-1111-4111-8111-111111111111';

-- ---------------------------------------------------------------------------
-- ทุกขนาด × ทั้งสองเพดาน: total_count ตรงจริงเสมอ และจำนวนแถว = min(total, limit)
-- truncated (= total_count > limit) ต้องถูกต้องแม้ขอ limit เท่ากับ/เกินเพดาน clamp
-- ---------------------------------------------------------------------------

create or replace function pg_temp.probe(p_day date, p_limit integer)
returns table (total bigint, returned integer, truncated boolean)
language sql as $$
  with r as (
    select public.procurement_register_result(
      null, null, null, p_day, p_day, p_limit) as j
  )
  select (j->>'total_count')::bigint,
         jsonb_array_length(j->'rows'),
         (j->>'total_count')::bigint > p_limit
  from r;
$$;

grant execute on function pg_temp.probe(date, integer) to authenticated;

-- เพดานหน้าจอ 1000: ขอบเขต 999/1000/1001
select pg_temp.assert_eq((select total from pg_temp.probe('1977-01-01', 1000)), 999::bigint, 'หน้าจอ 999: total');
select pg_temp.assert_eq((select returned from pg_temp.probe('1977-01-01', 1000)), 999, 'หน้าจอ 999: คืนครบ 999');
select pg_temp.assert_eq((select truncated from pg_temp.probe('1977-01-01', 1000)), false, 'หน้าจอ 999: ไม่ถูกตัด');

select pg_temp.assert_eq((select total from pg_temp.probe('1977-01-02', 1000)), 1000::bigint, 'หน้าจอ 1000: total');
select pg_temp.assert_eq((select returned from pg_temp.probe('1977-01-02', 1000)), 1000, 'หน้าจอ 1000: คืนครบ 1000');
select pg_temp.assert_eq((select truncated from pg_temp.probe('1977-01-02', 1000)), false, 'หน้าจอ 1000: ไม่ถูกตัด (พอดีเพดาน)');

select pg_temp.assert_eq((select total from pg_temp.probe('1977-01-03', 1000)), 1001::bigint, 'หน้าจอ 1001: total บอกจำนวนจริง');
select pg_temp.assert_eq((select returned from pg_temp.probe('1977-01-03', 1000)), 1000, 'หน้าจอ 1001: คืน 1000 แถว');
select pg_temp.assert_eq((select truncated from pg_temp.probe('1977-01-03', 1000)), true, 'หน้าจอ 1001: ตรวจพบว่าถูกตัด');

-- เพดาน export 5000: ขอบเขต 4999/5000/5001
select pg_temp.assert_eq((select total from pg_temp.probe('1977-02-01', 5000)), 4999::bigint, 'export 4999: total');
select pg_temp.assert_eq((select returned from pg_temp.probe('1977-02-01', 5000)), 4999, 'export 4999: คืนครบ 4999');
select pg_temp.assert_eq((select truncated from pg_temp.probe('1977-02-01', 5000)), false, 'export 4999: ไม่ถูกตัด');

select pg_temp.assert_eq((select total from pg_temp.probe('1977-02-02', 5000)), 5000::bigint, 'export 5000: total');
select pg_temp.assert_eq((select returned from pg_temp.probe('1977-02-02', 5000)), 5000, 'export 5000: คืนครบ 5000');
select pg_temp.assert_eq((select truncated from pg_temp.probe('1977-02-02', 5000)), false, 'export 5000: ไม่ถูกตัด (พอดีเพดาน)');

-- กรณีที่ F-01 เดิมพลาด: 5001 แถว
select pg_temp.assert_eq((select total from pg_temp.probe('1977-02-03', 5000)), 5001::bigint, 'export 5001: total บอกจำนวนจริง');
select pg_temp.assert_eq((select returned from pg_temp.probe('1977-02-03', 5000)), 5000, 'export 5001: คืน 5000 แถว');
select pg_temp.assert_eq((select truncated from pg_temp.probe('1977-02-03', 5000)), true, 'export 5001: ตรวจพบว่าถูกตัด');

-- วิธีเดิม (ขอ limit+1) ที่เป็นต้นเหตุ: ขอ 5001 แล้ว SQL clamp เหลือ 5000 — จำนวนแถวที่ได้
-- เท่ากับเพดาน ทำให้ "ได้เกินเพดาน" เป็นเท็จ แต่ total_count ยังบอกว่ามี 5001 จริง
select pg_temp.assert_eq((select returned from pg_temp.probe('1977-02-03', 5001)), 5000,
  'ขอ 5001 ถูก clamp เหลือ 5000 แถว (นี่คือสาเหตุที่เดาจากจำนวนแถวไม่ได้)');
select pg_temp.assert_eq((select total from pg_temp.probe('1977-02-03', 5001)), 5001::bigint,
  'แม้ถูก clamp total_count ยังบอก 5001 จึงตรวจได้ว่าแถวที่ได้ไม่ครบ');

-- ---------------------------------------------------------------------------
-- ความถูกต้องของแถวใน jsonb: ลำดับ ค่าเงินเป็นข้อความ และไม่มีคอลัมน์ total_count ปน
-- ---------------------------------------------------------------------------

select pg_temp.assert_eq(
  (select (public.procurement_register_result(null, null, null, '1977-01-01', '1977-01-01', 3)
           -> 'rows' -> 0 ->> 'reference')),
  'RC-0101-00999', 'แถวแรกเรียง reference จากมากไปน้อย (ลำดับเดียวกับฟังก์ชันต้นทาง)');
select pg_temp.assert_eq(
  (select public.procurement_register_result(null, null, null, '1977-01-01', '1977-01-01', 3)
          -> 'rows' -> 0 ? 'total_count'),
  false, 'แถวไม่มี total_count ปนอยู่');
select pg_temp.assert_eq(
  (select jsonb_typeof(public.procurement_register_result(null, null, null, '1977-01-01', '1977-01-01', 3)
          -> 'rows' -> 0 -> 'grand_total')),
  'string', 'ยอดเงินส่งเป็นข้อความ ไม่ผ่านการแปลงเป็น double');

-- ไม่มีแถวตรงเงื่อนไข: total 0 และ rows เป็นอาร์เรย์ว่าง ไม่ใช่ null
select pg_temp.assert_eq(
  (select (public.procurement_register_result(null, null, null, '1977-12-31', '1977-12-31', 10))::text),
  '{"rows": [], "total_count": 0}', 'ไม่มีแถว: total_count 0 และ rows เป็น []');

-- ---------------------------------------------------------------------------
-- RLS ยังเป็นตัวกำหนดขอบเขต: ผู้ที่ไม่มีสิทธิ์อ่านเห็น total_count = 0 ไม่ใช่จำนวนจริง
-- และ anon เรียกไม่ได้ (revoke from anon ใน migration)
-- ---------------------------------------------------------------------------

reset role;
insert into auth.users (id, email) values ('c3222222-2222-4222-8222-222222222222', 'regc-nobody@example.test');
insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('c3222222-2222-4222-8222-222222222222', 'regc-nobody@example.test', 'ทดสอบ', 'ไม่มีสิทธิ์', true);

set local role authenticated;
set local request.jwt.claim.sub = 'c3222222-2222-4222-8222-222222222222';
select pg_temp.assert_eq(
  (public.procurement_register_result(null, null, null, '1977-02-03', '1977-02-03', 5000) ->> 'total_count')::bigint,
  0::bigint, 'ผู้ที่ไม่มีสิทธิ์อ่านรายการเห็น total_count = 0 ไม่ใช่จำนวนจริง (RLS)');

reset role;
set local role anon;
do $$
begin
  perform public.procurement_register_result();
  raise exception 'FAIL anon เรียก procurement_register_result สำเร็จ';
exception when insufficient_privilege then
  raise notice 'ok   anon เรียก procurement_register_result ไม่ได้';
end $$;

rollback;
