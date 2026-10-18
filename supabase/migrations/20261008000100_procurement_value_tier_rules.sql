-- =============================================================================
-- Migration 20261008000100 — กฎส่งอนุมัติแยกตามวงเงิน
--
-- ที่มา: ผลค้นระเบียบพัสดุจากไฟล์ต้นฉบับ (ตุลาคม 2569)
--
--   กฎกระทรวงกำหนดวงเงินฯ พ.ศ. 2560 ข้อ 1  ไม่เกิน 500,000 บาท ให้ใช้วิธีเฉพาะเจาะจง
--   ระเบียบ กค. 2560 ข้อ 22               รายงานขอซื้อ/ขอจ้าง 8 รายการ
--                                          (ฉุกเฉินทำเฉพาะรายการที่จำเป็นได้)
--   ระเบียบ กค. 2560 ข้อ 79 วรรคสอง       เร่งด่วนที่คาดไม่ได้ ซื้อก่อนรายงานตามหลังได้
--   ข่าว กวจ. 52/2568 (ว804 ใช้ 1 ธ.ค. 2568)
--                                          ซื้อไม่เกิน 50,000 บาท รายงาน 3 รายการ
--                                          และรายงานสรุปผลภายใน 5 วันทำการหลังซื้อ
--
-- เปลี่ยนเฉพาะ procurement_check_submit() — procurement_submit() เรียกฟังก์ชันนี้อยู่แล้ว
-- จึงบังคับตามกฎใหม่ทันที ฟังก์ชัน is_overridable_rule() ไม่เปลี่ยน
-- รหัสกฎใหม่ทั้งหมดไม่อยู่ในรายการที่ยกเว้นได้ (METHOD_EXCEEDS_LIMIT ห้ามยกเว้น,
-- อีกสองรหัสไม่ใช่ ERROR)
--
-- กฎชุดเดียวกันอยู่ใน src/domain/procurement/submit-rules.ts และ value-tier.ts
-- ฝั่งนั้นให้ผู้ใช้เห็นล่วงหน้า ฝั่งนี้เป็นผู้ตัดสิน
-- =============================================================================

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
  -- ขั้นวงเงิน (ต้องตรงกับ src/domain/procurement/value-tier.ts)
  v_total numeric;
  v_tier text;
  v_simplified boolean := false;
  v_buy_first boolean := false;
  v_buy_first_used boolean := false;
  v_purchase_date date;
  v_days integer;
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

  select count(*) into v_item_count
  from public.procurement_items where procurement_id = p_procurement_id;

  -- ---- ขั้นวงเงิน ----
  --
  -- คำนวณก่อนตรวจช่องบังคับ เพราะช่องบังคับขึ้นกับวงเงิน
  -- ไม่มีรายการเลย = ไม่รู้วงเงิน ถือว่าเข้มที่สุดไว้ก่อน (v_tier เป็น null)
  select * into v_totals from public.procurement_totals where procurement_id = p_procurement_id;
  v_total := coalesce(v_totals.grand_total, 0);

  if v_item_count > 0 then
    v_tier := case
      when v_total <= 50000 then 'UP_TO_50K'
      when v_total <= 100000 then 'UP_TO_100K'
      when v_total <= 500000 then 'UP_TO_500K'
      else 'OVER_500K'
    end;
  end if;

  -- ซื้อ (ไม่ใช่จ้าง) ไม่เกิน 50,000 บาท ใช้รายงาน 3 รายการตาม ว804 (ข่าว กวจ. 52/2568)
  v_simplified := v_tier = 'UP_TO_50K'
    and v_row.classification = 'GOODS'
    and not v_row.is_emergency;

  -- ซื้อก่อนรายงานตามหลังได้: เร่งด่วน (ระเบียบ ข้อ 79 วรรคสอง) หรือซื้อขั้นตอนย่อ (ว804)
  v_buy_first := v_tier is not null
    and (v_row.is_emergency or (v_tier = 'UP_TO_50K' and v_row.classification = 'GOODS'));

  -- ---- ช่องบังคับของรายงานขอซื้อ/ขอจ้าง ----
  if v_item_count = 0 then
    return query select 'REQUIRED_REPORT_FIELD_MISSING'::text, 'ERROR'::public.validation_severity,
      'ต้องมีรายการพัสดุอย่างน้อยหนึ่งรายการ'::text, 'items'::text;
  end if;

  -- ข้อ 22(1) เหตุผลความจำเป็น: ว804 ตัดออกสำหรับซื้อไม่เกิน 50,000 บาท กรณีฉุกเฉินต้องมีเสมอ
  if not v_simplified and btrim(coalesce(v_row.purpose, '')) = '' then
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

  -- ข้อ 22(5) กำหนดเวลาที่ต้องการใช้พัสดุ: ข้อ 22 วรรคสองให้ตัดรายการได้เมื่อฉุกเฉิน
  if not v_simplified and not v_row.is_emergency and v_row.required_date is null then
    return query select 'REQUIRED_REPORT_FIELD_MISSING'::text, 'ERROR'::public.validation_severity,
      'รายงานขอซื้อ/ขอจ้างต้องระบุกำหนดเวลาที่ต้องการใช้พัสดุหรือให้งานแล้วเสร็จ'::text,
      'requiredDate'::text;
  end if;

  -- ---- วิธีจัดหาเทียบกับวงเงิน (กฎกระทรวงกำหนดวงเงินฯ พ.ศ. 2560 ข้อ 1) ----
  if v_tier = 'OVER_500K'
     and v_row.procurement_method = 'SPECIFIC'
     and not v_row.is_emergency
     and btrim(coalesce(v_row.method_legal_basis_code, '')) = '' then
    return query select 'METHOD_EXCEEDS_LIMIT'::text, 'ERROR'::public.validation_severity,
      format('วงเงิน %s บาท เกิน 500,000.00 บาท ใช้วิธีเฉพาะเจาะจงไม่ได้ เว้นแต่เป็นกรณีฉุกเฉินหรือระบุฐานกฎหมายของวิธีนี้',
        to_char(v_total, 'FM999999999990.00'))::text,
      'procurementMethod'::text;
  end if;

  if v_tier is not null and v_tier <> 'OVER_500K'
     and v_row.procurement_method in ('AUCTION', 'SELECTION') then
    return query select 'METHOD_NOT_SPECIFIC_FOR_SMALL'::text, 'WARNING'::public.validation_severity,
      format('วงเงิน %s บาท ไม่เกิน 500,000.00 บาท กฎกระทรวงกำหนดให้ใช้วิธีเฉพาะเจาะจง — ตรวจว่าเลือกวิธีจัดหาถูกต้องหรือไม่',
        to_char(v_total, 'FM999999999990.00'))::text,
      'procurementMethod'::text;
  end if;

  -- ---- ยอดแหล่งเงินต้องเท่ากับยอดรวม (F-02) ----
  --
  -- อ่านจาก view procurement_totals ไม่ใช่จากค่าที่ผู้เรียกส่งมา
  -- ตารางไม่มีคอลัมน์ยอดให้เขียนอยู่แล้ว ยอดจึงมาจากรายการย่อยเสมอ
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

      -- ซื้อก่อนรายงานตามหลัง: ผ่อนเฉพาะ "ขั้นเอกสาร" ที่ตามหลัง "ขั้นปฏิบัติ"
      -- ต้องตรงกับ BUY_FIRST_DOCUMENT_STEPS / BUY_FIRST_ACTION_STEPS ใน chronology.ts
      if v_buy_first
         and v_names[i] in ('requestDate', 'reportDate', 'approvedDate', 'selectionDate')
         and v_names[j] in ('orderOrAgreementDate', 'deliveryOrServiceDate', 'inspectionDate') then
        v_buy_first_used := true;
        continue;
      end if;

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

  -- ---- แจ้งว่าใช้ทางลัด "ซื้อก่อนรายงานตามหลัง" ----
  --
  -- ซื้อขั้นตอนย่อมีกำหนดชัด 5 วันทำการนับถัดจากวันซื้อ (ว804) เกินกำหนดเป็น WARNING
  -- กรณีเร่งด่วนข้อ 79 วรรคสองมีแค่ "รีบรายงาน" ไม่มีจำนวนวัน จึงเป็น INFO อย่างเดียว
  --
  -- นับวันทำการแบบจันทร์–ศุกร์ ไม่รู้วันหยุดราชการ ผลมากกว่าหรือเท่าของจริงเสมอ
  -- เกินกำหนดจึงเป็น WARNING ไม่ใช่ ERROR
  if v_buy_first_used then
    select min(d) into v_purchase_date
    from unnest(array[v_row.order_or_agreement_date, v_row.delivery_or_service_date]) as d
    where d is not null;

    if v_simplified and v_purchase_date is not null and v_row.report_date > v_purchase_date then
      select count(*) into v_days
      from generate_series(v_purchase_date + 1, v_row.report_date, interval '1 day') as g(day)
      where extract(isodow from g.day) < 6;

      if v_days > 5 then
        return query select 'BUY_FIRST_REPORT_DEADLINE'::text, 'WARNING'::public.validation_severity,
          format('ซื้อก่อนรายงาน: รายงานสรุปผลเสนอหลังวันซื้อ %s วันทำการ เกิน 5 วันทำการตามแนวปฏิบัติซื้อไม่เกิน 50,000 บาท (นับวันหยุดราชการเป็นวันทำการ ตรวจวันที่จริงอีกครั้ง)', v_days)::text,
          'reportDate'::text;
      else
        return query select 'BUY_FIRST_REPORT_DEADLINE'::text, 'INFO'::public.validation_severity,
          format('ซื้อก่อนรายงาน: รายงานสรุปผลเสนอหลังวันซื้อ %s วันทำการ อยู่ในกำหนด 5 วันทำการ', v_days)::text,
          'reportDate'::text;
      end if;
    else
      return query select 'BUY_FIRST_REPORT_DEADLINE'::text, 'INFO'::public.validation_severity,
        'ซื้อ/จ้างไปก่อนแล้วรายงานตามหลัง (กรณีเร่งด่วน ระเบียบ ข้อ 79 วรรคสอง) — ต้องรีบรายงานขอความเห็นชอบ และเมื่อหัวหน้าหน่วยงานเห็นชอบถือเป็นหลักฐานตรวจรับโดยอนุโลม'::text,
        'reportDate'::text;
    end if;
  end if;

  return;
end;
$$;

revoke execute on function public.procurement_check_submit(uuid) from public;
grant execute on function public.procurement_check_submit(uuid) to authenticated;
