-- =============================================================================
-- Seed สำหรับ local/dev เท่านั้น — ข้อมูลสมมติทั้งหมด
--
-- ข้อห้ามตามแผนข้อ 14.2 และ 17.1:
--   * ห้ามใส่ชื่อโรงเรียนจริง ชื่อผู้บริหารจริง หรือข้อความระเบียบจริงในไฟล์นี้
--   * ห้ามรันไฟล์นี้กับฐานข้อมูล Production
--   * บัญชีทดสอบสร้างแยกต่างหากผ่านสคริปต์ผู้ดูแล ไม่ฝังรหัสผ่านไว้ที่นี่
--
-- ส่วนที่ "ไม่ใช่ข้อมูลสมมติ" คือ permissions และ roles ซึ่งผูกกับโค้ดในแอป
-- (src/domain/auth/permissions.ts) จึงต้อง seed ให้ตรงกันเสมอ
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
  ('REVIEWER', 'documents.preview'),

  ('APPROVER', 'masters.read'),
  ('APPROVER', 'procurement.read.all'),
  ('APPROVER', 'procurement.approve'),
  ('APPROVER', 'documents.preview'),

  ('FINANCE', 'masters.read'),
  ('FINANCE', 'procurement.read.all'),
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
  ('AUDITOR', 'inventory.read'),
  ('AUDITOR', 'assets.read'),
  ('AUDITOR', 'reports.export'),
  ('AUDITOR', 'audit.read')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- หน่วยงานและตำแหน่งสมมติสำหรับ dev/preview
-- ชื่อทั้งหมดเป็นชื่อทั่วไป ไม่อ้างอิงโรงเรียนหรือบุคคลจริง
-- -----------------------------------------------------------------------------

insert into public.departments (code, name_th) values
  ('ADMIN',    'กลุ่มบริหารงานทั่วไป (ตัวอย่าง)'),
  ('ACADEMIC', 'กลุ่มบริหารวิชาการ (ตัวอย่าง)'),
  ('BUDGET',   'กลุ่มบริหารงบประมาณ (ตัวอย่าง)')
on conflict (code) do nothing;

insert into public.positions (code, name_th, is_signatory) values
  ('DIRECTOR',   'ผู้อำนวยการ (ตัวอย่าง)',        true),
  ('DEPUTY',     'รองผู้อำนวยการ (ตัวอย่าง)',      true),
  ('OFFICER',    'เจ้าหน้าที่พัสดุ (ตัวอย่าง)',    false),
  ('TEACHER',    'ครู (ตัวอย่าง)',                false)
on conflict (code) do nothing;
