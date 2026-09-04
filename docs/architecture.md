# สถาปัตยกรรม

> สถานะ: สะท้อนสิ่งที่ **มีอยู่จริงหลัง Phase 1** ไม่ใช่เป้าหมายปลายทาง
> เป้าหมายปลายทางอยู่ใน `SCHOOL_PROCUREMENT_SYSTEM_PLAN.md` ข้อ 10

## ภาพรวม

```text
Browser
  │ HTTPS + security headers (next.config.ts)
  ▼
Vercel / Next.js App Router
  ├─ proxy.ts            ต่ออายุ session, ใส่ request ID, ส่ง pathname ต่อ
  ├─ Server Components   อ่านข้อมูลผ่าน server-client (อยู่ใต้ RLS)
  ├─ Client Components   auth flow เท่านั้น
  ├─ src/server/         การ์ดสิทธิ์, audit, supabase clients
  ├─ src/domain/         ตรรกะบริสุทธิ์ ไม่มี I/O
  └─ src/lib/            ยูทิลิตีที่ใช้ร่วมทั้งสองฝั่ง
          │
          ├──── Supabase PostgreSQL (RLS เปิดทุกตาราง)
          ├──── Supabase Auth (ปิด public sign-up)
          └──── Supabase Storage (private bucket — ยังไม่ใช้ใน Phase 1)
```

## การแบ่งชั้นและกฎการพึ่งพา

ลูกศรชี้ทางเดียวเสมอ ห้ามมี circular dependency (NFR-008)

```text
app/ ──▶ features/ ──▶ components/
  │         │
  └────┬────┘
       ▼
   server/ ──▶ domain/ ──▶ (ไม่พึ่งอะไรเลย)
       │           ▲
       └──▶ lib/ ──┘
```

| ชั้น            | ความรับผิดชอบ                                        | ข้อห้าม                                           |
| --------------- | ---------------------------------------------------- | ------------------------------------------------- |
| `src/domain/`   | ตรรกะธุรกิจบริสุทธิ์: เงิน, สถานะ, สิทธิ์, เลขเอกสาร | ห้ามมี I/O, ห้าม import จาก `server/` หรือ `app/` |
| `src/server/`   | ตรวจสิทธิ์, transaction, audit, เข้าถึงฐานข้อมูล     | ต้องมี `import 'server-only'` ทุกไฟล์             |
| `src/lib/`      | ยูทิลิตีที่ใช้ได้ทั้งสองฝั่ง: env, วันที่, redaction | ห้ามพึ่ง `server/`                                |
| `src/features/` | UI ที่ผูกกับโดเมนหนึ่ง ๆ                             | ห้ามเขียนฐานข้อมูลตรง                             |
| `src/app/`      | routing, layout, การ์ดระดับหน้า                      | ตรรกะธุรกิจต้องอยู่ใน `domain/`                   |

**เหตุผลที่ `domain/` ไม่มี I/O:** ทำให้ทดสอบตรรกะการเงินและ state machine
ได้โดยไม่ต้องยกฐานข้อมูล ซึ่งเป็นเงื่อนไขที่ทำให้ CI เร็วพอจะรันทุก PR

## สิ่งที่มีอยู่จริงหลัง Phase 1

### โดเมน (มี unit test ครบ)

| โมดูล       | ไฟล์                                  | ครอบคลุม                       |
| ----------- | ------------------------------------- | ------------------------------ |
| จำนวนเงิน   | `domain/money/money.ts`               | BigInt, ปัดเศษ, parse/format   |
| การคำนวณยอด | `domain/money/calculation.ts`         | INCLUSIVE / EXCLUSIVE / EXEMPT |
| เงินภาษาไทย | `domain/money/thai-baht-text.ts`      | เอ็ด, ยี่สิบ, ล้านซ้อน, สตางค์ |
| สิทธิ์      | `domain/auth/permissions.ts`          | 25 permission, 8 บทบาท         |
| สถานะรายการ | `domain/procurement/status.ts`        | 10 สถานะ, 10 action            |
| เลขเอกสาร   | `domain/documents/document-number.ts` | pattern token                  |
| วันที่ไทย   | `lib/format/thai-date.ts`             | Asia/Bangkok, พ.ศ./ค.ศ.        |
| Redaction   | `lib/redact.ts`                       | ตัดข้อมูลอ่อนไหวก่อนลง log     |

### ฐานข้อมูล

- `20260903000100_core_identity.sql` — departments, positions, profiles, RBAC, audit_events
- `20260903000200_rls_policies.sql` — RLS ทุกตาราง + `has_permission()`
- `seed-reference.sql` — สิทธิ์/บทบาทที่ผูกกับโค้ด รันทุก environment
- `seed-sample.sql` — หน่วยงานและตำแหน่งตัวอย่าง เฉพาะ local/preview

### แอปพลิเคชัน

- `/login` — เข้าสู่ระบบ (ไม่มีทางสมัครสมาชิก)
- `/dashboard` — หน้าแรกหลังเข้าสู่ระบบ แสดงสิทธิ์ที่ผู้ใช้ถืออยู่
- `/admin/system` — ตัวอย่างการบังคับสิทธิ์ที่ server (ต้องมี `settings.manage`)
- `/api/health` — health check ที่ไม่เปิดเผยข้อมูลภายใน
- `/forbidden`, `not-found`, `error` — สถานะที่ผู้ใช้เจอได้จริง

## เส้นทางของหนึ่ง request

```text
1. proxy.ts       ใส่ x-request-id และ x-pathname, ต่ออายุ session cookie
2. layout         requireUserForPage() — ยังไม่เข้าสู่ระบบ → /login?returnTo=<path เดิม>
3. page           requirePermissionForPage() — ไม่มีสิทธิ์ → /forbidden
4. server client  query อยู่ใต้ RLS เสมอ
5. audit          recordAuditEvent() สำหรับ mutation สำคัญ
```

`x-pathname` จำเป็นเพราะ Server Component อ่าน pathname เองไม่ได้
ถ้าไม่มี layout จะ redirect ไป `/login` เปล่า ๆ แล้วผู้ใช้เสียปลายทางเดิม

## ยังไม่มีในระบบ

ตาราง `procurements`, `inventory_*`, `assets`, `document_templates`, `issued_documents`
และ domain service ที่ทำ transaction หลายตาราง — อยู่ใน Phase 3 ถึง 6
