# Branch, PR และ Review Gate

เอกสารนี้ระบุว่างานแต่ละรอบ **commit ไปที่ไหน เปิด PR เข้า branch ใด และผ่านการตรวจอะไรก่อน merge**
เขียนขึ้นเพราะสถานะจริงของรีโปไม่ตรงกับที่แผนพัฒนาต่อคาดไว้ จึงต้องบันทึกให้ตรงกัน

---

## 1. สถานะ branch ณ ปัจจุบัน

| รายการ                         | ค่าจริงที่ตรวจได้           |
| ------------------------------ | --------------------------- |
| Default branch บน GitHub       | `claude/new-session-1bt8d0` |
| Branch ที่ PR #1–#3 merge เข้า | `main`                      |
| Branch protection              | **ยังไม่ได้ตั้ง**           |

**ประเด็นที่ต้องแก้:** default branch ยังเป็น branch ของ session พัฒนา ไม่ใช่ `main`
ผลคือ PR ที่เปิดใหม่จะตั้ง base เป็น branch นั้นโดยอัตโนมัติ ซึ่งไม่ใช่ trunk จริงของโครงการ

**ข้อเสนอ:** เปลี่ยน default branch เป็น `main` แล้วตั้ง branch protection
— เป็นการเปลี่ยนค่าตั้งของรีโป จึงต้องให้เจ้าของรีโปเป็นผู้ทำ ไม่ใช่ agent
(ดู [`assumptions.md`](assumptions.md) คำถาม Q29)

## 2. กติกาที่ใช้ระหว่างที่ยังไม่ได้ตั้ง branch protection

- **trunk คือ `main`** — ทุก PR ตั้ง base เป็น `main` เสมอ แม้ GitHub จะเสนอ branch อื่น
- **ห้าม commit ตรงเข้า `main`** — งานทุกชิ้นผ่าน PR
- **หนึ่ง PR ต่อหนึ่งเรื่อง** ตามลำดับ PR-00 ถึง PR-10 ในแผนพัฒนาต่อ
  ห้ามรวม schema, workflow และ PDF ไว้ใน PR เดียวกัน
- **เปิดเป็น Draft PR ตั้งแต่ต้น** แล้วเปลี่ยนเป็น ready เมื่อผ่าน CI และ review gate
- **agent ห้ามทำเองโดยไม่มีคำสั่งชัดเจน:** merge PR, deploy Production, หมุน secret,
  แก้ branch protection, เปลี่ยนค่าตั้งของรีโป และนำเข้าข้อมูลจริง

## 3. เมื่อตั้ง branch protection แล้ว

ค่าที่ควรตั้งบน `main`:

- required status checks: `CI` และ `Security` ทุก job
- required review อย่างน้อย 1 คน
- ห้าม force push และห้ามลบ branch
- ต้อง merge ผ่าน PR เท่านั้น

## 4. รูปแบบ commit

- ข้อความหัวเป็นภาษาไทยได้ ขึ้นต้นด้วย type ตาม Conventional Commits (`feat`, `fix`, `docs`, `chore`)
- เนื้อความต้องบอก **เหตุผล** ไม่ใช่แค่สิ่งที่เปลี่ยน และอ้าง requirement ID, rule code
  หรือรหัสข้อค้นพบ (`F-01`) เมื่อเกี่ยวข้อง
- commit ที่แก้ปัญหาที่พบระหว่างทางต้องบอกว่าพบได้อย่างไร เพื่อให้ผู้อ่านตรวจซ้ำได้

## 5. สิ่งที่ต้องแนบทุก PR

| ประเภทงาน      | สิ่งที่ต้องแนบ                                  |
| -------------- | ----------------------------------------------- |
| ทุก PR         | ผล `npm run verify` ที่รันจริง (ไม่ใช่คาดการณ์) |
| แตะ schema     | ผล migration บนฐานว่าง และแผน rollback          |
| แตะ UI         | screenshot จากแอปที่รันจริง                     |
| แตะ PDF        | test artifact ที่ปกปิดข้อมูลแล้ว                |
| แตะ RLS/สิทธิ์ | ผล negative test ว่าผู้ไม่มีสิทธิ์ถูกปฏิเสธ     |

## 6. Review Gate ก่อน merge

ตามแผนพัฒนาต่อข้อ 14 — PR แต่ละกลุ่มต้องผ่าน gate ที่ตรงกับเนื้องาน

| Gate | ครอบคลุม             | เกณฑ์หลัก                                                                      |
| ---- | -------------------- | ------------------------------------------------------------------------------ |
| A    | Schema / Foundation  | migration รันจากฐานว่าง, constraint จับ invalid state, RLS มี negative test    |
| B    | Procurement/Workflow | transition + permission ถูก, validation บังคับที่ server, ออกเลขไม่มี race     |
| C    | Documents            | view model จาก snapshot เดียว, ไม่มี placeholder/หน้าว่าง, checksum ไม่เปลี่ยน |
| D    | Inventory / Reports  | ledger append-only, ยอด reconcile, export typed/filtered, import idempotent    |
| E    | Deployment           | environment แยก, secret ไม่รั่ว, backup/restore ผ่าน, มีหลักฐาน UAT            |

**สิ่งที่ AI รับรองแทนไม่ได้:** ข้อความกฎหมาย แบบพิมพ์ที่มีผลทางราชการ อำนาจอนุมัติ
และการจัดประเภทค่าใช้จ่าย — ต้องให้ผู้รับผิดชอบของโรงเรียนตรวจรับ
