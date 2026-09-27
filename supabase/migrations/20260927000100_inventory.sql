-- =============================================================================
-- Migration 0021 — คลังพัสดุ: รายการพัสดุและ ledger การเคลื่อนไหวแบบ append-only
--
-- ที่มา: docs/CONTINUATION_PLAN.md ข้อ 6.8 (Inventory) และ PR-07 ในลำดับ PR
--
-- หลักการ (เดียวกับ budget ledger ใน migration 0005 — ดู docs/decisions/0008):
--   * รายการเคลื่อนไหวเป็น append-only แก้ผิดด้วย REVERSAL ไม่ใช่ update/delete
--   * จำนวนเป็นบวกเสมอ ทิศทางมาจาก movement_type
--   * ห้ามยอดคงเหลือติดลบ — ต่างจากงบประมาณตรงนี้ไม่มีสิทธิ์ override เลย
--     เพราะยอดของจริงติดลบไม่ได้ทางกายภาพ (ของที่ไม่มีอยู่เบิกออกไปไม่ได้จริง)
--     ไม่ใช่ข้อจำกัดเชิงนโยบายที่ผู้มีอำนาจอนุมัติข้ามได้แบบยอดงบ
--   * จำนวน (quantity) เป็น numeric เสมอ ห้าม float (ตาม ADR 0005 ที่ใช้กับเงิน
--     ขยายหลักการเดียวกันมาใช้กับจำนวนนับ)
--
-- ความต่างจาก budget ledger ที่ตั้งใจ:
--   * `balance_after` เป็นคอลัมน์ที่คำนวณและบันทึกในทรานแซกชันเดียวกับแถว
--     (denormalized) ไม่ใช่ view ที่ sum ทุกครั้ง ตามที่ข้อ 6.8 ระบุไว้ชัดเจน
--     เหตุผล: ledger ของพัสดุมีแนวโน้มยาวและอ่านบ่อย (หน้ารายการพัสดุต้องแสดง
--     ยอดคงเหลือของทุกรายการพร้อมกัน) การอ่าน "แถวล่าสุด" เร็วกว่า sum ทั้งชุด
--   * ไม่ผูกกับปีงบประมาณ — ของจริงที่มีอยู่ยังอยู่ต่อเนื่องข้ามปี ต่างจากงบ
--     ที่ปิดปีแล้วเริ่มยอดใหม่ (ข้อค้นพบ "opening balance และปีงบประมาณแยกชัด"
--     ในข้อ 6.8 หมายถึงต้องแยกวันที่ตั้งต้นให้ชัด ไม่ใช่ผูกสต็อกกับปีงบ)
--
-- ตรรกะเดียวกันนี้อยู่ใน src/domain/inventory/ ด้วย ฝั่งฐานข้อมูลเป็นชั้นที่บังคับจริง
-- =============================================================================

create type public.inventory_item_status as enum ('ACTIVE', 'INACTIVE');

create type public.stock_movement_type as enum (
  'OPENING_BALANCE',
  'RECEIPT',
  'ISSUE',
  'RETURN',
  'ADJUSTMENT_INCREASE',
  'ADJUSTMENT_DECREASE',
  'REVERSAL'
);

-- -----------------------------------------------------------------------------
-- รายการพัสดุ — บัตรบัญชีพัสดุหนึ่งใบต่อหนึ่งชนิดของ
-- -----------------------------------------------------------------------------

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_th text not null,
  item_category_id uuid references public.item_categories (id) on delete restrict,
  unit_id uuid not null references public.units (id) on delete restrict,
  location_id uuid references public.locations (id) on delete restrict,
  -- จุดสั่งซื้อซ้ำ — ใช้เตือนเมื่อยอดต่ำกว่าค่านี้ ยังไม่ผูกกับ workflow จัดซื้ออัตโนมัติ
  minimum_quantity numeric(18, 3) not null default 0,
  status public.inventory_item_status not null default 'ACTIVE',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  constraint inventory_items_code_not_blank check (btrim(code) <> ''),
  constraint inventory_items_name_not_blank check (btrim(name_th) <> ''),
  constraint inventory_items_minimum_non_negative check (minimum_quantity >= 0)
);

create index inventory_items_category_idx on public.inventory_items (item_category_id);
create index inventory_items_status_idx on public.inventory_items (status);

create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- รายการเคลื่อนไหวคลังพัสดุ — append-only
-- -----------------------------------------------------------------------------

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  movement_type public.stock_movement_type not null,
  -- numeric(18,3) — ทศนิยม 3 ตำแหน่งพอสำหรับหน่วยนับที่พบจริง (ชิ้น/กล่อง/กิโลกรัม/ลิตร)
  quantity numeric(18, 3) not null,
  -- ยอดคงเหลือหลังแถวนี้ — คำนวณและบันทึกโดย stock_post_movement() ในทรานแซกชันเดียวกัน
  -- ไม่ใช่ generated column เพราะขึ้นกับแถวก่อนหน้าซึ่งไม่ immutable ต่อแถว
  balance_after numeric(18, 3) not null,
  effective_date date not null,
  -- เลขที่เอกสารอ้างอิง (ใบรับ/ใบเบิก/บันทึกปรับยอด) — บังคับทุกแถวตามข้อ 6.8
  -- "movement ทุกแถวมี source reference" ไม่ปล่อยว่างแล้วอ้างว่า "ไม่มีเอกสาร"
  reference text not null,
  reason text,
  -- ที่มาของรายการ เช่น 'PROCUREMENT' — เก็บเป็นคู่ type/id แทน foreign key
  -- ตรงตามแบบของ budget_movements เพราะยังไม่มีตารางใบตรวจรับ/ใบเบิกจริงใน PR นี้
  -- (ดูหมายเหตุใน docs/assumptions.md เรื่องการเชื่อมกับใบตรวจรับที่ยังไม่ทำ)
  source_type text,
  source_id uuid,
  -- ผู้เบิก — บังคับเมื่อ ISSUE เท่านั้น (constraint ด้านล่าง)
  requested_by uuid references public.profiles (id) on delete set null,
  -- ผู้อนุมัติ — บังคับเมื่อ ISSUE หรือ ADJUSTMENT_* เท่านั้น
  approved_by uuid references public.profiles (id) on delete set null,
  -- หลักฐานแนบ (ภาพถ่าย/เอกสารนับสต็อก) — เผื่อไว้ให้ผูกได้ ยังไม่บังคับที่ชั้นนี้
  -- เพราะการอัปโหลดไฟล์ก่อนมี movement id ต้องมี flow แยกที่ยังไม่ได้ทำใน PR นี้
  attachment_id uuid references public.attachments (id) on delete set null,
  reverses_movement_id uuid references public.stock_movements (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,

  constraint stock_movements_quantity_positive check (quantity > 0),
  constraint stock_movements_balance_not_negative check (balance_after >= 0),
  constraint stock_movements_reference_not_blank check (btrim(reference) <> ''),

  -- REVERSAL ต้องระบุแถวที่ย้อน ชนิดอื่นห้ามระบุ
  constraint stock_movements_reversal_target check (
    (movement_type = 'REVERSAL' and reverses_movement_id is not null)
    or (movement_type <> 'REVERSAL' and reverses_movement_id is null)
  ),

  -- เบิกจ่ายต้องระบุทั้งผู้เบิกและผู้อนุมัติ มิฉะนั้นตรวจสอบย้อนหลังไม่ได้ว่าใครขอ/ใครไฟเขียว
  constraint stock_movements_issue_requires_actors check (
    movement_type <> 'ISSUE' or (requested_by is not null and approved_by is not null)
  ),

  -- ปรับยอดต้องมีทั้งเหตุผลและผู้อนุมัติเสมอ เพราะเป็นการแก้ยอดที่ไม่มีเอกสารซื้อ/เบิกรองรับ
  constraint stock_movements_adjustment_requires_reason check (
    movement_type not in ('ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE')
    or (btrim(coalesce(reason, '')) <> '' and approved_by is not null)
  )
);

create index stock_movements_item_idx
  on public.stock_movements (item_id, created_at, id);
create index stock_movements_source_idx on public.stock_movements (source_type, source_id);
create index stock_movements_reverses_idx on public.stock_movements (reverses_movement_id);

-- ย้อนรายการเดิมได้ครั้งเดียว การย้อนซ้ำทำให้ยอดคลาดเคลื่อนโดยไม่มีใครสังเกต
create unique index stock_movements_single_reversal
  on public.stock_movements (reverses_movement_id)
  where reverses_movement_id is not null;

-- -----------------------------------------------------------------------------
-- ยอดคงเหลือปัจจุบันของแต่ละรายการ — อ่านจากแถวล่าสุด ไม่ sum ทั้งชุด
--
-- ใช้ distinct on ลำดับตาม (created_at, id) เดียวกับที่ stock_post_movement()
-- ใช้หาแถวล่าสุดก่อนคำนวณยอดใหม่ ต้องเป็นลำดับเดียวกันเสมอมิฉะนั้นยอดจะไม่ตรงกัน
-- -----------------------------------------------------------------------------

create view public.stock_item_balances as
select distinct on (item_id)
  item_id,
  balance_after as on_hand,
  effective_date as as_of_date,
  created_at as as_of
from public.stock_movements
order by item_id, created_at desc, id desc;

comment on view public.stock_item_balances is
  'ยอดคงเหลือล่าสุดต่อรายการพัสดุ — อ่านจากแถวสุดท้ายของ ledger ไม่ sum ทั้งชุด';
