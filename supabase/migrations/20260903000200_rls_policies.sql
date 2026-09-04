-- =============================================================================
-- Migration 0002 — Row Level Security
--
-- ครอบคลุมข้อ 4.2, 14.1 และ Gate B ของแผน
--
-- แนวคิด:
--   * ทุกตารางเปิด RLS และ "ปฏิเสธก่อน" — สิทธิ์ที่ไม่ได้ประกาศคือไม่มีสิทธิ์
--   * ฟังก์ชัน public.has_permission() เป็นจุดตัดสินเดียวของฝั่งฐานข้อมูล
--   * RLS เป็นแนวป้องกันชั้นที่สอง ไม่ใช่ชั้นเดียว domain service ต้องตรวจซ้ำเสมอ
--   * service_role ข้าม RLS ตามปกติของ Supabase จึงต้องใช้เฉพาะฝั่ง server
--     และเฉพาะกรณีที่จำเป็นจริงเท่านั้น (ข้อ 10.3)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ฟังก์ชันตัดสินสิทธิ์
--
-- security definer + search_path ที่ตรึงไว้ เพื่อกัน search_path hijacking
-- stable ทำให้ planner เรียกซ้ำในคำสั่งเดียวได้โดยไม่ประเมินใหม่ทุกแถว
-- -----------------------------------------------------------------------------

create or replace function public.current_profile_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
  );
$$;

create or replace function public.has_permission(required_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    join public.role_permissions rp on rp.role_code = ur.role_code
    where p.id = auth.uid()
      and p.is_active
      and rp.permission_code = required_permission
  );
$$;

revoke execute on function public.has_permission(text) from public;
revoke execute on function public.current_profile_is_active() from public;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.current_profile_is_active() to authenticated;

-- -----------------------------------------------------------------------------
-- เปิด RLS ทุกตาราง
-- -----------------------------------------------------------------------------

alter table public.departments enable row level security;
alter table public.positions enable row level security;
alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_events enable row level security;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------

-- ผู้ใช้ที่ยัง active อ่านโปรไฟล์ตัวเองได้เสมอ เพื่อให้ app shell ทำงานได้
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_with_permission on public.profiles
  for select to authenticated
  using (public.has_permission('users.read'));

create policy profiles_insert_with_permission on public.profiles
  for insert to authenticated
  with check (public.has_permission('users.manage'));

create policy profiles_update_with_permission on public.profiles
  for update to authenticated
  using (public.has_permission('users.manage'))
  with check (public.has_permission('users.manage'));

-- ไม่มี policy สำหรับ delete โดยเจตนา — ปิดบัญชีด้วย is_active = false แทน (ข้อ 4.2)

-- -----------------------------------------------------------------------------
-- master data ระดับองค์กร
-- -----------------------------------------------------------------------------

create policy departments_select on public.departments
  for select to authenticated
  using (public.current_profile_is_active());

create policy departments_write on public.departments
  for all to authenticated
  using (public.has_permission('masters.manage'))
  with check (public.has_permission('masters.manage'));

create policy positions_select on public.positions
  for select to authenticated
  using (public.current_profile_is_active());

create policy positions_write on public.positions
  for all to authenticated
  using (public.has_permission('masters.manage'))
  with check (public.has_permission('masters.manage'));

-- -----------------------------------------------------------------------------
-- ตาราง RBAC
--
-- อ่านได้เมื่อ active (แอปต้องรู้สิทธิ์ของตัวเองเพื่อ render เมนู)
-- แต่แก้ไขได้เฉพาะผู้ถือ users.manage เท่านั้น
-- -----------------------------------------------------------------------------

create policy permissions_select on public.permissions
  for select to authenticated
  using (public.current_profile_is_active());

create policy roles_select on public.roles
  for select to authenticated
  using (public.current_profile_is_active());

create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (public.current_profile_is_active());

create policy roles_write on public.roles
  for all to authenticated
  using (public.has_permission('users.manage'))
  with check (public.has_permission('users.manage'));

create policy role_permissions_write on public.role_permissions
  for all to authenticated
  using (public.has_permission('users.manage'))
  with check (public.has_permission('users.manage'));

-- permissions เป็นรายการคงที่ที่ผูกกับโค้ด แก้ผ่าน migration เท่านั้น ไม่มี policy เขียน

create policy user_roles_select_self on public.user_roles
  for select to authenticated
  using (user_id = auth.uid());

create policy user_roles_select_with_permission on public.user_roles
  for select to authenticated
  using (public.has_permission('users.read'));

create policy user_roles_write on public.user_roles
  for all to authenticated
  using (public.has_permission('users.manage'))
  with check (public.has_permission('users.manage'));

-- -----------------------------------------------------------------------------
-- audit_events — append-only (FR-AUD-002)
--
-- มีเฉพาะ select และ insert
-- update/delete ถูกเพิกถอนที่ระดับ table privilege ด้วย เพื่อไม่ให้ผู้ใช้ใด ๆ
-- ที่ไม่ใช่ service_role แก้ประวัติได้ แม้จะมีการเพิ่ม policy ผิดพลาดในอนาคต
-- -----------------------------------------------------------------------------

create policy audit_events_select on public.audit_events
  for select to authenticated
  using (public.has_permission('audit.read'));

create policy audit_events_insert on public.audit_events
  for insert to authenticated
  with check (public.current_profile_is_active());

revoke update, delete on public.audit_events from authenticated, anon;
