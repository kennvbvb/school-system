-- =============================================================================
-- Migration 0004 — Row Level Security ของข้อมูลพื้นฐาน
--
-- ต่อจาก migration 0002 โดยใช้หลักการเดียวกัน (ดู ADR 0004):
--   * ทุกตารางเปิด RLS และ "ปฏิเสธก่อน" — สิทธิ์ที่ไม่ได้ประกาศคือไม่มีสิทธิ์
--   * ผู้ใช้ที่ยัง active อ่านข้อมูลพื้นฐานได้ เพราะต้องใช้เลือกตอนสร้างรายการ
--   * แก้ไขได้เฉพาะผู้ถือ masters.manage
--   * ไม่มี policy สำหรับ delete เลย — ปิดใช้ด้วย is_active หรือ deleted_at แทน
--     (FR-MST-008 "ป้องกันการลบ master data ที่ถูกอ้างอิง ให้ deactivate แทน")
--
-- ข้อยกเว้นที่ตั้งใจ: การปิดปีงบประมาณต้องใช้ settings.manage ไม่ใช่ masters.manage
-- เพราะเป็นการกระทำที่กระทบทั้งระบบ ไม่ใช่การแก้ข้อมูลอ้างอิงตามปกติ
-- =============================================================================

alter table public.school_settings enable row level security;
alter table public.fiscal_years enable row level security;
alter table public.locations enable row level security;
alter table public.vendors enable row level security;
alter table public.funding_sources enable row level security;
alter table public.projects enable row level security;
alter table public.units enable row level security;
alter table public.item_categories enable row level security;

-- -----------------------------------------------------------------------------
-- ข้อมูลโรงเรียน
--
-- อ่านได้ทุกคนที่ active เพราะต้องใช้แสดงหัวเอกสารและหน้าจอทั่วไป
-- แก้ได้เฉพาะ settings.manage ไม่ใช่ masters.manage เพราะกระทบทุกเอกสารที่จะออก
-- -----------------------------------------------------------------------------

create policy school_settings_select on public.school_settings
  for select to authenticated
  using (public.current_profile_is_active());

create policy school_settings_write on public.school_settings
  for all to authenticated
  using (public.has_permission('settings.manage'))
  with check (public.has_permission('settings.manage'));

-- -----------------------------------------------------------------------------
-- ปีงบประมาณ
--
-- แยก insert/update ออกจากกันเพื่อให้ชัดว่าไม่มีทางลบได้เลย
-- ปีงบประมาณที่ปิดแล้วยังต้องอยู่ เพราะเอกสารเก่าอ้างอิงถึง
-- -----------------------------------------------------------------------------

create policy fiscal_years_select on public.fiscal_years
  for select to authenticated
  using (public.current_profile_is_active());

create policy fiscal_years_insert on public.fiscal_years
  for insert to authenticated
  with check (public.has_permission('settings.manage'));

create policy fiscal_years_update on public.fiscal_years
  for update to authenticated
  using (public.has_permission('settings.manage'))
  with check (public.has_permission('settings.manage'));

-- -----------------------------------------------------------------------------
-- ข้อมูลอ้างอิงทั่วไป — อ่านได้เมื่อ active แก้ได้เมื่อมี masters.manage
-- -----------------------------------------------------------------------------

create policy locations_select on public.locations
  for select to authenticated
  using (public.current_profile_is_active());

create policy locations_write on public.locations
  for all to authenticated
  using (public.has_permission('masters.manage'))
  with check (public.has_permission('masters.manage'));

create policy funding_sources_select on public.funding_sources
  for select to authenticated
  using (public.current_profile_is_active());

create policy funding_sources_write on public.funding_sources
  for all to authenticated
  using (public.has_permission('masters.manage'))
  with check (public.has_permission('masters.manage'));

create policy projects_select on public.projects
  for select to authenticated
  using (public.current_profile_is_active());

create policy projects_write on public.projects
  for all to authenticated
  using (public.has_permission('masters.manage'))
  with check (public.has_permission('masters.manage'));

create policy units_select on public.units
  for select to authenticated
  using (public.current_profile_is_active());

create policy units_write on public.units
  for all to authenticated
  using (public.has_permission('masters.manage'))
  with check (public.has_permission('masters.manage'));

create policy item_categories_select on public.item_categories
  for select to authenticated
  using (public.current_profile_is_active());

create policy item_categories_write on public.item_categories
  for all to authenticated
  using (public.has_permission('masters.manage'))
  with check (public.has_permission('masters.manage'));

-- -----------------------------------------------------------------------------
-- ผู้ขาย
--
-- ผู้ที่ไม่มีสิทธิ์จัดการข้อมูลพื้นฐานจะเห็นเฉพาะผู้ขายที่ยังไม่ถูกลบ
-- ส่วนผู้ถือ masters.manage เห็นทั้งหมดรวมที่ลบแล้ว เพื่อกู้คืนหรือตรวจสอบได้
--
-- ไม่มี policy สำหรับ delete — การลบใช้การตั้ง deleted_at ผ่าน update
-- -----------------------------------------------------------------------------

create policy vendors_select on public.vendors
  for select to authenticated
  using (
    public.current_profile_is_active()
    and (deleted_at is null or public.has_permission('masters.manage'))
  );

create policy vendors_insert on public.vendors
  for insert to authenticated
  with check (public.has_permission('masters.manage'));

create policy vendors_update on public.vendors
  for update to authenticated
  using (public.has_permission('masters.manage'))
  with check (public.has_permission('masters.manage'));

-- -----------------------------------------------------------------------------
-- เพิกถอน delete ที่ระดับ table privilege ด้วย
--
-- การไม่ประกาศ policy ก็เพียงพอที่จะปฏิเสธอยู่แล้ว แต่การเพิกถอนสิทธิ์ระดับตาราง
-- ทำให้ยังปลอดภัยแม้จะมีใครเผลอเพิ่ม policy สำหรับ delete ในอนาคต
-- (ใช้แนวทางเดียวกับ audit_events ใน migration 0002)
-- -----------------------------------------------------------------------------

revoke delete on
  public.school_settings,
  public.fiscal_years,
  public.locations,
  public.vendors,
  public.funding_sources,
  public.projects,
  public.units,
  public.item_categories
from authenticated, anon;
