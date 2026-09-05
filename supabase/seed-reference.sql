-- =============================================================================
-- ข้อมูลอ้างอิงที่ระบบ "ต้องมี" — รันในทุก environment รวมถึง Production
--
-- ไฟล์นี้ไม่ใช่ข้อมูลทดสอบ แต่เป็นรายการสิทธิ์และบทบาทที่ผูกกับโค้ดใน
-- src/domain/auth/permissions.ts โดยตรง ถ้าไม่รันไฟล์นี้ ระบบสิทธิ์จะไม่ทำงานเลย
-- ผู้ใช้จะเข้าสู่ระบบได้แต่ไม่เห็นเมนูใดเลยสักอัน และ RLS จะปฏิเสธทุก query
--
-- ความสอดคล้องกับโค้ดถูกตรวจโดย tests/unit/seed-consistency.test.ts
-- ถ้าแก้ไฟล์นี้แล้วไม่แก้ permissions.ts ให้ตรงกัน (หรือกลับกัน) CI จะจับได้ทันที
--
-- รันซ้ำได้ปลอดภัย (idempotent) ทุกคำสั่งมี on conflict กำกับไว้
--
-- ข้อห้าม (แผนข้อ 14.2):
--   * ห้ามใส่ชื่อโรงเรียนจริง ชื่อบุคคลจริง หรือข้อความระเบียบจริง
--   * ห้ามใส่รหัสผ่านหรือ secret ใด ๆ
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permissions — ต้องตรงกับ PERMISSIONS ใน src/domain/auth/permissions.ts
-- -----------------------------------------------------------------------------

insert into public.permissions (code, description_th) values
  ('users.read',              'ดูข้อมูลผู้ใช้'),
  ('users.manage',            'จัดการผู้ใช้และการมอบบทบาท'),
  ('masters.read',            'ดูข้อมูลพื้นฐาน'),
  ('masters.manage',          'จัดการข้อมูลพื้นฐาน'),
  ('procurement.read.own',    'ดูรายการจัดซื้อจัดจ้างของตนเอง'),
  ('procurement.read.all',    'ดูรายการจัดซื้อจัดจ้างทั้งหมด'),
  ('procurement.create',      'สร้างรายการจัดซื้อจัดจ้าง'),
  ('procurement.edit_draft',  'แก้ไขรายการที่ยังเป็นฉบับร่าง'),
  ('procurement.submit',      'ส่งรายการเข้าสู่ขั้นตอนตรวจสอบ'),
  ('procurement.review',      'ตรวจสอบรายการ'),
  ('procurement.approve',     'อนุมัติหรือปฏิเสธรายการ'),
  ('procurement.cancel',      'ยกเลิกรายการ'),
  ('budget.read',             'ดูยอดงบประมาณและรายการเคลื่อนไหว'),
  ('budget.manage',           'จัดสรร ปรับ และโอนงบประมาณ'),
  ('budget.override',         'อนุมัติให้ลงรายการเกินยอดคงเหลือ พร้อมเหตุผล'),
  ('documents.preview',       'ดูตัวอย่างเอกสาร'),
  ('documents.issue',         'ออกเอกสารจริงและจองเลขที่เอกสาร'),
  ('documents.print',         'พิมพ์เอกสารที่ออกแล้ว'),
  ('inventory.read',          'ดูข้อมูลคลังวัสดุ'),
  ('inventory.receive',       'บันทึกรับเข้าพัสดุ'),
  ('inventory.issue',         'เบิกวัสดุ'),
  ('inventory.adjust',        'ปรับยอดคงเหลือ'),
  ('assets.read',             'ดูทะเบียนครุภัณฑ์'),
  ('assets.manage',           'จัดการทะเบียนครุภัณฑ์'),
  ('reports.export',          'ส่งออกรายงาน'),
  ('audit.read',              'ดู audit log'),
  ('templates.manage',        'จัดการแม่แบบเอกสาร'),
  ('settings.manage',         'จัดการค่าตั้งระบบ')
on conflict (code) do update set description_th = excluded.description_th;

-- -----------------------------------------------------------------------------
-- Roles — ต้องตรงกับ ROLES และ ROLE_LABELS_TH ในแอป
-- -----------------------------------------------------------------------------

insert into public.roles (code, name_th, description_th, is_system) values
  ('SYSTEM_ADMIN',        'ผู้ดูแลระบบ',           'จัดการระบบ ผู้ใช้ บทบาท ค่าตั้ง แม่แบบ และดู audit log', true),
  ('PROCUREMENT_OFFICER', 'เจ้าหน้าที่พัสดุ',       'สร้างรายการ จัดการเอกสาร รับพัสดุ และออกรายงาน',        true),
  ('REQUESTER',           'ผู้ขอ',                 'สร้างคำขอของตนเองและดูสถานะ',                          true),
  ('REVIEWER',            'ผู้ตรวจสอบ',            'ตรวจสอบข้อมูลและส่งต่อเพื่ออนุมัติ',                    true),
  ('APPROVER',            'ผู้อนุมัติ',            'อนุมัติหรือปฏิเสธตามขอบเขตที่ได้รับมอบหมาย',            true),
  ('FINANCE',             'เจ้าหน้าที่การเงิน',     'ตรวจแหล่งเงิน งบประมาณ ภาษี และดูรายงานที่เกี่ยวข้อง',  true),
  ('INVENTORY_OFFICER',   'เจ้าหน้าที่คลังพัสดุ',   'รับเข้า เบิก คืน ปรับยอด และดูแลทะเบียนครุภัณฑ์',       true),
  ('AUDITOR',             'ผู้ตรวจสอบภายใน',       'อ่านและส่งออกรายงาน แต่แก้ไขไม่ได้',                    true)
on conflict (code) do update set name_th = excluded.name_th, description_th = excluded.description_th;

-- -----------------------------------------------------------------------------
-- Role → Permission — ต้องตรงกับ DEFAULT_ROLE_PERMISSIONS ในแอป
-- ผู้ดูแลระบบปรับได้ภายหลังผ่านหน้าจอ ค่าที่นี่เป็นเพียงจุดเริ่มต้น
-- -----------------------------------------------------------------------------

-- SYSTEM_ADMIN ได้ทุกสิทธิ์
insert into public.role_permissions (role_code, permission_code)
select 'SYSTEM_ADMIN', code from public.permissions
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('PROCUREMENT_OFFICER', 'masters.read'),
  ('PROCUREMENT_OFFICER', 'procurement.read.all'),
  ('PROCUREMENT_OFFICER', 'procurement.create'),
  ('PROCUREMENT_OFFICER', 'procurement.edit_draft'),
  ('PROCUREMENT_OFFICER', 'procurement.submit'),
  ('PROCUREMENT_OFFICER', 'procurement.cancel'),
  ('PROCUREMENT_OFFICER', 'budget.read'),
  ('PROCUREMENT_OFFICER', 'documents.preview'),
  ('PROCUREMENT_OFFICER', 'documents.issue'),
  ('PROCUREMENT_OFFICER', 'documents.print'),
  ('PROCUREMENT_OFFICER', 'inventory.read'),
  ('PROCUREMENT_OFFICER', 'inventory.receive'),
  ('PROCUREMENT_OFFICER', 'assets.read'),
  ('PROCUREMENT_OFFICER', 'reports.export'),

  ('REQUESTER', 'masters.read'),
  ('REQUESTER', 'procurement.read.own'),
  ('REQUESTER', 'procurement.create'),
  ('REQUESTER', 'procurement.edit_draft'),
  ('REQUESTER', 'procurement.submit'),
  ('REQUESTER', 'documents.preview'),

  ('REVIEWER', 'masters.read'),
  ('REVIEWER', 'procurement.read.all'),
  ('REVIEWER', 'procurement.review'),
  ('REVIEWER', 'budget.read'),
  ('REVIEWER', 'documents.preview'),

  ('APPROVER', 'masters.read'),
  ('APPROVER', 'procurement.read.all'),
  ('APPROVER', 'procurement.approve'),
  ('APPROVER', 'budget.read'),
  ('APPROVER', 'documents.preview'),

  ('FINANCE', 'masters.read'),
  ('FINANCE', 'procurement.read.all'),
  ('FINANCE', 'budget.read'),
  ('FINANCE', 'budget.manage'),
  ('FINANCE', 'reports.export'),

  ('INVENTORY_OFFICER', 'masters.read'),
  ('INVENTORY_OFFICER', 'procurement.read.all'),
  ('INVENTORY_OFFICER', 'inventory.read'),
  ('INVENTORY_OFFICER', 'inventory.receive'),
  ('INVENTORY_OFFICER', 'inventory.issue'),
  ('INVENTORY_OFFICER', 'inventory.adjust'),
  ('INVENTORY_OFFICER', 'assets.read'),
  ('INVENTORY_OFFICER', 'assets.manage'),
  ('INVENTORY_OFFICER', 'reports.export'),

  ('AUDITOR', 'masters.read'),
  ('AUDITOR', 'procurement.read.all'),
  ('AUDITOR', 'budget.read'),
  ('AUDITOR', 'inventory.read'),
  ('AUDITOR', 'assets.read'),
  ('AUDITOR', 'reports.export'),
  ('AUDITOR', 'audit.read')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- หน่วยนับมาตรฐาน (FR-MST-007)
--
-- อยู่ในไฟล์ reference เพราะเป็นหน่วยสากลที่ใช้จริงทุกโรงเรียน ไม่ใช่ข้อมูลสมมติ
-- และถ้าตารางนี้ว่าง จะสร้างรายการจัดซื้อไม่ได้เลยตั้งแต่ Phase 3
--
-- โรงเรียนเพิ่ม แก้ หรือปิดใช้หน่วยใดก็ได้ภายหลังผ่านหน้าจัดการข้อมูลพื้นฐาน
-- ค่าที่นี่เป็นเพียงจุดเริ่มต้นให้ระบบใช้งานได้ทันที
-- -----------------------------------------------------------------------------

insert into public.units (code, name_th) values
  ('EA',   'ชิ้น'),
  ('BOX',  'กล่อง'),
  ('PK',   'แพ็ก'),
  ('REAM', 'รีม'),
  ('SET',  'ชุด'),
  ('BTL',  'ขวด'),
  ('ROLL', 'ม้วน'),
  ('JOB',  'งาน')
on conflict (code) do nothing;
