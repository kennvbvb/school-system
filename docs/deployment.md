# การติดตั้งและ deploy

## Environment ทั้งสี่

| Environment | Trigger                   | Database                           | ข้อมูล                  |
| ----------- | ------------------------- | ---------------------------------- | ----------------------- |
| Local       | เครื่องนักพัฒนา           | Supabase local (`supabase start`)  | seed สมมติ              |
| Preview     | ทุก PR                    | โครงการ Supabase แยกสำหรับ preview | **ข้อมูลสมมติเท่านั้น** |
| Staging     | branch `staging`          | โครงการ staging                    | UAT ที่ anonymize แล้ว  |
| Production  | `main` + manual promotion | โครงการ production                 | ข้อมูลจริง              |

> **ห้ามให้ Preview deployment เชื่อม Production database หรือ Production storage**
> เป็นข้อบังคับตามแผนข้อ 17.1 และเป็นหนึ่งในเกณฑ์ AC-10

## Environment variables

ดูรายการทั้งหมดใน `.env.example` — ไฟล์นั้นระบุเฉพาะ **ชื่อ** ไม่มีค่าจริง

| ตัวแปร                          | ฝั่ง                | บังคับ                                |
| ------------------------------- | ------------------- | ------------------------------------- |
| `NEXT_PUBLIC_APP_URL`           | client + server     | ใช่                                   |
| `NEXT_PUBLIC_SUPABASE_URL`      | client + server     | ใช่                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server     | ใช่                                   |
| `SUPABASE_SERVICE_ROLE_KEY`     | **server เท่านั้น** | ไม่ (แต่จำเป็นสำหรับงานผู้ดูแล)       |
| `SENTRY_DSN`                    | server              | ไม่                                   |
| `APP_TIMEZONE`                  | server              | ไม่ (ค่าเริ่มต้น `Asia/Bangkok`)      |
| `DOCUMENT_STORAGE_BUCKET`       | server              | ไม่                                   |
| `ATTACHMENT_STORAGE_BUCKET`     | server              | ไม่                                   |
| `APP_COMMIT_SHA`                | server              | ไม่ — ตั้งจาก `VERCEL_GIT_COMMIT_SHA` |

env ถูกตรวจด้วย Zod schema ตอน import ครั้งแรก (`src/lib/env/server.ts`)
deployment ที่ตั้งค่าไม่ครบจะล้มตั้งแต่ตอน build ไม่ใช่ตอนผู้ใช้กดปุ่ม

## ตั้งค่าสำหรับพัฒนาในเครื่อง

```bash
# 1. ติดตั้ง dependency ตาม lockfile
npm ci

# 2. ยก Supabase local ขึ้น
npx supabase start

# 3. คัดลอกและเติมค่า env
cp .env.example .env.local
# นำ API URL และ anon key จากผลลัพธ์ของ supabase start มาใส่

# 4. สร้าง schema และ seed
npx supabase db reset

# 5. รัน
npm run dev
```

## การสร้างผู้ดูแลระบบคนแรก

**ห้ามฝังบัญชีผู้ดูแลไว้ใน seed หรือใน source code**

ขั้นตอนที่ปลอดภัย:

1. สร้างบัญชีใน Supabase Auth ผ่าน Dashboard หรือ Admin API
   โดยตั้งรหัสผ่านที่สุ่มและส่งให้เจ้าตัวผ่านช่องทางที่ปลอดภัย
2. เพิ่มแถวใน `public.profiles` โดยใช้ `id` เดียวกับบัญชีที่สร้าง
3. เพิ่มแถวใน `public.user_roles` ผูกบทบาท `SYSTEM_ADMIN`
4. ให้เจ้าตัวเปลี่ยนรหัสผ่านทันทีที่เข้าใช้ครั้งแรก
5. บันทึกว่าใครเป็นผู้สร้างบัญชีนี้และเมื่อใด

ขั้นที่ 2 และ 3 ต้องใช้ service-role key เพราะยังไม่มีผู้ถือ `users.manage` ในระบบ

## ขั้นตอน deploy

1. Merge PR หลัง CI ผ่านและมีผู้ตรวจอนุมัติ
2. ตรวจ Vercel Preview และแผน migration
3. **Backup ก่อน migration ที่มีความเสี่ยง**
4. Deploy migration แบบ backward-compatible ก่อน application เมื่อจำเป็น
5. Deploy application
6. รัน smoke test: เข้าสู่ระบบ, เปิดหน้าที่ต้องมีสิทธิ์, health check, security headers
7. ตรวจ error dashboard และ performance
8. บันทึก release notes และ rollback point

## Rollback

- **Application** — ย้อนไป deployment ก่อนหน้าใน Vercel
- **Database** — ต้องมีแผน roll-forward/rollback แยกต่อ migration
  **ห้าม rollback schema แบบทำให้ข้อมูลสูญหายโดยอัตโนมัติ**
- **เอกสารที่ออกแล้ว** — ห้ามลบไฟล์ระหว่าง rollback ไม่ว่ากรณีใด (FR-DOC-010)

## Security headers

ตั้งไว้ที่ `next.config.ts` จุดเดียว: CSP, HSTS, X-Frame-Options, X-Content-Type-Options,
Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy
และปิด `X-Powered-By`

E2E test `tests/e2e/smoke.spec.ts` ยืนยันว่า header เหล่านี้ถูกส่งจริง

หากต้องเพิ่ม origin ใน CSP ให้แก้ที่ไฟล์นั้นที่เดียวและบันทึกเหตุผลไว้
