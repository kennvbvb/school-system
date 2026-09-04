-- =============================================================================
-- Migration 0003 — ข้อมูลพื้นฐาน (Master Data)
--
-- ขอบเขต Phase 2 ตาม docs/SCHOOL_PROCUREMENT_SYSTEM_PLAN.md ข้อ 18
-- ครอบคลุม FR-MST-001, FR-MST-002, FR-MST-005..009 และข้อ 11.2
--
-- หลักการเดียวกับ migration 0001:
--   * ไม่ hard delete ข้อมูลที่ถูกอ้างอิง ใช้ is_active หรือ deleted_at
--   * ทุกตารางเปิด RLS ใน migration ถัดไป (0004)
--   * ตัดสินสิทธิ์จริงที่ domain service ส่วน RLS เป็นแนวป้องกันชั้นที่สอง
--
-- สิ่งที่จงใจ "ไม่" เก็บ (ข้อ 11.2, 14.2 data minimization):
--   * ข้อมูลบัญชีธนาคารของผู้ขาย — แผนระบุว่า "หากไม่จำเป็นต่อ MVP ห้ามเก็บ"
--     MVP ไม่มีการจ่ายเงินจริง จึงไม่มีเหตุผลให้เก็บข้อมูลระดับนั้น
--     หากภายหลังจำเป็น ต้องมี ADR รองรับและออกแบบการเข้ารหัสก่อน
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ข้อมูลโรงเรียน (FR-MST-001)
--
-- เก็บแบบ effective-dated ไม่ใช่แถวเดียวที่ update ทับ เพราะชื่อผู้บริหาร
-- ที่อยู่ และตราสัญลักษณ์เปลี่ยนได้ตามเวลา และเอกสารที่ออกไปแล้วต้องอ้างอิง
-- ค่าที่ใช้ ณ วันที่ออกเอกสารได้ (ADR 0007)
--
-- หมายเหตุ: เอกสารที่ออกแล้วเก็บ snapshot ของตัวเองอยู่แล้ว ตารางนี้จึงเป็น
-- แหล่งข้อมูลตอน "สร้าง" เอกสาร ไม่ใช่ตอน "แสดง" เอกสารเก่า
-- -----------------------------------------------------------------------------

create table public.school_settings (
  id uuid primary key default gen_random_uuid(),
  name_th text not null,
  name_en text,
  address_th text not null,
  phone text,
  email text,
  tax_id text,
  logo_path text,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  constraint school_settings_name_not_blank check (btrim(name_th) <> ''),
  constraint school_settings_address_not_blank check (btrim(address_th) <> ''),
  constraint school_settings_effective_range check (
    effective_to is null or effective_to >= effective_from
  ),
  -- เลขประจำตัวผู้เสียภาษีไทยเป็นตัวเลข 13 หลัก
  constraint school_settings_tax_id_format check (tax_id is null or tax_id ~ '^[0-9]{13}$'),
  constraint school_settings_email_format check (email is null or email = lower(email))
);

-- ห้ามมีข้อมูลโรงเรียนสองชุดที่ช่วงเวลามีผลทับกัน มิฉะนั้นระบบจะเลือกไม่ถูก
-- ว่าควรใช้ชุดไหนตอนสร้างเอกสาร
create extension if not exists "btree_gist";

alter table public.school_settings
  add constraint school_settings_no_overlap exclude using gist (
    daterange(effective_from, effective_to, '[]') with &&
  );

-- -----------------------------------------------------------------------------
-- ปีงบประมาณ (FR-MST-002)
--
-- เก็บเป็น record จริง ไม่คำนวณจาก year + 543 (ข้อ 9.3)
-- เพราะวันเริ่ม-สิ้นสุดของโรงเรียนอาจไม่ตรงกับ 1 ต.ค. - 30 ก.ย. เสมอไป
-- และการปิดปีงบประมาณเป็นเหตุการณ์ทางธุรการที่ต้องบันทึกว่าใครปิดเมื่อใด
-- -----------------------------------------------------------------------------

create type public.fiscal_year_status as enum ('OPEN', 'CLOSED');

create table public.fiscal_years (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  year_be integer not null unique,
  start_date date not null,
  end_date date not null,
  status public.fiscal_year_status not null default 'OPEN',
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_years_code_not_blank check (btrim(code) <> ''),
  constraint fiscal_years_range check (end_date > start_date),
  -- ปี พ.ศ. ในช่วงที่สมเหตุสมผล กันการกรอกปี ค.ศ. ผิดช่อง
  constraint fiscal_years_year_be_range check (year_be between 2500 and 2700),
  -- ถ้าปิดแล้วต้องรู้ว่าปิดเมื่อใด และถ้ายังเปิดต้องไม่มีวันที่ปิดค้างอยู่
  constraint fiscal_years_closed_consistency check (
    (status = 'CLOSED' and closed_at is not null)
    or (status = 'OPEN' and closed_at is null)
  )
);

-- ปีงบประมาณต้องไม่ทับกัน เพราะระบบต้องหาปีงบประมาณจากวันที่ได้คำตอบเดียว
alter table public.fiscal_years
  add constraint fiscal_years_no_overlap exclude using gist (
    daterange(start_date, end_date, '[]') with &&
  );

create index fiscal_years_status_idx on public.fiscal_years (status);
create index fiscal_years_range_idx on public.fiscal_years (start_date, end_date);

-- -----------------------------------------------------------------------------
-- สถานที่เก็บพัสดุ (ข้อ 11.1)
-- -----------------------------------------------------------------------------

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_th text not null,
  department_id uuid references public.departments (id) on delete restrict,
  building text,
  room text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_code_not_blank check (btrim(code) <> ''),
  constraint locations_name_not_blank check (btrim(name_th) <> '')
);

create index locations_department_idx on public.locations (department_id) where is_active;

-- -----------------------------------------------------------------------------
-- ผู้ขาย (FR-MST-005, FR-MST-009)
--
-- soft delete ด้วย deleted_at เพราะเป็นข้อมูลที่ถูกอ้างจากรายการจัดซื้อ
-- ซึ่งเป็นข้อมูลธุรกรรม การลบจริงจะทำให้ประวัติเสียหาย (ข้อ 4.2)
-- -----------------------------------------------------------------------------

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  vendor_code text not null unique,
  name text not null,
  tax_id text,
  branch_no text,
  address jsonb,
  contact_name text,
  phone text,
  email text,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,
  constraint vendors_code_not_blank check (btrim(vendor_code) <> ''),
  constraint vendors_name_not_blank check (btrim(name) <> ''),
  constraint vendors_tax_id_format check (tax_id is null or tax_id ~ '^[0-9]{13}$'),
  constraint vendors_branch_no_format check (branch_no is null or branch_no ~ '^[0-9]{1,5}$'),
  constraint vendors_email_format check (email is null or email = lower(email)),
  constraint vendors_deleted_consistency check (
    (deleted_at is null and deleted_by is null) or deleted_at is not null
  )
);

-- FR-MST-009 — ตรวจผู้ขายซ้ำจากเลขประจำตัวผู้เสียภาษี
--
-- unique เฉพาะแถวที่ยังไม่ถูกลบ เพราะผู้ขายที่ลบไปแล้วไม่ควรกันไม่ให้
-- บันทึกผู้ขายรายเดิมเข้ามาใหม่ได้ และรวมสาขาเข้าไปด้วยเพราะนิติบุคคลเดียวกัน
-- มีได้หลายสาขาที่ใช้เลขผู้เสียภาษีเดียวกัน
create unique index vendors_tax_id_branch_unique
  on public.vendors (tax_id, coalesce(branch_no, '00000'))
  where tax_id is not null and deleted_at is null;

create index vendors_active_idx on public.vendors (is_active) where deleted_at is null;

-- ค้นหาชื่อผู้ขายแบบใกล้เคียง สำหรับเตือนว่าอาจซ้ำ (FR-MST-009)
create extension if not exists "pg_trgm";
create index vendors_name_trgm_idx on public.vendors using gin (name gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- แหล่งเงิน (FR-MST-006)
--
-- แยกจาก projects เพราะโครงการหนึ่งอาจใช้เงินหลายแหล่ง และแหล่งเงินหนึ่ง
-- ใช้ได้หลายโครงการ ส่วนวงเงินที่จัดสรรผูกกับปีงบประมาณเสมอ
-- -----------------------------------------------------------------------------

create table public.funding_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_th text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funding_sources_code_not_blank check (btrim(code) <> ''),
  constraint funding_sources_name_not_blank check (btrim(name_th) <> '')
);

-- -----------------------------------------------------------------------------
-- โครงการ (FR-MST-006)
--
-- วงเงินเป็น numeric(18,2) ตาม ADR 0005 และแปลงเป็น BigInt หน่วยสตางค์
-- ที่ขอบเขต repository เท่านั้น
-- -----------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name_th text not null,
  fiscal_year_id uuid not null references public.fiscal_years (id) on delete restrict,
  department_id uuid references public.departments (id) on delete restrict,
  funding_source_id uuid references public.funding_sources (id) on delete restrict,
  budget_amount numeric(18, 2) not null default 0,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_code_not_blank check (btrim(code) <> ''),
  constraint projects_name_not_blank check (btrim(name_th) <> ''),
  constraint projects_budget_non_negative check (budget_amount >= 0),
  -- รหัสโครงการซ้ำข้ามปีงบประมาณได้ แต่ห้ามซ้ำภายในปีเดียวกัน
  unique (fiscal_year_id, code)
);

create index projects_fiscal_year_idx on public.projects (fiscal_year_id) where is_active;
create index projects_department_idx on public.projects (department_id);
create index projects_funding_source_idx on public.projects (funding_source_id);

-- -----------------------------------------------------------------------------
-- หน่วยนับ (FR-MST-007)
-- -----------------------------------------------------------------------------

create table public.units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_th text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint units_code_not_blank check (btrim(code) <> ''),
  constraint units_name_not_blank check (btrim(name_th) <> '')
);

-- -----------------------------------------------------------------------------
-- ประเภทพัสดุและหมวดครุภัณฑ์ (FR-MST-007)
--
-- ใช้ตารางเดียวที่มี kind แยกวัสดุกับครุภัณฑ์ แทนสองตารางที่โครงสร้างเหมือนกัน
-- เพราะการแบ่งวัสดุ/ครุภัณฑ์เป็นเรื่องเกณฑ์ของโรงเรียนซึ่งยังไม่ได้ข้อสรุป
-- (คำถาม Q5 ใน docs/assumptions.md) การใช้ตารางเดียวทำให้ปรับเกณฑ์ภายหลัง
-- ได้โดยไม่ต้องย้ายข้อมูลข้ามตาราง
-- -----------------------------------------------------------------------------

create type public.item_kind as enum ('SUPPLY', 'ASSET');

create table public.item_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_th text not null,
  kind public.item_kind not null,
  parent_id uuid references public.item_categories (id) on delete restrict,
  default_unit_id uuid references public.units (id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_categories_code_not_blank check (btrim(code) <> ''),
  constraint item_categories_name_not_blank check (btrim(name_th) <> ''),
  constraint item_categories_not_self_parent check (parent_id is distinct from id)
);

create index item_categories_kind_idx on public.item_categories (kind) where is_active;
create index item_categories_parent_idx on public.item_categories (parent_id);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger school_settings_set_updated_at
  before update on public.school_settings
  for each row execute function public.set_updated_at();

create trigger fiscal_years_set_updated_at
  before update on public.fiscal_years
  for each row execute function public.set_updated_at();

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

create trigger vendors_set_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

create trigger funding_sources_set_updated_at
  before update on public.funding_sources
  for each row execute function public.set_updated_at();

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create trigger units_set_updated_at
  before update on public.units
  for each row execute function public.set_updated_at();

create trigger item_categories_set_updated_at
  before update on public.item_categories
  for each row execute function public.set_updated_at();
