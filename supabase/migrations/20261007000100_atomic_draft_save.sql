-- =============================================================================
-- แก้ F-08 — บันทึกร่างจัดซื้อแบบ atomic และปิดการเขียนตรงที่ข้ามกติกา
--
-- เดิม server action ทำ update แม่ → ลบรายการย่อย → เพิ่มรายการย่อย → เพิ่มแหล่งเงิน →
-- audit เป็นหลายคำขอแยก (หลาย transaction) ถ้าล้มกลางทางร่างจะเหลือไม่ครบหรือหาย และ audit ที่ล้ม
-- ไม่ rollback ข้อมูล นอกจากนี้ policy `procurements_update` ยอมรับการแก้ **ทุกคอลัมน์** ของร่าง
-- ผ่าน Data API ตรง (created_by, fiscal_year_id, deleted_at, exception_*, status ระหว่าง DRAFT/
-- NEEDS_REVISION ฯลฯ) และตารางรายการย่อย/แหล่งเงินเขียนตรงได้เช่นกัน
--
-- ทางแก้:
--   1) RPC สองตัว (security definer) สร้าง/บันทึกร่างทั้งชุด — ตรวจสิทธิ์ ตรวจ version ล็อกแถวแม่
--      เขียนแม่+รายการย่อย+แหล่งเงิน+audit ใน transaction เดียว ล้มตรงไหนก็ rollback ทั้งหมด
--   2) เพิกถอน insert/update/delete ตรงบน procurements / procurement_items /
--      procurement_funding_allocations จาก authenticated — เขียนได้ทางเดียวคือ RPC
--      (RPC ธุรกรรมอื่นที่เป็น definer เช่น procurement_submit ไม่กระทบ)
--   3) policy เขียนถูกลบ (ไม่มี privilege ให้ใช้แล้ว) — ผลข้างเคียงที่ดี: policy `for all` ของตาราง
--      ลูกเคยถูกประเมินตอน select ด้วย (can_edit_procurement ต่อแถว) การลบทำให้การอ่านยอดทะเบียนเร็วขึ้น
--   4) audit ของการสร้าง/แก้ร่างและส่งอนุมัติเขียนใน RPC (DB_TRUSTED) จึงเอาคู่ (action, entity)
--      ของ procurement ออกจากช่องทางแอปรายงาน (ปลอมไม่ได้อีก; ไม่ซ้ำสองแถวต่อการส่งอนุมัติหนึ่งครั้ง)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- version: บันทึกร่างหนึ่งครั้ง = เพิ่ม version หนึ่งครั้ง
--
-- เดิม trigger ของรายการย่อยเพิ่ม version ของแม่ทุกแถวที่เขียน (n แถว = n ครั้ง) ผู้เรียกต้องเดา
-- version ใหม่ ตอนนี้ RPC ตั้งธง transaction-local `app.draft_save` แล้ว trigger ข้ามการแตะแม่ —
-- RPC แก้แม่ครั้งเดียวท้ายสุด (trigger version_bump เพิ่มหนึ่ง)
-- การเขียนรายการย่อยนอก RPC (ถ้ามีในอนาคต) ยังแตะแม่เหมือนเดิม
-- -----------------------------------------------------------------------------

create or replace function public.procurement_children_touch_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent uuid := coalesce(new.procurement_id, old.procurement_id);
begin
  if coalesce(current_setting('app.draft_save', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  update public.procurements set updated_at = now() where id = v_parent;
  return coalesce(new, old);
end;
$$;

-- -----------------------------------------------------------------------------
-- ตัวช่วยภายใน: เขียนรายการย่อยและแหล่งเงินใหม่ทั้งชุดจาก payload (client เรียกตรงไม่ได้)
-- -----------------------------------------------------------------------------

create or replace function public.procurement_write_draft_children(p_procurement_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.procurement_items where procurement_id = p_procurement_id;
  delete from public.procurement_funding_allocations where procurement_id = p_procurement_id;

  insert into public.procurement_items (
    procurement_id, line_no, description, quantity, unit_id, unit_price,
    discount_amount, tax_rate, item_category_id
  )
  select p_procurement_id, i.line_no, i.description, i.quantity, i.unit_id, i.unit_price,
         coalesce(i.discount_amount, 0), coalesce(i.tax_rate, 0), i.item_category_id
  from jsonb_to_recordset(coalesce(p_payload -> 'items', '[]'::jsonb)) as i(
    line_no integer, description text, quantity numeric, unit_id uuid, unit_price numeric,
    discount_amount numeric, tax_rate numeric, item_category_id uuid
  );

  insert into public.procurement_funding_allocations (
    procurement_id, line_no, budget_account_id, amount, note
  )
  select p_procurement_id, f.line_no, f.budget_account_id, f.amount, f.note
  from jsonb_to_recordset(coalesce(p_payload -> 'funding_allocations', '[]'::jsonb)) as f(
    line_no integer, budget_account_id uuid, amount numeric, note text
  );
end;
$$;

revoke execute on function public.procurement_write_draft_children(uuid, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- สร้างร่าง
--
-- payload: { subject, purpose, tax_mode, fiscal_year_id, department_id, vendor_id, request_date,
--            required_date, report_date, approved_date, selection_date, order_or_agreement_date,
--            delivery_or_service_date, inspection_date, sent_to_finance_date, classification,
--            procurement_method, method_legal_basis_code, is_emergency, note,
--            items: [...], funding_allocations: [...] }
-- ผู้สร้าง/สถานะเริ่มต้น/เวลา มาจากฐานข้อมูลเองเสมอ — ไม่รับจาก payload
-- -----------------------------------------------------------------------------

create or replace function public.procurement_create_draft(
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
  v_id uuid;
  v_reference text;
begin
  if v_actor is null or not public.has_permission('procurement.create') then
    raise exception 'ไม่มีสิทธิ์สร้างรายการจัดซื้อ' using errcode = 'insufficient_privilege';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'ข้อมูลรายการจัดซื้อไม่ถูกต้อง' using errcode = 'check_violation';
  end if;

  perform set_config('app.draft_save', 'on', true);

  insert into public.procurements (
    subject, purpose, tax_mode, fiscal_year_id, department_id, vendor_id,
    request_date, required_date, report_date, approved_date, selection_date,
    order_or_agreement_date, delivery_or_service_date, inspection_date, sent_to_finance_date,
    classification, procurement_method, method_legal_basis_code, is_emergency, note,
    created_by
  ) values (
    p_payload ->> 'subject',
    p_payload ->> 'purpose',
    coalesce((p_payload ->> 'tax_mode')::public.tax_mode, 'EXEMPT'),
    (p_payload ->> 'fiscal_year_id')::uuid,
    (p_payload ->> 'department_id')::uuid,
    (p_payload ->> 'vendor_id')::uuid,
    (p_payload ->> 'request_date')::date,
    (p_payload ->> 'required_date')::date,
    (p_payload ->> 'report_date')::date,
    (p_payload ->> 'approved_date')::date,
    (p_payload ->> 'selection_date')::date,
    (p_payload ->> 'order_or_agreement_date')::date,
    (p_payload ->> 'delivery_or_service_date')::date,
    (p_payload ->> 'inspection_date')::date,
    (p_payload ->> 'sent_to_finance_date')::date,
    (p_payload ->> 'classification')::public.procurement_classification,
    (p_payload ->> 'procurement_method')::public.procurement_method,
    p_payload ->> 'method_legal_basis_code',
    coalesce((p_payload ->> 'is_emergency')::boolean, false),
    p_payload ->> 'note',
    v_actor
  )
  returning id, reference into v_id, v_reference;

  perform public.procurement_write_draft_children(v_id, p_payload);

  insert into public.audit_events (
    request_id, actor_id, action, entity_type, entity_id, after_json, metadata_json
  ) values (
    p_request_id, v_actor, 'entity.create', 'procurement', v_id::text,
    jsonb_build_object('reference', v_reference, 'subject', p_payload ->> 'subject'),
    jsonb_build_object(
      'itemCount', jsonb_array_length(coalesce(p_payload -> 'items', '[]'::jsonb)),
      'fundingLineCount', jsonb_array_length(coalesce(p_payload -> 'funding_allocations', '[]'::jsonb))
    )
  );

  return jsonb_build_object(
    'id', v_id,
    'reference', v_reference,
    'version', (select version from public.procurements where id = v_id)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- บันทึกร่าง (แก้ทั้งชุด)
--
-- ล็อกแถวแม่ก่อนตรวจ version จึงไม่มีช่องว่างระหว่างตรวจกับเขียน สองคำขอที่ถือ version เดียวกัน
-- คำขอหลังเห็น version ใหม่แล้วถูกปฏิเสธ (ไม่เขียนทับเงียบ ๆ)
-- fiscal_year_id / created_by / status / deleted_* / exception_* ไม่ถูกแก้โดย RPC นี้เลย
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

revoke execute on function public.procurement_create_draft(jsonb, text) from public, anon;
revoke execute on function public.procurement_save_draft(uuid, integer, jsonb, text) from public, anon;
grant execute on function public.procurement_create_draft(jsonb, text) to authenticated;
grant execute on function public.procurement_save_draft(uuid, integer, jsonb, text) to authenticated;

-- -----------------------------------------------------------------------------
-- ปิดการเขียนตรง: เขียนได้ทางเดียวคือ RPC
--
-- SELECT ยังเปิดตาม policy เดิม (can_read_procurement) — ลบ policy เขียนทิ้งเพราะไม่มี privilege
-- ให้ใช้แล้ว และ policy `for all` ทำให้การอ่านตารางลูกประเมิน can_edit_procurement เพิ่มต่อแถว
-- -----------------------------------------------------------------------------

revoke insert, update, delete on public.procurements from authenticated, anon;
revoke insert, update, delete on public.procurement_items from authenticated, anon;
revoke insert, update, delete on public.procurement_funding_allocations from authenticated, anon;

drop policy procurements_insert on public.procurements;
drop policy procurements_update on public.procurements;
drop policy procurement_items_write on public.procurement_items;
drop policy procurement_funding_write on public.procurement_funding_allocations;

-- -----------------------------------------------------------------------------
-- audit: การสร้าง/แก้ร่างและส่งอนุมัติเขียนโดย RPC แล้ว (DB_TRUSTED) — เอาออกจากช่องทางแอปรายงาน
-- ฟังก์ชันนี้ถูกสร้างใน migration 20261006000300 (เหลือคู่ที่แอปยังรายงานเองจริงเท่านั้น)
-- -----------------------------------------------------------------------------

create or replace function public.audit_reportable_permission(p_action text, p_entity_type text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_action = 'user.invite' and p_entity_type = 'profile' then 'users.manage'
    when p_action = 'entity.update' and p_entity_type = 'profile' then 'users.manage'
    when p_action = 'auth.password_set' and p_entity_type = 'profile' then 'SELF'

    when p_action in ('entity.create', 'admin.action') and p_entity_type = 'fiscal_year' then 'settings.manage'
    when p_action in ('entity.create', 'entity.update')
         and p_entity_type in ('funding_source', 'project', 'vendor') then 'masters.manage'

    when p_action in ('entity.create', 'admin.action') and p_entity_type = 'budget_account' then 'budget.manage'
    when p_action in ('entity.create', 'admin.action') and p_entity_type = 'inventory_item' then 'inventory.adjust'

    when p_action = 'report.export' and p_entity_type = 'report_export' then 'reports.export'
    else null
  end;
$$;
