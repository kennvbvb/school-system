#!/usr/bin/env bash
#
# ทดสอบ ledger คลังพัสดุบน PostgreSQL จริง
#
# ใช้:  supabase/tests/run-inventory-tests.sh "$DB_URL"
#
# ชุดที่ 1 เป็น SQL ไฟล์เดียว (ทรานแซกชันเดียว rollback ท้ายไฟล์)
# ชุดที่ 2 ต้องใช้หลาย session พร้อมกัน เขียนในไฟล์ .sql ไม่ได้ — พิสูจน์ว่า
# การล็อกรายการพัสดุ + sequence_no กันลำดับชนและยอดเพี้ยนได้จริงเมื่อคำขอมาพร้อมกัน
set -euo pipefail

DB_URL="${1:?ต้องระบุ connection string ของฐานข้อมูล}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS="$(mktemp -d)"

echo "== ชุดที่ 1: ความถูกต้องของ ledger (ลำดับ ย้อนรายการ ยอดยกมา สิทธิ์) =="
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$HERE/inventory_ledger_test.sql"

echo
echo "== ชุดที่ 2: ลงรายการพร้อมกันหลาย session =="

# id ใหม่ทุกรอบ มิฉะนั้นรอบถัดไปเจอรายการสะสมจากรอบก่อนแล้วผ่านด้วยเหตุผลผิด
RUN_ID="$(date +%s%N | tail -c 8)"
ids() { psql "$DB_URL" -t -A -c 'select gen_random_uuid()'; }

OFFICER="$(ids)"; REQUESTER="$(ids)"; APPROVER="$(ids)"; UNIT="$(ids)"
ITEM_RECEIPT="$(ids)"; ITEM_ISSUE="$(ids)"; ITEM_REVERSE="$(ids)"

psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (id, email) values
  ('$OFFICER',   'invc-off-$RUN_ID@example.test'),
  ('$REQUESTER', 'invc-req-$RUN_ID@example.test'),
  ('$APPROVER',  'invc-app-$RUN_ID@example.test');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active) values
  ('$OFFICER',   'invc-off-$RUN_ID@example.test', 'ทดสอบ', 'เจ้าหน้าที่คลัง', true),
  ('$REQUESTER', 'invc-req-$RUN_ID@example.test', 'ทดสอบ', 'ผู้เบิก', true),
  ('$APPROVER',  'invc-app-$RUN_ID@example.test', 'ทดสอบ', 'ผู้อนุมัติ', true);

insert into public.user_roles (user_id, role_code) values
  ('$OFFICER', 'INVENTORY_OFFICER'),
  ('$APPROVER', 'APPROVER');

insert into public.units (id, code, name_th) values ('$UNIT', 'UNIT-INVC-$RUN_ID', 'ชิ้น (ทดสอบพร้อมกัน)');

insert into public.inventory_items (id, code, name_th, unit_id) values
  ('$ITEM_RECEIPT', 'INVC-R-$RUN_ID', 'พัสดุทดสอบรับพร้อมกัน', '$UNIT'),
  ('$ITEM_ISSUE',   'INVC-I-$RUN_ID', 'พัสดุทดสอบเบิกพร้อมกัน', '$UNIT'),
  ('$ITEM_REVERSE', 'INVC-V-$RUN_ID', 'พัสดุทดสอบย้อนพร้อมกัน', '$UNIT');
SQL

# เรียก stock_post_movement ใน session ของเจ้าหน้าที่คลัง — คืน id ที่ลงได้ หรือข้อความ error
post() {
  local item="$1" type="$2" qty="$3" ref="$4" extra="${5:-}"
  psql "$DB_URL" -q -t -A 2>&1 <<SQL
set role authenticated;
set request.jwt.claim.sub = '$OFFICER';
select public.stock_post_movement(
  p_item_id => '$item', p_type => '$type', p_quantity => $qty,
  p_effective_date => current_date, p_reference => '$ref',
  p_request_id => 'invc-$RUN_ID' $extra);
SQL
}

issue_extra=", p_requested_by => '$REQUESTER', p_approved_by => '$APPROVER'"

fail() { echo "FAIL $1"; exit 1; }

# --- 2.1 รับเข้าพร้อมกัน 8 session บนรายการที่ยังไม่มีรายการเลย -----------------------
# เดิม: รายการแรกต้องเป็นยอดยกมา และลำดับอ้างอิง created_at/id ซึ่งชนกันได้
N=8
for i in $(seq 1 $N); do
  post "$ITEM_RECEIPT" RECEIPT 1 "RC-INVC-$i" > "$LOGS/receipt-$i.log" &
done
wait
for i in $(seq 1 $N); do
  if grep -q 'ERROR' "$LOGS/receipt-$i.log"; then
    cat "$LOGS/receipt-$i.log"; fail "รับเข้าพร้อมกันครั้งที่ $i ล้ม"
  fi
done
echo "ok   รับเข้าพร้อมกัน $N คำขอสำเร็จทั้งหมด (ไม่ต้องมียอดยกมา)"

on_hand="$(psql "$DB_URL" -t -A -c "select public.stock_on_hand('$ITEM_RECEIPT')")"
[ "$on_hand" = "8.000" ] || fail "ยอดคงเหลือควรเป็น 8.000 แต่ได้ $on_hand"
echo "ok   ยอดคงเหลือ $on_hand ตรงกับจำนวนรับเข้า"

seqs="$(psql "$DB_URL" -t -A -c \
  "select string_agg(sequence_no::text, ',' order by sequence_no)
   from public.stock_movements where item_id = '$ITEM_RECEIPT'")"
[ "$seqs" = "1,2,3,4,5,6,7,8" ] || fail "sequence_no ควรเป็น 1..8 ต่อเนื่องไม่ซ้ำ แต่ได้ $seqs"
echo "ok   sequence_no ต่อเนื่อง 1..8 ไม่ซ้ำไม่ข้าม"

chain="$(psql "$DB_URL" -t -A -c \
  "select count(*) from public.stock_movements
   where item_id = '$ITEM_RECEIPT' and balance_after <> sequence_no")"
[ "$chain" = "0" ] || fail "balance_after ของแต่ละแถวต้องเท่ากับลำดับ (รับทีละ 1) แต่ผิด $chain แถว"
echo "ok   balance_after ของทุกแถวสอดคล้องกับลำดับ ledger"

# --- 2.2 เบิกเกินยอดพร้อมกัน: ยอด 5 เบิกใบละ 4 สองใบ ------------------------------------
post "$ITEM_ISSUE" OPENING_BALANCE 5 "OB-INVC-$RUN_ID" > /dev/null
post "$ITEM_ISSUE" ISSUE 4 "ISS-INVC-1" "$issue_extra" > "$LOGS/issue-1.log" &
post "$ITEM_ISSUE" ISSUE 4 "ISS-INVC-2" "$issue_extra" > "$LOGS/issue-2.log" &
wait

issued=0
for i in 1 2; do
  if grep -q 'ยอดคงเหลือไม่พอ' "$LOGS/issue-$i.log"; then
    echo "ok   คำขอเบิกหนึ่งถูกปฏิเสธเพราะยอดไม่พอ"
  elif grep -q 'ERROR' "$LOGS/issue-$i.log"; then
    cat "$LOGS/issue-$i.log"; fail "คำขอเบิกล้มด้วยเหตุผลอื่นที่ไม่ใช่ยอดไม่พอ"
  else
    issued=$((issued + 1))
  fi
done
[ "$issued" = "1" ] || fail "คาดว่าเบิกสำเร็จเพียงรายการเดียว แต่สำเร็จ $issued"
on_hand="$(psql "$DB_URL" -t -A -c "select public.stock_on_hand('$ITEM_ISSUE')")"
[ "$on_hand" = "1.000" ] || fail "ยอดคงเหลือควรเป็น 1.000 (ไม่ติดลบ) แต่ได้ $on_hand"
echo "ok   เบิกพร้อมกันสำเร็จเพียงรายการเดียว ยอดคงเหลือ $on_hand ไม่ติดลบ"

# --- 2.3 ย้อนรายการเดียวกันพร้อมกัน -----------------------------------------------------
post "$ITEM_REVERSE" OPENING_BALANCE 10 "OB-INVC-V-$RUN_ID" > /dev/null
TARGET="$(post "$ITEM_REVERSE" ISSUE 3 "ISS-INVC-V" "$issue_extra" | tail -n 1)"
case "$TARGET" in
  *ERROR*) echo "$TARGET"; fail "เบิกรายการตั้งต้นสำหรับทดสอบการย้อนไม่สำเร็จ" ;;
esac

rev_extra=", p_reason => 'ลงผิด', p_reverses_movement_id => '$TARGET'"
post "$ITEM_REVERSE" REVERSAL 3 "ISS-INVC-V" "$rev_extra" > "$LOGS/rev-1.log" &
post "$ITEM_REVERSE" REVERSAL 3 "ISS-INVC-V" "$rev_extra" > "$LOGS/rev-2.log" &
wait

reversed=0
for i in 1 2; do
  if grep -q 'stock_movements_single_reversal' "$LOGS/rev-$i.log"; then
    echo "ok   การย้อนซ้ำถูกปฏิเสธ"
  elif grep -q 'ERROR' "$LOGS/rev-$i.log"; then
    cat "$LOGS/rev-$i.log"; fail "การย้อนล้มด้วยเหตุผลอื่นที่ไม่ใช่ย้อนซ้ำ"
  else
    reversed=$((reversed + 1))
  fi
done
[ "$reversed" = "1" ] || fail "คาดว่าย้อนสำเร็จเพียงครั้งเดียว แต่สำเร็จ $reversed"
on_hand="$(psql "$DB_URL" -t -A -c "select public.stock_on_hand('$ITEM_REVERSE')")"
[ "$on_hand" = "10.000" ] || fail "ยอดควรกลับเป็น 10.000 (ย้อนครั้งเดียว) แต่ได้ $on_hand"
echo "ok   ย้อนพร้อมกันสำเร็จครั้งเดียว ยอดกลับเป็น $on_hand"

echo
echo "ผ่านทั้งสองชุด"
