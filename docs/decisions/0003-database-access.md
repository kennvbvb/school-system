# 0003 — การเข้าถึงฐานข้อมูลและการแบ่งชั้น

- **สถานะ:** Accepted
- **เกี่ยวข้องกับ:** ข้อ 10.3, 11, NFR-008

## บริบท

แผนกำหนดว่า "UI ไม่เขียนฐานข้อมูลโดยตรงสำหรับธุรกรรมสำคัญ" และ "domain service
เป็นจุดรวม validation, permission, transaction และ audit"

## การตัดสินใจ

### Supabase client สามตัว แยกหน้าที่ชัดเจน

| ไฟล์                                   | key                   | ใช้เมื่อ                                   | อยู่ใต้ RLS |
| -------------------------------------- | --------------------- | ------------------------------------------ | ----------- |
| `src/lib/supabase/browser-client.ts`   | anon                  | auth flow ฝั่ง browser เท่านั้น            | ใช่         |
| `src/server/supabase/server-client.ts` | anon + session cookie | ค่าเริ่มต้นสำหรับทุกการอ่าน/เขียนแทนผู้ใช้ | ใช่         |
| `src/server/supabase/admin-client.ts`  | service-role          | เฉพาะงานที่ทำแทนผู้ใช้ไม่ได้               | **ไม่**     |

### การกัน service-role key หลุดเข้า client bundle

ป้องกันสามชั้น เพราะเป็นความผิดพลาดที่ราคาแพงที่สุดชั้นเดียว

1. `import 'server-only'` — build ล้มทันทีถ้ามี client component import เข้าไป
2. กฎ `no-restricted-imports` ใน ESLint ที่ห้าม import path นี้จากทุกที่ยกเว้น `src/server/**`
3. ไม่ตั้งชื่อตัวแปรขึ้นต้นด้วย `NEXT_PUBLIC_` ซึ่งเป็นเงื่อนไขเดียวที่ Next.js จะฝังค่าลง bundle

**ยืนยันด้วยการรันจริง:** หลัง `next build` ค้นหาคำว่า `SUPABASE_SERVICE_ROLE_KEY`
และ `service_role` ใน `.next/static/` แล้วไม่พบ

### การอ่านผู้ใช้ปัจจุบัน

`getCurrentUser()` ห่อด้วย `React.cache()` เพื่อไม่ให้ยิงฐานข้อมูลซ้ำเมื่อ
layout และ page ในหนึ่ง request ต่างเรียกใช้ — ป้องกัน N+1 ตั้งแต่ชั้นนี้ (ข้อ 10.3)

สิทธิ์อ่านจากตาราง `role_permissions` **ไม่ใช่** จากค่าคงที่ในโค้ด
เพราะผู้ดูแลระบบต้องปรับการผูกบทบาทกับสิทธิ์ได้โดยไม่ต้อง deploy ใหม่
ค่าใน `DEFAULT_ROLE_PERMISSIONS` เป็นเพียงค่าที่ใช้ seed

## ผลที่ตามมา

- ต้องมี test ที่ยืนยันว่า `supabase/seed.sql` กับ `src/domain/auth/permissions.ts` ไม่หลุดจากกัน
  → `tests/unit/seed-consistency.test.ts` ทำหน้าที่นี้ โดยไม่ต้องยกฐานข้อมูลขึ้นใน CI
- ตั้งแต่ Phase 3 เป็นต้นไป mutation ที่แตะหลายตารางต้องย้ายไปเป็น PostgreSQL function
  เพื่อให้ transaction และ audit event เกิดพร้อมกันจริง (ดู `docs/assumptions.md` ข้อ 2.10)
