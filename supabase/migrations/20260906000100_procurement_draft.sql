-- =============================================================================
-- Migration 0007 — รายการจัดซื้อจัดจ้าง (Draft) และรายการย่อย
--
-- ขอบเขต PR-02 ตาม docs/CONTINUATION_PLAN.md ข้อ 8
-- ครอบคลุมข้อค้นพบ F-02 (แหล่งเงินหลายบรรทัด), F-16 (ทุกรายการต้องมีเลขลำดับ)
-- และ F-17 (แยกผู้ขาย เลขเอกสาร วันที่ และคำอธิบายออกจากกัน)
--
-- หลักการที่ต่างจากของเดิม:
--   * ยอดเงินไม่ได้เก็บเป็นคอลัมน์ แต่คำนวณจากรายการย่อยผ่าน view
--     ผู้ใช้จึงส่งยอดรวมเข้ามาเองไม่ได้เลย ไม่ใช่แค่ "ไม่ควรส่ง"
--   * version สำหรับ optimistic concurrency เพิ่มด้วย trigger ไม่ใช่ให้ client ส่งมา
--   * เลขเอกสารทางการยังไม่มีใน PR นี้ (อยู่ใน PR-04)
--     reference เป็นเลขอ้างอิงภายในสำหรับค้นหาเท่านั้น
-- =============================================================================

create type public.procurement_status as enum (
  'DRAFT',
  'PENDING_REVIEW',
  'NEEDS_REVISION',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'ISSUED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED'
);

create type public.tax_mode as enum ('INCLUSIVE', 'EXCLUSIVE', 'EXEMPT');

-- -----------------------------------------------------------------------------
-- เลขอ้างอิงภายใน
--
-- ข้อค้นพบ F-16 พบว่า 8 sheet มีรายการใช้จ่ายแต่ไม่มีเลขลำดับเลย ทำให้อ้างอิงยาก
-- เลขนี้ระบบสร้างเองเสมอ ห้ามว่างและห้ามซ้ำ
--
-- **ไม่ใช่เลขที่เอกสารทางราชการ** ซึ่งจะจองใน PR-04 ด้วยกติกาคนละชุด
-- (นับต่อปีงบ ต่อประเภท และเลขที่ยกเลิกห้ามนำกลับมาใช้)
-- ใช้ sequence เดียวทั้งระบบเพราะเป็นเพียงตัวจับต้องสำหรับค้นหา
-- ไม่มีความหมายทางราชการที่ต้องรีเซ็ตรายปี
-- -----------------------------------------------------------------------------

create sequence public.procurement_reference_seq;

create table public.procurements (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique
    default 'D-' || lpad(nextval('public.procurement_reference_seq')::text, 6, '0'),
  subject text not null,
  purpose text,
  status public.procurement_status not null default 'DRAFT',
  tax_mode public.tax_mode not null default 'EXEMPT',

  fiscal_year_id uuid not null references public.fiscal_years (id) on delete restrict,
  department_id uuid references public.departments (id) on delete restrict,
  vendor_id uuid references public.vendors (id) on delete restrict,

  /* วันที่ในขั้น draft เก็บเท่าที่จำเป็นต่อการร่าง
     ชุดวันที่เต็มและกฎลำดับเวลา (F-03, F-04) อยู่ใน PR-03 */
  request_date date not null,
  required_date date,

  note text,

  /* optimistic concurrency — trigger เป็นผู้เพิ่มค่า client ส่งมาเองไม่ได้
     ดู docs/architecture.md */
  version integer not null default 1,

  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,

  /* soft delete เท่านั้น (ข้อ 4.2) */
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,

  constraint procurements_subject_not_blank check (btrim(subject) <> ''),
  constraint procurements_reference_not_blank check (btrim(reference) <> ''),
  constraint procurements_required_after_request check (
    required_date is null or required_date >= request_date
  ),
  constraint procurements_deleted_consistency check (
    (deleted_at is null and deleted_by is null)
    or (deleted_at is not null)
  )
);

create index procurements_status_idx on public.procurements (status)
  where deleted_at is null;
create index procurements_owner_idx on public.procurements (created_by)
  where deleted_at is null;
create index procurements_fiscal_year_idx on public.procurements (fiscal_year_id);
create index procurements_vendor_idx on public.procurements (vendor_id);
-- ค้นหาด้วยชื่อเรื่องภาษาไทย ใช้ trigram เหมือน vendors
create index procurements_subject_trgm_idx on public.procurements
  using gin (subject public.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- รายการย่อย
--
-- ความละเอียดของ numeric ตรงกับ scale ในโดเมน (src/domain/money/money.ts):
--   quantity และ unit_price ทศนิยม 4 ตำแหน่ง · เงินและส่วนลด 2 ตำแหน่ง
--   อัตราภาษี 4 ตำแหน่ง
-- ถ้าสองฝั่งไม่ตรงกัน การปัดเศษจะต่างกันโดยไม่มีใครสังเกต
-- -----------------------------------------------------------------------------

create table public.procurement_items (
  id uuid primary key default gen_random_uuid(),
  procurement_id uuid not null references public.procurements (id) on delete cascade,
  line_no integer not null,
  description text not null,
  quantity numeric(18, 4) not null,
  unit_id uuid references public.units (id) on delete restrict,
  unit_price numeric(18, 4) not null,
  discount_amount numeric(18, 2) not null default 0,
  tax_rate numeric(9, 4) not null default 0,
  item_category_id uuid references public.item_categories (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint procurement_items_description_not_blank check (btrim(description) <> ''),
  constraint procurement_items_line_no_positive check (line_no > 0),
  constraint procurement_items_quantity_positive check (quantity > 0),
  constraint procurement_items_unit_price_non_negative check (unit_price >= 0),
  constraint procurement_items_discount_non_negative check (discount_amount >= 0),
  constraint procurement_items_tax_rate_range check (tax_rate >= 0 and tax_rate <= 100),
  -- ส่วนลดเกินมูลค่าบรรทัดทำให้ยอดติดลบ ซึ่งไม่มีความหมายทางบัญชี
  constraint procurement_items_discount_within_line check (
    discount_amount <= round(quantity * unit_price, 2)
  ),

  unique (procurement_id, line_no)
);

create index procurement_items_procurement_idx
  on public.procurement_items (procurement_id, line_no);

-- -----------------------------------------------------------------------------
-- แหล่งเงินหลายบรรทัดต่อหนึ่งรายการ (ข้อค้นพบ F-02)
--
-- แผนเดิมให้หนึ่งรายการผูกโครงการเดียว แต่ไฟล์จริงมีการยืม/ใช้เงินข้ามโครงการ
-- ความจริงจึงถูกบันทึกไว้ในช่องคำอธิบายซึ่งรายงานสรุปยอดอ่านไม่ได้
--
-- ผลรวมต้องเท่ากับยอดรวมของรายการก่อน submit — บังคับใน PR-03 ตอน submit
-- ไม่ใช่ที่นี่ เพราะ draft ต้องบันทึกค้างไว้ได้ (ข้อ 7.2 ของแผน)
-- -----------------------------------------------------------------------------

create table public.procurement_funding_allocations (
  id uuid primary key default gen_random_uuid(),
  procurement_id uuid not null references public.procurements (id) on delete cascade,
  budget_account_id uuid not null references public.budget_accounts (id) on delete restrict,
  line_no integer not null,
  amount numeric(18, 2) not null,
  note text,
  created_at timestamptz not null default now(),

  constraint procurement_funding_line_no_positive check (line_no > 0),
  constraint procurement_funding_amount_positive check (amount > 0),

  unique (procurement_id, line_no),
  -- บัญชีงบเดียวกันซ้ำสองบรรทัดในรายการเดียวไม่มีความหมาย ให้รวมเป็นบรรทัดเดียว
  unique (procurement_id, budget_account_id)
);

create index procurement_funding_account_idx
  on public.procurement_funding_allocations (budget_account_id);

-- -----------------------------------------------------------------------------
-- ไฟล์แนบ
--
-- ผูกด้วย entity_type/entity_id แทน foreign key ตรง เพราะการตรวจรับ
-- และคำขอใช้เงินจะต้องแนบไฟล์ด้วยเช่นกัน การทำตารางแยกต่อชนิด
-- จะได้ตารางที่โครงสร้างเหมือนกันหลายตาราง
--
-- เก็บเฉพาะ "ที่อยู่ของไฟล์" ไม่เก็บตัวไฟล์ ไฟล์จริงอยู่ใน Supabase Storage
-- แบบ private และเข้าถึงผ่าน signed URL อายุสั้นเท่านั้น (ข้อ 14.3)
-- -----------------------------------------------------------------------------

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  storage_path text not null unique,
  /* ชื่อไฟล์ที่ผู้ใช้เห็น — ชื่อใน storage ถูกเปลี่ยนเป็นค่าสุ่มเสมอ
     เพื่อไม่ให้ชื่อไฟล์เดิมเปิดเผยข้อมูลหรือชนกัน (ข้อ 14.3) */
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  checksum_sha256 text,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,

  constraint attachments_entity_type_not_blank check (btrim(entity_type) <> ''),
  constraint attachments_file_name_not_blank check (btrim(file_name) <> ''),
  constraint attachments_size_positive check (size_bytes > 0)
);

create index attachments_entity_idx on public.attachments (entity_type, entity_id)
  where deleted_at is null;

-- -----------------------------------------------------------------------------
-- ยอดเงิน — คำนวณจากรายการย่อย ไม่เก็บเป็นคอลัมน์
--
-- เหตุผลเดียวกับ budget_account_balances: ยอดที่เก็บเป็นคอลัมน์แก้ได้
-- โดยไม่มีร่องรอย และเปิดช่องให้ client ส่งยอดรวมเข้ามาเอง
--
-- กติกาการคำนวณต้องตรงกับ src/domain/money/calculation.ts ทุกกรณี:
--   base        = quantity * unit_price ปัดที่สตางค์
--   discount    = ส่วนลดของบรรทัด (ปรับเป็นฐานไม่รวมภาษีเมื่อ INCLUSIVE)
--   subtotal    = base - discount
--   tax         = ขึ้นกับ tax_mode
--   line_total  = subtotal + tax
--
-- round() ของ PostgreSQL ปัดครึ่งออกจากศูนย์ ตรงกับ divideRoundHalfUp ในโดเมน
-- มี SQL test เทียบยอดกับค่าที่โดเมนคำนวณ เพื่อจับกรณีที่สองฝั่งเริ่มต่างกัน
-- -----------------------------------------------------------------------------

create view public.procurement_item_amounts as
select
  i.id,
  i.procurement_id,
  i.line_no,
  amounts.base,
  amounts.discount,
  amounts.line_subtotal,
  amounts.line_tax,
  amounts.line_subtotal + amounts.line_tax as line_total
from public.procurement_items i
join public.procurements p on p.id = i.procurement_id
cross join lateral (
  select
    case
      when p.tax_mode = 'INCLUSIVE'
        -- ราคารวมภาษีแล้ว ต้องถอดภาษีออกก่อนจึงได้ฐาน
        then round(round(i.quantity * i.unit_price, 2) / (1 + i.tax_rate / 100), 2)
      else round(i.quantity * i.unit_price, 2)
    end as base_amount,
    case
      when p.tax_mode = 'INCLUSIVE'
        then round(i.discount_amount / (1 + i.tax_rate / 100), 2)
      else i.discount_amount
    end as discount_amount
) as adjusted
cross join lateral (
  select
    adjusted.base_amount as base,
    adjusted.discount_amount as discount,
    adjusted.base_amount - adjusted.discount_amount as line_subtotal,
    case
      when p.tax_mode = 'EXEMPT' then 0::numeric(18, 2)
      else round((adjusted.base_amount - adjusted.discount_amount) * i.tax_rate / 100, 2)
    end as line_tax
) as amounts;

create view public.procurement_totals as
select
  p.id as procurement_id,
  coalesce(sum(a.line_subtotal + a.discount), 0)::numeric(18, 2) as subtotal,
  coalesce(sum(a.discount), 0)::numeric(18, 2) as discount_total,
  coalesce(sum(a.line_tax), 0)::numeric(18, 2) as tax_total,
  coalesce(sum(a.line_total), 0)::numeric(18, 2) as grand_total,
  coalesce(
    (select sum(f.amount) from public.procurement_funding_allocations f
     where f.procurement_id = p.id), 0
  )::numeric(18, 2) as funding_total
from public.procurements p
left join public.procurement_item_amounts a on a.procurement_id = p.id
group by p.id;

comment on view public.procurement_totals is
  'ยอดของรายการจัดซื้อ คำนวณจากรายการย่อย — นิยามเดียวกับ src/domain/money/calculation.ts';
