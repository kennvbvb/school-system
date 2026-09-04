# ระบบงานพัสดุและจัดซื้อจัดจ้างภายในโรงเรียน

School Procurement & Inventory System — เว็บแอปพลิเคชันสำหรับบุคลากรภายในโรงเรียน
กรอกข้อมูลรายการจัดซื้อ/จัดจ้างครั้งเดียว แล้วสร้างชุดเอกสาร PDF ที่พร้อมพิมพ์

> **ระบบภายในเท่านั้น** ไม่มีหน้าสาธารณะและไม่เปิดให้สมัครสมาชิกเอง

## สถานะปัจจุบัน

**Phase 1 — Foundation** เสร็จแล้ว

| มีแล้ว                                   | ยังไม่มี                         |
| ---------------------------------------- | -------------------------------- |
| เข้าสู่ระบบ (ปิด public sign-up)         | รายการจัดซื้อจัดจ้าง (Phase 3)   |
| RBAC 8 บทบาท / 25 สิทธิ์                 | สายอนุมัติและเลขเอกสาร (Phase 4) |
| RLS ทุกตาราง                             | แม่แบบและการสร้าง PDF (Phase 5)  |
| App shell ภาษาไทยที่กรองเมนูตามสิทธิ์    | คลังวัสดุและครุภัณฑ์ (Phase 6)   |
| โดเมนการเงิน + ข้อความเงินภาษาไทย        | รายงานและการส่งออก (Phase 7)     |
| audit log แบบ append-only                |                                  |
| CI, unit test, component test, E2E smoke |                                  |

แผนฉบับเต็ม: [`docs/SCHOOL_PROCUREMENT_SYSTEM_PLAN.md`](docs/SCHOOL_PROCUREMENT_SYSTEM_PLAN.md)

## เริ่มพัฒนา

**ต้องมี:** Node.js 22 (ดู `.nvmrc`), Docker (สำหรับ Supabase local)

```bash
npm ci                      # ติดตั้งตาม lockfile
npx supabase start          # ยกฐานข้อมูล local
cp .env.example .env.local  # แล้วเติมค่าจากผลลัพธ์ของ supabase start
npx supabase db reset       # สร้าง schema + seed ข้อมูลสมมติ
npm run dev                 # http://localhost:3000
```

การสร้างบัญชีผู้ดูแลคนแรก: ดู [`docs/deployment.md`](docs/deployment.md)

## คำสั่ง

| คำสั่ง                 | หน้าที่                                  |
| ---------------------- | ---------------------------------------- |
| `npm run dev`          | เซิร์ฟเวอร์สำหรับพัฒนา                   |
| `npm run build`        | build สำหรับ production                  |
| `npm run typecheck`    | TypeScript strict                        |
| `npm run lint`         | ESLint                                   |
| `npm run format:check` | Prettier                                 |
| `npm run test`         | unit + component test (Vitest)           |
| `npm run test:e2e`     | E2E smoke test (Playwright)              |
| `npm run verify`       | typecheck + lint + format + test + build |

## โครงสร้าง

```text
src/
├─ app/        routing, layout, การ์ดระดับหน้า
├─ components/ UI ที่ใช้ร่วมกัน
├─ features/   UI ที่ผูกกับโดเมนหนึ่ง ๆ
├─ domain/     ตรรกะบริสุทธิ์ — เงิน สถานะ สิทธิ์ เลขเอกสาร (ไม่มี I/O)
├─ lib/        ยูทิลิตีที่ใช้ได้ทั้ง client และ server
├─ server/     ตรวจสิทธิ์ audit และการเข้าถึงฐานข้อมูล (server-only)
└─ styles/
supabase/migrations/   schema และ RLS policies
tests/{unit,integration,e2e}/
docs/                  แผน สมมติฐาน ADR และคู่มือ
```

รายละเอียดกฎการพึ่งพาระหว่างชั้น: [`docs/architecture.md`](docs/architecture.md)

## หลักการที่บังคับใช้

1. **ตรวจสิทธิ์ที่ server เสมอ** — การซ่อนปุ่มฝั่ง browser เป็นเรื่อง UX ไม่ใช่ความปลอดภัย
2. **ห้ามใช้ floating point กับจำนวนเงิน** — โดเมนใช้ BigInt หน่วยสตางค์ ([ADR 0005](docs/decisions/0005-money-representation.md))
3. **เอกสารที่ออกแล้วห้ามเปลี่ยน** — เก็บเป็น snapshot พร้อม checksum ([ADR 0007](docs/decisions/0007-immutable-document-snapshots.md))
4. **audit log แก้ไม่ได้** — append-only ทั้ง policy และ table privilege
5. **ห้าม commit secret หรือข้อมูลจริงของโรงเรียน** — seed ทั้งหมดเป็นข้อมูลสมมติ
6. **ตรึงเวอร์ชัน dependency** — ไม่มี `^` หรือ `~` และ commit lockfile

## เอกสาร

| ไฟล์                                                                               | เนื้อหา                                       |
| ---------------------------------------------------------------------------------- | --------------------------------------------- |
| [`docs/SCHOOL_PROCUREMENT_SYSTEM_PLAN.md`](docs/SCHOOL_PROCUREMENT_SYSTEM_PLAN.md) | PRD, spec และแผนส่งมอบฉบับเต็ม                |
| [`docs/assumptions.md`](docs/assumptions.md)                                       | **สิ่งที่สมมติไว้และคำถามที่โรงเรียนต้องตอบ** |
| [`docs/architecture.md`](docs/architecture.md)                                     | การแบ่งชั้นและสิ่งที่มีอยู่จริง               |
| [`docs/data-dictionary.md`](docs/data-dictionary.md)                               | ตาราง คอลัมน์ และข้อจำกัด                     |
| [`docs/permissions.md`](docs/permissions.md)                                       | เมทริกซ์บทบาทกับสิทธิ์                        |
| [`docs/deployment.md`](docs/deployment.md)                                         | environment, env vars และขั้นตอน deploy       |
| [`docs/backup-restore.md`](docs/backup-restore.md)                                 | แผนสำรองและกู้คืน (ยังต้องกรอกและซ้อม)        |
| [`docs/document-template-guide.md`](docs/document-template-guide.md)               | กติกาแม่แบบเอกสาร                             |
| [`docs/decisions/`](docs/decisions/)                                               | Architecture Decision Records                 |
| [`docs/phase-1-issues.md`](docs/phase-1-issues.md)                                 | รายการ issue ของ Phase 1 พร้อมเกณฑ์ตรวจรับ    |

## สิ่งที่ต้องได้คำตอบก่อนไปต่อ

Phase 2 ขึ้นไปต้องการคำตอบจากโรงเรียนหลายข้อ — ดูรายการทั้งหมดพร้อมระดับความเร่งด่วนใน
[`docs/assumptions.md`](docs/assumptions.md) หัวข้อ 3
