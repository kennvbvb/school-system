# Data dictionary

> ครอบคลุมเฉพาะตารางที่ **มีอยู่จริง** หลัง Phase 2
> ตารางของ Phase 3-6 อยู่ในแผนข้อ 11 และจะถูกเพิ่มที่นี่เมื่อ migration ถูกสร้าง

## ข้อตกลงร่วม

| เรื่อง               | กติกา                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| เวลา                 | `timestamptz` เก็บ UTC เสมอ แปลงเป็น `Asia/Bangkok` ตอนแสดงผลเท่านั้น        |
| การลบ                | ข้อมูลอ้างอิงใช้ `is_active` ข้อมูลธุรกรรมใช้ `deleted_at` (soft delete)     |
| จำนวนเงิน            | `numeric(18,2)` ในฐานข้อมูล แปลงเป็น BigInt หน่วยสตางค์ในแอป (ADR 0005)      |
| จำนวนและราคาต่อหน่วย | `numeric(18,4)`                                                              |
| Primary key          | `uuid` ที่สร้างด้วย `gen_random_uuid()` ยกเว้นตารางที่ใช้รหัสข้อความเป็น key |
| `updated_at`         | อัปเดตอัตโนมัติด้วย trigger `set_updated_at()`                               |

## `departments` — หน่วยงาน

| คอลัมน์     | ชนิด    | ข้อจำกัด                             | หมายเหตุ                    |
| ----------- | ------- | ------------------------------------ | --------------------------- |
| `id`        | uuid    | PK                                   |                             |
| `code`      | text    | unique, ไม่ว่าง                      | รหัสที่ใช้ในเลขเอกสาร       |
| `name_th`   | text    | not null                             |                             |
| `parent_id` | uuid    | FK → departments, on delete restrict | ห้ามเป็นตัวเอง              |
| `is_active` | boolean | not null default true                | ปิดใช้แทนการลบ (FR-MST-008) |

## `positions` — ตำแหน่ง

| คอลัมน์        | ชนิด    | ข้อจำกัด               | หมายเหตุ                          |
| -------------- | ------- | ---------------------- | --------------------------------- |
| `id`           | uuid    | PK                     |                                   |
| `code`         | text    | unique, ไม่ว่าง        |                                   |
| `name_th`      | text    | not null               |                                   |
| `is_signatory` | boolean | not null default false | ตำแหน่งนี้ลงนามในเอกสารได้หรือไม่ |
| `is_active`    | boolean | not null default true  |                                   |

## `profiles` — บุคลากร

หนึ่งต่อหนึ่งกับ `auth.users` — **การมีแถวที่นี่คือสิ่งที่ให้สิทธิ์ใช้ระบบ** (ADR 0002)

| คอลัมน์                          | ชนิด        | ข้อจำกัด                                | หมายเหตุ                                        |
| -------------------------------- | ----------- | --------------------------------------- | ----------------------------------------------- |
| `id`                             | uuid        | PK, FK → auth.users, on delete restrict | `restrict` เพื่อไม่ให้ประวัติหายเมื่อบัญชีถูกลบ |
| `email`                          | text        | unique, ต้องเป็นตัวพิมพ์เล็ก            | check constraint บังคับ lowercase               |
| `employee_code`                  | text        | unique, nullable                        |                                                 |
| `title_th`                       | text        | nullable                                | คำนำหน้า                                        |
| `first_name_th` / `last_name_th` | text        | not null, ไม่ว่าง                       |                                                 |
| `position_id`                    | uuid        | FK → positions, restrict                |                                                 |
| `department_id`                  | uuid        | FK → departments, restrict              |                                                 |
| `is_active`                      | boolean     | not null default true                   | `false` = ปิดบัญชี ใช้ระบบไม่ได้ทันที           |
| `last_login_at`                  | timestamptz | nullable                                | FR-AUTH-004                                     |

**Index:** `department_id` (เฉพาะแถว active), `is_active`

**ไม่มี policy สำหรับ `delete`** โดยเจตนา

## `permissions` — รหัสสิทธิ์

| คอลัมน์          | ชนิด | ข้อจำกัด                                  |
| ---------------- | ---- | ----------------------------------------- |
| `code`           | text | PK, ต้องตรงรูปแบบ `^[a-z_]+(\.[a-z_]+)+$` |
| `description_th` | text | not null                                  |

รายการผูกกับ `src/domain/auth/permissions.ts` และ seed ด้วย `supabase/seed-reference.sql`
แก้ผ่าน migration เท่านั้น ไม่มี policy เขียน

## `roles` — บทบาท

| คอลัมน์          | ชนิด    | ข้อจำกัด                           |
| ---------------- | ------- | ---------------------------------- |
| `code`           | text    | PK, ต้องตรงรูปแบบ `^[A-Z][A-Z_]*$` |
| `name_th`        | text    | not null                           |
| `description_th` | text    | nullable                           |
| `is_system`      | boolean | not null default false             |

## `role_permissions` — การผูกบทบาทกับสิทธิ์

| คอลัมน์           | ชนิด | หมายเหตุ                             |
| ----------------- | ---- | ------------------------------------ |
| `role_code`       | text | FK → roles, on delete cascade        |
| `permission_code` | text | FK → permissions, on delete restrict |

PK ประกอบ `(role_code, permission_code)` — กันการผูกซ้ำ

**ตารางนี้เป็นแหล่งความจริงตอนรัน** ผู้ดูแลปรับได้โดยไม่ต้อง deploy

## `user_roles` — การมอบบทบาท

| คอลัมน์         | ชนิด        | หมายเหตุ                                                            |
| --------------- | ----------- | ------------------------------------------------------------------- |
| `user_id`       | uuid        | FK → profiles, on delete cascade                                    |
| `role_code`     | text        | FK → roles, on delete restrict                                      |
| `department_id` | uuid        | nullable — เตรียมรองรับ scope ตามหน่วยงาน **ยังไม่มี logic ที่ใช้** |
| `granted_by`    | uuid        | FK → profiles, on delete set null                                   |
| `granted_at`    | timestamptz | not null default now()                                              |

## `audit_events` — บันทึกการกระทำ

**append-only** — มีเฉพาะ policy `select` และ `insert` และเพิกถอน `update, delete`
ที่ระดับ table privilege ด้วย (FR-AUD-002)

| คอลัมน์                      | ชนิด  | หมายเหตุ                                                         |
| ---------------------------- | ----- | ---------------------------------------------------------------- |
| `id`                         | uuid  | PK                                                               |
| `request_id`                 | text  | not null — ผูกกับ `x-request-id` ที่ผู้ใช้เห็นบนหน้า error       |
| `actor_id`                   | uuid  | FK → profiles, on delete set null — เก็บประวัติไว้แม้ผู้ใช้ถูกลบ |
| `action`                     | text  | not null, ไม่ว่าง                                                |
| `entity_type` / `entity_id`  | text  | สิ่งที่ถูกกระทำ                                                  |
| `before_json` / `after_json` | jsonb | ผ่าน `redactSensitive()` แล้วเสมอ (FR-AUD-004)                   |
| `metadata_json`              | jsonb | ข้อมูลประกอบ เช่น filter ที่ใช้ตอน export                        |
| `ip_hash`                    | text  | **hash ไม่ใช่ IP ดิบ** (ข้อ 14.2 data minimization)              |
| `user_agent`                 | text  | ตัดที่ 512 อักขระ                                                |

**Index:** `created_at desc`, `(entity_type, entity_id)`, `(actor_id, created_at desc)`, `request_id`

---

# ข้อมูลพื้นฐาน (Phase 2)

## `school_settings` — ข้อมูลโรงเรียน

เก็บแบบ **effective-dated** ไม่ใช่แถวเดียวที่ update ทับ เพราะที่อยู่ ตราสัญลักษณ์
และข้อมูลติดต่อเปลี่ยนได้ตามเวลา และเอกสารต้องอ้างค่า ณ วันที่ออก

| คอลัมน์                           | ชนิด | หมายเหตุ                               |
| --------------------------------- | ---- | -------------------------------------- |
| `name_th` / `address_th`          | text | not null, ห้ามเป็นช่องว่างล้วน         |
| `tax_id`                          | text | ตัวเลข 13 หลัก                         |
| `logo_path`                       | text | path ใน Storage ไม่ใช่ไฟล์             |
| `effective_from` / `effective_to` | date | `effective_to` เป็น null = ยังมีผลอยู่ |

**Exclude constraint** `school_settings_no_overlap` กันไม่ให้มีสองชุดที่ช่วงเวลามีผลทับกัน

## `fiscal_years` — ปีงบประมาณ

| คอลัมน์                   | ชนิด    | หมายเหตุ                                               |
| ------------------------- | ------- | ------------------------------------------------------ |
| `code`                    | text    | unique                                                 |
| `year_be`                 | integer | unique, จำกัด 2500-2700 เพื่อจับการกรอกปี ค.ศ. ผิดช่อง |
| `start_date` / `end_date` | date    | `end_date > start_date`                                |
| `status`                  | enum    | `OPEN` / `CLOSED`                                      |
| `closed_at` / `closed_by` | —       | ต้องสอดคล้องกับ `status` (check constraint)            |

**Exclude constraint** `fiscal_years_no_overlap` — ช่วงวันที่ห้ามทับกัน
เพราะระบบต้องหาปีงบประมาณจากวันที่ได้คำตอบเดียว

> ปีงบประมาณมาจากตารางนี้เสมอ **ไม่ใช่** จาก `year + 543` (ข้อ 9.3)
> ดู `src/domain/master-data/fiscal-year.ts`

## `vendors` — ผู้ขาย

| คอลัมน์                     | ชนิด  | หมายเหตุ             |
| --------------------------- | ----- | -------------------- |
| `vendor_code`               | text  | unique               |
| `tax_id`                    | text  | ตัวเลข 13 หลัก       |
| `branch_no`                 | text  | ตัวเลขไม่เกิน 5 หลัก |
| `address`                   | jsonb |                      |
| `deleted_at` / `deleted_by` | —     | soft delete          |

**`vendors_tax_id_branch_unique`** — unique เฉพาะแถวที่ `deleted_at is null`
เพื่อให้บันทึกผู้ขายรายเดิมใหม่ได้หลังลบ และรวมสาขาเพราะนิติบุคคลเดียวกันมีหลายสาขา

**`vendors_name_trgm_idx`** — GIN trigram index สำหรับค้นชื่อใกล้เคียง (FR-MST-009)

> **ไม่มีคอลัมน์ข้อมูลบัญชีธนาคาร** โดยเจตนา — MVP ไม่มีการจ่ายเงินจริง
> แผนข้อ 11.2 ระบุว่า "หากไม่จำเป็นต่อ MVP ห้ามเก็บ"

## `projects` / `funding_sources`

`projects` ผูกกับปีงบประมาณเสมอ และ `unique (fiscal_year_id, code)` ทำให้
รหัสโครงการซ้ำข้ามปีได้ แต่ห้ามซ้ำในปีเดียวกัน

`budget_amount` เป็น `numeric(18,2)` แปลงเป็น BigInt หน่วยสตางค์ที่ repository (ADR 0005)

## `units` / `item_categories` / `locations`

`item_categories` ใช้ตารางเดียวที่มีคอลัมน์ `kind` (`SUPPLY` / `ASSET`)
แทนสองตารางที่โครงสร้างเหมือนกัน เพราะเกณฑ์แบ่งวัสดุ/ครุภัณฑ์ของโรงเรียน
ยังไม่ได้ข้อสรุป (คำถาม Q5) การใช้ตารางเดียวทำให้ปรับเกณฑ์ภายหลังได้
โดยไม่ต้องย้ายข้อมูลข้ามตาราง

## RLS ของข้อมูลพื้นฐาน

| ตาราง             | อ่าน                                                 | เขียน             |
| ----------------- | ---------------------------------------------------- | ----------------- |
| `school_settings` | ผู้ใช้ที่ active                                     | `settings.manage` |
| `fiscal_years`    | ผู้ใช้ที่ active                                     | `settings.manage` |
| ตารางอ้างอิงอื่น  | ผู้ใช้ที่ active                                     | `masters.manage`  |
| `vendors`         | ที่ยังไม่ถูกลบ (ผู้ถือ `masters.manage` เห็นทั้งหมด) | `masters.manage`  |

**ไม่มี policy สำหรับ `delete` เลย** และเพิกถอน `delete` ที่ระดับ table privilege ด้วย
— ปิดใช้ด้วย `is_active` หรือ `deleted_at` แทน (FR-MST-008)

`school_settings` และ `fiscal_years` ใช้ `settings.manage` ไม่ใช่ `masters.manage`
เพราะกระทบทั้งระบบ ไม่ใช่การแก้ข้อมูลอ้างอิงตามปกติ

---

## `budget_accounts` / `budget_movements` — บัญชีงบและ ledger

เพิ่มใน migration `20260905000100_budget_ledger.sql` ตาม
[ADR 0008](decisions/0008-budget-ledger-and-multi-funding.md)

### หน่วยที่คุมยอด

`budget_accounts` ผูก `fiscal_year_id` + `project_id` + `funding_source_id` + `department_id`
เข้าด้วยกัน คุมยอดที่ระดับนี้แทนระดับโครงการ เพราะโครงการเดียวที่ได้เงินจากสองแหล่ง
ต้องแยกยอดกันได้ มิฉะนั้นรายงานตามแหล่งเงินทำไม่ได้

ข้อจำกัดสองข้อที่บังคับความหมายของตาราง:

- `budget_accounts_scope_required` — ต้องผูกกับอย่างน้อยหนึ่ง scope
  บัญชีที่ไม่ผูกอะไรเลยไม่รู้ว่าคุมยอดของอะไร
- `budget_accounts_scope_unique` — หนึ่ง scope มีบัญชีได้บัญชีเดียวต่อปีงบ
  ใช้ `coalesce(..., uuid ศูนย์)` เพราะ unique index ปกติถือว่า `null` ไม่ซ้ำกับ `null`
  ซึ่งจะทำให้สร้างบัญชีที่ scope ว่างซ้ำได้ไม่จำกัด

### แถวใน ledger

`budget_movements` เป็น **append-only** — ไม่มี policy สำหรับ `insert`/`update`/`delete`
และเพิกถอน privilege ทั้งสามที่ระดับตาราง การลงรายการทำผ่าน
`budget_post_movement()` เท่านั้น เพราะ function นั้นล็อกแถวบัญชีก่อนอ่านยอด

`amount` เป็น `numeric(18,2)` **เป็นบวกเสมอ** ทิศทางมาจาก `movement_type`
ไม่ใช่จากเครื่องหมายของตัวเลข เพราะจำนวนติดลบทำให้ constraint ตรวจได้ยาก
และคนอ่านรายงานตีความผิดง่าย

| ชนิด                           | ผลต่อยอดที่ใช้ได้ | ใช้เมื่อ                        |
| ------------------------------ | ----------------- | ------------------------------- |
| `ALLOCATION` `INCREASE`        | เพิ่ม             | จัดสรรตั้งต้น / ได้รับเพิ่ม     |
| `DECREASE`                     | ลด                | ถูกเรียกคืน                     |
| `TRANSFER_IN` / `TRANSFER_OUT` | เพิ่ม / ลด        | โอนระหว่างบัญชี ต้องเกิดเป็นคู่ |
| `RESERVE`                      | ลด                | กันยอดระหว่างรออนุมัติ          |
| `RELEASE`                      | เพิ่ม             | คืนยอดที่กันไว้                 |
| `COMMIT` `ACTUAL`              | ลด                | ผูกพัน / จ่ายจริง               |
| `REVERSAL`                     | กลับทิศของต้นทาง  | แก้รายการที่ลงผิด               |

คอลัมน์อ้างอิงถูกบังคับให้ตรงกับชนิดด้วย check constraint:
`paired_movement_id` มีได้เฉพาะการโอน, `reverses_movement_id` เฉพาะ `REVERSAL`,
`releases_movement_id` เฉพาะ `RELEASE` — เพื่อไม่ให้ความหมายของคอลัมน์กำกวม

`budget_movements_single_reversal` เป็น partial unique index ที่ทำให้ย้อนรายการเดิม
ได้ครั้งเดียว การย้อนซ้ำทำให้ยอดคลาดเคลื่อนโดยไม่มีใครสังเกต

### กฎที่ `budget_post_movement()` บังคับเพิ่มใน migration 0009

check constraint บอกได้แค่ว่า "คอลัมน์ไหนมีค่าได้เมื่อไร" แต่บอกไม่ได้ว่า
"ค่าที่อ้างถึงนั้นเป็นของบัญชีเดียวกันหรือไม่" สามข้อนี้จึงอยู่ใน function

| กฎ                                                                         | ถ้าไม่มี                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------- |
| `TRANSFER_IN` / `TRANSFER_OUT` ลงได้จาก `budget_transfer()` เท่านั้น       | ลงขาเดียวได้ เท่ากับสร้างเงินขึ้นจากระบบ                |
| `REVERSAL` ต้องอ้างแถวของบัญชีเดียวกัน และแถวนั้นต้องไม่ใช่ `REVERSAL`     | ย้อนข้ามบัญชีได้ ทำให้ยอดสองบัญชีเพี้ยนพร้อมกัน         |
| `RELEASE` ต้องอ้าง `RESERVE` ของบัญชีเดียวกัน และคืนรวมกันไม่เกินที่กันไว้ | คืนยอดเกินได้ ทำให้ยอดที่ใช้ได้งอกจากรายการที่ไม่มีจริง |

ทั้งสามข้อพิสูจน์ด้วย `supabase/tests/budget_integrity_test.sql` บน PostgreSQL จริง

### ยอดคงเหลือ

`budget_account_balances` เป็น view ที่คำนวณ `granted` / `reserved` / `used` / `available`
จากแถวทั้งหมด **ไม่มีคอลัมน์เก็บยอด** เพราะคอลัมน์ที่แก้ได้โดยไม่มีร่องรอย
คือสาเหตุที่ทำให้งบติดลบเกิดขึ้นได้ตั้งแต่แรก (ข้อค้นพบ F-01)

นิยามเดียวกันนี้อยู่ใน `src/domain/budget/availability.ts` ด้วย
ฝั่งฐานข้อมูลเป็นชั้นที่บังคับจริง เพราะการเรียก API ตรงต้องถูกปฏิเสธเช่นเดียวกัน

### RLS

| ตาราง              | อ่าน          | เขียน                                 |
| ------------------ | ------------- | ------------------------------------- |
| `budget_accounts`  | `budget.read` | `budget.manage` (ไม่มี delete)        |
| `budget_movements` | `budget.read` | **ไม่มีเลย** — ผ่าน function เท่านั้น |

ไม่ให้ผู้ใช้ที่ active ทุกคนอ่านได้เหมือนข้อมูลพื้นฐานอื่น เพราะยอดงบคงเหลือ
ไม่ใช่ข้อมูลที่ทุกบทบาทควรเห็น

`budget.override` ใช้สองกรณีเท่านั้น: ลงรายการเกินยอดคงเหลือ (ต้องมีเหตุผลด้วย)
และลงรายการในปีงบที่ปิดแล้ว

### `projects.budget_amount` เปลี่ยนความหมาย

จาก "วงเงินโครงการ" เป็น **"วงเงินตั้งต้นเท่านั้น"** ยอดจริงอยู่ที่
`budget_account_balances` คอลัมน์เดิมยังอยู่ตามแผน migration ใน ADR 0008
เพราะการถอดพร้อมกับสร้างตารางใหม่ทำให้ rollback กลับไม่ได้โดยไม่เสียข้อมูล

---

## `procurements` และตารางที่เกี่ยวข้อง

เพิ่มใน migration `20260906000100_procurement_draft.sql` (PR-02)

### เลขอ้างอิงกับเลขที่เอกสาร — คนละเรื่องกัน

`procurements.reference` เป็น **เลขอ้างอิงภายใน** ที่ระบบสร้างเองจาก sequence
ห้ามว่างและห้ามซ้ำ ตอบข้อค้นพบ F-16 ที่พบว่า 8 sheet มีรายการใช้จ่ายแต่ไม่มีเลขลำดับเลย

**ไม่ใช่เลขที่เอกสารทางราชการ** ซึ่งจะจองใน PR-04 ด้วยกติกาคนละชุด
(นับต่อปีงบและต่อประเภท เลขที่ยกเลิกห้ามนำกลับมาใช้ และมีสถานะ
`ISSUED` / `NOT_REQUIRED` / `PENDING` ตอบข้อค้นพบ F-14)

### ยอดเงินไม่มีคอลัมน์

`procurement_totals` เป็น view ที่คำนวณ subtotal, ส่วนลด, ภาษี, ยอดรวม และยอดแหล่งเงิน
จากรายการย่อย **ไม่มีคอลัมน์ยอดในตารางหลัก** ผลคือ client ส่งยอดรวมเข้ามาเองไม่ได้เลย
ไม่ใช่แค่ "ไม่ควรส่ง"

กติกาการคำนวณต้องตรงกับ `src/domain/money/calculation.ts` ทุกสตางค์ ซึ่งบังคับด้วย
`tests/unit/procurement-calculation-parity.test.ts` ที่อ่านค่าคาดหวังจากไฟล์ SQL test
โดยตรง ถ้าฝั่งใดเปลี่ยนกติกาการปัดเศษ จะล้มทั้งสองฝั่งพร้อมกัน

### Optimistic concurrency

`version` เพิ่มโดย trigger `procurements_version_bump` เท่านั้น — ค่าที่ client ส่งมา
ถูกเขียนทับเสมอ การแก้ไขต้องระบุ `where version = <ที่อ่านมา>` ถ้าได้ 0 แถว
แปลว่ามีคนอื่นแก้ไปแล้ว ต้องบอกผู้ใช้ให้โหลดใหม่ ไม่ใช่เขียนทับเงียบ ๆ

**การแก้รายการย่อยเพิ่ม version ของรายการแม่ด้วย** (trigger `*_touch_parent`)
ตั้งใจให้เป็นแบบนี้ มิฉะนั้นสองคนที่แก้คนละบรรทัดพร้อมกันจะไม่ชนกันเลย
ทั้งที่ยอดรวมเปลี่ยนไปแล้ว ผลข้างเคียง: เพิ่มรายการย่อย n บรรทัดทำให้ version เพิ่ม n
ผู้เรียกจึงต้องอ่าน version กลับมาใหม่หลังบันทึกเสมอ

### แหล่งเงินหลายบรรทัด (F-02)

`procurement_funding_allocations` ผูกรายการหนึ่งกับบัญชีงบได้หลายบัญชี
มี `unique (procurement_id, budget_account_id)` เพราะบัญชีเดียวกันซ้ำสองบรรทัด
ในรายการเดียวไม่มีความหมาย ให้รวมเป็นบรรทัดเดียว

ผลรวมต้องเท่ากับยอดรวมของรายการ **ก่อน submit** ไม่ใช่ตอนบันทึกร่าง
เพราะฉบับร่างต้องบันทึกค้างไว้ได้แม้ยังไม่ครบ (แผนข้อ 7.2)
หน้ารายละเอียดเตือนไว้ตั้งแต่ขั้นร่างเพื่อให้แก้ก่อนถึงขั้นที่ระบบปฏิเสธ

### ไฟล์แนบ

`attachments` ผูกด้วย `entity_type` + `entity_id` แทน foreign key ตรง
เพราะการตรวจรับและคำขอใช้เงินจะต้องแนบไฟล์เช่นกัน เก็บเฉพาะที่อยู่ของไฟล์
ตัวไฟล์อยู่ใน Supabase Storage แบบ private และเข้าถึงผ่าน signed URL อายุสั้น

### RLS

| ตาราง                             | อ่าน                                    | เขียน                                  |
| --------------------------------- | --------------------------------------- | -------------------------------------- |
| `procurements`                    | `read.all` หรือ `read.own` (เฉพาะของตน) | `create` / `edit_draft` (ไม่มี delete) |
| `procurement_items`               | ตามรายการแม่                            | ตามรายการแม่                           |
| `procurement_funding_allocations` | ตามรายการแม่                            | ตามรายการแม่                           |
| `attachments`                     | ตามรายการแม่                            | ตามรายการแม่ (ไม่มี delete)            |

สิ่งที่ policy บังคับและหน้าจอบังคับแทนไม่ได้:

- สร้างรายการในนามคนอื่นไม่ได้ (`created_by = auth.uid()`)
- สร้างรายการที่สถานะไม่ใช่ `DRAFT` มาตรง ๆ ไม่ได้
- แก้ไขได้เฉพาะสถานะ `DRAFT` และ `NEEDS_REVISION`
- เปลี่ยนสถานะผ่านการแก้ไขธรรมดาไม่ได้ — ต้องผ่าน workflow (PR-04)

## `procurement_validations` — ผลตรวจกฎที่บันทึกไว้

เก็บผลตรวจของแต่ละขั้น (ปัจจุบันมีขั้น `SUBMIT` ขั้นเดียว) ไว้เป็นแถว
ไม่ใช่คำนวณสดอย่างเดียว เพราะผู้ตรวจสอบต้องตอบได้ว่า **"ตอนที่ส่งอนุมัติ
ระบบเตือนอะไรไว้บ้าง"** ซึ่งคำนวณย้อนหลังไม่ได้ถ้ากฎเปลี่ยนไปแล้ว

`overridden = true` หมายถึงข้อนั้นเป็น ERROR ที่ถูกยกเว้นด้วยสิทธิ์
`procurement.override_validation` พร้อมเหตุผลที่บันทึกไว้ในตัวรายการ

append-only เหมือน `audit_events` และ `budget_movements` — เขียนได้ผ่าน
`procurement_submit()` เท่านั้น อ่านได้เมื่ออ่านรายการนั้นได้ (ใช้
`can_read_procurement()` ตัวเดียวกับตัวรายการ ไม่นิยามกติกาซ้ำ)

### กฎที่ยกเว้นได้

| กฎ                              | ยกเว้นได้ | เหตุผล                                                     |
| ------------------------------- | :-------: | ---------------------------------------------------------- |
| `DATE_INVALID`                  |     ✗     | วันที่ที่ไม่มีในปฏิทินไม่ใช่เรื่องที่ใครอนุมัติให้ผ่านได้  |
| `FUNDING_TOTAL_MISMATCH`        |     ✗     | เป็นเลขคณิต ไม่ใช่ดุลพินิจ                                 |
| `FISCAL_YEAR_MISMATCH`          |     ✗     | ปีงบประมาณเป็นข้อเท็จจริง                                  |
| `REQUIRED_REPORT_FIELD_MISSING` |     ✗     | เอกสารที่ขาดสาระสำคัญออกไม่ได้                             |
| กลุ่ม `DATE_*` ที่เหลือ         |     ✓     | การบันทึกย้อนหลังเกิดขึ้นจริงในงานธุรการ ต้องมีเหตุผลกำกับ |
| `BUDGET_INSUFFICIENT`           |     ✓     | มีกรณีลงเกินแล้วโอนงบตามทีหลัง (Q18)                       |
| `VENDOR_INCOMPLETE`             |     ✓     | บางวิธีจัดหายังไม่มีผู้ขาย ณ วันส่งอนุมัติ                 |

รายการนี้อยู่สองที่: `OVERRIDABLE_RULES` ในโดเมน และ `is_overridable_rule()`
ในฐานข้อมูล — จำเป็นเพราะคนละชั้น และมี `tests/unit/rule-parity.test.ts`
อ่าน SQL จริงมาเทียบกันทุกครั้งที่รัน test เพื่อไม่ให้ทั้งสองฝั่งเลื่อนออกจากกัน
