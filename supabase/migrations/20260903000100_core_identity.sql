-- =============================================================================
-- Migration 0001 — โครงสร้างพื้นฐานด้านผู้ใช้ บทบาท และสิทธิ์
--
-- ขอบเขต Phase 1 (P0-002, P0-003) ตาม docs/SCHOOL_PROCUREMENT_SYSTEM_PLAN.md
-- ครอบคลุม FR-AUTH-001..005, FR-MST-003, FR-MST-004, ข้อ 4.1-4.3 และ 11.1
--
-- หลักการ:
--   * ไม่ hard delete ข้อมูลที่ถูกอ้างอิง ใช้ is_active หรือ deleted_at
--   * ทุกตารางเปิด RLS และปฏิเสธโดยค่าเริ่มต้น
--   * การตรวจสิทธิ์จริงอยู่ที่ server domain service ส่วน RLS เป็นแนวป้องกันชั้นที่สอง
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- ฟังก์ชันช่วยเหลือ
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- หน่วยงานและตำแหน่ง (FR-MST-003, FR-MST-004)
-- -----------------------------------------------------------------------------

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_th text not null,
  parent_id uuid references public.departments (id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint departments_code_not_blank check (btrim(code) <> ''),
  constraint departments_not_self_parent check (parent_id is distinct from id)
);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_th text not null,
  is_signatory boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint positions_code_not_blank check (btrim(code) <> '')
);

-- -----------------------------------------------------------------------------
-- โปรไฟล์บุคลากร — ผูกกับ auth.users แบบหนึ่งต่อหนึ่ง
--
-- ไม่มี public sign-up (FR-AUTH-002): แถวในตารางนี้สร้างโดยผู้ดูแลระบบเท่านั้น
-- ผู้ใช้ที่มีบัญชีใน auth.users แต่ไม่มี profile ถือว่ายังไม่ได้รับอนุญาตให้ใช้ระบบ
-- -----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  email text not null unique,
  employee_code text unique,
  title_th text,
  first_name_th text not null,
  last_name_th text not null,
  position_id uuid references public.positions (id) on delete restrict,
  department_id uuid references public.departments (id) on delete restrict,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_lowercase check (email = lower(email)),
  constraint profiles_first_name_not_blank check (btrim(first_name_th) <> ''),
  constraint profiles_last_name_not_blank check (btrim(last_name_th) <> '')
);

create index profiles_department_idx on public.profiles (department_id) where is_active;
create index profiles_active_idx on public.profiles (is_active);

-- -----------------------------------------------------------------------------
-- RBAC (ข้อ 4.3, 11.1)
--
-- รหัสสิทธิ์ต้องตรงกับ src/domain/auth/permissions.ts เสมอ
-- seed.sql เป็นผู้เติมข้อมูลให้ตรงกัน และมี test ฝั่งแอปตรวจความสอดคล้อง
-- -----------------------------------------------------------------------------

create table public.permissions (
  code text primary key,
  description_th text not null,
  created_at timestamptz not null default now(),
  constraint permissions_code_format check (code ~ '^[a-z_]+(\.[a-z_]+)+$')
);

create table public.roles (
  code text primary key,
  name_th text not null,
  description_th text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_code_format check (code ~ '^[A-Z][A-Z_]*$')
);

create table public.role_permissions (
  role_code text not null references public.roles (code) on delete cascade,
  permission_code text not null references public.permissions (code) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (role_code, permission_code)
);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_code text not null references public.roles (code) on delete restrict,
  -- เตรียมรองรับ scope ตามหน่วยงานในอนาคต (ข้อ 11.1) โดย null = ทุกหน่วยงาน
  department_id uuid references public.departments (id) on delete restrict,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_code)
);

create index user_roles_role_idx on public.user_roles (role_code);

-- -----------------------------------------------------------------------------
-- Audit log (FR-AUD-001..005, ข้อ 11.7)
--
-- append-only: ไม่มี policy สำหรับ update/delete เลย และเพิกถอนสิทธิ์ระดับตาราง
-- เพื่อไม่ให้แม้แต่ผู้ดูแลระบบแก้ประวัติผ่านช่องทางปกติได้
-- -----------------------------------------------------------------------------

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_json jsonb,
  after_json jsonb,
  metadata_json jsonb,
  -- เก็บเป็น hash ไม่เก็บ IP ดิบ เพื่อลดข้อมูลส่วนบุคคลที่ไม่จำเป็น (ข้อ 14.2)
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint audit_events_action_not_blank check (btrim(action) <> ''),
  constraint audit_events_entity_type_not_blank check (btrim(entity_type) <> '')
);

create index audit_events_created_at_idx on public.audit_events (created_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);
create index audit_events_actor_idx on public.audit_events (actor_id, created_at desc);
create index audit_events_request_idx on public.audit_events (request_id);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

create trigger positions_set_updated_at
  before update on public.positions
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();
