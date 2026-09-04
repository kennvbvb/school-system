# Data dictionary

> ครอบคลุมเฉพาะตารางที่ **มีอยู่จริง** หลัง Phase 1
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
