#!/usr/bin/env bash
#
# ทดสอบการกันยอดงบตอนอนุมัติบน PostgreSQL จริง
#
# ใช้:  supabase/tests/run-reservation-tests.sh "$DB_URL"
#
# แยกเป็นสคริปต์เพราะชุดที่ 2 ต้องใช้สอง session พร้อมกัน ซึ่งเขียนในไฟล์ .sql
# ไฟล์เดียวไม่ได้ — และเป็นชุดที่พิสูจน์ว่าช่องโหว่เดิมถูกปิดจริง
set -euo pipefail

DB_URL="${1:?ต้องระบุ connection string ของฐานข้อมูล}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== ชุดที่ 1: การกันยอด คืนยอด และการตรวจสิทธิ์ =="
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$HERE/procurement_reservation_test.sql"

echo
echo "== ชุดที่ 2: อนุมัติสองรายการพร้อมกัน =="
#
# **นี่คือช่องโหว่ที่ PR-04c ปิด**
#
# สองรายการ ใบละ 4,000 บนบัญชีที่มีงบ 6,000 — รวมกัน 8,000
#
# การตรวจ BUDGET_INSUFFICIENT ตอนส่งอนุมัติเป็นการอ่านยอดแล้วเทียบเท่านั้น
# ทั้งสองใบจึงผ่านการตรวจ (4,000 < 6,000) ถ้าการอนุมัติไม่ได้ลงรายการกันยอด
# ที่ล็อกแถวบัญชีก่อนอ่านยอด ทั้งคู่จะอนุมัติสำเร็จจนยอดติดลบ 2,000
# ซึ่งเป็นอาการเดียวกับข้อค้นพบ F-01 (โครงการที่งบติดลบในไฟล์จริง)
#
# ใช้ id ใหม่ทุกครั้งที่รัน มิฉะนั้นรอบถัดไปจะเจอบัญชีที่มีงบสะสมจากรอบก่อน
# แล้วอนุมัติสำเร็จทั้งคู่ ทำให้ test ผ่านทั้งที่ระบบอาจพัง
RUN_ID="$(date +%s%N | tail -c 8)"

ids() { psql "$DB_URL" -t -A -c 'select gen_random_uuid()'; }

REQUESTER="$(ids)"; REVIEWER="$(ids)"; APPROVER="$(ids)"; FINANCE="$(ids)"
PRJ="$(ids)"; ACC="$(ids)"; P1="$(ids)"; P2="$(ids)"

# ต้องใช้ปีงบประมาณที่ **ครอบวันนี้**
#
# การกันยอดลงรายการด้วยวันที่ของวันนี้ ถ้าปีงบไม่ครอบวันนี้ การอนุมัติจะล้มด้วย
# "วันที่มีผลอยู่นอกช่วงปีงบประมาณ" ทั้งสองใบ แล้ว test จะผ่านด้วยเหตุผลผิด
# (รอบแรกที่เขียนสคริปต์นี้ใช้ปี 2090 แล้วเกิดอาการนั้นจริง)
#
# ใช้ปีที่มีอยู่แล้วถ้ามี เพื่อไม่ชน exclusion constraint fiscal_years_no_overlap
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
begin
  if not exists (
    select 1 from public.fiscal_years where current_date between start_date and end_date
  ) then
    insert into public.fiscal_years (code, year_be, start_date, end_date, status)
    values (
      'FYRSVC-$RUN_ID',
      extract(year from current_date)::integer + 543,
      date_trunc('year', current_date)::date,
      (date_trunc('year', current_date) + interval '1 year - 1 day')::date,
      'OPEN'
    );
  end if;
end
\$\$;
SQL

FY="$(psql "$DB_URL" -t -A -c \
  "select id from public.fiscal_years
   where current_date between start_date and end_date and status = 'OPEN' limit 1")"

# วันที่ในเอกสารต้องอยู่ในช่วงปีงบเดียวกัน มิฉะนั้นกฎ FISCAL_YEAR_MISMATCH จะกัน
DOC_DATE="$(psql "$DB_URL" -t -A -c \
  "select greatest(start_date, current_date - 5)::text from public.fiscal_years where id = '$FY'")"

psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (id, email) values
  ('$REQUESTER', 'rsc-req-$RUN_ID@example.test'),
  ('$REVIEWER',  'rsc-rev-$RUN_ID@example.test'),
  ('$APPROVER',  'rsc-app-$RUN_ID@example.test'),
  ('$FINANCE',   'rsc-fin-$RUN_ID@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('$REQUESTER', 'rsc-req-$RUN_ID@example.test', 'ทดสอบ', 'ผู้ขอ', true),
  ('$REVIEWER',  'rsc-rev-$RUN_ID@example.test', 'ทดสอบ', 'ผู้ตรวจสอบ', true),
  ('$APPROVER',  'rsc-app-$RUN_ID@example.test', 'ทดสอบ', 'ผู้อนุมัติ', true),
  ('$FINANCE',   'rsc-fin-$RUN_ID@example.test', 'ทดสอบ', 'การเงิน', true);

insert into public.user_roles (user_id, role_code) values
  ('$REQUESTER', 'REQUESTER'),
  ('$REVIEWER',  'REVIEWER'),
  ('$APPROVER',  'APPROVER'),
  ('$FINANCE',   'FINANCE');

insert into public.projects (id, code, name_th, fiscal_year_id)
  values ('$PRJ', 'PRJ-RSVC-$RUN_ID', 'โครงการทดสอบอนุมัติพร้อมกัน (ตัวอย่าง)', '$FY');
insert into public.budget_accounts (id, code, fiscal_year_id, project_id)
  values ('$ACC', 'ACC-RSVC-$RUN_ID', '$FY', '$PRJ');

insert into public.procurements (
  id, subject, purpose, fiscal_year_id, request_date, report_date,
  classification, procurement_method, tax_mode, created_by
) values
  ('$P1', 'จัดซื้อทดสอบอนุมัติพร้อมกัน ก (ตัวอย่าง)', 'ใช้ทดสอบ (ตัวอย่าง)',
   '$FY', '$DOC_DATE', '$DOC_DATE', 'GOODS', 'SPECIFIC', 'EXEMPT', '$REQUESTER'),
  ('$P2', 'จัดซื้อทดสอบอนุมัติพร้อมกัน ข (ตัวอย่าง)', 'ใช้ทดสอบ (ตัวอย่าง)',
   '$FY', '$DOC_DATE', '$DOC_DATE', 'GOODS', 'SPECIFIC', 'EXEMPT', '$REQUESTER');

insert into public.procurement_items (procurement_id, line_no, description, quantity, unit_price)
values ('$P1', 1, 'กระดาษ (ตัวอย่าง)', 16, 250.00),
       ('$P2', 1, 'หมึกพิมพ์ (ตัวอย่าง)', 16, 250.00);

insert into public.procurement_funding_allocations
  (procurement_id, line_no, budget_account_id, amount)
values ('$P1', 1, '$ACC', 4000.00),
       ('$P2', 1, '$ACC', 4000.00);

set role authenticated;

set request.jwt.claim.sub = '$FINANCE';
select public.budget_post_movement('$ACC', 'ALLOCATION', 6000.00, '$DOC_DATE', 'ตั้งต้น');

set request.jwt.claim.sub = '$REQUESTER';
select public.procurement_submit('$P1', (select version from public.procurements where id = '$P1'));
select public.procurement_submit('$P2', (select version from public.procurements where id = '$P2'));

set request.jwt.claim.sub = '$REVIEWER';
select public.procurement_transition(
  '$P1', 'review_pass', (select version from public.procurements where id = '$P1'));
select public.procurement_transition(
  '$P2', 'review_pass', (select version from public.procurements where id = '$P2'));
SQL

approve() {
  psql "$DB_URL" -q -t -A <<SQL 2>&1
set role authenticated;
set request.jwt.claim.sub = '$APPROVER';
begin;
select public.procurement_transition(
  '$1', 'approve', (select version from public.procurements where id = '$1'));
commit;
SQL
}

approve "$P1" > /tmp/reserve-conc-1.log &
approve "$P2" > /tmp/reserve-conc-2.log &
wait

#
# แยกสามกรณี ไม่ใช่สองกรณี
#
# "ไม่ได้ถูกปฏิเสธเพราะยอดไม่พอ" **ไม่ได้แปลว่าสำเร็จ** — อาจล้มด้วยเหตุผลอื่น
# ถ้านับรวมเป็นสำเร็จ test จะผ่านทั้งที่ทั้งสองใบล้มด้วยเหตุผลที่ไม่เกี่ยวกันเลย
# (เกิดขึ้นจริงตอนเขียนสคริปต์นี้รอบแรก)
succeeded=0
for log in /tmp/reserve-conc-1.log /tmp/reserve-conc-2.log; do
  if grep -q 'ยอดงบคงเหลือไม่พอ' "$log"; then
    echo "ok   คำขอหนึ่งถูกปฏิเสธเพราะยอดไม่พอ"
  elif grep -q 'ERROR' "$log"; then
    echo "FAIL คำขอล้มด้วยเหตุผลอื่นที่ไม่ใช่ยอดงบไม่พอ"
    cat "$log"
    exit 1
  else
    succeeded=$((succeeded + 1))
  fi
done

if [ "$succeeded" -ne 1 ]; then
  echo "FAIL คาดว่าจะอนุมัติสำเร็จเพียงรายการเดียว แต่สำเร็จ $succeeded รายการ"
  cat /tmp/reserve-conc-1.log /tmp/reserve-conc-2.log
  exit 1
fi
echo "ok   อนุมัติสำเร็จเพียงรายการเดียว"

remaining="$(psql "$DB_URL" -t -A -c \
  "select available_amount from public.budget_account_balances where budget_account_id = '$ACC';")"
reserves="$(psql "$DB_URL" -t -A -c \
  "select count(*) from public.budget_movements
   where budget_account_id = '$ACC' and movement_type = 'RESERVE';")"
approved="$(psql "$DB_URL" -t -A -c \
  "select count(*) from public.procurements
   where id in ('$P1', '$P2') and status = 'APPROVED';")"

if [ "$remaining" != "2000.00" ]; then
  echo "FAIL ยอดคงเหลือควรเป็น 2000.00 แต่ได้ $remaining"
  exit 1
fi
echo "ok   ยอดคงเหลือ $remaining ไม่ติดลบ"

if [ "$reserves" != "1" ]; then
  echo "FAIL ควรมีรายการกันยอดเพียงรายการเดียว แต่มี $reserves"
  exit 1
fi
echo "ok   มีรายการกันยอดเพียงรายการเดียว"

# สถานะกับ ledger ต้องตรงกัน — ถ้าสถานะเปลี่ยนแต่ไม่มียอดกัน จะเป็นรายการที่
# อนุมัติแล้วโดยไม่มีงบรองรับ ซึ่งไม่มีใครเห็นว่าผิด
if [ "$approved" != "1" ]; then
  echo "FAIL ควรมีรายการที่อนุมัติแล้วเพียงรายการเดียว แต่มี $approved"
  exit 1
fi
echo "ok   สถานะตรงกับ ledger — อนุมัติแล้วหนึ่งรายการ กันยอดหนึ่งรายการ"

echo
echo "การกันยอดงบ: ทุกชุดผ่าน"
