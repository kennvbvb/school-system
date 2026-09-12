-- =============================================================================
-- Migration 0015 — ฟังก์ชันบันทึกและยกเลิกเลขที่เอกสาร
--
-- ตารางใน migration 0014 ไม่มี policy ให้เขียนตรงเลย ทางเดียวที่เขียนได้คือสองฟังก์ชัน
-- นี้ ซึ่งตรวจสิทธิ์ ตรวจกติกา และเขียน audit ในทรานแซกชันเดียวกับข้อมูล
-- ถ้าขั้นใดล้ม ทั้งชุดถูกย้อนกลับ จึงไม่มีเลขที่ออกไปแล้วแต่ไม่มีร่องรอยว่าใครออก
-- =============================================================================

-- -----------------------------------------------------------------------------
-- document_number_record — บันทึกเลขที่เอกสาร หรือบันทึกว่าไม่มีเลขเพราะอะไร
--
-- **ไม่ผูกกับสถานะของรายการจัดซื้อ** เพราะบันทึกข้อความขออนุมัติได้เลขตั้งแต่ก่อน
-- อนุมัติ ส่วนใบตรวจรับได้เลขหลังส่งมอบ การบังคับสถานะเดียวจะผิดกับอย่างน้อยหนึ่งฉบับ
-- สิ่งที่บังคับคือสิทธิ์ documents.issue กับความไม่ซ้ำ
-- -----------------------------------------------------------------------------

create or replace function public.document_number_record(
  p_procurement_id uuid,
  p_document_kind public.document_kind,
  p_status public.document_number_status,
  p_document_no text default null,
  p_issued_date date default null,
  p_reason text default null,
  p_request_id text default 'system'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_fiscal_year uuid;
  v_document_no text := nullif(btrim(coalesce(p_document_no, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
  v_running integer;
begin
  if v_actor is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนดำเนินการ' using errcode = 'insufficient_privilege';
  end if;

  /*
   * ยกเลิกต้องใช้ document_number_void ไม่ใช่บันทึกสถานะ VOIDED ตรง ๆ
   *
   * ถ้ารับที่นี่ได้ จะมีทางสร้างแถว VOIDED ขึ้นมาลอย ๆ เพื่อ "จอง" เลขไม่ให้คนอื่นใช้
   * โดยไม่เคยมีเลขนั้นออกจริง ซึ่งเป็นการใช้ระบบกันเลขเป็นเครื่องมือกีดกัน
   */
  if p_status = 'VOIDED' then
    raise exception 'การยกเลิกเลขที่เอกสารต้องใช้ document_number_void'
      using errcode = 'restrict_violation';
  end if;

  if not public.has_permission('documents.issue') then
    -- ไม่บอกชื่อสิทธิ์ที่ขาด เพราะผู้ไม่มีสิทธิ์จะใช้ข้อความนั้นสำรวจระบบได้ (ข้อ 14.2)
    raise exception 'คุณไม่มีสิทธิ์ดำเนินการนี้' using errcode = 'insufficient_privilege';
  end if;

  /*
   * ล็อกแถวรายการจัดซื้อไว้ก่อนอ่านปีงบ
   *
   * ทำให้สองคนที่บันทึกเลขของรายการเดียวกันพร้อมกันเข้าคิวกัน — ไม่ได้กันเลขซ้ำ
   * (unique index เป็นผู้กัน) แต่กันไม่ให้สองแถวอ้างปีงบคนละค่าเพราะอ่านคาบเกี่ยวกัน
   */
  select fiscal_year_id into v_fiscal_year
  from public.procurements
  where id = p_procurement_id and deleted_at is null
  for update;

  if not found then
    raise exception 'ไม่พบรายการนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = 'no_data_found';
  end if;

  /*
   * ฟังก์ชันนี้เป็น security definer จึงข้าม RLS ได้ ถ้าไม่ตรวจตรงนี้ ผู้ที่เดา id ถูก
   * จะผูกเลขเอกสารกับรายการที่ตัวเองไม่มีสิทธิ์แม้แต่จะเห็น
   */
  if not public.can_read_procurement(p_procurement_id) then
    raise exception 'ไม่พบรายการนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = 'no_data_found';
  end if;

  if p_status = 'ISSUED' then
    if v_document_no is null then
      raise exception 'กรุณากรอกเลขที่เอกสาร' using errcode = 'check_violation';
    end if;
    if p_issued_date is null then
      raise exception 'กรุณากรอกวันที่ออกเอกสาร' using errcode = 'check_violation';
    end if;
    v_running := public.document_running_no(v_document_no);
  else
    if v_reason is null then
      raise exception 'กรุณาระบุเหตุผล เพราะรายการนี้ไม่ได้ออกเลขที่เอกสาร'
        using errcode = 'check_violation';
    end if;
    -- สถานะที่ยังไม่เคยออกเลข ต้องไม่พาเลขติดมาด้วย
    v_document_no := null;
  end if;

  begin
    insert into public.document_numbers (
      procurement_id, document_kind, fiscal_year_id, status,
      document_no, running_no, issued_date, reason, created_by
    ) values (
      p_procurement_id, p_document_kind, v_fiscal_year, p_status,
      v_document_no, v_running, p_issued_date, v_reason, v_actor
    )
    returning id into v_id;
  exception
    when unique_violation then
      /*
       * แปลง unique_violation เป็นข้อความที่ผู้ใช้แก้ตามได้
       *
       * ข้อความดิบของ PostgreSQL บอกชื่อ index ซึ่งผู้ใช้อ่านไม่ออกและไม่ได้บอกว่า
       * ต้องทำอะไรต่อ — สองดัชนีที่ชนได้มีคนละความหมาย จึงแยกข้อความ
       */
      if sqlerrm like '%document_numbers_active_per_kind_idx%' then
        raise exception 'รายการนี้มีเลขที่เอกสารชนิดนี้อยู่แล้ว หากต้องการออกใหม่ ให้ยกเลิกเลขเดิมก่อน'
          using errcode = 'unique_violation';
      end if;

      raise exception 'เลขที่ % ถูกใช้ไปแล้วในชนิดเอกสารเดียวกันของปีงบประมาณนี้ หรือเคยออกแล้วถูกยกเลิกไป',
        v_document_no using errcode = 'unique_violation';
  end;

  insert into public.audit_events (
    request_id, actor_id, action, entity_type, entity_id, before_json, after_json, metadata_json
  ) values (
    p_request_id, v_actor, 'document_number.record', 'document_number', v_id::text,
    null,
    jsonb_build_object('status', p_status, 'document_no', v_document_no, 'running_no', v_running),
    jsonb_build_object(
      'procurement_id', p_procurement_id,
      'document_kind', p_document_kind,
      'reason', v_reason
    )
  );

  return v_id;
end;
$$;

revoke all on function public.document_number_record(
  uuid, public.document_kind, public.document_number_status, text, date, text, text
) from public;
grant execute on function public.document_number_record(
  uuid, public.document_kind, public.document_number_status, text, date, text, text
) to authenticated;

comment on function public.document_number_record(
  uuid, public.document_kind, public.document_number_status, text, date, text, text
) is 'บันทึกเลขที่เอกสารที่โรงเรียนกำหนด หรือบันทึกว่าไม่มีเลขเพราะอะไร (F-14)';

-- -----------------------------------------------------------------------------
-- document_number_void — ยกเลิกเลขที่ออกไปแล้ว
--
-- **แถวไม่ถูกลบและเลขไม่ถูกล้าง** เพราะ unique index ไม่ได้กรอง VOIDED ออก
-- เลขที่ยกเลิกแล้วจึงยังกินที่ในดัชนีและนำกลับมาใช้ไม่ได้ตลอดไป
-- ถ้าล้างเลขทิ้ง เลขนั้นจะว่างให้ใครก็ได้หยิบไปใช้ซ้ำ ซึ่งทำให้เอกสารสองฉบับที่
-- คนละเรื่องกันมีเลขเดียวกันในทะเบียนเดียวกัน
-- -----------------------------------------------------------------------------

create or replace function public.document_number_void(
  p_document_number_id uuid,
  p_reason text,
  p_request_id text default 'system'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.document_numbers%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนดำเนินการ' using errcode = 'insufficient_privilege';
  end if;

  if not public.has_permission('documents.issue') then
    raise exception 'คุณไม่มีสิทธิ์ดำเนินการนี้' using errcode = 'insufficient_privilege';
  end if;

  if v_reason is null then
    raise exception 'การยกเลิกเลขที่เอกสารต้องระบุเหตุผล' using errcode = 'check_violation';
  end if;

  select * into v_row
  from public.document_numbers
  where id = p_document_number_id
  for update;

  if not found or not public.can_read_procurement(v_row.procurement_id) then
    raise exception 'ไม่พบเลขที่เอกสารนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = 'no_data_found';
  end if;

  if v_row.status = 'VOIDED' then
    raise exception 'เลขที่เอกสารนี้ถูกยกเลิกไปแล้ว' using errcode = 'restrict_violation';
  end if;

  update public.document_numbers
  set status = 'VOIDED',
      reason = v_reason,
      voided_at = now(),
      voided_by = v_actor
  where id = p_document_number_id;

  insert into public.audit_events (
    request_id, actor_id, action, entity_type, entity_id, before_json, after_json, metadata_json
  ) values (
    p_request_id, v_actor, 'document_number.void', 'document_number', p_document_number_id::text,
    jsonb_build_object('status', v_row.status, 'document_no', v_row.document_no),
    jsonb_build_object('status', 'VOIDED', 'document_no', v_row.document_no),
    jsonb_build_object('procurement_id', v_row.procurement_id, 'reason', v_reason)
  );
end;
$$;

revoke all on function public.document_number_void(uuid, text, text) from public;
grant execute on function public.document_number_void(uuid, text, text) to authenticated;

comment on function public.document_number_void(uuid, text, text) is
  'ยกเลิกเลขที่เอกสาร — เลขเดิมยังถูกกันไว้ไม่ให้นำกลับมาใช้';
