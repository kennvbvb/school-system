-- =============================================================================
-- Migration 0008 — RLS, optimistic concurrency และการจำกัดการแก้ไขตามสถานะ
--
-- หลักการเดียวกับ migration 0002/0004/0006 (ADR 0004):
-- ปฏิเสธก่อน สิทธิ์ที่ไม่ได้ประกาศคือไม่มีสิทธิ์
--
-- สิ่งที่ migration นี้บังคับและหน้าจอบังคับแทนไม่ได้:
--   * ผู้ที่มีเพียง procurement.read.own เห็นเฉพาะรายการที่ตนสร้าง
--   * แก้ไขได้เฉพาะสถานะ DRAFT และ NEEDS_REVISION
--   * version เพิ่มโดย trigger — client ส่งค่าเองไม่ได้
--   * ยอดเงินไม่มีคอลัมน์ให้เขียน จึงส่งยอดรวมเข้ามาไม่ได้เลย
-- =============================================================================

alter table public.procurements enable row level security;
alter table public.procurement_items enable row level security;
alter table public.procurement_funding_allocations enable row level security;
alter table public.attachments enable row level security;

-- -----------------------------------------------------------------------------
-- ตัวช่วย
-- -----------------------------------------------------------------------------

/* มองเห็นรายการนี้ไหม — read.all เห็นทุกรายการ ส่วน read.own เห็นเฉพาะของตน
   ผู้สร้างเห็นรายการของตนเสมอ แม้ภายหลังจะถูกถอนสิทธิ์ read.all ออก */
create or replace function public.can_read_procurement(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.procurements p
    where p.id = p_id
      and (
        public.has_permission('procurement.read.all')
        or (public.has_permission('procurement.read.own') and p.created_by = auth.uid())
      )
  );
$$;

/* แก้ไขได้ไหม — ต้องมีสิทธิ์ อยู่ในสถานะที่แก้ได้ และยังไม่ถูกลบ
   ตรวจสถานะก่อนสิทธิ์ไม่ได้ที่นี่เพราะเป็น boolean เดียว
   ข้อความอธิบายสาเหตุอยู่ที่ชั้น domain service (src/server/procurement) */
create or replace function public.can_edit_procurement(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.procurements p
    where p.id = p_id
      and p.deleted_at is null
      and p.status in ('DRAFT', 'NEEDS_REVISION')
      and public.has_permission('procurement.edit_draft')
      and (
        public.has_permission('procurement.read.all')
        or p.created_by = auth.uid()
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- procurements
-- -----------------------------------------------------------------------------

create policy procurements_select on public.procurements
  for select to authenticated
  using (
    public.current_profile_is_active()
    and (
      public.has_permission('procurement.read.all')
      or (public.has_permission('procurement.read.own') and created_by = auth.uid())
    )
  );

/* ผู้สร้างต้องเป็นตัวเอง — กันการสร้างรายการในนามคนอื่น
   สถานะเริ่มต้นต้องเป็น DRAFT เสมอ ไม่ให้สร้างรายการที่อนุมัติแล้วมาตรง ๆ */
create policy procurements_insert on public.procurements
  for insert to authenticated
  with check (
    public.has_permission('procurement.create')
    and created_by = auth.uid()
    and status = 'DRAFT'
    and deleted_at is null
  );

create policy procurements_update on public.procurements
  for update to authenticated
  using (
    deleted_at is null
    and status in ('DRAFT', 'NEEDS_REVISION')
    and public.has_permission('procurement.edit_draft')
    and (public.has_permission('procurement.read.all') or created_by = auth.uid())
  )
  with check (
    -- ห้ามเปลี่ยนสถานะผ่านการแก้ไขธรรมดา การเปลี่ยนสถานะทำผ่าน workflow (PR-04)
    status in ('DRAFT', 'NEEDS_REVISION')
  );

-- ไม่มี policy delete — ใช้ deleted_at แทน (ข้อ 4.2)
revoke delete on public.procurements from authenticated, anon;

-- -----------------------------------------------------------------------------
-- รายการย่อยและแหล่งเงิน — สิทธิ์ผูกกับรายการแม่ทั้งหมด
-- -----------------------------------------------------------------------------

create policy procurement_items_select on public.procurement_items
  for select to authenticated
  using (public.can_read_procurement(procurement_id));

create policy procurement_items_write on public.procurement_items
  for all to authenticated
  using (public.can_edit_procurement(procurement_id))
  with check (public.can_edit_procurement(procurement_id));

create policy procurement_funding_select on public.procurement_funding_allocations
  for select to authenticated
  using (public.can_read_procurement(procurement_id));

create policy procurement_funding_write on public.procurement_funding_allocations
  for all to authenticated
  using (public.can_edit_procurement(procurement_id))
  with check (public.can_edit_procurement(procurement_id));

-- -----------------------------------------------------------------------------
-- ไฟล์แนบ
--
-- อ่านได้เมื่ออ่านรายการแม่ได้ แนบได้เมื่อแก้รายการแม่ได้
-- ลบจริงไม่ได้ ใช้ deleted_at เพราะไฟล์ที่เคยแนบเป็นหลักฐานประกอบเอกสาร
-- -----------------------------------------------------------------------------

create policy attachments_select on public.attachments
  for select to authenticated
  using (
    deleted_at is null
    and entity_type = 'procurement'
    and public.can_read_procurement(entity_id)
  );

create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (
    entity_type = 'procurement'
    and public.can_edit_procurement(entity_id)
    and uploaded_by = auth.uid()
  );

create policy attachments_update on public.attachments
  for update to authenticated
  using (entity_type = 'procurement' and public.can_edit_procurement(entity_id))
  with check (entity_type = 'procurement');

revoke delete on public.attachments from authenticated, anon;

-- -----------------------------------------------------------------------------
-- Optimistic concurrency
--
-- version เพิ่มโดย trigger ไม่ใช่โดย client
--
-- วิธีใช้: client อ่าน version มา แล้ว update ... where id = ? and version = ?
-- ถ้าได้ 0 แถว แปลว่ามีคนอื่นแก้ไปแล้ว ต้องบอกผู้ใช้ให้โหลดใหม่
-- ไม่ใช่เขียนทับเงียบ ๆ ซึ่งจะทำให้งานของอีกคนหายไปโดยไม่มีใครรู้
--
-- trigger เขียนทับค่าที่ client ส่งมาเสมอ จึงปลอมค่าไม่ได้
-- -----------------------------------------------------------------------------

create or replace function public.procurements_bump_version()
returns trigger
language plpgsql
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger procurements_version_bump
  before update on public.procurements
  for each row execute function public.procurements_bump_version();

/* การแก้รายการย่อยถือเป็นการแก้รายการแม่ด้วย มิฉะนั้นสองคนแก้คนละบรรทัด
   พร้อมกันจะไม่ชนกันเลย ทั้งที่ยอดรวมเปลี่ยนไปแล้ว และคนที่บันทึกทีหลัง
   จะเห็นยอดที่ไม่ตรงกับที่ตัวเองกรอก

   ผลข้างเคียงที่ตั้งใจ: การเพิ่มรายการย่อย n บรรทัดทำให้ version ของแม่เพิ่ม n
   ผู้เรียกจึงต้องอ่าน version กลับมาใหม่หลังบันทึกเสมอ ไม่ใช่เดาว่าเพิ่มทีละหนึ่ง */
create or replace function public.procurement_children_touch_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent uuid := coalesce(new.procurement_id, old.procurement_id);
begin
  update public.procurements set updated_at = now() where id = v_parent;
  return coalesce(new, old);
end;
$$;

create trigger procurement_items_touch_parent
  after insert or update or delete on public.procurement_items
  for each row execute function public.procurement_children_touch_parent();

create trigger procurement_funding_touch_parent
  after insert or update or delete on public.procurement_funding_allocations
  for each row execute function public.procurement_children_touch_parent();
