#!/usr/bin/env bash
#
# ทดสอบการสร้าง/บันทึกร่างจัดซื้อบน PostgreSQL จริง (F-08)
#
# ใช้:  supabase/tests/run-draft-tests.sh "$DB_URL"
#
# ชุดที่ 1 เป็น SQL ไฟล์เดียว (ทรานแซกชันเดียว rollback ท้ายไฟล์)
# ชุดที่ 2 ต้องใช้หลาย session พร้อมกัน — พิสูจน์ว่าการล็อกแถวแม่ + ตรวจ version ในฐานข้อมูล
# กันการเขียนทับเงียบ ๆ ได้จริง และสร้างร่างพร้อมกันไม่ชนเลขอ้างอิง
set -euo pipefail

DB_URL="${1:?ต้องระบุ connection string ของฐานข้อมูล}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS="$(mktemp -d)"

echo "== ชุดที่ 1: RPC สร้าง/บันทึกร่าง ความ atomic สิทธิ์ และการปิดเขียนตรง =="
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$HERE/procurement_draft_atomic_test.sql"

echo
echo "== ชุดที่ 2: บันทึก/สร้างพร้อมกันหลาย session =="

# id ใหม่ทุกรอบ มิฉะนั้นรอบถัดไปเจอข้อมูลสะสมจากรอบก่อนแล้วผ่านด้วยเหตุผลผิด
RUN_ID="$(date +%s%N | tail -c 8)"
ids() { psql "$DB_URL" -t -A -c 'select gen_random_uuid()'; }
OFFICER="$(ids)"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (id, email) values ('$OFFICER', 'drc-off-$RUN_ID@example.test');
insert into public.profiles (id, email, first_name_th, last_name_th, is_active)
values ('$OFFICER', 'drc-off-$RUN_ID@example.test', 'ทดสอบ', 'พัสดุ', true);
insert into public.user_roles (user_id, role_code) values ('$OFFICER', 'PROCUREMENT_OFFICER');
SQL

# ปีงบที่ไม่ซ้ำกันทุกรอบ: fiscal_years_no_overlap เป็น exclusion constraint และ year_be ต้องอยู่ 2500–2700
# สุ่มจาก RUN_ID ในช่อง 2600–2699 (พ.ศ. → ค.ศ. 2057–2156) ชนกับรอบก่อนให้ลองใหม่
FY=""
for attempt in 1 2 3 4 5 6 7 8; do
  YEAR_BE=$(( 2600 + (RUN_ID + attempt * 37) % 100 ))
  CE=$(( YEAR_BE - 543 ))
  FY="$(psql "$DB_URL" -t -A -q -c "
    insert into public.fiscal_years (code, year_be, start_date, end_date, status)
    values ('FYDC-$RUN_ID-$attempt', $YEAR_BE, make_date($CE - 1, 10, 1), make_date($CE, 9, 30), 'OPEN')
    returning id" 2>/dev/null)" && [ -n "$FY" ] && break
  FY=""
done
[ -n "$FY" ] || { echo "FAIL สร้างปีงบทดสอบไม่ได้ (ชนกับปีที่มีอยู่ทุกครั้ง)" >&2; exit 1; }
FY_DATE="$(psql "$DB_URL" -t -A -c "select (start_date + 31)::text from public.fiscal_years where id = '$FY'")"

fail() { echo "FAIL $1" >&2; exit 1; }

# เรียก RPC ในนามเจ้าหน้าที่พัสดุ — คืน jsonb หรือข้อความ error
rpc() {
  psql "$DB_URL" -q -t -A 2>&1 <<SQL
set role authenticated;
set request.jwt.claim.sub = '$OFFICER';
$1
SQL
}

payload() { # subject item_description
  cat <<JSON
jsonb_build_object(
  'subject', '$1', 'tax_mode', 'EXEMPT', 'fiscal_year_id', '$FY', 'request_date', '$FY_DATE',
  'is_emergency', false,
  'items', jsonb_build_array(jsonb_build_object(
    'line_no', 1, 'description', '$2', 'quantity', '1', 'unit_price', '100')),
  'funding_allocations', '[]'::jsonb)
JSON
}

# --- 2.1 บันทึกพร้อมกันด้วย version เดียวกัน: ต้องสำเร็จหนึ่ง ถูกปฏิเสธหนึ่ง ---------------
created="$(rpc "select public.procurement_create_draft($(payload 'ร่างทดสอบพร้อมกัน' 'ตั้งต้น'), 'drc-create')")"
DRAFT_ID="$(echo "$created" | jq -r '.id')"
[ -n "$DRAFT_ID" ] && [ "$DRAFT_ID" != "null" ] || fail "สร้างร่างตั้งต้นไม่สำเร็จ: $created"

rpc "select public.procurement_save_draft('$DRAFT_ID', 1, $(payload 'ผู้บันทึก A' 'จาก-A'), 'drc-save-a')" > "$LOGS/save-a.log" &
rpc "select public.procurement_save_draft('$DRAFT_ID', 1, $(payload 'ผู้บันทึก B' 'จาก-B'), 'drc-save-b')" > "$LOGS/save-b.log" &
wait

ok=0; winner=""
for who in a b; do
  if grep -q 'มีผู้อื่นแก้ไขรายการนี้ไปแล้ว' "$LOGS/save-$who.log"; then
    echo "ok   ผู้บันทึก ${who^^} ถูกปฏิเสธเพราะมีผู้อื่นแก้ไปแล้ว"
  elif grep -q 'ERROR' "$LOGS/save-$who.log"; then
    cat "$LOGS/save-$who.log"; fail "ผู้บันทึก ${who^^} ล้มด้วยเหตุผลอื่นที่ไม่ใช่ version ชน"
  else
    ok=$((ok + 1)); winner="$who"
  fi
done
[ "$ok" = "1" ] || { cat "$LOGS"/save-*.log; fail "คาดว่าบันทึกสำเร็จหนึ่งคำขอ แต่สำเร็จ $ok"; }
echo "ok   บันทึกพร้อมกันด้วย version เดียวกัน สำเร็จเพียงหนึ่งคำขอ (ผู้ชนะ: ${winner^^})"

state="$(psql "$DB_URL" -t -A -F'|' -c "
  select p.version, p.subject,
         (select string_agg(description, ',') from public.procurement_items where procurement_id = p.id)
  from public.procurements p where p.id = '$DRAFT_ID'")"
expected="2|ผู้บันทึก ${winner^^}|จาก-${winner^^}"
[ "$state" = "$expected" ] || fail "สถานะสุดท้ายควรเป็น '$expected' (ผู้ชนะเท่านั้น ไม่ปนกัน) แต่ได้ '$state'"
echo "ok   สถานะสุดท้ายเป็นของผู้ชนะล้วน ๆ ไม่ปนกัน: version 2"

audits="$(psql "$DB_URL" -t -A -c "
  select count(*) from public.audit_events
  where entity_id = '$DRAFT_ID' and action = 'entity.update' and provenance = 'DB_TRUSTED'")"
[ "$audits" = "1" ] || fail "ควรมี audit การบันทึกหนึ่งแถว (ของผู้ชนะ) แต่มี $audits"
echo "ok   มี audit เฉพาะของคำขอที่สำเร็จ"

# --- 2.2 สร้างพร้อมกัน 8 session: เลขอ้างอิงไม่ชน ------------------------------------------
N=8
for i in $(seq 1 $N); do
  rpc "select public.procurement_create_draft($(payload "สร้างพร้อมกัน $i" "ก-$i"), 'drc-par-$RUN_ID-$i')" > "$LOGS/create-$i.log" &
done
wait
for i in $(seq 1 $N); do
  if grep -q 'ERROR' "$LOGS/create-$i.log"; then cat "$LOGS/create-$i.log"; fail "สร้างพร้อมกันครั้งที่ $i ล้ม"; fi
done
refs="$(psql "$DB_URL" -t -A -c "
  select count(distinct reference) from public.procurements
  where created_by = '$OFFICER' and subject like 'สร้างพร้อมกัน %'")"
[ "$refs" = "$N" ] || fail "ควรได้เลขอ้างอิงไม่ซ้ำ $N รายการ แต่ได้ $refs"
audits="$(psql "$DB_URL" -t -A -c "
  select count(*) from public.audit_events
  where request_id like 'drc-par-$RUN_ID-%' and action = 'entity.create' and provenance = 'DB_TRUSTED'")"
[ "$audits" = "$N" ] || fail "ควรมี audit การสร้าง $N แถว แต่มี $audits"
echo "ok   สร้างพร้อมกัน $N ร่าง เลขอ้างอิงไม่ซ้ำและมี audit ครบทุกร่าง"

echo
echo "ผ่านทั้งสองชุด"
