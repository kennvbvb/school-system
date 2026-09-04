-- =============================================================================
-- Migration 0005 — Budget ledger แบบ append-only
--
-- ที่มา: ข้อค้นพบ F-01 (โครงการหนึ่งได้งบ 6,000 บาท ใช้ 6,199 บาท คงเหลือ -199)
-- และ F-02 (ใช้เงินข้ามโครงการโดยไม่มีเอกสารโอนงบ)
-- ดู docs/decisions/0008-budget-ledger-and-multi-funding.md
--
-- หลักการ:
--   * ยอดคงเหลือเป็น "ผลรวมของแถว" ไม่ใช่คอลัมน์ที่ update ทับได้
--     คอลัมน์ที่แก้ได้โดยไม่มีร่องรอยคือสาเหตุที่ทำให้ F-01 เกิดขึ้นตั้งแต่แรก
--   * movement เป็น append-only — แก้ผิดด้วย REVERSAL ไม่ใช่ update/delete
--   * จำนวนเงินเป็นบวกเสมอ ทิศทางมาจาก movement_type
--     จำนวนติดลบทำให้ constraint ตรวจยากและคนอ่านรายงานตีความผิดง่าย
--   * การโอนต้องเกิดเป็นคู่ในทรานแซกชันเดียว ผลรวมสุทธิเป็นศูนย์
--   * ห้ามยอดที่ใช้ได้ติดลบ เว้นแต่ผู้มีสิทธิ์ budget.override ระบุเหตุผล
--
-- ตรรกะเดียวกันนี้อยู่ใน src/domain/budget/ ด้วย ฝั่งฐานข้อมูลเป็นชั้นที่บังคับจริง
-- เพราะการเรียก API ตรงต้องถูกปฏิเสธเช่นเดียวกับการกดผ่านหน้าจอ (ข้อ 4.2)
-- =============================================================================

create type public.budget_account_status as enum ('OPEN', 'CLOSED');

create type public.budget_movement_type as enum (
  'ALLOCATION',
  'INCREASE',
  'DECREASE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'RESERVE',
  'RELEASE',
  'COMMIT',
  'ACTUAL',
  'REVERSAL'
);

-- -----------------------------------------------------------------------------
-- บัญชีงบ — หน่วยที่ยอดถูกคุมจริง
--
-- คุมที่ระดับนี้แทนระดับโครงการ เพราะโครงการเดียวที่ได้เงินจากสองแหล่ง
-- ต้องแยกยอดกันได้ มิฉะนั้นการรายงานตามแหล่งเงินจะทำไม่ได้
-- -----------------------------------------------------------------------------

create table public.budget_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  fiscal_year_id uuid not null references public.fiscal_years (id) on delete restrict,
  project_id uuid references public.projects (id) on delete restrict,
  funding_source_id uuid references public.funding_sources (id) on delete restrict,
  department_id uuid references public.departments (id) on delete restrict,
  status public.budget_account_status not null default 'OPEN',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null,
  constraint budget_accounts_code_not_blank check (btrim(code) <> ''),
  constraint budget_accounts_closed_consistency check (
    (status = 'CLOSED' and closed_at is not null)
    or (status = 'OPEN' and closed_at is null)
  ),
  -- บัญชีงบต้องผูกกับอย่างน้อยหนึ่ง scope มิฉะนั้นไม่รู้ว่าคุมยอดของอะไร
  -- และ index ด้านล่างจะยอมให้มีบัญชี "ไร้ scope" ได้เพียงบัญชีเดียวต่อปีอยู่แล้ว
  constraint budget_accounts_scope_required check (
    project_id is not null or funding_source_id is not null or department_id is not null
  ),
  -- รหัสบัญชีงบซ้ำข้ามปีได้ แต่ห้ามซ้ำภายในปีเดียวกัน
  unique (fiscal_year_id, code)
);

-- หนึ่งโครงการต่อหนึ่งแหล่งเงินต่อหนึ่งหน่วยงาน ต้องมีบัญชีงบได้บัญชีเดียว
-- มิฉะนั้นยอดของ scope เดียวกันจะกระจายอยู่หลายบัญชีและรวมยอดผิด
--
-- ใช้ coalesce เพราะ unique index ปกติถือ null ว่าไม่ซ้ำกับ null
-- ซึ่งจะทำให้สร้างบัญชีที่ project_id เป็น null ซ้ำได้ไม่จำกัด
create unique index budget_accounts_scope_unique on public.budget_accounts (
  fiscal_year_id,
  coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(funding_source_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create index budget_accounts_fiscal_year_idx on public.budget_accounts (fiscal_year_id);
create index budget_accounts_project_idx on public.budget_accounts (project_id);

-- -----------------------------------------------------------------------------
-- รายการเคลื่อนไหวงบ — append-only
-- -----------------------------------------------------------------------------

create table public.budget_movements (
  id uuid primary key default gen_random_uuid(),
  budget_account_id uuid not null references public.budget_accounts (id) on delete restrict,
  movement_type public.budget_movement_type not null,
  -- numeric(18,2) ตรงกับหน่วยสตางค์ที่โดเมนใช้ ไม่ใช้ float ในทุกกรณี (ADR 0005)
  amount numeric(18, 2) not null,
  effective_date date not null,
  /* ที่มาของรายการ เช่น 'PROCUREMENT' หรือ 'MANUAL' — ตารางปลายทางยังไม่มีใน PR นี้
     จึงเก็บเป็นคู่ type/id แทน foreign key เพื่อไม่ให้ต้องแก้ schema เมื่อเพิ่มแหล่งที่มา */
  source_type text,
  source_id uuid,
  paired_movement_id uuid references public.budget_movements (id) on delete restrict,
  reverses_movement_id uuid references public.budget_movements (id) on delete restrict,
  releases_movement_id uuid references public.budget_movements (id) on delete restrict,
  reason text,
  approval_reference text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,

  -- จำนวนเป็นบวกเสมอ ทิศทางมาจาก movement_type
  constraint budget_movements_amount_positive check (amount > 0),

  -- การโอนต้องมีคู่ ชนิดอื่นห้ามมี เพื่อไม่ให้ความหมายของคอลัมน์กำกวม
  constraint budget_movements_transfer_pairing check (
    (movement_type in ('TRANSFER_IN', 'TRANSFER_OUT'))
    or paired_movement_id is null
  ),

  -- REVERSAL ต้องระบุแถวที่ย้อน ชนิดอื่นห้ามระบุ
  constraint budget_movements_reversal_target check (
    (movement_type = 'REVERSAL' and reverses_movement_id is not null)
    or (movement_type <> 'REVERSAL' and reverses_movement_id is null)
  ),

  -- RELEASE ต้องระบุการกันยอดที่คืนให้ ชนิดอื่นห้ามระบุ
  constraint budget_movements_release_target check (
    (movement_type = 'RELEASE' and releases_movement_id is not null)
    or (movement_type <> 'RELEASE' and releases_movement_id is null)
  ),

  -- ทุกการปรับที่คนเป็นผู้สั่งต้องมีเหตุผล เพราะเป็นสิ่งที่ผู้ตรวจสอบต้องอ่านย้อนหลัง
  constraint budget_movements_reason_required check (
    movement_type not in ('INCREASE', 'DECREASE', 'TRANSFER_IN', 'TRANSFER_OUT', 'REVERSAL')
    or btrim(coalesce(reason, '')) <> ''
  )
);

create index budget_movements_account_idx
  on public.budget_movements (budget_account_id, effective_date);
create index budget_movements_source_idx on public.budget_movements (source_type, source_id);
create index budget_movements_reverses_idx on public.budget_movements (reverses_movement_id);
create index budget_movements_releases_idx on public.budget_movements (releases_movement_id);

-- ย้อนรายการเดิมได้ครั้งเดียว การย้อนซ้ำทำให้ยอดคลาดเคลื่อนโดยไม่มีใครสังเกต
create unique index budget_movements_single_reversal
  on public.budget_movements (reverses_movement_id)
  where reverses_movement_id is not null;

-- -----------------------------------------------------------------------------
-- ยอดคงเหลือ — คำนวณจากแถว ไม่เก็บเป็นคอลัมน์
--
-- แยกเป็น view เพื่อให้ทั้ง query ของแอปและ function ตรวจยอดใช้นิยามเดียวกัน
-- ถ้าปล่อยให้แต่ละที่เขียน sum เอง นิยามจะแตกกันเมื่อเพิ่มชนิดรายการใหม่
-- -----------------------------------------------------------------------------

create view public.budget_account_balances as
with effective as (
  select
    m.budget_account_id,
    -- REVERSAL ใช้ชนิดของแถวที่มันย้อน แล้วกลับทิศทีหลัง
    coalesce(target.movement_type, m.movement_type) as effective_type,
    case when m.movement_type = 'REVERSAL' then -1 else 1 end as sign_flip,
    m.amount
  from public.budget_movements m
  left join public.budget_movements target on target.id = m.reverses_movement_id
)
select
  a.id as budget_account_id,
  coalesce(sum(
    case
      when e.effective_type in ('ALLOCATION', 'INCREASE', 'TRANSFER_IN') then e.amount * e.sign_flip
      when e.effective_type in ('DECREASE', 'TRANSFER_OUT') then -e.amount * e.sign_flip
      else 0
    end
  ), 0)::numeric(18, 2) as granted_amount,
  coalesce(sum(
    case
      when e.effective_type = 'RESERVE' then e.amount * e.sign_flip
      when e.effective_type = 'RELEASE' then -e.amount * e.sign_flip
      else 0
    end
  ), 0)::numeric(18, 2) as reserved_amount,
  coalesce(sum(
    case when e.effective_type in ('COMMIT', 'ACTUAL') then e.amount * e.sign_flip else 0 end
  ), 0)::numeric(18, 2) as used_amount,
  coalesce(sum(
    case
      when e.effective_type in ('ALLOCATION', 'INCREASE', 'TRANSFER_IN') then e.amount * e.sign_flip
      when e.effective_type in ('DECREASE', 'TRANSFER_OUT', 'RESERVE', 'COMMIT', 'ACTUAL')
        then -e.amount * e.sign_flip
      when e.effective_type = 'RELEASE' then e.amount * e.sign_flip
      else 0
    end
  ), 0)::numeric(18, 2) as available_amount
from public.budget_accounts a
left join effective e on e.budget_account_id = a.id
group by a.id;

comment on view public.budget_account_balances is
  'ยอดงบที่คำนวณจาก ledger — นิยามเดียวกับ src/domain/budget/availability.ts';

-- -----------------------------------------------------------------------------
-- projects.budget_amount เปลี่ยนความหมาย
--
-- จาก "วงเงินโครงการ" เป็น "วงเงินตั้งต้นที่ใช้สร้าง movement แรกเท่านั้น"
-- ไม่ถอดคอลัมน์ใน migration นี้ตามแผนใน ADR 0008 เพราะการถอดพร้อมกับ
-- สร้างตารางใหม่ทำให้ rollback กลับไม่ได้โดยไม่เสียข้อมูล
-- -----------------------------------------------------------------------------

comment on column public.projects.budget_amount is
  'วงเงินตั้งต้นเท่านั้น ไม่ใช่ยอดคงเหลือ — ยอดจริงอยู่ที่ budget_account_balances (ADR 0008)';
