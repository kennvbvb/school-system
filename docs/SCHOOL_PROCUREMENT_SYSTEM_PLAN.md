# แผนพัฒนาเว็บไซต์ระบบงานพัสดุและจัดซื้อจัดจ้างภายในโรงเรียน

> เอกสารฉบับนี้เป็น Product Requirements Document (PRD), Technical Specification และแผนส่งมอบงานสำหรับใช้เป็นคำสั่งตั้งต้นให้ AI coding agent เช่น Claude เริ่มพัฒนาโครงการใน GitHub และนำขึ้นใช้งานบน Vercel

---

## 0. สถานะเอกสาร

| รายการ              | ค่า                                            |
| ------------------- | ---------------------------------------------- |
| ชื่อโครงการชั่วคราว | School Procurement & Inventory System          |
| ชื่อภาษาไทย         | ระบบงานพัสดุและจัดซื้อจัดจ้างภายในโรงเรียน     |
| กลุ่มผู้ใช้         | บุคลากรภายในโรงเรียนเท่านั้น                   |
| ช่องทางใช้งาน       | Responsive Web Application                     |
| Repository          | GitHub                                         |
| Deployment          | Vercel                                         |
| ภาษาหน้าจอหลัก      | ภาษาไทย                                        |
| เขตเวลา             | `Asia/Bangkok`                                 |
| รูปแบบวันที่แสดงผล  | วันที่ไทย โดยตั้งค่าเลือกปี พ.ศ./ค.ศ. ได้      |
| สถานะ               | Draft สำหรับยืนยันความต้องการและเริ่มพัฒนา MVP |

### 0.1 หลักการใช้เอกสารนี้

1. ให้ถือหัวข้อ **ข้อกำหนดที่ต้องมีใน MVP**, **เกณฑ์ตรวจรับ** และ **Definition of Done** เป็นข้อบังคับ
2. หากรายละเอียดใดไม่ชัดเจน ให้สร้างเป็นค่าตั้งหรือแม่แบบที่แก้ไขได้ แทนการฝังค่าถาวรในโค้ด
3. ห้ามสมมติว่าข้อความหรือแบบฟอร์มตัวอย่างเป็นคำรับรองด้านกฎหมาย โรงเรียนต้องส่งแบบฟอร์มฉบับที่ใช้อยู่จริงให้ทีมพัฒนาและผู้รับผิดชอบตรวจรับ
4. ทุก Pull Request ต้องมีคำอธิบาย วิธีทดสอบ ภาพหน้าจอเมื่อมีการเปลี่ยน UI และผลกระทบต่อฐานข้อมูลหรือเอกสาร
5. หากมีข้อขัดแย้ง ให้เรียงลำดับความสำคัญดังนี้: ความปลอดภัยและความถูกต้องของข้อมูล → แบบฟอร์มที่โรงเรียนรับรอง → เกณฑ์ตรวจรับ → ความสะดวกในการใช้งาน → รายละเอียดทางเทคนิค

---

## 1. บทสรุปโครงการ

พัฒนาเว็บไซต์สำหรับบริหารงานพัสดุและการจัดซื้อจัดจ้างภายในโรงเรียน โดยผู้ใช้กรอกข้อมูลเฉพาะของรายการจัดซื้อหรือจัดจ้างเพียงครั้งเดียว ระบบนำข้อมูลพื้นฐานที่บันทึกไว้แล้วมาประกอบ คำนวณยอด ตรวจความครบถ้วน สร้างเลขเอกสาร และผลิตเอกสารหลายฉบับในรูปแบบ PDF ที่พร้อมพิมพ์อย่างเป็นระเบียบ

ระบบต้องรองรับการจัดเก็บ ค้นหา ส่งออก และตรวจสอบย้อนหลัง พร้อมทะเบียนวัสดุ/ครุภัณฑ์ การรับเข้า เบิก คืน ยืม โอนย้าย ซ่อม และจำหน่าย โดยออกแบบสิทธิ์ตามบทบาทและเก็บประวัติทุกการเปลี่ยนแปลงที่สำคัญ

### 1.1 ปัญหาที่ต้องแก้

- เจ้าหน้าที่ต้องกรอกข้อมูลชุดเดียวกันซ้ำในหลายเอกสาร
- แบบฟอร์มและการจัดวางเอกสารไม่เป็นมาตรฐานเดียวกัน
- เลขที่เอกสาร ยอดเงิน วันที่ และรายชื่อผู้เกี่ยวข้องมีโอกาสไม่ตรงกัน
- ค้นหาเอกสารหรือประวัติย้อนหลังยาก
- ยอดวัสดุในคลังและทะเบียนครุภัณฑ์อาจแยกอยู่หลายไฟล์
- ไม่ทราบว่าใครแก้ไข อนุมัติ หรือพิมพ์เอกสารเมื่อใด
- การเปลี่ยนแบบฟอร์มใหม่อาจกระทบเอกสารเก่าที่เคยออกแล้ว

### 1.2 ผลลัพธ์ที่ต้องการ

- กรอกข้อมูลหนึ่งครั้งแล้วสร้างชุดเอกสารที่เกี่ยวข้องได้
- ข้อมูลร่วม เช่น โรงเรียน บุคลากร ปีงบประมาณ โครงการ และผู้ขาย เลือกใช้ซ้ำได้
- คำนวณยอดและจำนวนเงินเป็นตัวอักษรโดยอัตโนมัติ
- ตรวจสอบข้อมูลบังคับและความสอดคล้องก่อนสร้างเอกสาร
- PDF พิมพ์บน A4 ได้ตรงรูปแบบ และแสดงภาษาไทยถูกต้อง
- เอกสารที่อนุมัติแล้วถูกเก็บเป็น snapshot และไม่เปลี่ยนตามข้อมูลหรือแม่แบบในอนาคต
- ดูสถานะและประวัติของแต่ละรายการได้จากจุดเดียว
- ส่งออกข้อมูลเป็น PDF, XLSX และ CSV ตามสิทธิ์ของผู้ใช้

### 1.3 ตัวชี้วัดความสำเร็จเบื้องต้น

- เจ้าหน้าที่สร้างชุดเอกสารมาตรฐานหนึ่งรายการได้ภายใน 10 นาที หลังตั้งค่าข้อมูลพื้นฐานแล้ว
- ข้อมูลชื่อโครงการ ผู้ขาย ยอดรวม และผู้ลงนามตรงกันทุกเอกสารในชุดเดียวกัน 100%
- รายการที่อนุมัติแล้วมี audit trail ครบทุกเหตุการณ์สำคัญ 100%
- รายงานยอดคงเหลือตรงกับผลการตรวจนับตามกรณีทดสอบที่โรงเรียนรับรอง
- เอกสาร PDF ผ่านการตรวจพิมพ์จริงโดยเจ้าหน้าที่พัสดุและผู้บริหาร

---

## 2. ขอบเขตโครงการ

### 2.1 ขอบเขต MVP — ต้องมี

1. การเข้าสู่ระบบและกำหนดสิทธิ์ตามบทบาท
2. ข้อมูลโรงเรียน ปีงบประมาณ หน่วยงาน บุคลากร ผู้ขาย โครงการ แหล่งเงิน หมวดพัสดุ และหน่วยนับ
3. สร้างและแก้ไขรายการจัดซื้อ/จัดจ้างแบบ Draft
4. ตารางรายการสินค้า/บริการ จำนวน ราคาต่อหน่วย ส่วนลด และภาษีตามที่ตั้งค่า
5. คำนวณยอดรวมและจำนวนเงินภาษาไทย
6. ขั้นตอน ส่งตรวจ → ส่งอนุมัติ → อนุมัติ/ส่งกลับแก้ไข → ออกเอกสาร
7. สร้างเลขเอกสารแบบป้องกันเลขซ้ำ
8. สร้าง Preview และ PDF ภาษาไทยจากแม่แบบที่มีเวอร์ชัน
9. เก็บไฟล์ PDF ที่ออกแล้วแบบ immutable snapshot
10. ทะเบียนรับเข้าวัสดุและครุภัณฑ์จากรายการที่อนุมัติ
11. เบิกวัสดุ คืน/ปรับยอด และดู Stock Card
12. ทะเบียนครุภัณฑ์และ QR Code
13. ค้นหา กรอง และส่งออก CSV/XLSX/PDF
14. Dashboard สรุปข้อมูลที่จำเป็น
15. Audit log, soft delete, backup และ error monitoring
16. Responsive UI ที่ใช้งานได้บนคอมพิวเตอร์และแท็บเล็ต

### 2.2 ระยะถัดไป — ไม่บังคับใน MVP

- ลายเซ็นอิเล็กทรอนิกส์เต็มรูปแบบหรือ Digital Signature
- การเชื่อมต่อระบบ e-GP หรือระบบภายนอก
- OCR ใบเสนอราคาและใบเสร็จ
- แจ้งเตือนผ่าน LINE, อีเมล หรือแอปภายนอก
- Workflow หลายสายงานที่ซับซ้อนตามวงเงิน
- การเปรียบเทียบใบเสนอราคาหลายผู้ขายแบบอัตโนมัติ
- แอปมือถือแบบ Native
- การจัดการหลายโรงเรียนในฐานข้อมูลเดียวกัน
- ระบบบัญชีและการจ่ายเงินจริง
- นำเข้าเอกสาร Word ที่แก้รูปแบบได้อิสระ

### 2.3 สิ่งที่ระบบนี้ไม่ใช่

- ไม่ใช่ระบบธนาคารหรือระบบโอนเงิน
- ไม่ใช่คำปรึกษาทางกฎหมาย และไม่รับรองความถูกต้องตามระเบียบโดยอัตโนมัติโดยไม่มีผู้รับผิดชอบของโรงเรียนตรวจแม่แบบ
- ไม่ใช่ระบบเผยแพร่สู่สาธารณะ ผู้ใช้ทั่วไปไม่ควรเห็นข้อมูลภายใน
- ไม่ควรแทนที่การอนุมัติที่กฎหมายหรือระเบียบกำหนดให้ต้องลงนามจริง เว้นแต่โรงเรียนรับรองกระบวนการอิเล็กทรอนิกส์นั้นแล้ว

---

## 3. สมมติฐานและประเด็นที่โรงเรียนต้องยืนยัน

ก่อนขึ้น Production โรงเรียนต้องยืนยันข้อมูลต่อไปนี้:

- ชื่อ ที่อยู่ ตราสัญลักษณ์ เลขประจำตัวผู้เสียภาษี และข้อมูลติดต่อของโรงเรียน
- โครงสร้างฝ่าย/กลุ่มงาน/ห้องเรียน
- ตำแหน่งและรายชื่อผู้ลงนาม ผู้อนุมัติ ผู้ตรวจรับ และผู้รับผิดชอบ
- ลำดับขั้นตอนอนุมัติที่ใช้จริง
- วิธีสร้างเลขที่เอกสารและการเริ่มเลขใหม่ในแต่ละปีงบประมาณ
- แบบฟอร์มเอกสารฉบับล่าสุดที่โรงเรียนใช้อยู่จริง
- เอกสารใดต้องมีตราครุฑ ตราโรงเรียน ลายเซ็น หรือเลขหน้า
- กรณีภาษีมูลค่าเพิ่ม ภาษีหัก ณ ที่จ่าย ส่วนลด และการปัดเศษ
- ประเภทเงิน/แหล่งงบประมาณและรหัสโครงการ
- หลักเกณฑ์การแบ่งวัสดุและครุภัณฑ์ของโรงเรียน
- อายุการเก็บรักษาข้อมูลและเอกสาร
- ผู้มีสิทธิ์ดู/พิมพ์/ส่งออกข้อมูลส่วนบุคคลและข้อมูลราคา
- นโยบายการใช้ลายเซ็นภาพ หากต้องการในอนาคต

ข้อมูลเหล่านี้ต้องเก็บเป็น configuration หรือ master data เท่าที่เหมาะสม ไม่ควรฝังลงใน source code

---

## 4. ผู้ใช้งานและสิทธิ์

### 4.1 บทบาทพื้นฐาน

| บทบาท                 | ความสามารถหลัก                                           |
| --------------------- | -------------------------------------------------------- |
| `SYSTEM_ADMIN`        | จัดการระบบ ผู้ใช้ บทบาท ค่าตั้ง แม่แบบ และดู audit log   |
| `PROCUREMENT_OFFICER` | สร้างรายการ จัดการเอกสาร รับพัสดุ และออกรายงาน           |
| `REQUESTER`           | สร้างคำขอของตนเอง ดูสถานะ และแก้เฉพาะรายการที่ถูกส่งกลับ |
| `REVIEWER`            | ตรวจสอบข้อมูล ส่งกลับ หรือส่งต่อเพื่ออนุมัติ             |
| `APPROVER`            | อนุมัติหรือปฏิเสธตามขอบเขตที่ได้รับมอบหมาย               |
| `FINANCE`             | ตรวจแหล่งเงิน งบประมาณ ภาษี และดูรายงานที่เกี่ยวข้อง     |
| `INVENTORY_OFFICER`   | รับเข้า เบิก คืน ปรับยอด และดูแลทะเบียนครุภัณฑ์          |
| `AUDITOR`             | อ่านและส่งออกรายงาน แต่แก้ไขไม่ได้                       |

### 4.2 กฎสิทธิ์สำคัญ

- ผู้ใช้ต้องเห็นเฉพาะเมนูและข้อมูลที่ตนมีสิทธิ์
- การตรวจสิทธิ์ต้องทำที่ server/database ไม่พึ่งเพียงการซ่อนปุ่มฝั่ง browser
- ผู้อนุมัติไม่ควรอนุมัติรายการของตนเอง หากโรงเรียนเปิดใช้กฎ separation of duties
- เอกสารที่อนุมัติ/ออกเลขแล้วห้ามแก้ข้อมูลต้นฉบับโดยตรง
- การแก้รายการที่อนุมัติแล้วต้องใช้การยกเลิกหรือสร้าง revision พร้อมเหตุผล
- การลบข้อมูลธุรกรรมให้ใช้ soft delete และบันทึก audit log
- การจัดการผู้ใช้ แม่แบบ และสิทธิ์ต้องจำกัดเฉพาะ `SYSTEM_ADMIN`
- ข้อมูลจากไฟล์ส่งออกต้องใช้สิทธิ์เดียวกับข้อมูลบนหน้าจอ

### 4.3 Permission codes ที่แนะนำ

```text
users.read
users.manage
masters.read
masters.manage
procurement.read.own
procurement.read.all
procurement.create
procurement.edit_draft
procurement.submit
procurement.review
procurement.approve
procurement.cancel
documents.preview
documents.issue
documents.print
inventory.read
inventory.receive
inventory.issue
inventory.adjust
assets.read
assets.manage
reports.export
audit.read
templates.manage
settings.manage
```

---

## 5. กระบวนการหลัก

### 5.1 Procurement workflow

```text
DRAFT
  └─ submit → PENDING_REVIEW
                  ├─ return → NEEDS_REVISION → resubmit → PENDING_REVIEW
                  └─ pass → PENDING_APPROVAL
                                  ├─ return → NEEDS_REVISION
                                  ├─ reject → REJECTED
                                  └─ approve → APPROVED
                                                   └─ issue documents → ISSUED
                                                                            ├─ receive → PARTIALLY_RECEIVED
                                                                            └─ receive all → RECEIVED

ทุกสถานะก่อน RECEIVED สามารถยกเลิกได้เฉพาะผู้มีสิทธิ์ → CANCELLED
```

กฎ:

- `DRAFT` และ `NEEDS_REVISION` แก้ไขได้
- เมื่อ submit ให้บันทึก snapshot ของข้อมูลที่ส่ง
- ทุกการส่งกลับ/ปฏิเสธ/ยกเลิกต้องมีเหตุผล
- เมื่อ approve ให้ตรึงรายการ ราคา ผู้ขาย แหล่งเงิน และผู้เกี่ยวข้อง
- เมื่อ issue ให้จองเลขที่เอกสารและสร้าง PDF snapshot ใน transaction ที่ปลอดภัย
- รับเข้าได้ไม่เกินจำนวนที่อนุมัติ ยกเว้นผู้มีสิทธิ์ override พร้อมเหตุผล

### 5.2 Inventory workflow

```text
รายการจัดซื้อที่อนุมัติ
  → บันทึกรับเข้า
      ├─ วัสดุสิ้นเปลือง → เพิ่ม lot/ยอดคงเหลือ → เบิก → คืน/ปรับยอด
      └─ ครุภัณฑ์ → สร้าง asset ทีละชิ้น → พิมพ์ QR → ย้าย/ยืม/ซ่อม/จำหน่าย
```

### 5.3 การสร้างเอกสารแบบกรอกครั้งเดียว

1. ผู้ใช้เลือกประเภทงาน: ซื้อวัสดุ, ซื้อครุภัณฑ์ หรือจ้างบริการ
2. ระบบเติมข้อมูลโรงเรียน ปีงบประมาณ ผู้ขอ และหน่วยงานจาก master data
3. ผู้ใช้กรอกชื่อเรื่อง เหตุผล โครงการ แหล่งเงิน ผู้ขาย และรายการ
4. ระบบคำนวณยอด ภาษี ยอดสุทธิ และจำนวนเงินเป็นตัวอักษร
5. ระบบตรวจ field บังคับตามชนิดเอกสาร
6. ผู้ใช้เลือกชุดเอกสารที่ต้องการ หรือระบบเลือกจาก rule set
7. ผู้ใช้ดู Preview ก่อนส่งอนุมัติ
8. เมื่ออนุมัติและออกเอกสาร ระบบสร้าง PDF แต่ละฉบับและไฟล์รวมทั้งชุด
9. ระบบบันทึก template version, data snapshot, checksum และผู้สั่งสร้าง

---

## 6. Functional Requirements

รหัส requirement ต้องถูกอ้างใน issue, test case และ Pull Request ที่เกี่ยวข้อง

### 6.1 Authentication และผู้ใช้

- **FR-AUTH-001** ผู้ใช้เข้าสู่ระบบด้วยอีเมลที่ได้รับอนุญาต
- **FR-AUTH-002** ปิด public sign-up โดยค่าเริ่มต้น ผู้ดูแลเป็นผู้เชิญหรือสร้างบัญชี
- **FR-AUTH-003** รองรับ reset password และการปิดบัญชีผู้ใช้
- **FR-AUTH-004** เก็บเวลาเข้าสู่ระบบล่าสุดและเหตุการณ์ด้านความปลอดภัยที่สำคัญ
- **FR-AUTH-005** รองรับ session expiration และ sign out ทุกอุปกรณ์
- **FR-AUTH-006** เตรียมโครงสร้างสำหรับ SSO ของโรงเรียนในอนาคต โดยไม่บังคับใน MVP

### 6.2 Master data

- **FR-MST-001** จัดการข้อมูลโรงเรียนและตราสัญลักษณ์
- **FR-MST-002** จัดการปีงบประมาณ วันที่เริ่ม/สิ้นสุด และสถานะเปิด/ปิด
- **FR-MST-003** จัดการหน่วยงาน ห้อง สถานที่เก็บ และสายการอนุมัติ
- **FR-MST-004** จัดการบุคลากร ตำแหน่ง และบทบาทในการลงนาม
- **FR-MST-005** จัดการผู้ขาย พร้อมเลขประจำตัวผู้เสียภาษีและข้อมูลติดต่อ
- **FR-MST-006** จัดการโครงการ แผนงาน แหล่งเงิน และวงเงินที่จัดสรร
- **FR-MST-007** จัดการประเภทพัสดุ หมวดครุภัณฑ์ และหน่วยนับ
- **FR-MST-008** ป้องกันการลบ master data ที่ถูกอ้างอิง ให้ deactivate แทน
- **FR-MST-009** ค้นหา duplicate vendor จากเลขประจำตัวผู้เสียภาษีหรือชื่อใกล้เคียง

### 6.3 รายการจัดซื้อจัดจ้าง

- **FR-PR-001** สร้างรายการใหม่เป็น Draft พร้อมเลขอ้างอิงภายใน
- **FR-PR-002** รองรับประเภท `GOODS`, `ASSET`, `SERVICE`
- **FR-PR-003** เพิ่ม/ลบ/เรียงลำดับรายการย่อยได้
- **FR-PR-004** แต่ละรายการมีคำอธิบาย จำนวน หน่วย ราคาต่อหน่วย ส่วนลด อัตราภาษี และหมายเหตุ
- **FR-PR-005** รองรับราคาที่รวมภาษีแล้วและยังไม่รวมภาษี โดยระบุโหมดชัดเจน
- **FR-PR-006** คำนวณ subtotal, discount, tax, grand total จากข้อมูลรายการ
- **FR-PR-007** แสดงจำนวนเงินเป็นตัวอักษรภาษาไทย
- **FR-PR-008** แนบใบเสนอราคา TOR รูปภาพ หรือเอกสารสนับสนุนได้
- **FR-PR-009** บันทึกอัตโนมัติหรือเตือนก่อนออกจากหน้าที่มีข้อมูลยังไม่บันทึก
- **FR-PR-010** Clone Draft เดิมเป็นรายการใหม่โดยไม่คัดลอกเลขเอกสาร/การอนุมัติ
- **FR-PR-011** ค้นหาด้วยเลขอ้างอิง ชื่อเรื่อง ผู้ขาย โครงการ ปีงบประมาณ ผู้ขอ และสถานะ
- **FR-PR-012** ตรวจงบประมาณเชิงข้อมูลและแจ้งเตือนเมื่อเกินวงเงิน โดยการบล็อกหรืออนุญาต override เป็นค่าตั้ง
- **FR-PR-013** ยกเลิกรายการพร้อมเหตุผลและผู้อนุมัติการยกเลิกตามสิทธิ์
- **FR-PR-014** สร้าง revision ใหม่จากรายการที่ออกแล้ว โดยเชื่อมโยง revision ก่อนหน้า

### 6.4 Review และ Approval

- **FR-APR-001** สร้างสายอนุมัติตามประเภท หน่วยงาน หรือช่วงวงเงินได้
- **FR-APR-002** แสดงรายการรอตรวจ/รออนุมัติของผู้ใช้
- **FR-APR-003** ผู้ตรวจสามารถผ่านหรือส่งกลับพร้อมเหตุผล
- **FR-APR-004** ผู้อนุมัติสามารถอนุมัติ ปฏิเสธ หรือส่งกลับพร้อมเหตุผล
- **FR-APR-005** บันทึกผู้ดำเนินการ เวลา สถานะเดิม สถานะใหม่ และหมายเหตุ
- **FR-APR-006** ป้องกัน double-submit และการอนุมัติซ้ำ
- **FR-APR-007** แจ้งผู้ใช้เมื่อข้อมูลเปลี่ยนจาก version ที่กำลังเปิดอยู่ด้วย optimistic concurrency control

### 6.5 เอกสารและการพิมพ์

- **FR-DOC-001** แม่แบบแต่ละชนิดมีรหัส ชื่อ เวอร์ชัน สถานะ Draft/Published/Retired และวันที่มีผล
- **FR-DOC-002** รายการหนึ่งเลือกแม่แบบตามชนิดงาน ปีงบประมาณ และ effective date ได้
- **FR-DOC-003** Preview ต้องใส่ watermark `ฉบับร่าง` ก่อนออกเอกสารจริง
- **FR-DOC-004** PDF จริงไม่มี watermark และมีเลขอ้างอิง/เลขเอกสารตามข้อกำหนด
- **FR-DOC-005** รองรับฟอนต์ไทยที่ฝังใน PDF และพิมพ์ A4 ได้
- **FR-DOC-006** สร้างทั้ง PDF รายฉบับและ PDF รวมชุด
- **FR-DOC-007** เก็บ PDF จริง, data snapshot, template version, SHA-256 checksum, issuedAt และ issuedBy
- **FR-DOC-008** เมื่อออกเอกสารแล้ว การเปลี่ยน master data หรือแม่แบบใหม่ต้องไม่เปลี่ยนไฟล์เดิม
- **FR-DOC-009** พิมพ์ซ้ำได้พร้อม audit event โดยเนื้อหาไฟล์เดิมไม่เปลี่ยน
- **FR-DOC-010** ยกเลิกเอกสารได้แต่ห้ามลบไฟล์เดิม ให้ประทับสถานะยกเลิกในระบบและสร้างสำเนาที่มี watermark หากต้องใช้
- **FR-DOC-011** มีหน้า document pack แสดงเอกสารที่ต้องมี เอกสารที่ยังขาด และสถานะ
- **FR-DOC-012** รองรับ page number, ชื่อผู้ลงนาม ตำแหน่ง ช่องวันที่ และช่องเซ็นตาม template
- **FR-DOC-013** XLSX และ CSV ต้องมี header ชัดเจน รูปแบบวันที่/ตัวเลขคงที่ และ UTF-8 สำหรับ CSV

### 6.6 เลขที่เอกสาร

- **FR-NUM-001** กำหนดรูปแบบได้ เช่น `{prefix}/{running}/{fiscalYearBE}`
- **FR-NUM-002** แยก sequence ตามชนิดเอกสาร ปีงบประมาณ และหน่วยงานได้
- **FR-NUM-003** จอง running number ใน database transaction และมี unique constraint
- **FR-NUM-004** ห้ามนำเลขที่ยกเลิกแล้วกลับมาใช้ใหม่
- **FR-NUM-005** ผู้ดูแลดูประวัติเลขที่ออก ข้าม หรือยกเลิกได้
- **FR-NUM-006** Preview ห้ามใช้เลขจริง ให้ใช้ข้อความ `DRAFT` หรือเลขจำลอง

### 6.7 คลังวัสดุ

- **FR-INV-001** รับเข้าจากรายการจัดซื้อที่อนุมัติ พร้อมรองรับรับบางส่วน
- **FR-INV-002** วัสดุแต่ละชนิดมีรหัส ชื่อ หมวด หน่วย และจุดสั่งซื้อ
- **FR-INV-003** บันทึก lot, วันที่รับ, ราคา, จำนวน และเอกสารต้นทาง
- **FR-INV-004** เบิกวัสดุตามผู้ขอ หน่วยงาน วัตถุประสงค์ และผู้อนุมัติ
- **FR-INV-005** คืนวัสดุหรือปรับยอดโดยต้องระบุเหตุผล
- **FR-INV-006** ป้องกันยอดคงเหลือติดลบ เว้นแต่ policy อนุญาตและมี override audit
- **FR-INV-007** Stock Card แสดงยอดก่อน จำนวนเข้า/ออก ยอดหลัง ผู้ทำรายการ และแหล่งอ้างอิง
- **FR-INV-008** รองรับการตรวจนับและบันทึก variance
- **FR-INV-009** แสดงรายการต่ำกว่าจุดสั่งซื้อ

### 6.8 ครุภัณฑ์

- **FR-AST-001** สร้างครุภัณฑ์ทีละชิ้นจากรายการรับเข้า
- **FR-AST-002** เก็บเลขครุภัณฑ์ ชื่อ รุ่น ยี่ห้อ serial number ราคา วันที่ได้มา แหล่งเงิน สถานที่ และผู้รับผิดชอบ
- **FR-AST-003** สร้าง QR Code ที่ชี้ไปหน้ารายละเอียดภายในระบบ ไม่ฝังข้อมูลอ่อนไหวใน QR
- **FR-AST-004** สถานะขั้นต่ำ: `ACTIVE`, `BORROWED`, `IN_REPAIR`, `DAMAGED`, `LOST`, `DISPOSED`
- **FR-AST-005** รองรับย้ายสถานที่/ผู้รับผิดชอบพร้อมประวัติ
- **FR-AST-006** รองรับยืม คืน แจ้งซ่อม และจำหน่ายพร้อมเอกสารอ้างอิง
- **FR-AST-007** หน้าจาก QR ต้องบังคับเข้าสู่ระบบ

### 6.9 Dashboard และรายงาน

- **FR-RPT-001** สรุปจำนวนรายการและมูลค่าตามสถานะในปีงบประมาณปัจจุบัน
- **FR-RPT-002** สรุปมูลค่าตามโครงการ แหล่งเงิน หน่วยงาน และผู้ขาย
- **FR-RPT-003** รายงานรับ-จ่ายและยอดคงเหลือวัสดุ
- **FR-RPT-004** ทะเบียนครุภัณฑ์แยกตามสถานที่/ผู้รับผิดชอบ/สถานะ
- **FR-RPT-005** รายการรอรับ รายการยืมเกินกำหนด และรายการชำรุด
- **FR-RPT-006** ทุก report รองรับ filter, pagination และ export ตามสิทธิ์
- **FR-RPT-007** รายงานต้องระบุวันที่ออกรายงาน ผู้จัดทำ และ filter ที่ใช้
- **FR-RPT-008** ตัวเลขรวมในหน้าจอและไฟล์ export ต้องมาจาก query/rule เดียวกัน

### 6.10 Audit และ System administration

- **FR-AUD-001** บันทึก create/update/status change/approve/issue/print/export/login/admin action
- **FR-AUD-002** audit log ต้อง append-only สำหรับผู้ใช้ทั่วไปและผู้ดูแลระบบ
- **FR-AUD-003** เก็บ actor, action, entity, entityId, timestamp, requestId, IP แบบเหมาะสม, user agent และ before/after ที่ลบข้อมูลลับแล้ว
- **FR-AUD-004** ห้ามบันทึกรหัสผ่าน access token refresh token หรือ secret ลง log
- **FR-AUD-005** ผู้ดูแลค้นหาและส่งออก audit log ได้ตามสิทธิ์
- **FR-SYS-001** มี health check ที่ไม่เปิดเผยข้อมูลลับ
- **FR-SYS-002** มีหน้าจัดการ feature/config ที่ได้รับอนุญาต
- **FR-SYS-003** แสดง application version/commit SHA ในหน้าสำหรับผู้ดูแล

---

## 7. ข้อมูลที่ผู้ใช้กรอกกับข้อมูลที่ระบบเติมให้

### 7.1 ข้อมูลที่กรอกต่อรายการ

- ประเภทซื้อ/จ้าง
- ชื่อเรื่องและเหตุผลความจำเป็น
- วันที่ต้องการใช้
- โครงการ แหล่งเงิน และงบประมาณ
- ผู้ขายที่เลือกหรือผู้ขายใหม่
- รายการสินค้า/บริการ จำนวน หน่วย และราคา
- เงื่อนไขภาษี/ส่วนลด หากต่างจากค่าปกติ
- เอกสารแนบ
- หมายเหตุเฉพาะกรณี

### 7.2 ข้อมูลที่ระบบดึงอัตโนมัติ

- ข้อมูลโรงเรียนและตราสัญลักษณ์
- ปีงบประมาณจากวันที่ทำรายการ
- ผู้ขอ หน่วยงาน และตำแหน่ง
- ผู้ตรวจ ผู้อนุมัติ ผู้ตรวจรับ และผู้ลงนามจาก workflow
- ข้อมูลผู้ขายที่เคยบันทึก
- รูปแบบและเลขที่เอกสาร
- วันที่ของแต่ละเหตุการณ์ใน workflow
- ยอดรวม ภาษี ยอดสุทธิ และจำนวนเงินเป็นตัวอักษร
- ข้อความมาตรฐานจาก template version ที่เลือก

### 7.3 Validation ที่ต้องมี

- จำนวนต้องมากกว่า 0
- ราคาไม่ติดลบและเก็บความละเอียดตามนโยบายที่กำหนด
- ห้ามรายการว่าง
- ยอดรวมต้องคำนวณจาก server ซ้ำเสมอ ห้ามเชื่อค่าที่ส่งจาก browser
- วันที่ต้องอยู่ในปีงบประมาณที่เปิดอยู่ หรือผู้มีสิทธิ์ override
- ผู้ขาย/โครงการ/แหล่งเงินต้อง active ณ วันที่ทำรายการ
- ผู้อนุมัติต้องมีสิทธิ์และอยู่ในสายอนุมัติของรายการ
- ไฟล์แนบต้องผ่านการตรวจชนิด ขนาด และชื่อไฟล์
- ฟิลด์เฉพาะแม่แบบต้องครบก่อนออกเอกสาร

---

## 8. แบบเอกสารและ Template Engine

### 8.1 แนวทางที่กำหนดสำหรับ MVP

- ใช้ React component สำหรับ PDF ผ่าน `@react-pdf/renderer` หรือไลบรารีที่เทียบเท่าและทำงานได้บน Vercel serverless
- เก็บไฟล์ฟอนต์ไทย เช่น Sarabun ที่มีสิทธิ์ใช้งานเหมาะสมไว้ใน repository หรือ storage ที่ควบคุมได้
- แม่แบบหนึ่งฉบับประกอบด้วย metadata, schema ของข้อมูล, renderer component และ version
- ห้ามใช้ HTML ที่ผู้ดูแลป้อนโดยตรงโดยไม่ sanitize
- ไม่แก้ published template ทับของเดิม ให้ clone เป็นเวอร์ชันใหม่
- Preview ใช้ข้อมูลปัจจุบัน แต่ issued document ใช้ frozen snapshot

### 8.2 Document types ตั้งต้น

ชื่อจริงและเนื้อหาต้องแทนด้วยเอกสารที่โรงเรียนรับรอง:

1. บันทึกข้อความขออนุมัติ
2. รายงานขอซื้อหรือขอจ้าง
3. รายละเอียดรายการและประมาณราคา
4. คำสั่งแต่งตั้งผู้ตรวจรับ/คณะกรรมการ
5. ใบสั่งซื้อหรือใบสั่งจ้าง
6. ใบตรวจรับพัสดุ
7. ใบเบิกวัสดุ
8. ทะเบียนคุมการจัดซื้อจัดจ้าง
9. ทะเบียนครุภัณฑ์/ป้าย QR
10. หน้าปกชุดเอกสารและ checklist

### 8.3 Placeholder naming

ให้ใช้ key ที่มีชนิดข้อมูลชัดเจน ไม่อิงข้อความไทย เช่น:

```text
school.nameTh
school.addressTh
procurement.referenceNo
procurement.subject
procurement.reason
procurement.fiscalYearBE
requester.fullName
requester.position
vendor.name
vendor.taxId
totals.subtotal
totals.tax
totals.grandTotal
totals.grandTotalThaiText
approver.fullName
approver.position
items[]
```

### 8.4 Versioning และ snapshot

เมื่อออกเอกสารจริงให้เก็บ:

- `documentType`
- `templateId`
- `templateVersion`
- `sourceEntityId`
- `sourceEntityVersion`
- `snapshotJson`
- `filePath`
- `mimeType`
- `fileSize`
- `sha256`
- `issuedAt`
- `issuedBy`
- `documentNumber`
- `status`

หาก regenerate หลังออกจริง ต้องสร้าง document revision ใหม่และเก็บไฟล์เดิมไว้ ไม่เขียนทับ

### 8.5 PDF quality checklist

- A4 ถูกต้องทั้ง portrait/landscape ตามแม่แบบ
- ฟอนต์ไทยไม่แตก วรรณยุกต์ไม่หาย และค้นหาข้อความใน PDF ได้
- ตารางไม่ล้นขอบและ header ซ้ำเมื่อขึ้นหน้าใหม่
- จำนวนเงินใช้รูปแบบเดียวกันทั้งระบบ
- ไม่มีบรรทัดลายเซ็นแยกไปหน้าถัดไปโดยไม่มีชื่อผู้ลงนาม
- เลขหน้าถูกต้อง
- เอกสารยาวหลายหน้ามียอดยกมา/ยอดรวมตามแบบที่โรงเรียนต้องการ
- พิมพ์ด้วย scale 100% แล้วระยะขอบผ่านการตรวจจริง
- Metadata ของ PDF ไม่เปิดเผยข้อมูลภายในที่ไม่จำเป็น

---

## 9. กฎการคำนวณ

### 9.1 เงิน

- ห้ามใช้ JavaScript floating point โดยตรงสำหรับยอดทางการเงิน
- เลือกหนึ่งแนวทางและใช้ทั้งระบบ:
  - เก็บจำนวนเงินเป็น integer หน่วยสตางค์ หรือ
  - ใช้ PostgreSQL `numeric(18,2)` ร่วมกับ decimal library
- การคำนวณจริงต้องทำ/ตรวจซ้ำที่ server
- นิยามลำดับการคำนวณ subtotal → discount → taxable amount → tax → grand total ให้เป็น domain function เดียว
- กำหนดกฎปัดเศษอย่างชัดเจนและมี unit test
- ห้ามให้ตัวเลขที่แสดงและตัวเลขใน PDF ใช้ logic คนละชุด

### 9.2 จำนวนเงินภาษาไทย

- สร้าง pure function พร้อม unit test สำหรับ 0, จำนวนเต็ม, สตางค์, เลขหลักล้านซ้ำ และค่าขอบเขตสูงสุดที่ระบบรองรับ
- ตัวอย่างกรณีทดสอบต้องให้เจ้าหน้าที่โรงเรียนรับรองข้อความที่ต้องการ
- ค่าใน PDF ต้องสร้างจากยอดสุทธิที่บันทึก ไม่รับข้อความที่ผู้ใช้พิมพ์เอง ยกเว้น override ที่เก็บเหตุผล

### 9.3 ปี พ.ศ. และเขตเวลา

- เก็บ timestamp ในฐานข้อมูลเป็น UTC
- แสดงและตีความวันที่ธุรกิจด้วย `Asia/Bangkok`
- เก็บปีงบประมาณเป็น record แยก ไม่คำนวณจาก `year + 543` อย่างเดียว
- ใช้ฟังก์ชันกลางในการแสดงวันที่ไทยและปี พ.ศ.
- ห้ามใช้เวลาของ browser เพียงอย่างเดียวในการออกเลขหรือกำหนดวันที่ทางการ

---

## 10. สถาปัตยกรรมที่แนะนำ

### 10.1 Technology stack

| ชั้น             | เทคโนโลยีแนะนำ                                              |
| ---------------- | ----------------------------------------------------------- |
| Web framework    | Next.js App Router รุ่น stable ที่ pin version              |
| Language         | TypeScript แบบ `strict`                                     |
| UI               | Tailwind CSS + accessible component library เช่น shadcn/ui  |
| Form             | React Hook Form + Zod                                       |
| Database         | Supabase PostgreSQL                                         |
| Authentication   | Supabase Auth ปิด public registration                       |
| Authorization    | Server-side permission checks + PostgreSQL RLS เมื่อเหมาะสม |
| File storage     | Supabase Storage private buckets พร้อม signed URL อายุสั้น  |
| PDF              | `@react-pdf/renderer` พร้อม bundled Thai font               |
| XLSX/CSV         | ExcelJS หรือ SheetJS และ CSV UTF-8 BOM เมื่อจำเป็น          |
| QR Code          | ไลบรารีที่สร้าง SVG/PNG ได้โดยไม่ส่งข้อมูลออกนอกระบบ        |
| Validation       | Zod schema ใช้ร่วมระหว่าง form และ server boundary          |
| Unit test        | Vitest                                                      |
| Component test   | Testing Library                                             |
| E2E              | Playwright                                                  |
| Error monitoring | Sentry หรือบริการเทียบเท่าโดยไม่ส่งข้อมูลลับเกินจำเป็น      |
| Hosting          | Vercel                                                      |
| CI               | GitHub Actions                                              |

ข้อกำหนด: ตรวจสอบรุ่น stable และความเข้ากันได้ ณ วันที่เริ่มพัฒนา จากนั้น pin dependency และ commit lockfile ห้ามใช้ `latest` ใน Production โดยไม่ตรวจสอบ

### 10.2 ภาพรวมระบบ

```text
Browser
  │ HTTPS
  ▼
Vercel / Next.js
  ├─ Server Components / Route Handlers / Server Actions
  ├─ Domain services: procurement, approval, documents, inventory
  ├─ PDF/XLSX generation
  └─ Authorization + validation + audit
          │
          ├──────── Supabase PostgreSQL
          ├──────── Supabase Auth
          └──────── Supabase Storage (private)
```

### 10.3 หลักการแบ่งชั้น

- UI ไม่เขียนฐานข้อมูลโดยตรงสำหรับธุรกรรมสำคัญ
- Domain service เป็นจุดรวม validation, permission, transaction และ audit
- Repository/data-access layer รับผิดชอบ query และป้องกัน N+1
- PDF renderer รับ immutable view model ไม่ query ฐานข้อมูลเอง
- Export service ใช้ query/filter เดียวกับรายงานบนหน้าจอ
- ห้ามใส่ service-role key ใน client bundle

### 10.4 โครงสร้าง repository ที่แนะนำ

```text
/
├─ .github/
│  ├─ workflows/
│  │  ├─ ci.yml
│  │  └─ security.yml
│  └─ pull_request_template.md
├─ docs/
│  ├─ architecture.md
│  ├─ data-dictionary.md
│  ├─ permissions.md
│  ├─ document-template-guide.md
│  ├─ deployment.md
│  ├─ backup-restore.md
│  └─ decisions/
├─ public/
├─ src/
│  ├─ app/
│  │  ├─ (auth)/
│  │  ├─ (dashboard)/
│  │  ├─ api/
│  │  └─ error.tsx
│  ├─ components/
│  ├─ features/
│  │  ├─ auth/
│  │  ├─ master-data/
│  │  ├─ procurement/
│  │  ├─ approvals/
│  │  ├─ documents/
│  │  ├─ inventory/
│  │  ├─ assets/
│  │  ├─ reports/
│  │  └─ audit/
│  ├─ domain/
│  ├─ lib/
│  ├─ server/
│  └─ styles/
├─ supabase/
│  ├─ migrations/
│  ├─ seed.sql
│  └─ tests/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  ├─ e2e/
│  └─ fixtures/
├─ .env.example
├─ README.md
├─ package.json
└─ lockfile
```

---

## 11. แบบจำลองข้อมูล

ชื่อ field สามารถปรับได้ แต่ความสัมพันธ์และข้อจำกัดสำคัญต้องคงอยู่

### 11.1 ตารางระบบและบุคลากร

#### `profiles`

```text
id uuid PK references auth.users
email text unique not null
employee_code text nullable
title_th text nullable
first_name_th text not null
last_name_th text not null
position_id uuid nullable FK
department_id uuid nullable FK
is_active boolean not null default true
last_login_at timestamptz nullable
created_at timestamptz not null
updated_at timestamptz not null
```

#### `roles`, `permissions`, `user_roles`, `role_permissions`

- RBAC แบบ many-to-many
- unique constraints ป้องกัน role/permission ซ้ำ
- รองรับ scope ตามหน่วยงานในอนาคต

#### `departments`, `positions`, `locations`

- ใช้ `is_active` และ effective dates เมื่อจำเป็น
- ห้าม hard delete หากถูกอ้างอิง

### 11.2 ข้อมูลพื้นฐาน

#### `school_settings`

- ชื่อไทย/อังกฤษ ที่อยู่ โทรศัพท์ อีเมล เลขผู้เสียภาษี โลโก้
- เก็บค่าที่เปลี่ยนตามเวลาเป็น version หรือ effective-dated record

#### `fiscal_years`

```text
id uuid PK
code text unique
year_be integer not null
start_date date not null
end_date date not null
status enum(OPEN, CLOSED)
```

#### `vendors`

```text
id uuid PK
vendor_code text unique
name text not null
tax_id text nullable
branch_no text nullable
address jsonb nullable
contact_name text nullable
phone text nullable
email text nullable
bank_data_encrypted jsonb nullable
is_active boolean not null
created_at, updated_at, deleted_at
```

หากไม่จำเป็นต่อ MVP ห้ามเก็บข้อมูลบัญชีธนาคาร

#### `projects`, `funding_sources`, `units`, `item_categories`

- มี code, name, fiscal_year, budget/active status ตามชนิดข้อมูล
- index field ที่ใช้ค้นหาและ join บ่อย

### 11.3 Procurement

#### `procurements`

```text
id uuid PK
internal_reference text unique not null
revision integer not null default 1
parent_procurement_id uuid nullable FK
type enum(GOODS, ASSET, SERVICE)
subject text not null
reason text not null
status enum(...workflow statuses...)
fiscal_year_id uuid not null FK
department_id uuid not null FK
project_id uuid nullable FK
funding_source_id uuid not null FK
vendor_id uuid nullable FK
requester_id uuid not null FK
needed_by date nullable
tax_mode enum(INCLUSIVE, EXCLUSIVE, EXEMPT)
currency char(3) not null default 'THB'
subtotal numeric(18,2) not null
discount_total numeric(18,2) not null
tax_total numeric(18,2) not null
grand_total numeric(18,2) not null
version integer not null default 1
submitted_at, approved_at, issued_at, cancelled_at timestamptz nullable
created_by, updated_by uuid not null
created_at, updated_at, deleted_at timestamptz
```

#### `procurement_items`

```text
id uuid PK
procurement_id uuid not null FK
line_no integer not null
description text not null
category_id uuid nullable FK
quantity numeric(18,4) not null
unit_id uuid not null FK
unit_price numeric(18,4) not null
discount_amount numeric(18,2) not null default 0
tax_rate numeric(7,4) not null default 0
line_subtotal numeric(18,2) not null
line_tax numeric(18,2) not null
line_total numeric(18,2) not null
is_asset boolean not null default false
specification text nullable
unique(procurement_id, line_no)
```

#### `approval_steps`, `approval_instances`, `approval_actions`

- `approval_steps` เป็น configuration ของสายอนุมัติ
- `approval_instances` เป็น frozen workflow ของรายการนั้น
- `approval_actions` เป็น append-only event
- ต้องเก็บ assignee ณ เวลาสร้าง instance เพื่อไม่ให้การเปลี่ยนตำแหน่งภายหลังเปลี่ยนประวัติ

#### `attachments`

- entity type/id, storage path, original filename, mime type, size, checksum, uploaded by/at
- private bucket เท่านั้น
- allowlist MIME และตรวจ magic bytes ฝั่ง server

### 11.4 Documents

#### `document_templates`

```text
id uuid PK
code text not null
name text not null
version integer not null
status enum(DRAFT, PUBLISHED, RETIRED)
applicable_type text nullable
schema_json jsonb not null
renderer_key text not null
effective_from date nullable
effective_to date nullable
published_at timestamptz nullable
published_by uuid nullable
unique(code, version)
```

#### `document_sequences`

```text
id uuid PK
document_type text not null
fiscal_year_id uuid not null
department_id uuid nullable
prefix text nullable
current_value bigint not null
format_pattern text not null
unique(document_type, fiscal_year_id, department_id)
```

#### `issued_documents`

ตามรายการในหัวข้อ 8.4 และมี unique constraint สำหรับเลขที่เอกสารตาม scope

### 11.5 Inventory

#### `inventory_items`

- item code, name, category, base unit, reorder point, active flag

#### `inventory_lots`

- inventory item, receipt line, received date, unit cost, quantity received, remaining quantity

#### `stock_movements`

```text
id uuid PK
inventory_item_id uuid not null
lot_id uuid nullable
movement_type enum(RECEIPT, ISSUE, RETURN, ADJUST_IN, ADJUST_OUT)
quantity numeric(18,4) not null
balance_after numeric(18,4) not null
reference_type text not null
reference_id uuid not null
reason text nullable
occurred_at timestamptz not null
created_by uuid not null
```

Movement ควร append-only การแก้ผิดให้สร้าง reversal ไม่แก้ record เดิม

### 11.6 Assets

#### `assets`

```text
id uuid PK
asset_no text unique not null
inventory_receipt_line_id uuid nullable
name text not null
category_id uuid not null
brand text nullable
model text nullable
serial_no text nullable
acquisition_date date not null
acquisition_cost numeric(18,2) not null
funding_source_id uuid not null
location_id uuid nullable
custodian_id uuid nullable
status enum(...)
qr_token text unique not null
created_at, updated_at, disposed_at
```

#### `asset_events`

- event type, asset id, from/to location, from/to custodian, condition, notes, evidence attachment, actor, timestamp
- append-only

### 11.7 Audit

#### `audit_events`

```text
id uuid PK
request_id text not null
actor_id uuid nullable
action text not null
entity_type text not null
entity_id text nullable
before_json jsonb nullable
after_json jsonb nullable
metadata_json jsonb nullable
ip_hash text nullable
user_agent text nullable
created_at timestamptz not null
```

### 11.8 Constraints และ indexes สำคัญ

- unique: internal reference, document number ตาม scope, asset number, vendor code
- check: quantity > 0, monetary fields >= 0, date range ถูกต้อง
- foreign keys พร้อม delete policy ที่ชัดเจน
- indexes: status/fiscal year/department/vendor/created_at และ full-text/trigram สำหรับชื่อเรื่องหรือผู้ขายถ้าจำเป็น
- optimistic concurrency ด้วย `version`
- transaction lock สำหรับ running number และ stock movement

---

## 12. หน้าจอและเส้นทาง

### 12.1 Public/Auth

- `/login` — เข้าสู่ระบบ
- `/forgot-password` — ขอรีเซ็ตรหัสผ่าน
- `/reset-password` — ตั้งรหัสผ่านใหม่
- ไม่มีหน้า public register

### 12.2 Dashboard

- `/dashboard`
- การ์ด: รายการรอตรวจ รออนุมัติ รอรับเข้า วัสดุต่ำกว่าจุดสั่งซื้อ ครุภัณฑ์ชำรุด
- กราฟ/ตารางต้องแสดงปีงบประมาณและ filter ชัดเจน

### 12.3 Procurement

- `/procurements`
- `/procurements/new`
- `/procurements/[id]`
- `/procurements/[id]/edit`
- `/procurements/[id]/documents`
- `/approvals/inbox`

Wizard สร้างรายการที่แนะนำ:

1. ประเภทและข้อมูลคำขอ
2. โครงการ/แหล่งเงิน
3. รายการและราคา
4. ผู้ขายและเอกสารแนบ
5. ผู้เกี่ยวข้อง/สายอนุมัติ
6. ตรวจสอบและ Preview

### 12.4 Inventory และ Assets

- `/inventory/items`
- `/inventory/receipts`
- `/inventory/issues`
- `/inventory/stock-card/[itemId]`
- `/assets`
- `/assets/[id]`
- `/assets/[id]/qr`

### 12.5 Reports และ Admin

- `/reports/procurements`
- `/reports/inventory`
- `/reports/assets`
- `/admin/users`
- `/admin/master-data/*`
- `/admin/workflows`
- `/admin/document-templates`
- `/admin/document-sequences`
- `/admin/audit-log`
- `/admin/system`

### 12.6 UX requirements

- ภาษาไทยอ่านง่าย ขนาดตัวอักษรอย่างน้อย 16px สำหรับเนื้อหาหลัก
- Keyboard navigation และ focus state ชัดเจน
- ปุ่มอันตรายต้องมี confirmation และอธิบายผลกระทบ
- Error แสดงภาษาที่ผู้ใช้แก้ไขได้ พร้อม request ID เมื่อเป็น server error
- ตารางรองรับ loading, empty, error, pagination และ filter state
- ไม่ใช้สีเพียงอย่างเดียวบอกสถานะ
- แสดง autosave/saved state เมื่อมี autosave
- ก่อน submit แสดง checklist ของข้อมูลที่ยังขาด
- หน้า print preview ต้องแยกจาก UI navigation และไม่พิมพ์ปุ่มเมนู

---

## 13. API และ Server Operations

สามารถใช้ Server Actions หรือ Route Handlers แต่ต้องมี boundary ชัดเจนและทดสอบได้

ตัวอย่าง operations:

```text
createProcurement(input)
updateProcurementDraft(id, version, input)
submitProcurement(id, version)
reviewProcurement(id, action, reason)
approveProcurement(id, action, reason)
previewDocument(procurementId, templateCode)
issueDocumentPack(procurementId)
cancelProcurement(id, reason)
createReceipt(procurementId, items)
issueStock(input)
reverseStockMovement(id, reason)
createAssetsFromReceipt(receiptId)
transferAsset(assetId, destination, reason)
exportReport(reportType, filters, format)
```

ทุก operation ที่เปลี่ยนข้อมูลต้องทำตามลำดับ:

1. authenticate
2. authorize
3. validate input
4. load current state
5. validate state transition/business rules
6. perform database transaction
7. append audit event
8. return safe response

Idempotency key ต้องใช้กับ operation ที่เสี่ยงทำซ้ำ เช่น issue document, approve และ receive

---

## 14. Security, Privacy และการเก็บข้อมูล

### 14.1 Security requirements

- HTTPS เท่านั้นใน Production
- ปิด public sign-up
- ใช้ secure, httpOnly, sameSite cookies ตามแนวทางของ auth provider
- ป้องกัน CSRF ตามรูปแบบที่ framework กำหนด
- validate และ authorize ทุก server mutation
- sanitize filename และห้าม path traversal
- จำกัด MIME, extension และขนาดไฟล์
- private storage + signed URL อายุสั้น
- rate limit login, export และ PDF generation
- ป้องกัน injection ด้วย parameterized queries/ORM
- กำหนด Content Security Policy และ security headers
- secret อยู่ใน Vercel/Supabase environment เท่านั้น
- ห้าม commit `.env`, production dump หรือไฟล์เอกสารจริงลง GitHub
- logs ต้อง redact token, password, tax ID หรือข้อมูลอ่อนไหวที่ไม่จำเป็น
- dependency scanning และ secret scanning ใน CI/GitHub

### 14.2 PDPA/Data minimization

- เก็บเฉพาะข้อมูลบุคลากรและผู้ขายที่จำเป็นต่อกระบวนการ
- แสดงข้อมูลส่วนบุคคลตามสิทธิ์
- ระบุฐานและวัตถุประสงค์การใช้งานข้อมูลในนโยบายภายในโรงเรียน
- กำหนด retention และกระบวนการ archive/delete โดยผู้รับผิดชอบ
- Export ต้องมีผู้กระทำ เวลา และ filter ใน audit log
- ข้อมูลทดสอบและ Preview environment ต้องเป็นข้อมูลสมมติหรือทำ anonymization

### 14.3 Backup และ recovery

- เปิด automated backup ตามแผนของ Supabase ที่เลือก
- จัดทำ `docs/backup-restore.md`
- กำหนด RPO/RTO กับโรงเรียนก่อน Production
- ทดสอบ restore อย่างน้อยก่อนเปิดใช้ และตามรอบที่กำหนด
- ไฟล์ใน Storage ต้องมีนโยบายสำรอง/กู้คืนสอดคล้องกับฐานข้อมูล
- ห้ามถือว่า GitHub เป็น backup ของฐานข้อมูลหรือเอกสาร

---

## 15. Non-functional Requirements

- **NFR-001 Availability:** กำหนดตามแพ็กเกจ Vercel/Supabase และสื่อสาร maintenance window
- **NFR-002 Performance:** หน้า list ทั่วไป LCP เป้าหมายไม่เกิน 2.5 วินาทีในเครือข่ายโรงเรียนที่ยอมรับได้
- **NFR-003 PDF:** ชุดเอกสารทั่วไปสร้างเสร็จภายใน 15 วินาที หากเกินให้ใช้ background job/polling
- **NFR-004 Pagination:** ห้ามดึงรายการธุรกรรมทั้งหมดมาที่ client ในครั้งเดียว
- **NFR-005 Accessibility:** เป้าหมาย WCAG 2.1 AA สำหรับ flow หลัก
- **NFR-006 Browser:** รองรับ Chrome/Edge รุ่นปัจจุบันอย่างน้อย 2 รุ่นย้อนหลัง
- **NFR-007 Responsive:** ใช้งาน flow หลักได้ตั้งแต่ viewport 768px ขึ้นไป และดูข้อมูลบนมือถือได้
- **NFR-008 Maintainability:** TypeScript strict, lint, format, test และไม่มี circular domain dependency
- **NFR-009 Observability:** error มี request ID, structured log และ alert สำหรับ critical failure
- **NFR-010 Localization:** ข้อความ UI อยู่ใน resource กลาง ไม่กระจาย hard-code หากคาดว่าจะมีหลายภาษา
- **NFR-011 Data integrity:** transaction และ constraint ป้องกันเลขซ้ำ ยอดติดลบ และสถานะผิดลำดับ
- **NFR-012 Scalability:** MVP ออกแบบขั้นต่ำสำหรับผู้ใช้พร้อมกัน 50 คนและข้อมูลหลายปีงบประมาณ โดยต้องทดสอบ query สำคัญ

---

## 16. GitHub Workflow

### 16.1 Repository setup

- Repository เป็น private โดยค่าเริ่มต้น
- ป้องกัน branch `main`
- merge ผ่าน Pull Request เท่านั้น
- ต้องผ่าน CI ก่อน merge
- ต้องมีอย่างน้อย 1 reviewer สำหรับ feature และ 2 reviewers สำหรับ auth/schema/document issuance หากทีมเพียงพอ
- เปิด Dependabot/Renovate, secret scanning และ code scanning ที่ใช้งานได้
- `README.md` ต้องอธิบาย setup, scripts, architecture ย่อ และลิงก์เอกสาร

### 16.2 Branch และ commit

```text
main                 production-ready
feat/<issue>-<name>  feature
fix/<issue>-<name>   bug fix
chore/<name>         tooling/docs
```

ใช้ Conventional Commits:

```text
feat(procurement): add draft item editor
fix(documents): preserve Thai glyphs in generated PDF
chore(ci): add Playwright workflow
```

### 16.3 Pull Request template ต้องมี

- ปัญหา/Requirement ID
- สิ่งที่เปลี่ยน
- สิ่งที่ไม่อยู่ใน PR
- Migration และ rollback
- วิธีทดสอบพร้อมผล
- ภาพ/วิดีโอ UI
- Security/privacy impact
- Checklist PDF หากกระทบเอกสาร
- Preview deployment URL

### 16.4 CI pipeline

ทุก PR ต้องรัน:

```text
install with frozen lockfile
typecheck
lint
format check
unit tests
integration tests
build
database migration validation
dependency/security scan
```

Playwright smoke test ให้รันบน Preview deployment หรือ test environment ที่แยกข้อมูล

---

## 17. Vercel และ Environment Strategy

### 17.1 Environments

| Environment | Branch/Trigger                | Database                        | ข้อมูล              |
| ----------- | ----------------------------- | ------------------------------- | ------------------- |
| Local       | developer machine             | local Supabase หรือ dev project | seed สมมติ          |
| Preview     | ทุก PR                        | isolated preview/dev database   | ข้อมูลสมมติเท่านั้น |
| Staging     | `staging` หรือ promotion flow | staging project                 | UAT anonymized      |
| Production  | `main`/manual promotion       | production project              | ข้อมูลจริง          |

ห้ามให้ Preview deployment เชื่อม Production database หรือ Production storage

### 17.2 Environment variables ตัวอย่าง

```text
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SENTRY_DSN=
APP_TIMEZONE=Asia/Bangkok
DOCUMENT_STORAGE_BUCKET=issued-documents
ATTACHMENT_STORAGE_BUCKET=attachments
```

- ระบุเฉพาะชื่อใน `.env.example` ห้ามใส่ค่าจริง
- ตรวจ env ด้วย schema ตอน startup/build
- service role ใช้เฉพาะ server และเฉพาะกรณีจำเป็น
- Production deployment ควรมี manual approval หากทีม/แพ็กเกจรองรับ

### 17.3 Deployment process

1. Merge PR หลัง CI และ review ผ่าน
2. ตรวจ Vercel Preview และ database migration plan
3. Backup ก่อน migration ที่มีความเสี่ยง
4. Deploy migration แบบ backward-compatible ก่อน application เมื่อจำเป็น
5. Deploy application
6. รัน smoke tests: login, create draft, preview PDF, search, authorization
7. ตรวจ error dashboard และ performance
8. บันทึก release notes และ rollback point

### 17.4 Rollback

- Application rollback ใช้ Vercel deployment ก่อนหน้า
- Database migration ต้องมี roll-forward/rollback plan แยก
- ห้าม rollback schema แบบทำข้อมูลสูญหายโดยอัตโนมัติ
- Document file ที่ออกแล้วห้ามลบระหว่าง rollback

---

## 18. แผนการพัฒนาเป็นระยะ

ระยะเวลาเป็นประมาณการสำหรับทีมเล็กและต้องปรับตามจำนวนแบบฟอร์มจริง

### Phase 0 — Discovery และรับรองแบบฟอร์ม (1–2 สัปดาห์)

ผลลัพธ์:

- แบบฟอร์มจริงทุกฉบับเป็นไฟล์ตัวอย่าง
- data dictionary ของช่องทั้งหมด
- workflow และ permission matrix ที่โรงเรียนลงความเห็นชอบ
- วิธีคำนวณภาษี/ส่วนลด/ปัดเศษ
- วิธีออกเลขเอกสาร
- wireframe flow หลัก
- รายการ acceptance test ของเอกสาร

Exit criteria:

- เจ้าหน้าที่พัสดุและผู้บริหารยืนยันแบบฟอร์มและผู้ลงนาม
- ไม่มี placeholder สำคัญที่ยังไม่รู้แหล่งข้อมูล

### Phase 1 — Foundation (1–2 สัปดาห์)

Issues แนะนำ:

- `P0-001` Scaffold Next.js/TypeScript strict
- `P0-002` Supabase local/dev setup และ migrations
- `P0-003` Auth, profile, role, permission
- `P0-004` App shell ภาษาไทยและ navigation ตามสิทธิ์
- `P0-005` CI, test framework, `.env.example`
- `P0-006` logging/error boundary/request ID
- `P0-007` initial security headers

Exit criteria:

- login ได้ ไม่มี public sign-up
- route และ server operation ป้องกันด้วย permission
- CI ผ่าน และ Preview deployment ทำงาน

### Phase 2 — Master Data (1–2 สัปดาห์)

- โรงเรียน ปีงบประมาณ หน่วยงาน ตำแหน่ง บุคลากร
- ผู้ขาย โครงการ แหล่งเงิน หมวด หน่วย และสถานที่
- deactivate แทน hard delete
- audit CRUD
- import CSV เฉพาะรายการที่โรงเรียนต้องการ พร้อม dry-run และ error report

Exit criteria:

- ข้อมูลพื้นฐานพร้อมใช้สร้างรายการ
- validation และ duplicate detection ผ่านชุดทดสอบ

### Phase 3 — Procurement Draft และ Calculation (2–3 สัปดาห์)

- create/edit/clone/list/search
- item editor
- domain calculation และ Thai baht text
- attachments private storage
- optimistic concurrency
- budget warning

Exit criteria:

- เจ้าหน้าที่สร้าง Draft จากต้นจนถึงหน้าสรุปได้
- calculation unit tests ครอบคลุม edge cases

### Phase 4 — Approval และเลขเอกสาร (2 สัปดาห์)

- workflow configuration
- reviewer/approver inbox
- state transition
- reason on return/reject/cancel
- safe running number transaction
- frozen approval instance และ audit

Exit criteria:

- ผู้ใช้สองคนอนุมัติพร้อมกันแล้วไม่เกิดเลขซ้ำ/สถานะซ้ำ
- ไม่สามารถข้ามสถานะหรือเรียก API โดยไม่มีสิทธิ์ได้

### Phase 5 — Document Engine (2–4 สัปดาห์ ขึ้นกับจำนวนแบบฟอร์ม)

- versioned templates
- Draft preview watermark
- Thai PDF font
- individual + merged pack
- immutable snapshot/checksum
- print audit
- เอกสารจริงอย่างน้อย 3 ชนิดใน MVP รอบแรก แล้วเพิ่มตามลำดับความสำคัญ

Exit criteria:

- PDF ผ่าน golden sample และการพิมพ์จริง
- เปลี่ยนชื่อผู้อนุมัติหรือ publish template ใหม่แล้ว PDF เก่าไม่เปลี่ยน

### Phase 6 — Inventory และ Assets (3–4 สัปดาห์)

- partial receipt
- stock movements/stock card
- issue/return/adjustment/reversal
- asset creation
- QR/transfer/status/history

Exit criteria:

- ยอดคงเหลือตรงกับ expected ledger ใน integration tests
- concurrent issue ไม่ทำให้ยอดติดลบ

### Phase 7 — Reports, Export และ UAT (2–3 สัปดาห์)

- dashboards และ report filters
- CSV/XLSX/PDF exports
- audit report
- performance/index tuning
- accessibility pass
- UAT และแก้ defect
- backup/restore drill

Exit criteria:

- UAT test cases ผ่านตามเกณฑ์
- ไม่มี Critical/High security issue ที่ยังไม่แก้
- runbook และคู่มือพร้อม

### Phase 8 — Production rollout (1 สัปดาห์ + ระยะเฝ้าระวัง)

- production configuration
- seed master data ที่รับรองแล้ว
- สร้างผู้ดูแลคนแรกอย่างปลอดภัย
- อบรมผู้ใช้
- pilot กับหน่วยงานเล็กก่อน
- monitoring และ daily review ในช่วงแรก

---

## 19. Testing Strategy

### 19.1 Unit tests — ต้องมี

- monetary calculation และ rounding
- VAT inclusive/exclusive/exempt
- Thai baht text
- fiscal year/date formatter
- document number formatter
- permission evaluator
- state transition matrix
- PDF view model mapping
- report filter parser

### 19.2 Integration tests — ต้องมี

- create → submit → review → approve → issue
- return for revision และ resubmit
- cancellation/revision
- concurrent document number issuance
- partial/full receipt
- concurrent stock issue
- RLS/authorization ระหว่างผู้ใช้คนละบทบาท
- audit event ถูกสร้างพร้อมธุรกรรม
- signed URL ไม่ให้เข้าถึงไฟล์อื่น

### 19.3 E2E tests — flow สำคัญ

1. Admin สร้างข้อมูลพื้นฐานและเชิญผู้ใช้
2. Requester สร้างคำขอและส่งตรวจ
3. Reviewer ส่งกลับ ผู้ขอแก้และส่งใหม่
4. Approver อนุมัติ
5. Procurement officer ออกชุดเอกสาร
6. Inventory officer รับเข้าและตรวจ Stock Card
7. สร้างครุภัณฑ์และเปิดหน้าจาก QR หลัง login
8. Auditor ส่งออกรายงานโดยแก้ข้อมูลไม่ได้

### 19.4 Document tests

- golden PDF/sample comparison ในส่วนที่ deterministic
- extract text เพื่อตรวจ placeholder/ยอด/ชื่อ
- render PDF เป็นภาพและ visual regression สำหรับหน้าสำคัญ
- ทดสอบข้อมูลยาว ชื่อยาว ตารางหลายหน้า และรายการอย่างน้อย 50 แถว
- ทดสอบเลขไทย/อารบิก สระ วรรณยุกต์ และคำอังกฤษปนไทย
- ตรวจด้วยเครื่องพิมพ์จริงอย่างน้อยหนึ่งรุ่นที่โรงเรียนใช้

### 19.5 Security tests

- unauthenticated access
- privilege escalation และ IDOR
- direct URL/file access
- malicious filename/upload
- XSS ในชื่อเรื่อง ผู้ขาย และหมายเหตุ
- CSRF/session expiration
- mass assignment
- rate limit
- secret exposure ใน bundle/log/error

---

## 20. เกณฑ์ตรวจรับ MVP

### AC-01 กรอกครั้งเดียวสร้างหลายเอกสาร

**Given** ข้อมูลโรงเรียน บุคลากร และผู้ขายถูกตั้งไว้แล้ว  
**When** เจ้าหน้าที่สร้างรายการ กรอกข้อมูลเฉพาะรายการ และผ่านการอนุมัติ  
**Then** ระบบสร้างเอกสารที่กำหนดอย่างน้อย 3 ชนิดโดยชื่อ ยอด ผู้ขาย โครงการ และผู้ลงนามตรงกันทั้งหมด

### AC-02 ความถูกต้องของยอดเงิน

ระบบคำนวณ subtotal, discount, tax และ grand total ตรงกับชุดกรณีตัวอย่างที่โรงเรียนรับรอง รวมถึงจำนวนเงินภาษาไทยและการปัดเศษ

### AC-03 PDF พร้อมพิมพ์

PDF แสดงภาษาไทยถูกต้อง ไม่ล้นหน้า ใช้ A4 และเมื่อพิมพ์จริงแล้วตำแหน่งหัวเรื่อง ตาราง เลขหน้า และลายเซ็นตรงกับ golden sample ที่อนุมัติ

### AC-04 เอกสารย้อนหลังไม่เปลี่ยน

เมื่อแก้ข้อมูลโรงเรียน ผู้ลงนาม หรือ publish template ใหม่ ไฟล์ PDF ที่เคยออกแล้ว checksum และเนื้อหาต้องไม่เปลี่ยน

### AC-05 เลขเอกสารไม่ซ้ำ

เมื่อจำลองการออกเอกสารพร้อมกันหลายคำขอ ระบบไม่สร้างเลขซ้ำและเลขที่ยกเลิกไม่ถูกนำกลับมาใช้

### AC-06 สิทธิ์

ผู้ใช้แต่ละบทบาทเปิดได้เฉพาะหน้า/ข้อมูลและทำได้เฉพาะ action ที่กำหนด การเรียก endpoint โดยตรงต้องถูกปฏิเสธเช่นเดียวกับ UI

### AC-07 Audit trail

ระบบระบุผู้ทำ เวลา และเหตุผลของการสร้าง แก้ ส่งตรวจ อนุมัติ ออกเอกสาร พิมพ์ ส่งออก รับเข้า และปรับยอดได้

### AC-08 ยอดคลัง

หลังรับ เบิก คืน และ reversal ตาม test script ยอดคงเหลือและ Stock Card ตรงทุกจุด และระบบไม่ยอมให้ยอดติดลบโดยไม่มี override ที่มีสิทธิ์

### AC-09 Export

ผู้ใช้กรองตามปีงบประมาณ ช่วงวันที่ สถานะ หน่วยงาน โครงการ และผู้ขาย แล้วดาวน์โหลด XLSX/CSV ได้ โดยยอดรวมและจำนวนแถวตรงกับหน้ารายงาน

### AC-10 Production readiness

CI ผ่าน, ไม่มี secret ใน repo, Production ไม่ใช้ฐานข้อมูล Preview, backup/restore ผ่านการทดสอบ และมีคู่มือ rollback/incident contact

---

## 21. Definition of Done สำหรับทุก Feature

Feature ถือว่าเสร็จเมื่อ:

- Requirement และ acceptance criteria ชัดเจน
- มี schema migration ที่ปลอดภัยหากเกี่ยวข้อง
- permission ตรวจทั้ง UI และ server
- validation ฝั่ง server ครบ
- audit event ครบสำหรับ mutation สำคัญ
- unit/integration/E2E test ตามความเสี่ยง
- error/loading/empty state ครบ
- responsive และ keyboard ใช้งานได้
- ไม่มี TypeScript, lint หรือ build error
- ไม่มี secret หรือข้อมูลจริงใน fixture/screenshot
- เอกสาร architecture/data dictionary อัปเดต
- PR มีภาพและวิธีทดสอบ
- Vercel Preview ผ่าน smoke test
- reviewer อนุมัติและข้อคิดเห็นถูกแก้หรืออธิบายครบ

---

## 22. Checklist สำหรับผู้ตรวจงาน (Codex Review Gates)

ให้ส่ง Pull Request URL หรือ commit SHA ให้ Codex ตรวจเมื่อจบแต่ละ gate

### Gate A — Foundation

- ตรวจ dependency และ lockfile
- ตรวจ auth flow และไม่มี public sign-up
- ตรวจ secrets/client bundle
- ตรวจ repository structure, CI และ env validation
- ตรวจ route/server permission อย่างน้อยหนึ่ง flow

### Gate B — Schema และ Domain

- ตรวจ migrations, constraints, indexes และ rollback/roll-forward
- ตรวจ money/date/fiscal year types
- ตรวจ state machine, concurrency และ audit atomicity
- ตรวจ RLS/policies ด้วย test user หลายบทบาท

### Gate C — Procurement และ Approval

- ตรวจ form validation และ server recomputation
- ตรวจ separation of duties
- ตรวจ double-submit/idempotency
- ตรวจ return/revision/cancel flow

### Gate D — PDF/Documents

- เปรียบเทียบ PDF กับแบบฟอร์มจริง
- ตรวจ Thai glyphs, pagination, long content และ print result
- ตรวจ snapshot/version/checksum
- ตรวจว่า regenerate ไม่เขียนทับเอกสารเดิม

### Gate E — Inventory/Assets

- ตรวจ ledger แบบ append-only
- ตรวจ concurrent updates และ negative stock
- ตรวจ asset history และ QR authorization
- reconcile ยอดกับ test ledger

### Gate F — Production readiness

- ตรวจ GitHub protection/CI
- ตรวจ Vercel environment separation
- ตรวจ Supabase RLS/storage policies
- ตรวจ backup/restore และ rollback
- ตรวจ security headers, monitoring และ privacy
- รัน smoke/E2E บน Preview/Staging

รูปแบบข้อมูลที่ควรส่งให้ผู้ตรวจ:

```text
PR URL:
Preview URL:
Requirement IDs:
Test accounts/roles (ห้ามส่งรหัสผ่านในข้อความหรือ repo):
Migration summary:
How to test:
Known limitations:
Screenshots/PDF samples:
```

---

## 23. ความเสี่ยงและแนวทางลดความเสี่ยง

| ความเสี่ยง                      | ผลกระทบ             | แนวทาง                                                           |
| ------------------------------- | ------------------- | ---------------------------------------------------------------- |
| แบบฟอร์มยังไม่รับรอง            | ต้องแก้ PDF หลายรอบ | ทำ Phase 0 และ golden sample ก่อนพัฒนา renderer จำนวนมาก         |
| ระเบียบหรือแบบฟอร์มเปลี่ยน      | เอกสารใหม่ไม่ตรง    | versioned templates + effective date + ไม่เปลี่ยนเอกสารเก่า      |
| ฟอนต์/ตารางภาษาไทยใน PDF ผิด    | พิมพ์ใช้ไม่ได้      | bundled font, visual regression, print QA                        |
| เลขเอกสารซ้ำ                    | กระทบงานตรวจสอบ     | DB transaction, row lock, unique constraint, concurrency test    |
| ยอดคลังคลาดเคลื่อน              | ข้อมูลพัสดุผิด      | append-only ledger, transaction, reconciliation report           |
| สิทธิ์หลุด                      | ข้อมูลภายในรั่ว     | server authorization, RLS, IDOR tests, private storage           |
| Preview ใช้ข้อมูลจริง           | ข้อมูลรั่ว          | environment isolation และ synthetic seed                         |
| Vercel function timeout ตอน PDF | ออกเอกสารไม่ได้     | วัดตั้งแต่ต้น ลด asset size หรือใช้ job architecture เมื่อจำเป็น |
| Dependency เปลี่ยน              | build/deploy เสีย   | pin version, lockfile, Dependabot และ staging                    |
| ผู้ใช้ต่อต้านระบบใหม่           | ระบบไม่ถูกใช้       | pilot, training, UX test และ export ที่คุ้นเคย                   |

---

## 24. สิ่งส่งมอบ

1. Private GitHub repository พร้อมประวัติ PR
2. Source code และ lockfile
3. Supabase migrations, seed สมมติ และ RLS policies
4. Vercel Preview, Staging และ Production configuration
5. เอกสาร PDF templates ที่โรงเรียนรับรอง
6. Automated tests และรายงานผล
7. `README.md` สำหรับนักพัฒนา
8. คู่มือผู้ใช้ภาษาไทย
9. คู่มือผู้ดูแลระบบ
10. Data dictionary และ permission matrix
11. Backup/restore, deployment และ incident runbooks
12. UAT scripts และเอกสารผลตรวจรับ
13. Release notes และ known limitations

---

## 25. คำสั่งเริ่มต้นสำหรับ Claude

คัดลอกข้อความด้านล่างไปใช้หลังสร้าง GitHub repository และวางเอกสารนี้ไว้ที่ `docs/SCHOOL_PROCUREMENT_SYSTEM_PLAN.md`:

```text
คุณเป็น lead full-stack engineer ของโครงการระบบงานพัสดุและจัดซื้อจัดจ้างภายในโรงเรียน

ให้อ่าน docs/SCHOOL_PROCUREMENT_SYSTEM_PLAN.md ทั้งหมดก่อนแก้ไฟล์ใด ๆ และถือ Requirement IDs, Acceptance Criteria, Security Requirements และ Definition of Done เป็นข้อบังคับ

งานรอบแรก:
1. ตรวจสถานะ repository และไฟล์คำสั่ง AGENTS.md/CLAUDE.md ที่มีอยู่
2. สร้าง docs/assumptions.md แยกสิ่งที่ยืนยันแล้ว สิ่งที่สมมติ และคำถามที่โรงเรียนต้องตอบ โดยห้ามเดาข้อความทางระเบียบหรือแบบฟอร์ม
3. เสนอ architecture decision records สำหรับ stack, authentication, database access, authorization/RLS, money representation, PDF generation และ immutable document snapshots
4. แตก Phase 1 เป็น GitHub issues ขนาดเล็ก พร้อม Requirement IDs และ acceptance criteria
5. Scaffold Next.js + TypeScript strict ตามสเปก ติดตั้งเฉพาะ dependency ที่จำเป็นและ pin version พร้อม lockfile
6. เพิ่ม Supabase local/dev structure, migration เริ่มต้นสำหรับ profiles/roles/permissions และ seed ที่เป็นข้อมูลสมมติ
7. ทำ login แบบปิด public sign-up, app shell ภาษาไทย, server-side authorization ตัวอย่าง และ audit event ตัวอย่าง
8. เพิ่ม Vitest, Testing Library, Playwright, lint, formatting, typecheck และ GitHub Actions CI
9. เพิ่ม .env.example โดยไม่มี secret และ README วิธีรัน local
10. รัน test/typecheck/lint/build และรายงานผลจริง

ข้อจำกัด:
- ห้ามเชื่อมต่อ Production หรือใช้ข้อมูลจริง
- ห้าม commit secret, .env, service-role key, database dump หรือเอกสารจริง
- ห้ามฝังรายชื่อโรงเรียน ผู้บริหาร ข้อความระเบียบ หรือปีงบประมาณลงใน component
- ห้ามเริ่มทำแบบ PDF จริงก่อนมี golden sample ที่โรงเรียนรับรอง ให้ทำเพียง proof of concept ภาษาไทยด้วยข้อมูลสมมติ
- ทุก mutation ต้องออกแบบให้ authenticate, authorize, validate และ audit ที่ server
- อย่าทำ feature นอก Phase 1 หากฐานยังไม่ผ่าน test
- หากพบความไม่ชัดเจนที่เปลี่ยน schema หรือ workflow อย่างมีนัยสำคัญ ให้บันทึกคำถามและหยุดเฉพาะส่วนนั้น แต่ทำงานส่วนที่ไม่ขึ้นกับคำตอบต่อได้

ก่อนจบรอบ ให้ส่งสรุป:
- ไฟล์ที่เปลี่ยน
- คำสั่งและผลการทดสอบ
- migration/permission/security decisions
- สิ่งที่ยังไม่ทำ
- ความเสี่ยงหรือคำถาม
- PR URL และ Vercel Preview URL ถ้ามี
```

---

## 26. คำถามสำหรับประชุมเก็บความต้องการครั้งแรก

1. โรงเรียนใช้เอกสารใดบ้าง และเอกสารใดสำคัญที่สุด 3 ฉบับแรก
2. มีตัวอย่างเอกสารที่กรอกสมบูรณ์และปิดข้อมูลส่วนบุคคลแล้วหรือไม่
3. ใครเป็นผู้ขอ ผู้ตรวจ ผู้อนุมัติ ผู้ตรวจรับ และผู้ลงนามในแต่ละกรณี
4. ขั้นตอนเปลี่ยนตามประเภทหรือวงเงินหรือไม่
5. เลขเอกสารแต่ละชนิดมีรูปแบบและรอบเริ่มเลขอย่างไร
6. VAT, ส่วนลด, ภาษีหัก ณ ที่จ่าย และการปัดเศษใช้อย่างไร
7. ต้องพิมพ์ลายเซ็นภาพหรือเว้นช่องสำหรับเซ็นจริง
8. ต้องการ Word หรือ PDF เพียงพอใน MVP
9. ปัจจุบันมีข้อมูลใน Excel กี่ไฟล์ และคุณภาพข้อมูลเป็นอย่างไร
10. ต้องรองรับครุภัณฑ์และคลังวัสดุตั้งแต่วันแรกหรือทำหลังระบบเอกสาร
11. ผู้ใช้งานจริงกี่คน และเข้าใช้ผ่านเครือข่าย/อุปกรณ์ใด
12. โรงเรียนมีโดเมนอีเมลสำหรับจำกัดผู้ใช้หรือไม่
13. ใครเป็น data owner, system owner และผู้ตอบเหตุขัดข้อง
14. ต้องเก็บเอกสารนานเท่าใด และใครมีสิทธิ์ export
15. งบประมาณบริการรายเดือนของ Vercel, Supabase, monitoring และ storage เท่าใด

---

## 27. ข้อสรุปการตัดสินใจตั้งต้น

- เริ่มจากระบบโรงเรียนเดียวและผู้ใช้ภายในเท่านั้น
- ใช้ Next.js/TypeScript บน Vercel และ Supabase สำหรับ Auth/PostgreSQL/Storage
- PDF เป็นผลลัพธ์ทางการหลักใน MVP ส่วน Word เป็นระยะถัดไปหากจำเป็น
- ใช้ versioned template และ immutable snapshot เพื่อรักษาความถูกต้องย้อนหลัง
- ธุรกรรมการเงิน เลขเอกสาร และ stock ใช้ server-side transaction และ database constraints
- การรับรองคำว่า “ถูกระเบียบ” ต้องมาจาก golden sample และผู้รับผิดชอบของโรงเรียน ไม่ใช่จากโค้ดเพียงอย่างเดียว
- เริ่มพัฒนาด้วย Phase 0 และ Phase 1 ก่อน แล้วให้ Codex ตรวจตาม Gate A ก่อนเดินหน้า Phase 2
