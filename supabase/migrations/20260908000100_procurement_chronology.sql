-- =============================================================================
-- Migration 0010 — ชุดวันที่ ประเภทงาน และข้อยกเว้นของรายการจัดซื้อ
--
-- ปิดข้อค้นพบ F-03 และ F-04 ตามแผนข้อ 6.3 และ 7
--
--   F-03  วันที่ 31/09/2568 ในทะเบียนใบสั่งจ้าง 3 แถว — วันที่ที่ไม่มีอยู่จริง
--   F-04  วันใช้บริการ 31 ม.ค. เกิดก่อนวันขออนุมัติ 2 ก.พ. พบใน 2 sheet
--
-- **F-03 ถูกปิดด้วยชนิดคอลัมน์ ไม่ใช่ด้วยกฎ** — คอลัมน์ชนิด date ปฏิเสธ
-- '2568-09-31' ตั้งแต่ระดับ PostgreSQL ไม่มีทางบันทึกลงไปได้ไม่ว่าจะเรียกทางใด
-- ต่างจากสเปรดชีตที่ยอมรับข้อความอะไรก็ได้ในช่องวันที่
--
-- **F-04 ปิดด้วยกฎลำดับเวลาที่ตรวจตอน submit ไม่ใช่ check constraint**
--
-- เหตุผลที่ไม่ใช้ check constraint: แผนข้อ 7.2 กำหนดว่าข้อยกเว้นต้องทำได้เมื่อมี
-- สิทธิ์ เหตุผล และหลักฐาน (เช่นกรณีเร่งด่วนที่บันทึกย้อนหลังโดยมีบันทึกอนุมัติ
-- รองรับ ซึ่งเป็นเรื่องที่เกิดจริงในงานธุรการ) check constraint ยกเว้นไม่ได้เลย
-- จึงจะบังคับให้คนกรอกวันที่ผิดเพื่อให้บันทึกผ่าน ซึ่งแย่กว่าการบันทึกความจริง
-- พร้อมเหตุผล
--
-- ขั้น draft ยังบันทึกข้อมูลไม่ครบได้ตามแผนข้อ 7.2 — การบังคับอยู่ที่ขั้น submit
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ประเภทงานและวิธีจัดหา
--
-- แยกสองเรื่องออกจากกันโดยเจตนา: ประเภทงานคือ "ซื้ออะไร" ส่วนวิธีจัดหาคือ
-- "ซื้ออย่างไรตามระเบียบ" เอกสารที่ต้องใช้ขึ้นกับทั้งสองอย่าง ไม่ใช่อย่างใด
-- อย่างหนึ่ง (แผนข้อ 6.3 "อย่าบังคับทุก classification ให้ใช้ document pack เดียวกัน")
-- -----------------------------------------------------------------------------

create type public.procurement_classification as enum (
  'GOODS',
  'SERVICE',
  'CONSTRUCTION',
  'RENTAL',
  'UTILITY',
  'TRAINING_OR_COMPENSATION',
  'OTHER'
);

/*
 * วิธีจัดหาเก็บเป็น enum แต่ **ฐานอำนาจตามกฎหมายเก็บเป็นข้อความอ้างอิง**
 * ไม่ฝังตัวบทลงในฐานข้อมูล
 *
 * ข้อความของระเบียบเปลี่ยนตามรุ่นที่ประกาศใช้ และข้อค้นพบ F-06/F-07 คือกรณีที่
 * เอกสารอ้างระเบียบผิดรุ่นและอ้าง "ข้อ" แทน "มาตรา" การเก็บแต่รหัสอ้างอิงที่นี่
 * ทำให้ข้อความจริงมาจาก legal_content_versions ใน PR-05 ได้โดยไม่ต้องแก้ schema
 */
create type public.procurement_method as enum (
  'SPECIFIC',
  'PRICE_COMPARISON',
  'SELECTION',
  'AUCTION',
  'OTHER'
);

alter table public.procurements
  add column classification public.procurement_classification,
  add column procurement_method public.procurement_method,
  add column method_legal_basis_code text,
  add column is_emergency boolean not null default false,

  /*
   * ชุดวันที่ตามลำดับงานจริง
   *
   * ทุกช่องยกเว้น request_date เป็น null ได้ เพราะรายการที่ยังไม่ถึงขั้นนั้น
   * ยังไม่มีวันที่ — การบังคับให้กรอกครบตั้งแต่ต้นจะทำให้คนกรอกวันที่มั่วเพื่อ
   * ให้บันทึกผ่าน ซึ่งเป็นที่มาของข้อมูลผิดในไฟล์จริง
   *
   * ลำดับที่ถูกต้อง (ตรวจตอน submit ไม่ใช่ที่นี่):
   *   request → report → approved → selection → order → delivery → inspection → finance
   */
  add column report_date date,
  add column approved_date date,
  add column selection_date date,
  add column order_or_agreement_date date,
  add column delivery_or_service_date date,
  add column inspection_date date,
  add column sent_to_finance_date date,

  /*
   * ข้อยกเว้นของกฎลำดับเวลา
   *
   * เก็บสามอย่างคู่กันเสมอ: เหตุผล ผู้อนุมัติ และเวลา — ข้อยกเว้นที่ไม่รู้ว่า
   * ใครอนุญาตและเมื่อใด ตรวจสอบย้อนหลังไม่ได้ จึงเท่ากับไม่มีข้อยกเว้น
   */
  add column exception_reason text,
  add column exception_attachment_id uuid references public.attachments (id) on delete set null,
  add column exception_granted_by uuid references public.profiles (id) on delete set null,
  add column exception_granted_at timestamptz,

  /* ข้อยกเว้นต้องครบชุดหรือไม่มีเลย ไม่มีสภาพ "มีเหตุผลแต่ไม่รู้ใครอนุมัติ" */
  add constraint procurements_exception_consistency check (
    (exception_reason is null and exception_granted_by is null and exception_granted_at is null)
    or (
      btrim(coalesce(exception_reason, '')) <> ''
      and exception_granted_by is not null
      and exception_granted_at is not null
    )
  ),

  /*
   * ฐานอำนาจระบุได้เฉพาะเมื่อเลือกวิธีจัดหาแล้ว
   * มิฉะนั้นจะมีรหัสอ้างอิงลอย ๆ ที่ไม่รู้ว่าอ้างถึงวิธีใด
   */
  add constraint procurements_legal_basis_requires_method check (
    method_legal_basis_code is null or procurement_method is not null
  );

comment on column public.procurements.approved_date is
  'วันอนุมัติ — PR-03 ให้กรอกเองเพื่อบันทึกงานที่เกิดไปแล้ว '
  'PR-04 จะให้ workflow เป็นผู้ตั้งค่าและปิดการแก้ด้วยมือ';

create index procurements_classification_idx on public.procurements (classification)
  where deleted_at is null;

-- -----------------------------------------------------------------------------
-- ผลการตรวจกฎที่บันทึกไว้ ณ เวลาที่ส่งอนุมัติ
--
-- เก็บเป็นตารางไม่ใช่คำนวณสดอย่างเดียว เพราะผู้ตรวจสอบต้องตอบได้ว่า
-- "ตอนที่อนุมัติ ระบบเตือนอะไรไว้บ้าง" ซึ่งคำนวณย้อนหลังไม่ได้ถ้ากฎเปลี่ยนไปแล้ว
-- append-only เหมือน audit_events ด้วยเหตุผลเดียวกัน
-- -----------------------------------------------------------------------------

create type public.validation_severity as enum ('ERROR', 'WARNING', 'INFO');

create table public.procurement_validations (
  id uuid primary key default gen_random_uuid(),
  procurement_id uuid not null references public.procurements (id) on delete cascade,
  /* ขั้นที่ตรวจ เช่น 'SUBMIT' — ขั้นอื่นเพิ่มใน PR-04 และ PR-06 */
  stage text not null,
  rule_code text not null,
  severity public.validation_severity not null,
  message text not null,
  /* ช่องที่ผิด ใช้ลิงก์กลับไปที่ฟอร์ม */
  field text,
  /* true = ข้อนี้ถูกยกเว้นด้วยสิทธิ์และเหตุผล */
  overridden boolean not null default false,
  checked_at timestamptz not null default now(),
  checked_by uuid references public.profiles (id) on delete set null,

  constraint procurement_validations_rule_not_blank check (btrim(rule_code) <> ''),
  constraint procurement_validations_message_not_blank check (btrim(message) <> '')
);

create index procurement_validations_procurement_idx
  on public.procurement_validations (procurement_id, checked_at desc);
