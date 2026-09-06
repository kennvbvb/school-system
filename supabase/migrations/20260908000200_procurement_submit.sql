-- =============================================================================
-- Migration 0011 — การส่งอนุมัติที่ตรวจกฎซ้ำที่ฐานข้อมูล
--
-- แผนข้อ 7.2: "Submit ต้องผ่าน rule set ของขั้น submit" และข้อ 4.2:
-- "เลี่ยงด้วยการเรียก API ตรงไม่ได้"
--
-- ทำไมต้องเป็น function ไม่ใช่ policy บน update:
--
--   ตาราง procurements ไม่มีนโยบายให้เปลี่ยน status ด้วย update ธรรมดาอยู่แล้ว
--   (migration 0008) การส่งอนุมัติจึงต้องผ่านทางนี้ทางเดียว ซึ่งเป็นที่เดียว
--   ที่ตรวจกฎครบทั้งชุดในทรานแซกชันเดียวกับการเปลี่ยนสถานะ
--
--   ถ้าตรวจที่แอปแล้วค่อย update ผู้ที่เรียก PostgREST ตรงจะข้ามการตรวจได้ทั้งหมด
--
-- กฎชุดเดียวกันนี้อยู่ใน src/domain/procurement/submit-rules.ts ด้วย
-- ฝั่งนั้นมีไว้ให้ผู้ใช้เห็นปัญหาก่อนกดส่ง **ฝั่งนี้เป็นผู้ตัดสิน**
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ตรวจกฎทั้งชุดโดยไม่เปลี่ยนอะไร
--
-- แยกเป็น function ของตัวเองเพราะหน้าจอต้องเรียกดูผลได้โดยไม่ส่งอนุมัติจริง
-- และ procurement_submit() เรียกตัวนี้ซ้ำอีกครั้งตอนส่ง — ผลจึงมาจากที่เดียวกัน
-- ไม่มีทางที่ "ที่แสดง" กับ "ที่บังคับ" จะต่างกัน
-- -----------------------------------------------------------------------------

create or replace function public.procurement_check_submit(p_procurement_id uuid)
returns table (rule_code text, severity public.validation_severity, message text, field text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.procurements%rowtype;
  v_fiscal public.fiscal_years%rowtype;
  v_totals record;
  v_item_count integer;
  v_alloc record;
  v_available numeric;
  v_requested numeric;
  -- ลำดับขั้นตอนตามความเป็นจริง ต้องตรงกับ PROCUREMENT_MILESTONES ในโดเมน
  v_names text[] := array[
    'requestDate', 'reportDate', 'approvedDate', 'selectionDate',
    'orderOrAgreementDate', 'deliveryOrServiceDate', 'inspectionDate', 'sentToFinanceDate'
  ];
  v_labels text[] := array[
    'วันที่ขอซื้อ/ขอจ้าง', 'วันที่รายงานขอซื้อ/ขอจ้าง', 'วันที่อนุมัติ', 'วันที่คัดเลือกผู้ขาย',
    'วันที่สั่งซื้อ/ทำข้อตกลง', 'วันที่ส่งมอบ/ใช้บริการ', 'วันที่ตรวจรับ', 'วันที่ส่งเบิกการเงิน'
  ];
  v_dates date[];
  i integer;
  j integer;
  v_code text;
begin
  select * into v_row from public.procurements
  where id = p_procurement_id and deleted_at is null;

  if not found then
    -- ไม่พบก็ไม่มีอะไรให้ตรวจ ผู้เรียกเป็นผู้ตัดสินใจว่าจะรายงานอย่างไร
    return;
  end if;

  select * into v_fiscal from public.fiscal_years where id = v_row.fiscal_year_id;

  v_dates := array[
    v_row.request_date, v_row.report_date, v_row.approved_date, v_row.selection_date,
    v_row.order_or_agreement_date, v_row.delivery_or_service_date,
    v_row.inspection_date, v_row.sent_to_finance_date
  ];

  -- ---- ช่องบังคับของรายงานขอซื้อ/ขอจ้าง ----
  select count(*) into v_item_count
  from public.procurement_items where procurement_id = p_procurement_id;

  if v_item_count = 0 then
    return query select 'REQUIRED_REPORT_FIELD_MISSING'::text, 'ERROR'::public.validation_severity,
      'ต้องมีรายการพัสดุอย่างน้อยหนึ่งรายการ'::text, 'items'::text;
  end if;

  if btrim(coalesce(v_row.purpose, '')) = '' then
    return query select 'REQUIRED_REPORT_FIELD_MISSING'::text, 'ERROR'::public.validation_severity,
      'รายงานขอซื้อ/ขอจ้างต้องระบุเหตุผลความจำเป็น'::text, 'purpose'::text;
  end if;

  if v_row.classification is null then
    return query select 'REQUIRED_REPORT_FIELD_MISSING'::text, 'ERROR'::public.validation_severity,
      'รายงานขอซื้อ/ขอจ้างต้องระบุประเภทงาน'::text, 'classification'::text;
  end if;

  if v_row.procurement_method is null then
    return query select 'REQUIRED_REPORT_FIELD_MISSING'::text, 'ERROR'::public.validation_severity,
      'รายงานขอซื้อ/ขอจ้างต้องระบุวิธีจัดหา'::text, 'procurementMethod'::text;
  end if;

  if v_row.report_date is null then
    return query select 'REQUIRED_REPORT_FIELD_MISSING'::text, 'ERROR'::public.validation_severity,
      'รายงานขอซื้อ/ขอจ้างต้องระบุวันที่รายงานขอซื้อ/ขอจ้าง'::text, 'reportDate'::text;
  end if;

  -- ---- ยอดแหล่งเงินต้องเท่ากับยอดรวม (F-02) ----
  --
  -- อ่านจาก view procurement_totals ไม่ใช่จากค่าที่ผู้เรียกส่งมา
  -- ตารางไม่มีคอลัมน์ยอดให้เขียนอยู่แล้ว ยอดจึงมาจากรายการย่อยเสมอ
  select * into v_totals from public.procurement_totals where procurement_id = p_procurement_id;

  if v_item_count > 0 and coalesce(v_totals.funding_total, 0) <> coalesce(v_totals.grand_total, 0) then
    return query select 'FUNDING_TOTAL_MISMATCH'::text, 'ERROR'::public.validation_severity,
      format('ยอดแหล่งเงินรวม %s บาท ไม่เท่ากับยอดรวมของรายการ %s บาท',
        to_char(coalesce(v_totals.funding_total, 0), 'FM999999999990.00'),
        to_char(coalesce(v_totals.grand_total, 0), 'FM999999999990.00'))::text,
      'fundingAllocations'::text;
  end if;

  -- ---- งบต้องพอในทุกบัญชีที่อ้างถึง ----
  --
  -- รวมยอดต่อบัญชีก่อนเทียบ เพราะรายการเดียวอ้างบัญชีเดิมได้หลายบรรทัด
  for v_alloc in
    select budget_account_id, sum(amount) as total
    from public.procurement_funding_allocations
    where procurement_id = p_procurement_id
    group by budget_account_id
  loop
    v_available := public.budget_available(v_alloc.budget_account_id);
    v_requested := v_alloc.total;

    if v_requested > v_available then
      return query select 'BUDGET_INSUFFICIENT'::text, 'ERROR'::public.validation_severity,
        format('ยอดงบคงเหลือของบัญชีที่เลือกไม่พอ ต้องใช้ %s บาท แต่เหลือ %s บาท',
          to_char(v_requested, 'FM999999999990.00'),
          to_char(v_available, 'FM999999999990.00'))::text,
        'fundingAllocations'::text;
    end if;
  end loop;

  -- ---- ปีงบประมาณ ----
  if v_fiscal.status = 'CLOSED' then
    return query select 'FISCAL_YEAR_MISMATCH'::text, 'ERROR'::public.validation_severity,
      format('ปีงบประมาณ %s ปิดแล้ว ส่งอนุมัติรายการใหม่ไม่ได้', v_fiscal.code)::text,
      'fiscalYearId'::text;
  end if;

  for i in 1 .. array_length(v_names, 1) loop
    if v_dates[i] is null then continue; end if;

    if v_dates[i] < v_fiscal.start_date or v_dates[i] > v_fiscal.end_date then
      return query select 'FISCAL_YEAR_MISMATCH'::text, 'ERROR'::public.validation_severity,
        format('%s (%s) อยู่นอกช่วงปีงบประมาณ %s',
          v_labels[i], to_char(v_dates[i], 'DD/MM/YYYY'), v_fiscal.code)::text,
        v_names[i]::text;
    end if;
  end loop;

  -- ---- ลำดับเวลา (F-04) ----
  --
  -- เทียบ **ทุกคู่** ที่มีค่าครบทั้งสองข้าง ไม่ใช่เฉพาะขั้นที่ติดกัน
  -- เพราะรายการที่เว้นขั้นกลางไว้ว่างจะไม่ถูกตรวจเลยถ้าเทียบเฉพาะขั้นติดกัน
  -- ซึ่งเป็นรูปแบบเดียวกับ F-04 พอดี
  for i in 1 .. array_length(v_names, 1) loop
    if v_dates[i] is null then continue; end if;

    for j in i + 1 .. array_length(v_names, 1) loop
      if v_dates[j] is null then continue; end if;
      if v_dates[j] >= v_dates[i] then continue; end if;

      v_code := case
        when v_names[i] = 'requestDate' and v_names[j] = 'deliveryOrServiceDate'
          then 'DATE_REQUEST_AFTER_DELIVERY'
        when v_names[i] = 'approvedDate' and v_names[j] = 'orderOrAgreementDate'
          then 'DATE_APPROVAL_AFTER_ORDER'
        when v_names[i] = 'orderOrAgreementDate' and v_names[j] = 'deliveryOrServiceDate'
          then 'DATE_ORDER_AFTER_DELIVERY'
        else 'DATE_OUT_OF_ORDER'
      end;

      return query select v_code::text, 'ERROR'::public.validation_severity,
        format('%s (%s) เกิดก่อน%s (%s) ซึ่งเป็นลำดับที่เกิดขึ้นจริงไม่ได้',
          v_labels[j], to_char(v_dates[j], 'DD/MM/YYYY'),
          v_labels[i], to_char(v_dates[i], 'DD/MM/YYYY'))::text,
        v_names[j]::text;
    end loop;
  end loop;

  return;
end;
$$;

-- -----------------------------------------------------------------------------
-- กฎที่ยกเว้นได้ — ต้องตรงกับ OVERRIDABLE_RULES ใน src/domain/validation/rules.ts
--
-- เขียนเป็นบัญชี "ข้อที่ยกเว้นได้" ไม่ใช่ "ข้อที่ห้าม" เพื่อให้รหัสใหม่ที่เพิ่ม
-- ภายหลังถูกถือว่าห้ามยกเว้นโดยอัตโนมัติ ซึ่งเป็นค่าเริ่มต้นที่ปลอดภัยกว่า
-- -----------------------------------------------------------------------------

create or replace function public.is_overridable_rule(p_code text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_code in (
    'DATE_REQUEST_AFTER_DELIVERY',
    'DATE_APPROVAL_AFTER_ORDER',
    'DATE_ORDER_AFTER_DELIVERY',
    'DATE_OUT_OF_ORDER',
    'BUDGET_INSUFFICIENT',
    'VENDOR_INCOMPLETE'
  )
$$;

-- -----------------------------------------------------------------------------
-- ส่งอนุมัติ
-- -----------------------------------------------------------------------------

create or replace function public.procurement_submit(
  p_procurement_id uuid,
  p_expected_version integer,
  p_exception_reason text default null,
  p_exception_attachment_id uuid default null,
  p_request_id text default 'system'
)
returns public.procurement_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.procurements%rowtype;
  v_actor uuid := auth.uid();
  v_can_override boolean := public.has_permission('procurement.override_validation');
  v_blocking integer := 0;
  v_overridden integer := 0;
  v_first_blocking text;
  v_finding record;
begin
  if not public.has_permission('procurement.submit') then
    raise exception 'ไม่มีสิทธิ์ส่งรายการเข้าสู่การอนุมัติ' using errcode = 'insufficient_privilege';
  end if;

  -- ล็อกแถวก่อนอ่าน เพื่อไม่ให้สองคำขอส่งพร้อมกันแล้วผ่านทั้งคู่
  select * into v_row from public.procurements
  where id = p_procurement_id and deleted_at is null
  for update;

  if not found then
    raise exception 'ไม่พบรายการนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = 'no_data_found';
  end if;

  if v_row.status not in ('DRAFT', 'NEEDS_REVISION') then
    raise exception 'รายการนี้อยู่ในสถานะที่ส่งอนุมัติซ้ำไม่ได้'
      using errcode = 'restrict_violation';
  end if;

  /*
   * ตรวจ version ที่นี่ด้วย ไม่ใช่แค่ตอนแก้ไข
   *
   * ผู้ใช้ที่เปิดหน้าค้างไว้แล้วมีคนอื่นแก้รายการย่อยระหว่างนั้น จะส่งอนุมัติ
   * รายการที่ตัวเองไม่เคยเห็นยอดจริง การบังคับ version ทำให้ต้องโหลดใหม่ก่อน
   */
  if v_row.version <> p_expected_version then
    raise exception 'มีผู้อื่นแก้ไขรายการนี้ไปแล้ว กรุณาโหลดหน้าใหม่แล้วตรวจก่อนส่งอนุมัติ'
      using errcode = 'serialization_failure';
  end if;

  -- ล้างผลตรวจของรอบก่อนในขั้นเดียวกัน เพื่อให้เหลือผลของรอบล่าสุดเสมอ
  delete from public.procurement_validations
  where procurement_id = p_procurement_id and stage = 'SUBMIT';

  for v_finding in select * from public.procurement_check_submit(p_procurement_id) loop
    if v_finding.severity = 'ERROR' then
      if v_can_override and public.is_overridable_rule(v_finding.rule_code) then
        v_overridden := v_overridden + 1;
      else
        v_blocking := v_blocking + 1;
        if v_first_blocking is null then
          v_first_blocking := v_finding.message;
        end if;
      end if;
    end if;

    insert into public.procurement_validations (
      procurement_id, stage, rule_code, severity, message, field, overridden, checked_by
    ) values (
      p_procurement_id, 'SUBMIT', v_finding.rule_code, v_finding.severity,
      v_finding.message, v_finding.field,
      v_finding.severity = 'ERROR'
        and v_can_override
        and public.is_overridable_rule(v_finding.rule_code),
      v_actor
    );
  end loop;

  if v_blocking > 0 then
    raise exception 'ส่งอนุมัติไม่ได้ ยังมีข้อที่ต้องแก้ %s ข้อ — %s', v_blocking, v_first_blocking
      using errcode = 'check_violation';
  end if;

  /*
   * การใช้สิทธิ์ยกเว้นต้องมีเหตุผลเสมอ สิทธิ์อย่างเดียวไม่พอ
   *
   * เหตุผลเดียวกับการลงงบเกินยอด: ผู้ตรวจสอบต้องอ่านย้อนหลังได้ว่าทำไมจึง
   * ยอมให้ผ่าน ข้อยกเว้นที่ไม่มีเหตุผลกำกับเท่ากับไม่มีการควบคุม
   */
  if v_overridden > 0 and btrim(coalesce(p_exception_reason, '')) = '' then
    raise exception 'การส่งอนุมัติโดยใช้ข้อยกเว้นต้องระบุเหตุผล'
      using errcode = 'check_violation';
  end if;

  update public.procurements
  set status = 'PENDING_REVIEW',
      exception_reason = case when v_overridden > 0 then p_exception_reason else exception_reason end,
      exception_attachment_id = case
        when v_overridden > 0 then p_exception_attachment_id else exception_attachment_id end,
      exception_granted_by = case when v_overridden > 0 then v_actor else exception_granted_by end,
      exception_granted_at = case when v_overridden > 0 then now() else exception_granted_at end,
      updated_by = v_actor
  where id = p_procurement_id;

  insert into public.audit_events (
    request_id, actor_id, action, entity_type, entity_id, before_json, after_json, metadata_json
  ) values (
    p_request_id, v_actor, 'procurement.status_change', 'procurement', p_procurement_id::text,
    jsonb_build_object('status', v_row.status),
    jsonb_build_object('status', 'PENDING_REVIEW'),
    jsonb_build_object(
      'overridden_rule_count', v_overridden,
      'exception_reason', case when v_overridden > 0 then p_exception_reason else null end
    )
  );

  return 'PENDING_REVIEW'::public.procurement_status;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS ของผลตรวจ และสิทธิ์เรียก function
-- -----------------------------------------------------------------------------

alter table public.procurement_validations enable row level security;

-- เห็นผลตรวจได้เมื่อเห็นรายการนั้นได้ ใช้กติกาเดียวกับตัวรายการ ไม่นิยามซ้ำ
create policy procurement_validations_select on public.procurement_validations
  for select to authenticated
  using (public.can_read_procurement(procurement_id));

-- append-only: เขียนได้ผ่าน function เท่านั้น เหมือน budget_movements
revoke insert, update, delete on public.procurement_validations from authenticated, anon;

revoke execute on function public.procurement_check_submit(uuid) from public;
revoke execute on function public.procurement_submit(uuid, integer, text, uuid, text) from public;
revoke execute on function public.is_overridable_rule(text) from public;

grant execute on function public.procurement_check_submit(uuid) to authenticated;
grant execute on function public.procurement_submit(uuid, integer, text, uuid, text) to authenticated;
grant execute on function public.is_overridable_rule(text) to authenticated;
