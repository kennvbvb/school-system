-- =============================================================================
-- ประวัติการดำเนินการตามสายอนุมัติ (FR-APR-005, แผนข้อ 5.1)
--
-- Q2 ได้คำตอบแล้วว่า **สายอนุมัติคงเดิมตลอด** ไม่เปลี่ยนตามวงเงินหรือประเภทงาน
-- จึงไม่สร้างตาราง approval definitions แบบ effective-dated ตามที่แผนเดิมวางไว้ —
-- สายอนุมัติคือ state machine ใน src/domain/procurement/status.ts กับสิทธิ์ที่มีอยู่
-- การสร้างระบบตั้งค่าให้สิ่งที่ไม่เคยเปลี่ยนคือความซับซ้อนที่ไม่มีคนใช้แต่ต้องดูแลตลอดไป
--
-- ข้อกำหนด "เปลี่ยนตำแหน่งภายหลังไม่เปลี่ยน approval history" ยังจำเป็นอยู่
-- และไม่เกี่ยวกับความคงที่ของสาย จึงเป็นเหตุผลหลักที่ตารางนี้มีอยู่
-- =============================================================================

-- -----------------------------------------------------------------------------
-- procurement_approvals — append-only
--
-- **คัดลอกชื่อ บทบาท และตำแหน่งของผู้ทำรายการมาเก็บไว้ ไม่ join กลับไป profiles**
--
-- ถ้าแสดงผลด้วยการ join ประวัติเมื่อปีที่แล้วจะเปลี่ยนไปตามตำแหน่งปัจจุบันของคนคนนั้น
-- ครูที่ย้ายไปเป็นรองผู้อำนวยการจะกลายเป็นว่า "รองผู้อำนวยการอนุมัติ" ทั้งที่ตอนนั้น
-- ยังเป็นครู ซึ่งทำให้เอกสารย้อนหลังผิดและตรวจสอบไม่ได้
--
-- ราคาที่จ่ายคือข้อมูลซ้ำ แต่เป็นความซ้ำที่ตั้งใจ — ค่าเหล่านี้เป็นข้อเท็จจริง
-- ณ เวลาที่กด ไม่ใช่ข้อมูลปัจจุบันของบุคคล
-- -----------------------------------------------------------------------------

create table public.procurement_approvals (
  id uuid primary key default gen_random_uuid(),
  procurement_id uuid not null references public.procurements (id) on delete restrict,

  -- ลำดับที่เท่าไรของรายการนี้ ใช้เรียงและกันการเขียนแทรกย้อนหลัง
  step_no integer not null,

  action text not null,
  from_status public.procurement_status not null,
  to_status public.procurement_status not null,

  actor_id uuid not null references public.profiles (id) on delete restrict,
  -- สำเนา ณ เวลาที่กด (ดูหมายเหตุด้านบน)
  actor_name_th text not null,
  actor_role_code text not null,
  actor_position_th text,

  reason text,
  acted_at timestamptz not null default now(),

  constraint procurement_approvals_step_positive check (step_no >= 1),
  constraint procurement_approvals_action_not_blank check (btrim(action) <> ''),
  constraint procurement_approvals_actor_name_not_blank check (btrim(actor_name_th) <> ''),
  constraint procurement_approvals_status_changes check (from_status <> to_status),
  -- เหตุผลที่มีต้องไม่ใช่ช่องว่างล้วน มิฉะนั้นการบังคับ "ต้องมีเหตุผล" จะเลี่ยงได้ด้วยเคาะวรรค
  constraint procurement_approvals_reason_not_blank check (reason is null or btrim(reason) <> ''),

  unique (procurement_id, step_no)
);

create index procurement_approvals_procurement_idx
  on public.procurement_approvals (procurement_id, step_no);

create index procurement_approvals_actor_idx
  on public.procurement_approvals (actor_id, acted_at desc);

comment on table public.procurement_approvals is
  'ประวัติการดำเนินการตามสายอนุมัติ แบบ append-only — ชื่อ บทบาท และตำแหน่งเป็นสำเนา ณ เวลาที่กด';

comment on column public.procurement_approvals.actor_role_code is
  'บทบาทที่ใช้ดำเนินการ ณ เวลานั้น — ไม่ใช่บทบาทปัจจุบันของผู้ใช้';

-- -----------------------------------------------------------------------------
-- RLS
--
-- อ่านได้เท่าที่อ่านรายการต้นทางได้ ใช้ can_read_procurement() ตัวเดียวกับ
-- ตารางลูกอื่น ๆ เพื่อไม่ให้มีสองนิยามของคำว่า "เห็นรายการนี้ได้"
--
-- **ไม่มี policy สำหรับ insert/update/delete เลย** — เขียนได้ทางเดียวคือผ่าน
-- procurement_transition() ซึ่งเป็น security definer การเปิดช่องให้เขียนตรง
-- จะทำให้ปลอมประวัติการอนุมัติได้ ซึ่งเป็นสิ่งเดียวที่ตารางนี้มีไว้ป้องกัน
-- -----------------------------------------------------------------------------

alter table public.procurement_approvals enable row level security;

create policy procurement_approvals_select on public.procurement_approvals
  for select to authenticated
  using (public.can_read_procurement(procurement_id));

revoke insert, update, delete on public.procurement_approvals from authenticated;
