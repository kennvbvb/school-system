-- =============================================================================
-- Q36 — ผู้มีอำนาจอนุมัติเบิกจ่าย/ปรับยอดคลัง: โรงเรียนระบุว่าเป็น "หัวหน้าเจ้าหน้าที่พัสดุ"
-- และ "เจ้าหน้าที่พัสดุ" (ไม่ใช่บทบาทผู้อนุมัติ APPROVER ที่ migration 20261007000300 สมมติไว้)
--
-- ระบบมีบทบาทเดียวคือ PROCUREMENT_OFFICER (เจ้าหน้าที่พัสดุ) ทั้งสองตำแหน่งจึงใช้บทบาทนี้
-- ไม่สร้างบทบาทหัวหน้าแยก เพราะยังไม่มีสิทธิ์ใดที่ต่างกัน — แยกภายหลังได้ที่ role_permissions
-- โดยไม่ต้องแก้โค้ด SYSTEM_ADMIN ถือ inventory.approve อยู่แล้ว (ได้ทุกสิทธิ์)
--
-- ผู้เบิก/ปรับยอดจริงยังเป็น INVENTORY_OFFICER (inventory.issue / inventory.adjust)
-- และผู้เบิกกับผู้อนุมัติต้องเป็นคนละคนตามเดิม
-- ไม่แตะ stock_post_movement — การตรวจอำนาจอ่านจาก role_permissions อยู่แล้ว
-- =============================================================================

insert into public.role_permissions (role_code, permission_code)
select r.code, 'inventory.approve'
from public.roles r
where r.code = 'PROCUREMENT_OFFICER'
on conflict do nothing;

delete from public.role_permissions
where role_code = 'APPROVER' and permission_code = 'inventory.approve';
