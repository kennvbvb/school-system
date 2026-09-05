#!/usr/bin/env bash
#
# รัน test ของ budget ledger บน PostgreSQL จริง
#
# ใช้:  supabase/tests/run-budget-tests.sh "$DB_URL"
#
# แยกเป็นสคริปต์เพราะการทดสอบเรื่อง concurrency ต้องใช้สอง session พร้อมกัน
# ซึ่งเขียนในไฟล์ .sql ไฟล์เดียวไม่ได้
set -euo pipefail

DB_URL="${1:?ต้องระบุ connection string ของฐานข้อมูล}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== ชุดที่ 1: constraint, RLS, การโอน และ audit =="
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$HERE/budget_ledger_test.sql"

echo
echo "== ชุดที่ 2: กฎความถูกต้องของ ledger (migration 0009) =="
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$HERE/budget_integrity_test.sql"

echo
echo "== ชุดที่ 3: การกันยอดพร้อมกัน =="
#
# สองคำขอกันยอด 4,000 บนบัญชีที่มีงบ 6,000 — รวมกัน 8,000
# ถ้า budget_post_movement ไม่ล็อกแถวบัญชีก่อนอ่านยอด ทั้งคู่จะเห็นยอด 6,000
# แล้วลงได้ทั้งคู่จนยอดติดลบ ซึ่งเป็นอาการเดียวกับข้อค้นพบ F-01
#
# ใช้ id ใหม่ทุกครั้งที่รัน มิฉะนั้นรอบถัดไปจะเจอบัญชีที่มีงบสะสมจากรอบก่อน
# แล้วกันยอดสำเร็จทั้งสองคำขอ ทำให้ test ผ่านทั้งที่ระบบอาจพัง
RUN_ID="$(date +%s%N | tail -c 8)"
USER_ID="$(psql "$DB_URL" -t -A -c 'select gen_random_uuid()')"
PRJ="$(psql "$DB_URL" -t -A -c 'select gen_random_uuid()')"

# ปีงบประมาณห้ามซ้อนช่วงกัน (exclusion constraint fiscal_years_no_overlap)
#
# ชุดนี้ commit ข้อมูลจริง (rollback ไม่ได้เพราะต้องใช้สอง session) จึงใช้ช่วงปี
# ที่ไกลจากของจริงและจากชุดที่ 1 เพื่อไม่ให้ชนกัน และใช้ปีเดิมซ้ำถ้ามีอยู่แล้ว
# เพื่อให้รันสคริปต์ซ้ำบนฐานเดิมได้
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
begin
  if not exists (
    select 1 from public.fiscal_years
    where '2095-01-15'::date between start_date and end_date
  ) then
    insert into public.fiscal_years (code, year_be, start_date, end_date, status)
    values ('FYCONC', 2638, '2094-10-01', '2095-09-30', 'OPEN');
  end if;
end
$$;
SQL

FY="$(psql "$DB_URL" -t -A -c \
  "select id from public.fiscal_years
   where '2095-01-15'::date between start_date and end_date limit 1")"
ACC="$(psql "$DB_URL" -t -A -c 'select gen_random_uuid()')"

psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (id, email) values ('$USER_ID', 'conc-$RUN_ID@example.test');
insert into public.profiles (id, email, first_name_th, last_name_th, is_active)
  values ('$USER_ID', 'conc-$RUN_ID@example.test', 'ทดสอบ', 'พร้อมกัน', true);
insert into public.user_roles (user_id, role_code) values ('$USER_ID', 'FINANCE');
insert into public.projects (id, code, name_th, fiscal_year_id, budget_amount)
  values ('$PRJ', 'PRJ-CONC-$RUN_ID', 'โครงการทดสอบพร้อมกัน (ตัวอย่าง)', '$FY', 6000.00);
insert into public.budget_accounts (id, code, fiscal_year_id, project_id)
  values ('$ACC', 'ACC-CONC-$RUN_ID', '$FY', '$PRJ');

set role authenticated;
set request.jwt.claim.sub = '$USER_ID';
select public.budget_post_movement('$ACC', 'ALLOCATION', 6000.00, '2095-01-15', 'ตั้งต้น');
SQL

reserve() {
  psql "$DB_URL" -q -t -A <<SQL 2>&1
set role authenticated;
set request.jwt.claim.sub = '$USER_ID';
begin;
select public.budget_post_movement('$ACC', 'RESERVE', 4000.00, '2095-01-20', 'กันยอดพร้อมกัน');
commit;
SQL
}

reserve > /tmp/budget-conc-1.log &
reserve > /tmp/budget-conc-2.log &
wait

succeeded=0
for log in /tmp/budget-conc-1.log /tmp/budget-conc-2.log; do
  if grep -q 'ยอดงบคงเหลือไม่พอ' "$log"; then
    echo "ok   คำขอหนึ่งถูกปฏิเสธเพราะยอดไม่พอ"
  else
    succeeded=$((succeeded + 1))
  fi
done

if [ "$succeeded" -ne 1 ]; then
  echo "FAIL คาดว่าจะสำเร็จเพียงคำขอเดียว แต่สำเร็จ $succeeded คำขอ"
  cat /tmp/budget-conc-1.log /tmp/budget-conc-2.log
  exit 1
fi
echo "ok   สำเร็จเพียงคำขอเดียว"

remaining="$(psql "$DB_URL" -t -A -c \
  "select available_amount from public.budget_account_balances where budget_account_id = '$ACC';")"
reserves="$(psql "$DB_URL" -t -A -c \
  "select count(*) from public.budget_movements
   where budget_account_id = '$ACC' and movement_type = 'RESERVE';")"

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

echo
echo "budget ledger: ทุกชุดผ่าน"
