# Permission matrix

> แหล่งความจริงของโค้ด: `src/domain/auth/permissions.ts`
> แหล่งความจริงที่มีผลจริงตอนรัน: ตาราง `role_permissions` ในฐานข้อมูล
> ทั้งสองฝั่งถูกตรวจว่าตรงกันโดย `tests/unit/seed-consistency.test.ts`

ผู้ดูแลระบบปรับการผูกบทบาทกับสิทธิ์ได้โดยไม่ต้อง deploy ใหม่
ค่าในตารางนี้คือค่าเริ่มต้นที่ระบบ seed ให้

## บทบาท

| รหัส                  | ชื่อไทย              | ความสามารถหลัก                                           |
| --------------------- | -------------------- | -------------------------------------------------------- |
| `SYSTEM_ADMIN`        | ผู้ดูแลระบบ          | จัดการระบบ ผู้ใช้ บทบาท ค่าตั้ง แม่แบบ และดู audit log   |
| `PROCUREMENT_OFFICER` | เจ้าหน้าที่พัสดุ     | สร้างรายการ จัดการเอกสาร รับพัสดุ และออกรายงาน           |
| `REQUESTER`           | ผู้ขอ                | สร้างคำขอของตนเอง ดูสถานะ และแก้เฉพาะรายการที่ถูกส่งกลับ |
| `REVIEWER`            | ผู้ตรวจสอบ           | ตรวจสอบข้อมูล ส่งกลับ หรือส่งต่อเพื่ออนุมัติ             |
| `APPROVER`            | ผู้อนุมัติ           | อนุมัติหรือปฏิเสธตามขอบเขตที่ได้รับมอบหมาย               |
| `FINANCE`             | เจ้าหน้าที่การเงิน   | ตรวจแหล่งเงิน งบประมาณ ภาษี และดูรายงานที่เกี่ยวข้อง     |
| `INVENTORY_OFFICER`   | เจ้าหน้าที่คลังพัสดุ | รับเข้า เบิก คืน ปรับยอด และดูแลทะเบียนครุภัณฑ์          |
| `AUDITOR`             | ผู้ตรวจสอบภายใน      | อ่านและส่งออกรายงาน แต่แก้ไขไม่ได้                       |

## เมทริกซ์

`●` = มีสิทธิ์เริ่มต้น

| สิทธิ์                   | ADMIN | PROC | REQ | REV | APPR | FIN | INV | AUD |
| ------------------------ | :---: | :--: | :-: | :-: | :--: | :-: | :-: | :-: |
| `users.read`             |   ●   |      |     |     |      |     |     |     |
| `users.manage`           |   ●   |      |     |     |      |     |     |     |
| `masters.read`           |   ●   |  ●   |  ●  |  ●  |  ●   |  ●  |  ●  |  ●  |
| `masters.manage`         |   ●   |      |     |     |      |     |     |     |
| `procurement.read.own`   |   ●   |      |  ●  |     |      |     |     |     |
| `procurement.read.all`   |   ●   |  ●   |     |  ●  |  ●   |  ●  |  ●  |  ●  |
| `procurement.create`     |   ●   |  ●   |  ●  |     |      |     |     |     |
| `procurement.edit_draft` |   ●   |  ●   |  ●  |     |      |     |     |     |
| `procurement.submit`     |   ●   |  ●   |  ●  |     |      |     |     |     |
| `procurement.review`     |   ●   |      |     |  ●  |      |     |     |     |
| `procurement.approve`    |   ●   |      |     |     |  ●   |     |     |     |
| `procurement.cancel`     |   ●   |  ●   |     |     |      |     |     |     |
| `budget.read`            |   ●   |  ●   |     |  ●  |  ●   |  ●  |     |  ●  |
| `budget.manage`          |   ●   |      |     |     |      |  ●  |     |     |
| `budget.override`        |   ●   |      |     |     |      |     |     |     |
| `documents.preview`      |   ●   |  ●   |  ●  |  ●  |  ●   |     |     |     |
| `documents.issue`        |   ●   |  ●   |     |     |      |     |     |     |
| `documents.print`        |   ●   |  ●   |     |     |      |     |     |     |
| `inventory.read`         |   ●   |  ●   |     |     |      |     |  ●  |  ●  |
| `inventory.receive`      |   ●   |  ●   |     |     |      |     |  ●  |     |
| `inventory.issue`        |   ●   |      |     |     |      |     |  ●  |     |
| `inventory.adjust`       |   ●   |      |     |     |      |     |  ●  |     |
| `assets.read`            |   ●   |  ●   |     |     |      |     |  ●  |  ●  |
| `assets.manage`          |   ●   |      |     |     |      |     |  ●  |     |
| `reports.export`         |   ●   |  ●   |     |     |      |  ●  |  ●  |  ●  |
| `audit.read`             |   ●   |      |     |     |      |     |     |  ●  |
| `templates.manage`       |   ●   |      |     |     |      |     |     |     |
| `settings.manage`        |   ●   |      |     |     |      |     |     |     |

## กฎที่บังคับด้วย test

`tests/unit/permissions.test.ts` ยืนยันว่า:

- `AUDITOR` ส่งออกและอ่าน audit ได้ แต่ไม่มีสิทธิ์แก้ไขข้อมูลใดเลย (ข้อ 4.1)
- มีเพียง `SYSTEM_ADMIN` ที่ถือ `users.manage`, `templates.manage` และ `settings.manage` (ข้อ 4.2)
- ทุกสิทธิ์ที่อ้างในบทบาทมีอยู่จริงในรายการกลาง

## การบังคับใช้

| ชั้น                          | ที่อยู่                                                  | หมายเหตุ                              |
| ----------------------------- | -------------------------------------------------------- | ------------------------------------- |
| เมนู                          | `visibleSections()` ใน `src/features/auth/navigation.ts` | UX เท่านั้น ไม่ใช่การควบคุมการเข้าถึง |
| หน้าเว็บ                      | `requirePermissionForPage()`                             | redirect ไป `/forbidden`              |
| Server action / Route handler | `requirePermission()`                                    | โยน `AuthorizationError`              |
| การเปลี่ยนสถานะ               | `assertTransitionAllowed()`                              | ตรวจสถานะก่อนสิทธิ์                   |
| ฐานข้อมูล                     | RLS + `has_permission()`                                 | ชั้นป้องกันสุดท้าย                    |

รายละเอียดเหตุผลอยู่ใน [ADR 0004](decisions/0004-authorization-and-rls.md)

## ยังไม่ได้ทำ

- **Scope ตามหน่วยงาน** — คอลัมน์ `user_roles.department_id` มีแล้วแต่ยังไม่มี logic ที่ใช้
- **Separation of duties** — ผู้อนุมัติไม่ควรอนุมัติรายการของตนเอง (ข้อ 4.2)
  จะทำเป็นค่าตั้งระดับระบบใน Phase 4
- **`procurement.read.own` vs `read.all`** — การกรองตามเจ้าของจะมีผลจริงเมื่อมีตาราง `procurements` ใน Phase 3
