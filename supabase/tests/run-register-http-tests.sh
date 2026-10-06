#!/usr/bin/env bash
#
# ทดสอบ F-01 ผ่าน HTTP จริง (PostgREST) — ทะเบียนต้องบอกได้เสมอว่าข้อมูลครบหรือถูกตัด
#
# ใช้:  supabase/tests/run-register-http-tests.sh "$DB_URL" "$API_URL" "$ANON_KEY" ["$SERVICE_ROLE_KEY"]
#
# ทำไมต้องมีชั้นนี้นอกจาก procurement_register_completeness_test.sql:
#
#   PostgREST มี max_rows (supabase/config.toml = 1,000; production ยังไม่ตรวจ) ที่ตัดจำนวนแถว
#   ของ set-returning function ก่อนถึง Next.js — SQL ตรง ๆ ไม่เห็นเพดานนี้เลย การเรียกผ่าน
#   HTTP เท่านั้นที่พิสูจน์ได้ว่า procurement_register_result (jsonb ค่าเดียว) ไม่ถูกตัด
#
# ผู้ใช้ทดสอบ: ถ้ามี ACCESS_TOKEN ใน environment จะใช้ตรง ๆ (สำหรับรันในเครื่องที่ไม่มี GoTrue)
# ไม่เช่นนั้นสร้างผู้ใช้ผ่าน GoTrue admin API (ต้องมี SERVICE_ROLE_KEY) แล้ว sign in ด้วยรหัสผ่าน
#
# ข้อมูล: **commit** แถวทดสอบ ~14,000 แถวในปีงบ พ.ศ. 2530 (ปีที่ห่างจากปีอื่นที่ test ใช้)
# ควรรันเป็นขั้นสุดท้ายของ job เพราะ test อื่นอาจนับทั้งตาราง
set -euo pipefail

DB_URL="${1:?ต้องระบุ connection string ของฐานข้อมูล}"
API_URL="${2:?ต้องระบุ API URL (เช่น http://127.0.0.1:54321)}"
ANON_KEY="${3:?ต้องระบุ anon key}"
SERVICE_ROLE_KEY="${4:-}"
# Supabase เปิด PostgREST ที่ /rest/v1 — ตั้ง REST_URL เองได้เมื่อรัน PostgREST ตรง ๆ ไม่ผ่าน gateway
REST_URL="${REST_URL:-$API_URL/rest/v1}"

fail() { echo "FAIL $1"; exit 1; }

# curl ที่แสดง body เมื่อ HTTP ล้ม (curl -f ซ่อนสาเหตุจาก GoTrue/PostgREST ไว้หมด)
api() {
  local out status
  out="$(mktemp)"
  status="$(curl -sS -o "$out" -w '%{http_code}' "$@")" || { cat "$out"; fail "curl ล้ม"; }
  if [ "${status:0:1}" != "2" ]; then
    echo "HTTP $status จาก: ${*: -1}"; cat "$out"; echo
    fail "คำขอ HTTP ไม่สำเร็จ ($status)"
  fi
  cat "$out"
}

OFFICER_ID="c4111111-1111-4111-8111-111111111111"
OFFICER_EMAIL="regh-officer@example.com"
OFFICER_PASSWORD="regh-test-password-$(date +%s)"

echo "== เตรียมข้อมูลทดสอบ =="

# 1) ผู้ใช้ (เจ้าหน้าที่พัสดุ มี procurement.read.all)
if [ -z "${ACCESS_TOKEN:-}" ]; then
  [ -n "$SERVICE_ROLE_KEY" ] || fail "ต้องระบุ SERVICE_ROLE_KEY หรือ ACCESS_TOKEN"

  existing="$(psql "$DB_URL" -t -A -c "select id from auth.users where email = '$OFFICER_EMAIL'")"
  if [ -n "$existing" ]; then
    OFFICER_ID="$existing"
    api -X PUT "$API_URL/auth/v1/admin/users/$OFFICER_ID" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
      -H 'Content-Type: application/json' \
      -d "{\"password\": \"$OFFICER_PASSWORD\"}" > /dev/null
  else
    created="$(api -X POST "$API_URL/auth/v1/admin/users" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
      -H 'Content-Type: application/json' \
      -d "{\"email\": \"$OFFICER_EMAIL\", \"password\": \"$OFFICER_PASSWORD\", \"email_confirm\": true}")"
    OFFICER_ID="$(echo "$created" | jq -r '.id')"
  fi

  ACCESS_TOKEN="$(api -X POST "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
    -d "{\"email\": \"$OFFICER_EMAIL\", \"password\": \"$OFFICER_PASSWORD\"}" | jq -r '.access_token')"
  [ -n "$ACCESS_TOKEN" ] && [ "$ACCESS_TOKEN" != "null" ] || fail "sign in ไม่ได้ access token"
fi

# 2) โปรไฟล์ + บทบาท + ปีงบ + ทะเบียนจำนวนมาก (idempotent)
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (id, email)
  select '$OFFICER_ID', '$OFFICER_EMAIL'
  where not exists (select 1 from auth.users where id = '$OFFICER_ID');

insert into public.profiles (id, email, first_name_th, last_name_th, is_active)
values ('$OFFICER_ID', '$OFFICER_EMAIL', 'ทดสอบ', 'พัสดุ', true)
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_code)
values ('$OFFICER_ID', 'PROCUREMENT_OFFICER')
on conflict do nothing;

insert into public.fiscal_years (id, code, year_be, start_date, end_date, status)
values ('c4000000-0000-4000-8000-0000000000f1', 'FYRH1', 2530, '1986-10-01', '1987-09-30', 'OPEN')
on conflict (id) do nothing;

create temp table sizes (d date, n integer);
insert into sizes values
  ('1987-01-01',  999), ('1987-01-02', 1000), ('1987-01-03', 1001),
  ('1987-02-01', 4999), ('1987-02-02', 5000), ('1987-02-03', 5001);

insert into public.procurements
  (reference, subject, status, classification, procurement_method, is_emergency,
   fiscal_year_id, request_date, created_by)
select
  'RH-' || to_char(s.d, 'MMDD') || '-' || lpad(g::text, 5, '0'),
  'ทะเบียนจำนวนมากผ่าน HTTP (ตัวอย่าง)', 'DRAFT', 'GOODS', 'SPECIFIC', false,
  'c4000000-0000-4000-8000-0000000000f1', s.d, '$OFFICER_ID'
from sizes s, generate_series(1, s.n) g
on conflict (reference) do nothing;

analyze public.procurements;
SQL

call_rpc() { # day limit
  api -X POST "$REST_URL/rpc/procurement_register_result" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"p_date_from\": \"$1\", \"p_date_to\": \"$1\", \"p_limit\": $2}"
}

# day limit expected_total expected_returned expected_truncated
check() {
  local day="$1" limit="$2" total="$3" returned="$4" truncated="$5"
  local body got_total got_returned got_truncated
  body="$(call_rpc "$day" "$limit")"
  got_total="$(echo "$body" | jq -r '.total_count')"
  got_returned="$(echo "$body" | jq -r '.rows | length')"
  got_truncated="$(echo "$body" | jq -r --argjson l "$limit" '.total_count > $l')"

  [ "$got_total" = "$total" ] || fail "[$day limit=$limit] total_count ควรเป็น $total แต่ได้ $got_total"
  [ "$got_returned" = "$returned" ] || fail "[$day limit=$limit] ควรได้ $returned แถว แต่ได้ $got_returned (มีชั้นใดตัดแถวเงียบ ๆ)"
  [ "$got_truncated" = "$truncated" ] || fail "[$day limit=$limit] truncated ควรเป็น $truncated แต่ได้ $got_truncated"
  echo "ok   [$day limit=$limit] total=$got_total คืน $got_returned แถว truncated=$got_truncated"
}

echo
echo "== ผ่าน PostgREST: เพดานหน้าจอ 1000 (ขอบเขต 999/1000/1001) =="
check 1987-01-01 1000  999  999 false
check 1987-01-02 1000 1000 1000 false
check 1987-01-03 1000 1001 1000 true

echo
echo "== ผ่าน PostgREST: เพดาน export 5000 (ขอบเขต 4999/5000/5001) =="
check 1987-02-01 5000 4999 4999 false
check 1987-02-02 5000 5000 5000 false
check 1987-02-03 5000 5001 5000 true

# ทำไมต้องไม่เดาจากจำนวนแถว: ขอ 5001 แต่ SQL clamp เหลือ 5000 — แถวที่ได้ไม่เกินเพดานที่ขอ
# (วิธีเดิม limit+1 จึงสรุปว่า "ครบ") แต่ total_count ยังบอก 5001 จึงเห็นว่าขาดไป 1 แถว
# (interpretRegisterResult ฝั่งแอป throw ในกรณีนี้ ดู tests/unit/register-result.test.ts)
body="$(call_rpc 1987-02-03 5001)"
[ "$(echo "$body" | jq -r '.total_count')" = "5001" ] || fail "ขอ 5001: total_count ต้องบอก 5001"
[ "$(echo "$body" | jq -r '.rows | length')" = "5000" ] || fail "ขอ 5001: SQL ต้อง clamp เหลือ 5000 แถว"
echo "ok   [1987-02-03 limit=5001] clamp เหลือ 5000 แต่ total_count=5001 จึงตรวจพบว่าแถวไม่ครบ"

# บันทึกพฤติกรรม max_rows ของสภาพแวดล้อมนี้ไว้ในล็อก (ไม่ใช่เงื่อนไขผ่าน/ล้ม — ค่านี้เปลี่ยนได้)
# เพื่อให้เห็นว่า set-returning function ธรรมดาถูกตัดจริงหรือไม่ ขณะที่ jsonb ครบทุกแถว
plain="$(api -X POST "$REST_URL/rpc/procurement_register_rows" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"p_date_from": "1987-02-02", "p_date_to": "1987-02-02", "p_limit": 5000}' | jq 'length')"
echo "info procurement_register_rows ผ่าน PostgREST ขอ 5000 แถว (มี 5000) ได้ $plain แถว — ถ้าน้อยกว่า 5000 แปลว่า max_rows ตัดจริง"

echo
echo "ผ่านทั้งหมด"
