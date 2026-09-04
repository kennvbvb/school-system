# Phase 1 — Foundation: รายการ issue

> แตกจากแผนข้อ 18 (Phase 1) พร้อม Requirement ID และเกณฑ์ตรวจรับ
> ใช้เป็นเนื้อหาตั้งต้นสำหรับสร้าง GitHub issues
>
> **สถานะ:** ทุก issue ในรอบนี้เสร็จแล้ว ยกเว้นที่ระบุว่ายกไป Phase ถัดไป

---

## P0-001 — Scaffold Next.js + TypeScript strict

**Requirement:** ข้อ 10.1, 10.4, NFR-008

**ขอบเขต:** ตั้งโครงการ Next.js App Router, TypeScript strict, Tailwind, ESLint, Prettier
พร้อมตรึงเวอร์ชันทุกตัวและ commit lockfile

**เกณฑ์ตรวจรับ**

- [x] `npm run typecheck` ผ่านโดยไม่มี error
- [x] `npm run lint` ผ่านโดยไม่มี error
- [x] `npm run build` สำเร็จ
- [x] `package.json` ไม่มี `^` หรือ `~` และมี `package-lock.json` ใน repository
- [x] โครงสร้างโฟลเดอร์ตรงกับแผนข้อ 10.4
- [x] `tsconfig.json` เปิด `strict` และ `noUncheckedIndexedAccess`

**บันทึก:** ตรึง ESLint ที่ 9.x และ TypeScript ที่ 5.9.x เพราะรุ่นใหม่กว่ายังเข้ากันไม่ได้จริง
เหตุผลและเงื่อนไขการทบทวนอยู่ใน [ADR 0001](decisions/0001-technology-stack.md)

---

## P0-002 — Supabase local/dev setup และ migration เริ่มต้น

**Requirement:** ข้อ 11.1, FR-MST-003, FR-MST-004

**ขอบเขต:** `supabase/config.toml`, migration สำหรับ departments, positions, profiles,
RBAC และ audit_events พร้อม seed ที่เป็นข้อมูลสมมติ

**เกณฑ์ตรวจรับ**

- [x] `supabase db reset` รันบนฐานข้อมูลเปล่าได้โดยไม่มี error
- [x] ทุกตารางมี `is_active` หรือ `deleted_at` ตามชนิดข้อมูล ไม่มีการ hard delete ที่ถูกอ้างอิง
- [x] `enable_signup = false` ใน config
- [x] seed ไม่มีชื่อโรงเรียนจริง ชื่อบุคคลจริง หรือรหัสผ่าน
- [x] มี test ยืนยันว่า seed ตรงกับ `src/domain/auth/permissions.ts`

---

## P0-003 — Auth, profile, role, permission

**Requirement:** FR-AUTH-001..005, ข้อ 4.1, 4.2, 4.3

**เกณฑ์ตรวจรับ**

- [x] เข้าสู่ระบบด้วยอีเมล+รหัสผ่านได้
- [x] ไม่มี route หรือลิงก์สำหรับสมัครสมาชิก และมี E2E test ยืนยัน
- [x] บัญชีที่ไม่มี profile หรือ `is_active = false` ใช้ระบบไม่ได้
- [x] ออกจากระบบใช้ `scope: 'global'` (FR-AUTH-005)
- [x] `getCurrentUser()` ใช้ `getUser()` ไม่ใช่ `getSession()`
- [x] ข้อความ error ตอนล็อกอินล้มเหลวไม่แยกว่าอีเมลไม่มีอยู่หรือรหัสผ่านผิด
- [x] `returnTo` ผ่านการ sanitize กัน open redirect และมี unit test
- [ ] **ยกไป Phase 2:** reset password และหน้าปิดบัญชีผู้ใช้ (FR-AUTH-003)
- [ ] **ยกไป Phase 2:** บันทึก `last_login_at` (FR-AUTH-004 — คอลัมน์มีแล้ว ยังไม่มีจุดเขียน)

---

## P0-004 — App shell ภาษาไทยและ navigation ตามสิทธิ์

**Requirement:** ข้อ 12.6, NFR-005, NFR-007

**เกณฑ์ตรวจรับ**

- [x] เมนูถูกกรองตามสิทธิ์ และ section ที่ว่างถูกตัดทิ้ง
- [x] มีลิงก์ "ข้ามไปยังเนื้อหาหลัก" สำหรับ keyboard navigation
- [x] focus state มองเห็นชัดในทุกองค์ประกอบที่โฟกัสได้
- [x] เมนูและ header ไม่ติดไปกับหน้าพิมพ์ (`data-print="hide"`)
- [x] ขนาดตัวอักษรหลักอย่างน้อย 16px
- [x] ใช้งานได้ตั้งแต่ viewport 768px ขึ้นไป
- [x] สถานะไม่ได้สื่อด้วยสีเพียงอย่างเดียว

---

## P0-005 — CI, test framework และ `.env.example`

**Requirement:** ข้อ 16.4, 17.2, 19

**เกณฑ์ตรวจรับ**

- [x] CI รัน: install frozen lockfile → typecheck → lint → format → test → build
- [x] CI มี job ตรวจ migration บนฐานข้อมูลเปล่า
- [x] CI มี job E2E แยก
- [x] workflow ด้านความปลอดภัย: `npm audit`, secret scan, CodeQL
- [x] `.env.example` มีเฉพาะชื่อตัวแปร ไม่มีค่าจริง
- [x] env ถูกตรวจด้วย schema ตอน startup
- [x] มี PR template ตามข้อ 16.3

---

## P0-006 — Logging, error boundary และ request ID

**Requirement:** NFR-009, ข้อ 12.6, FR-AUD-001..004

**เกณฑ์ตรวจรับ**

- [x] ทุก request มี `x-request-id`
- [x] error boundary แสดงรหัสอ้างอิงให้ผู้ใช้แจ้งเจ้าหน้าที่ โดยไม่แสดง stack trace
- [x] `recordAuditEvent()` ตัดข้อมูลอ่อนไหวออกก่อนบันทึกเสมอ
- [x] IP เก็บเป็น hash ไม่ใช่ค่าดิบ
- [x] audit_events แก้ไขไม่ได้ทั้ง policy และ table privilege
- [ ] **ยกไป Phase 3:** เขียน audit event ในทรานแซกชันเดียวกับข้อมูล
      (ดู `assumptions.md` ข้อ 2.10)
- [ ] **ยังไม่ทำ:** เชื่อมต่อ Sentry — ตัวแปร `SENTRY_DSN` เตรียมไว้แล้ว

---

## P0-007 — Security headers เริ่มต้น

**Requirement:** ข้อ 14.1

**เกณฑ์ตรวจรับ**

- [x] CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
      Permissions-Policy, Cross-Origin-Opener-Policy ถูกส่งจริง
- [x] ปิด `X-Powered-By`
- [x] มี E2E test ยืนยันว่า header ถูกส่งจริง ไม่ใช่แค่ตั้งค่าไว้
- [x] service-role key ไม่ปรากฏใน client bundle (ตรวจหลัง build จริง)
- [ ] **ยังไม่ทำ:** rate limit หน้า login และ endpoint ที่สร้าง PDF (ข้อ 14.1)

---

## Exit criteria ของ Phase 1

จากแผนข้อ 18:

| เกณฑ์                                             | สถานะ                                             |
| ------------------------------------------------- | ------------------------------------------------- |
| login ได้ ไม่มี public sign-up                    | ผ่าน                                              |
| route และ server operation ป้องกันด้วย permission | ผ่าน — `/admin/system` เป็นตัวอย่างที่มี E2E test |
| CI ผ่าน                                           | ผ่านในเครื่อง — ต้องยืนยันบน GitHub Actions       |
| Preview deployment ทำงาน                          | **ยังไม่ได้ตั้งค่า** ต้องเชื่อม Vercel            |

---

## งานที่ต้องทำก่อนเข้า Gate A

- [ ] เชื่อม Vercel และยืนยันว่า Preview deployment ทำงาน
- [ ] ตั้ง branch protection บน `main` และบังคับให้ CI ผ่านก่อน merge
- [ ] เปิด Dependabot, secret scanning และ code scanning ใน GitHub
- [ ] สร้างโครงการ Supabase สำหรับ dev/preview ที่แยกจาก production
- [ ] รัน CI จริงหนึ่งรอบเต็มบน GitHub Actions
