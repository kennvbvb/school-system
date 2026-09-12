-- =============================================================================
-- Migration 0014 — ทะเบียนเลขที่เอกสาร (FR-NUM-003, FR-NUM-004)
--
-- ปิดข้อค้นพบ F-12, F-13 และ F-14
--
--   F-12  ลำดับรายการซ้ำ (ลำดับ 139 ปรากฏ 2 แถว)
--   F-13  เลขเอกสารช่วงท้ายกระโดด (๑๓/๒๕๖๙ แล้วต่อด้วย ๙๑/๒๕๖๙)
--   F-14  12 แถวของทะเบียนซื้อไม่มีเลขเอกสาร ซึ่งบางรายการไม่ต้องมีเลขจริง
--
-- **Q3 ตอบแล้วว่าโรงเรียนกำหนดเลขเอง** จึงไม่มีฟังก์ชันออกเลขอัตโนมัติและไม่มี
-- การจอง running number ตามที่แผนเดิมวางไว้ — การสร้างกลไกออกเลขให้งานที่ผู้ใช้
-- ตั้งใจพิมพ์เอง จะกลายเป็นแหล่งความจริงที่สองที่ขัดกับเลขที่โรงเรียนใช้จริง
--
-- สิ่งที่ยังต้องบังคับคือ **ความไม่ซ้ำ** ซึ่งเกิดกับการพิมพ์เองได้เท่า ๆ กับการ
-- ออกเลขอัตโนมัติ
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ชนิดเอกสารและสถานะ
--
-- สถานะมีสี่ค่าเพราะ F-14 แสดงว่า "ไม่มีเลข" ไม่ใช่ความผิดพลาดเสมอไป
--
--   ISSUED        ออกเลขแล้ว — มีเลขจริง
--   NOT_REQUIRED  รายการนี้ไม่ต้องมีเลขเอกสาร (ต้องมีเหตุผล)
--   PENDING       ยังไม่ได้เลข แต่ต้องมี (ต้องมีเหตุผล)
--   VOIDED        เคยออกเลขแล้วยกเลิก (ต้องมีเหตุผล) — เลขเดิมห้ามนำกลับมาใช้
--
-- การบังคับให้กรอกเลขทุกแถวจะทำให้คนกรอกเลขปลอมเพื่อให้บันทึกผ่าน
-- ซึ่งแย่กว่าการบันทึกความจริงว่า "ไม่มีเลข เพราะอะไร"
-- -----------------------------------------------------------------------------

create type public.document_kind as enum (
  'REQUEST_MEMO',
  'PURCHASE_ORDER',
  'INSPECTION_REPORT',
  'DISBURSEMENT',
  'OTHER'
);

create type public.document_number_status as enum (
  'ISSUED',
  'NOT_REQUIRED',
  'PENDING',
  'VOIDED'
);

-- -----------------------------------------------------------------------------
-- normalize_document_number — รูปแบบมาตรฐานก่อนเทียบซ้ำ
--
-- **ไฟล์จริงใช้เลขไทย** (`๑๓/๒๕๖๙` ในทะเบียนใบสั่งจ้าง) ถ้าเทียบข้อความตรง ๆ
-- คนที่พิมพ์ `13/2569` จะบันทึกซ้ำกับ `๑๓/๒๕๖๙` ได้โดยไม่มีใครทัก ซึ่งเท่ากับ
-- ไม่ได้กัน F-12 จริง
--
-- ต้องเป็น immutable เพราะใช้ใน unique index
-- ต้องตรงกับ normalizeDocumentNumber() ใน src/domain/documents/document-register.ts
-- ซึ่งมี parity test อ่านไฟล์นี้มาเทียบ
-- -----------------------------------------------------------------------------

create or replace function public.normalize_document_number(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select lower(
    regexp_replace(
      translate(p_value, '๐๑๒๓๔๕๖๗๘๙', '0123456789'),
      '\s+', '', 'g'
    )
  );
$$;

comment on function public.normalize_document_number(text) is
  'แปลงเลขไทยเป็นอารบิก ตัดช่องว่าง และลดเป็นตัวพิมพ์เล็ก ก่อนเทียบเลขซ้ำ';

-- -----------------------------------------------------------------------------
-- document_running_no — แยกเลขลำดับออกจากรูปแบบ (F-13)
--
-- **ฐานข้อมูลเป็นผู้แยก ไม่ใช่ผู้เรียก** ถ้าให้ client ส่ง running มาเอง การเรียก
-- RPC ตรงด้วยค่าที่ไม่ตรงกับข้อความจะทำให้รายงาน "เลขกระโดดช่วงไหน" โกหก
-- ซึ่งเป็นสิ่งเดียวที่คอลัมน์นี้มีไว้ตอบ
--
-- กติกา: **กลุ่มตัวเลขสุดท้ายที่ไม่ใช่ปี**
--   ๑๓/๒๕๖๙        -> [13, 2569]        ตัดปีออก เหลือ 13
--   ศธ04/0007/2569  -> [04, 0007, 2569]  ตัดปีออก กลุ่มสุดท้ายคือ 7
-- ถ้าเอากลุ่มแรกจะได้ 04 ซึ่งเป็นส่วนของคำนำหน้า ไม่ใช่เลขลำดับ
--
-- ข้ามกลุ่มที่ยาวเกิน 9 หลัก เพราะเกินช่วง integer และไม่ใช่เลขลำดับที่เป็นไปได้
-- ต้องตรงกับ extractRunningNumber() ในชั้นโดเมน (มี parity test เทียบไฟล์นี้)
-- -----------------------------------------------------------------------------

create or replace function public.document_running_no(p_value text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  with groups as (
    select g.match[1] as digits, g.ordinality as position
    from regexp_matches(public.normalize_document_number(p_value), '\d+', 'g')
      with ordinality as g(match, ordinality)
    where length(g.match[1]) <= 9
  ),
  classified as (
    select digits, position,
           length(digits) = 4
             and (digits::integer between 2400 and 2700
                  or digits::integer between 1900 and 2200) as year_like
    from groups
  )
  select coalesce(
    (select digits::integer from classified where not year_like order by position desc limit 1),
    (select digits::integer from classified order by position desc limit 1)
  );
$$;

comment on function public.document_running_no(text) is
  'แยกเลขลำดับจากเลขที่เอกสาร (F-13) — เป็นค่าเดา ห้ามใช้ตัดสินความไม่ซ้ำ';

-- -----------------------------------------------------------------------------
-- document_numbers
--
-- หนึ่งรายการจัดซื้อมีเอกสารได้หลายฉบับ (บันทึกขออนุมัติ ใบสั่งซื้อ ใบตรวจรับ)
-- แต่ละฉบับมีเลขของตัวเอง จึงเป็นตารางลูก ไม่ใช่คอลัมน์ใน procurements
--
-- เก็บ `running_no` แยกจาก `document_no` ตาม F-13 — ข้อความคือสิ่งที่โรงเรียนใช้
-- ส่วนจำนวนเต็มคือสิ่งที่ทำให้รู้ว่าเลขกระโดดช่วงไหนโดยไม่ต้องแกะข้อความตอนทำรายงาน
-- -----------------------------------------------------------------------------

create table public.document_numbers (
  id uuid primary key default gen_random_uuid(),
  procurement_id uuid not null references public.procurements (id) on delete restrict,
  document_kind public.document_kind not null,

  /* ขอบเขตความไม่ซ้ำอ้างปีงบของตัวเอง ไม่ join ไปที่ procurements ตอนตรวจ
     เพราะปีงบของเอกสารคือปีที่ "ออกเลข" ซึ่งอาจไม่ใช่ปีของรายการในกรณีคาบปี */
  fiscal_year_id uuid not null references public.fiscal_years (id) on delete restrict,

  status public.document_number_status not null,

  /* เลขตามที่โรงเรียนพิมพ์ ไม่บังคับรูปแบบ (Q3) */
  document_no text,

  /* เลขลำดับที่แยกได้ — เป็นค่าที่ระบบ **เดา** จากข้อความ ไม่ใช่ข้อเท็จจริง
     ใช้กับรายงานและค่าเสนอแนะเท่านั้น ห้ามใช้ตัดสินความไม่ซ้ำ */
  running_no integer,

  issued_date date,
  reason text,

  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,

  /* ---- ความสอดคล้องของสถานะกับช่องอื่น ----
     บังคับที่นี่ด้วย ไม่ใช่แค่ใน Zod — Zod ป้องกันเฉพาะทางที่ผ่านแอป
     ส่วน constraint ป้องกันทุกทางรวมถึงการเรียก API ตรงและการ import ข้อมูลเดิม */
  constraint document_numbers_issued_has_number check (
    status <> 'ISSUED' or (document_no is not null and btrim(document_no) <> '')
  ),
  constraint document_numbers_issued_has_date check (
    status <> 'ISSUED' or issued_date is not null
  ),
  constraint document_numbers_reason_required check (
    status = 'ISSUED' or (reason is not null and btrim(reason) <> '')
  ),
  /* สถานะที่ยังไม่เคยออกเลขต้องไม่มีเลขติดมาด้วย
     VOIDED ยกเว้น เพราะต้องเก็บเลขเดิมไว้กันไม่ให้ใครนำกลับมาใช้ */
  constraint document_numbers_unissued_has_no_number check (
    status in ('ISSUED', 'VOIDED') or document_no is null
  ),
  constraint document_numbers_void_consistency check (
    (status = 'VOIDED') = (voided_at is not null)
  ),
  constraint document_numbers_running_positive check (running_no is null or running_no >= 0)
);

-- -----------------------------------------------------------------------------
-- ความไม่ซ้ำ (F-12) และเลขที่ยกเลิกแล้วห้ามนำกลับมาใช้
--
-- index เดียวทำทั้งสองเรื่อง เพราะไม่ได้กรองสถานะออก — แถว VOIDED ยังกินที่ในดัชนี
-- อยู่ เลขที่เคยออกแล้วจึงบันทึกซ้ำไม่ได้ตลอดไป ไม่ต้องมีตารางเลขต้องห้ามแยกอีกชุด
--
-- **ขอบเขต: ชนิดเอกสารเดียวกัน ปีงบเดียวกัน** เป็นค่าเริ่มต้นตาม assumptions ข้อ 2.7
-- เพราะเป็นขอบเขตที่แคบที่สุดที่ยังจับ F-12 ได้ โดยไม่บล็อกกรณีที่เอกสารคนละชนิด
-- ใช้เลขเดียวกันโดยชอบ **ถ้าโรงเรียนนับเลขต่อหน่วยงาน ต้องแก้ index นี้ก่อนนำเข้าข้อมูลจริง**
-- -----------------------------------------------------------------------------

create unique index document_numbers_unique_idx
  on public.document_numbers (
    fiscal_year_id,
    document_kind,
    public.normalize_document_number(document_no)
  )
  where document_no is not null;

/* หนึ่งรายการมีเลขที่ยังใช้งานอยู่ได้ฉบับละหนึ่งเลข
   ยกเลิกแล้วจึงออกใหม่ได้ โดยเลขเดิมยังถูกกันไว้ด้วย index ด้านบน */
create unique index document_numbers_active_per_kind_idx
  on public.document_numbers (procurement_id, document_kind)
  where status <> 'VOIDED';

create index document_numbers_procurement_idx
  on public.document_numbers (procurement_id);

create index document_numbers_running_idx
  on public.document_numbers (fiscal_year_id, document_kind, running_no desc)
  where running_no is not null;

comment on table public.document_numbers is
  'ทะเบียนเลขที่เอกสารที่โรงเรียนกำหนดเอง — ระบบกันเลขซ้ำ ไม่ได้ออกเลขให้';

comment on column public.document_numbers.running_no is
  'เลขลำดับที่ระบบแยกจากข้อความ เป็นค่าเดา ใช้กับรายงานและค่าเสนอแนะเท่านั้น';

comment on index public.document_numbers_unique_idx is
  'กันเลขซ้ำ (F-12) และกันการนำเลขที่ยกเลิกแล้วกลับมาใช้ — ไม่กรอง VOIDED ออกโดยเจตนา';

-- -----------------------------------------------------------------------------
-- RLS
--
-- อ่านได้เท่าที่อ่านรายการต้นทางได้ ใช้ can_read_procurement() ตัวเดียวกับตารางลูกอื่น
--
-- **ไม่มี policy สำหรับ insert/update/delete** — เขียนได้ทางเดียวคือผ่าน RPC
-- ด้านล่าง การเปิดช่องให้เขียนตรงจะทำให้เลี่ยงการตรวจซ้ำและการเขียน audit ได้
-- -----------------------------------------------------------------------------

alter table public.document_numbers enable row level security;

create policy document_numbers_select on public.document_numbers
  for select to authenticated
  using (public.can_read_procurement(procurement_id));

/*
 * ผู้ที่ออกเลขได้ ต้องเห็นทะเบียนทั้งเล่ม
 *
 * ถ้าเห็นเฉพาะรายการที่ตัวเองอ่านได้ หน้าจอจะเสนอเลขถัดไปจาก "เลขสูงสุดเท่าที่เห็น"
 * ซึ่งอาจเป็นเลขที่คนอื่นใช้ไปแล้ว ผู้ใช้จะกดบันทึกแล้วโดนปฏิเสธซ้ำ ๆ โดยไม่เข้าใจว่า
 * ทำไม — การกันเลขซ้ำจะใช้ได้จริงก็ต่อเมื่อคนออกเลขมองเห็นเลขที่ถูกใช้ไปแล้วทั้งหมด
 *
 * ตารางนี้มีแต่เลข ชนิดเอกสาร วันที่ และเหตุผล ไม่มีข้อมูลส่วนบุคคลของผู้ขาย
 * และไม่มียอดเงิน จึงไม่ได้เปิดข้อมูลอ่อนไหวเพิ่มให้บทบาทนี้
 */
create policy document_numbers_select_register on public.document_numbers
  for select to authenticated
  using (public.has_permission('documents.issue'));

revoke insert, update, delete on public.document_numbers from authenticated;
