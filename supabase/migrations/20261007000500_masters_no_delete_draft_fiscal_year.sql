-- =============================================================================
-- แก้ F-11 — ข้อมูลพื้นฐานและร่างจัดซื้อ
--
-- 1) departments / positions มี policy `for all` โดยไม่เพิกถอน delete — ผู้ถือ masters.manage ลบได้ทั้งที่
--    โครงการอื่นมีข้อมูลผูกอยู่ (FK เป็น restrict จึงลบไม่ได้ถ้ามีการอ้างอิง แต่ลบแถวที่ยังไม่ถูกอ้างอิงได้
--    โดยไม่มีร่องรอย) ตารางข้อมูลพื้นฐานอื่นปิด delete ไว้แล้วใน migration 20260904000200 สองตารางนี้ตกหล่น
--    แก้เป็น: policy แยก insert/update (ไม่มี delete) + revoke delete — ปิดใช้งานด้วย is_active = false แทน
-- 2) ปีงบประมาณของร่างจัดซื้อ: ตัดสินให้ "แก้ไม่ได้หลังสร้าง" และให้ RPC ปฏิเสธชัดเจน แทนการเมินเงียบ ๆ
-- =============================================================================

drop policy departments_write on public.departments;
drop policy positions_write on public.positions;

create policy departments_insert on public.departments
  for insert to authenticated
  with check (public.has_permission('masters.manage'));

create policy departments_update on public.departments
  for update to authenticated
  using (public.has_permission('masters.manage'))
  with check (public.has_permission('masters.manage'));

create policy positions_insert on public.positions
  for insert to authenticated
  with check (public.has_permission('masters.manage'));

create policy positions_update on public.positions
  for update to authenticated
  using (public.has_permission('masters.manage'))
  with check (public.has_permission('masters.manage'));

revoke delete on public.departments, public.positions from authenticated, anon;

-- -----------------------------------------------------------------------------
-- procurement_save_draft — เหมือนเดิมทุกอย่าง เพิ่มเฉพาะการปฏิเสธการเปลี่ยนปีงบประมาณ
-- -----------------------------------------------------------------------------

create or replace function public.procurement_save_draft(
  p_procurement_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_request_id text default 'system'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.procurements%rowtype;
  v_new_version integer;
begin
  if v_actor is null or not public.has_permission('procurement.edit_draft') then
    raise exception 'ไม่มีสิทธิ์แก้ไขรายการจัดซื้อ' using errcode = 'insufficient_privilege';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'ข้อมูลรายการจัดซื้อไม่ถูกต้อง' using errcode = 'check_violation';
  end if;

  select * into v_row from public.procurements
  where id = p_procurement_id and deleted_at is null
  for update;

  -- ไม่พบ กับ ไม่มีสิทธิ์เห็น ตอบเหมือนกัน ไม่เปิดเผยว่ามีรายการนี้อยู่
  if not found
     or not (public.has_permission('procurement.read.all') or v_row.created_by = v_actor) then
    raise exception 'ไม่พบรายการนี้ หรือคุณไม่มีสิทธิ์แก้ไข' using errcode = 'insufficient_privilege';
  end if;

  if v_row.status not in ('DRAFT', 'NEEDS_REVISION') then
    raise exception 'รายการนี้ถูกส่งเข้าสู่ขั้นตอนอนุมัติแล้ว จึงแก้ไขไม่ได้' using errcode = 'restrict_violation';
  end if;

  if v_row.version <> p_expected_version then
    -- PT409 (ไม่ใช่ serialization_failure/40001): PostgREST แปลง PTnnn เป็น HTTP nnn ตรง ๆ จึงได้ 409 ที่ client อ่านได้
    -- ส่วน SQLSTATE 40001 ทำให้ PostgREST 12.2.3 ไม่ตอบกลับเลย (ทดสอบแล้ว) — ดูหมายเหตุใน PR
    raise exception 'มีผู้อื่นแก้ไขรายการนี้ไปแล้วหลังจากที่คุณเปิดหน้านี้ กรุณาโหลดหน้าใหม่แล้วตรวจการเปลี่ยนแปลงก่อนบันทึกซ้ำ'
      using errcode = 'PT409';
  end if;

  -- F-11: ปีงบประมาณแก้ไม่ได้หลังสร้างร่าง (แหล่งเงินของร่างผูกกับบัญชีงบของปีนั้น)
  -- เดิม RPC เมินค่านี้เงียบ ๆ ผู้ใช้เปลี่ยนปีในฟอร์มแล้วบันทึกสำเร็จโดยปีไม่เปลี่ยน — ตอนนี้ปฏิเสธชัด ๆ
  -- ไม่ส่งคีย์นี้มาเลยก็ได้ (ถือว่าไม่แก้)
  if p_payload ? 'fiscal_year_id'
     and (p_payload ->> 'fiscal_year_id')::uuid is distinct from v_row.fiscal_year_id then
    raise exception 'ปีงบประมาณแก้ไม่ได้หลังสร้างร่าง เพราะแหล่งเงินผูกกับบัญชีงบของปีนั้น หากเลือกปีผิดให้สร้างร่างใหม่'
      using errcode = 'check_violation';
  end if;

  perform set_config('app.draft_save', 'on', true);

  perform public.procurement_write_draft_children(p_procurement_id, p_payload);

  update public.procurements set
    subject = p_payload ->> 'subject',
    purpose = p_payload ->> 'purpose',
    tax_mode = coalesce((p_payload ->> 'tax_mode')::public.tax_mode, 'EXEMPT'),
    department_id = (p_payload ->> 'department_id')::uuid,
    vendor_id = (p_payload ->> 'vendor_id')::uuid,
    request_date = (p_payload ->> 'request_date')::date,
    required_date = (p_payload ->> 'required_date')::date,
    report_date = (p_payload ->> 'report_date')::date,
    approved_date = (p_payload ->> 'approved_date')::date,
    selection_date = (p_payload ->> 'selection_date')::date,
    order_or_agreement_date = (p_payload ->> 'order_or_agreement_date')::date,
    delivery_or_service_date = (p_payload ->> 'delivery_or_service_date')::date,
    inspection_date = (p_payload ->> 'inspection_date')::date,
    sent_to_finance_date = (p_payload ->> 'sent_to_finance_date')::date,
    classification = (p_payload ->> 'classification')::public.procurement_classification,
    procurement_method = (p_payload ->> 'procurement_method')::public.procurement_method,
    method_legal_basis_code = p_payload ->> 'method_legal_basis_code',
    is_emergency = coalesce((p_payload ->> 'is_emergency')::boolean, false),
    note = p_payload ->> 'note',
    updated_by = v_actor
  where id = p_procurement_id
  returning version into v_new_version;

  insert into public.audit_events (
    request_id, actor_id, action, entity_type, entity_id, before_json, after_json, metadata_json
  ) values (
    p_request_id, v_actor, 'entity.update', 'procurement', p_procurement_id::text,
    jsonb_build_object('version', p_expected_version),
    jsonb_build_object('subject', p_payload ->> 'subject', 'version', v_new_version),
    jsonb_build_object(
      'itemCount', jsonb_array_length(coalesce(p_payload -> 'items', '[]'::jsonb)),
      'fundingLineCount', jsonb_array_length(coalesce(p_payload -> 'funding_allocations', '[]'::jsonb))
    )
  );

  return jsonb_build_object('version', v_new_version);
end;
$$;

revoke execute on function public.procurement_save_draft(uuid, integer, jsonb, text) from public, anon;
grant execute on function public.procurement_save_draft(uuid, integer, jsonb, text) to authenticated;
