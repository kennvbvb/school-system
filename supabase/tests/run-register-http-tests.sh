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

fail() { echo "FAIL $1" >&2; exit 1; }

# curl ที่แสดง body เมื่อ HTTP ล้ม (curl -f ซ่อนสาเหตุจาก GoTrue/PostgREST ไว้หมด)
api() {
  local out status
  out="$(mktemp)"
  status="$(curl -sS -o "$out" -w '%{http_code}' "$@")" || { cat "$out" >&2; fail "curl ล้ม"; }
  if [ "${status:0:1}" != "2" ]; then
    { echo "HTTP $status จาก: ${*: -1}"; cat "$out"; echo; } >&2
    fail "คำขอ HTTP ไม่สำเร็จ ($status)"
  fi
  cat "$out"
}

OFFICER_ID="c4111111-1111-4111-8111-111111111111"
OFFICER_EMAIL="regh-officer@example.com"
NOBODY_ID="c4222222-2222-4222-8222-222222222222"
NOBODY_EMAIL="regh-nobody@example.com"
TEST_PASSWORD="regh-test-password-$(date +%s)"

echo "== เตรียมข้อมูลทดสอบ =="

# สร้าง/รีเซ็ตผู้ใช้ผ่าน GoTrue admin API แล้ว sign in — ตั้ง USER_ID และ USER_TOKEN
provision_user() { # email
  local email="$1" existing created
  existing="$(psql "$DB_URL" -t -A -c "select id from auth.users where email = '$email'")"
  if [ -n "$existing" ]; then
    USER_ID="$existing"
    api -X PUT "$API_URL/auth/v1/admin/users/$USER_ID" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
      -H 'Content-Type: application/json' \
      -d "{\"password\": \"$TEST_PASSWORD\"}" > /dev/null
  else
    created="$(api -X POST "$API_URL/auth/v1/admin/users" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
      -H 'Content-Type: application/json' \
      -d "{\"email\": \"$email\", \"password\": \"$TEST_PASSWORD\", \"email_confirm\": true}")"
    USER_ID="$(echo "$created" | jq -r '.id')"
  fi

  USER_TOKEN="$(api -X POST "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
    -d "{\"email\": \"$email\", \"password\": \"$TEST_PASSWORD\"}" | jq -r '.access_token')"
  [ -n "$USER_TOKEN" ] && [ "$USER_TOKEN" != "null" ] || fail "sign in ไม่ได้ access token ของ $email"
}

# 1) ผู้ใช้: เจ้าหน้าที่พัสดุ (มี procurement.read.all) และผู้ใช้ที่ไม่มีสิทธิ์ใด ๆ
#    รันในเครื่องที่ไม่มี GoTrue ส่ง ACCESS_TOKEN และ ACCESS_TOKEN_NOBODY (JWT ที่ลงนามเอง) มาแทนได้
if [ -z "${ACCESS_TOKEN:-}" ]; then
  [ -n "$SERVICE_ROLE_KEY" ] || fail "ต้องระบุ SERVICE_ROLE_KEY หรือ ACCESS_TOKEN"
  provision_user "$OFFICER_EMAIL"; OFFICER_ID="$USER_ID"; ACCESS_TOKEN="$USER_TOKEN"
  provision_user "$NOBODY_EMAIL"; NOBODY_ID="$USER_ID"; ACCESS_TOKEN_NOBODY="$USER_TOKEN"
fi
: "${ACCESS_TOKEN_NOBODY:?ต้องมี ACCESS_TOKEN_NOBODY เมื่อส่ง ACCESS_TOKEN เอง}"

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

-- ผู้ใช้ที่ active แต่ไม่มีบทบาทใดเลย
insert into auth.users (id, email)
  select '$NOBODY_ID', '$NOBODY_EMAIL'
  where not exists (select 1 from auth.users where id = '$NOBODY_ID');
insert into public.profiles (id, email, first_name_th, last_name_th, is_active)
values ('$NOBODY_ID', '$NOBODY_EMAIL', 'ทดสอบ', 'ไม่มีสิทธิ์', true)
on conflict (id) do nothing;

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
echo "== ผ่าน Data API: view/ฟังก์ชันไม่ข้ามสิทธิ์ (F-06) =="

# ผู้ที่ไม่มีสิทธิ์ใด ๆ — view ต้องว่าง ไม่ใช่ 403 (RLS กรอง) และ RPC ที่อ่านต้องได้ total 0
for view in procurement_totals procurement_item_amounts budget_account_balances stock_item_balances; do
  got="$(api "$REST_URL/$view?limit=5" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN_NOBODY" | jq 'length')"
  [ "$got" = "0" ] || fail "ผู้ไม่มีสิทธิ์อ่าน $view ได้ $got แถว (ควรเป็น 0)"
done
echo "ok   ผู้ไม่มีสิทธิ์: view ทั้งสี่ว่าง"

nobody_total="$(api -X POST "$REST_URL/rpc/procurement_register_result" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN_NOBODY" -H 'Content-Type: application/json' \
  -d '{"p_date_from": "1987-02-03", "p_date_to": "1987-02-03", "p_limit": 5000}' | jq -r '.total_count')"
[ "$nobody_total" = "0" ] || fail "ผู้ไม่มีสิทธิ์เห็นทะเบียน total_count=$nobody_total (ควรเป็น 0)"
echo "ok   ผู้ไม่มีสิทธิ์: ทะเบียน total_count = 0"

# เจ้าหน้าที่พัสดุเห็นยอดจริง (ไม่ใช่แค่ว่างเสมอ — กันกรณี view พังจนทุกคนเห็น 0)
officer_rows="$(api "$REST_URL/procurement_totals?limit=3" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" | jq 'length')"
[ "$officer_rows" = "3" ] || fail "เจ้าหน้าที่พัสดุควรเห็นยอดรายการ แต่ได้ $officer_rows แถว"
echo "ok   เจ้าหน้าที่พัสดุ (read.all) เห็นยอดรายการ"

# ฟังก์ชันภายในเรียกตรงไม่ได้ แม้มีสิทธิ์ (ต้องอ่านผ่าน view)
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$REST_URL/rpc/budget_available" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"account_id": "c4000000-0000-4000-8000-000000000000"}')"
case "$code" in 401|403|404) echo "ok   budget_available เรียกผ่าน Data API ไม่ได้ (HTTP $code)";; *) fail "budget_available ควรถูกปฏิเสธ แต่ได้ HTTP $code";; esac

# anon (ไม่มี JWT ผู้ใช้): view และ RPC ถูกปฏิเสธที่ระดับสิทธิ์
code="$(curl -s -o /dev/null -w '%{http_code}' "$REST_URL/procurement_totals?limit=1" -H "apikey: $ANON_KEY")"
case "$code" in 401|403) echo "ok   anon อ่าน procurement_totals ไม่ได้ (HTTP $code)";; *) fail "anon อ่าน view ได้/ผิดปกติ HTTP $code";; esac
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$REST_URL/rpc/procurement_register_result" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}')"
case "$code" in 401|403) echo "ok   anon เรียก procurement_register_result ไม่ได้ (HTTP $code)";; *) fail "anon เรียก RPC ได้/ผิดปกติ HTTP $code";; esac

echo
echo "== ผ่าน Data API: บันทึกร่างแบบ atomic และ version ชน (F-08) =="

DRAFT_PAYLOAD='{"subject": "ร่างทดสอบผ่าน HTTP (ตัวอย่าง)", "tax_mode": "EXEMPT",
  "fiscal_year_id": "c4000000-0000-4000-8000-0000000000f1", "request_date": "1987-03-10",
  "is_emergency": false,
  "items": [{"line_no": 1, "description": "ปากกา (ตัวอย่าง)", "quantity": "2", "unit_price": "10.50"}],
  "funding_allocations": []}'

created="$(curl -sS -f -m 20 -X POST "$REST_URL/rpc/procurement_create_draft" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"p_payload\": $DRAFT_PAYLOAD, \"p_request_id\": \"http-draft-create\"}")" \
  || fail "สร้างร่างผ่าน Data API ไม่สำเร็จ"
draft_id="$(echo "$created" | jq -r '.id')"
[ "$(echo "$created" | jq -r '.version')" = "1" ] || fail "ร่างใหม่ควรเริ่มที่ version 1: $created"
echo "ok   สร้างร่างผ่าน RPC ได้ (version 1)"

saved="$(curl -sS -f -m 20 -X POST "$REST_URL/rpc/procurement_save_draft" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"p_procurement_id\": \"$draft_id\", \"p_expected_version\": 1, \"p_payload\": $DRAFT_PAYLOAD, \"p_request_id\": \"http-draft-save\"}")" \
  || fail "บันทึกร่างผ่าน Data API ไม่สำเร็จ"
[ "$(echo "$saved" | jq -r '.version')" = "2" ] || fail "บันทึกหนึ่งครั้งควรได้ version 2: $saved"
echo "ok   บันทึกร่างด้วย version ที่ถูกต้อง ได้ version 2"

# version เก่า: ต้องได้ 409 พร้อมข้อความไทย **ภายในไม่กี่วินาที** — เคยค้างไม่ตอบเมื่อใช้ SQLSTATE 40001
# (PostgREST ลองซ้ำไม่จบ) -m 20 ทำให้ถ้ากลับไปค้างอีก test นี้ล้มแทนที่จะค้างทั้ง job
stale_body="$(mktemp)"
stale_code="$(curl -s -m 20 -o "$stale_body" -w '%{http_code}' -X POST "$REST_URL/rpc/procurement_save_draft" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"p_procurement_id\": \"$draft_id\", \"p_expected_version\": 1, \"p_payload\": $DRAFT_PAYLOAD, \"p_request_id\": \"http-draft-stale\"}")" || stale_code="timeout"
[ "$stale_code" = "409" ] || { cat "$stale_body"; fail "บันทึกด้วย version เก่าควรได้ HTTP 409 แต่ได้ $stale_code"; }
grep -q 'มีผู้อื่นแก้ไขรายการนี้ไปแล้ว' "$stale_body" || { cat "$stale_body"; fail "409 ต้องมีข้อความภาษาไทยให้ผู้ใช้โหลดหน้าใหม่"; }
echo "ok   บันทึกด้วย version เก่าได้ 409 พร้อมข้อความไทยทันที (ไม่ค้าง)"

# procurement_submit เดิมก็แจ้ง version ชนด้วย 40001 (migration 20261007000200 เปลี่ยนเป็น PT409) — ยืนยันผ่าน HTTP จริง
submit_body="$(mktemp)"
submit_code="$(curl -s -m 20 -o "$submit_body" -w '%{http_code}' -X POST "$REST_URL/rpc/procurement_submit" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"p_procurement_id\": \"$draft_id\", \"p_expected_version\": 1, \"p_request_id\": \"http-submit-stale\"}")" || submit_code="timeout"
[ "$submit_code" = "409" ] || { cat "$submit_body"; fail "ส่งอนุมัติด้วย version เก่าควรได้ HTTP 409 แต่ได้ $submit_code"; }
echo "ok   ส่งอนุมัติด้วย version เก่าได้ 409 ทันที (ไม่ค้าง)"

# เขียนตารางตรงถูกปฏิเสธที่ระดับสิทธิ์ ไม่ใช่แค่ RLS
code="$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X PATCH "$REST_URL/procurements?id=eq.$draft_id" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"status": "APPROVED"}')"
case "$code" in 401|403) echo "ok   PATCH procurements ตรงถูกปฏิเสธ (HTTP $code)";; *) fail "PATCH ตรงควรถูกปฏิเสธ แต่ได้ HTTP $code";; esac
code="$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST "$REST_URL/procurement_items" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"procurement_id\": \"$draft_id\", \"line_no\": 9, \"description\": \"เขียนตรง\", \"quantity\": 1, \"unit_price\": 1}")"
case "$code" in 401|403) echo "ok   POST procurement_items ตรงถูกปฏิเสธ (HTTP $code)";; *) fail "POST รายการย่อยตรงควรถูกปฏิเสธ แต่ได้ HTTP $code";; esac

echo
echo "ผ่านทั้งหมด"
