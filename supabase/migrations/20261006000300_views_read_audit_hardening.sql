-- =============================================================================
-- แก้ F-06 (view/read RPC ข้ามสิทธิ์) และ F-07 (audit event ปลอมได้) ในรายงานตรวจสอบ
-- 2026-10-06
--
-- F-06  1) view ทั้งสี่ตัวรันด้วยสิทธิ์เจ้าของ (postgres) จึงข้าม RLS ของตารางเบื้องหลัง —
--          ผู้ใช้ที่ login แล้วทุกคน select procurement_totals / budget_account_balances /
--          stock_item_balances ได้ทั้งตาราง แม้ไม่มีสิทธิ์อ่านรายการเหล่านั้นเลย
--          → security_invoker = true ให้ RLS ของผู้เรียกบังคับผ่าน view
--       2) budget_available() / stock_on_hand() เป็น security definer ที่ authenticated เรียกตรงได้
--          โดยไม่มีการตรวจสิทธิ์อ่าน — แอปไม่เคยเรียกสองตัวนี้ตรง (ใช้ภายใน RPC ที่ตรวจสิทธิ์แล้ว)
--          → เป็นฟังก์ชันภายใน เพิกถอน execute จาก authenticated/anon (RPC ที่เป็น definer
--            เรียกต่อได้เพราะรันเป็นเจ้าของ)
--       3) Supabase ให้ anon มีสิทธิ์ execute ฟังก์ชัน/อ่านตารางใน public โดยค่าเริ่มต้น (revoke
--          from public อย่างเดียวไม่พอ) → เพิกถอนทั้งหมดจาก anon และ PUBLIC แล้วคืนให้ authenticated
--          เฉพาะฟังก์ชันที่เดิมมีสิทธิ์อยู่ (พฤติกรรมของผู้ใช้ที่ login แล้วไม่เปลี่ยน)
--
-- F-07  record_audit_event() รับ action/entity/before/after/metadata อิสระจากผู้ใช้ทุกคน จึงอ้างว่า
--       ตนออกเอกสาร เปลี่ยนสิทธิ์ หรือ export พร้อม checksum ที่สร้างเองได้
--       → RPC นี้เป็น "ช่องทางรายงานจากแอป" เท่านั้น:
--         * รับเฉพาะคู่ (action, entity_type) ที่แอปรายงานจริง และต้องมีสิทธิ์ของงานนั้น
--         * อ้างถึงแถวที่มีอยู่จริงเท่านั้น (ปลอมเหตุการณ์ของ entity ที่ไม่มีอยู่ไม่ได้)
--         * action ที่ฐานข้อมูลเขียนเองใน RPC ธุรกรรม (user.roles_change, procurement.disburse ฯลฯ
--           และ stock/budget movement) **เขียนผ่านช่องทางนี้ไม่ได้เลย**
--         * ติด provenance = 'APP_REPORTED' ทุกแถว แยกจากแถวที่ RPC ธุรกรรมเขียน
--           ('DB_TRUSTED') — ค่าใน metadata (เช่น checksum ของไฟล์ export) ของแถว APP_REPORTED
--           เป็นคำบอกเล่าของแอป ไม่ใช่สิ่งที่ฐานข้อมูลตรวจต้นทางให้
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) view ทั้งสี่ตัวใช้ RLS ของผู้เรียก
--
-- ต้องตั้งทุกตัว: view ซ้อน view (procurement_totals → procurement_item_amounts) ตัวในที่ไม่ตั้ง
-- จะรันด้วยสิทธิ์เจ้าของแล้วข้าม RLS ต่อไป
-- RPC แบบ security definer ที่อ่าน view เหล่านี้ (procurement_submit ฯลฯ) ยังทำงานเหมือนเดิม
-- เพราะผู้เรียก view ในนั้นคือเจ้าของฟังก์ชัน
-- -----------------------------------------------------------------------------

alter view public.procurement_item_amounts set (security_invoker = true);
alter view public.procurement_totals set (security_invoker = true);
alter view public.budget_account_balances set (security_invoker = true);
alter view public.stock_item_balances set (security_invoker = true);

-- -----------------------------------------------------------------------------
-- 2) ฟังก์ชันภายใน — ไม่ให้ client เรียกตรง
-- -----------------------------------------------------------------------------

revoke execute on function public.budget_available(uuid) from public, anon, authenticated;
revoke execute on function public.stock_on_hand(uuid) from public, anon, authenticated;

comment on function public.budget_available(uuid) is
  'ฟังก์ชันภายในสำหรับ RPC ธุรกรรม (security definer) — client เรียกตรงไม่ได้ อ่านยอดงบผ่าน view budget_account_balances (RLS)';
comment on function public.stock_on_hand(uuid) is
  'ฟังก์ชันภายใน — client เรียกตรงไม่ได้ อ่านยอดสต็อกผ่าน view stock_item_balances (RLS)';

-- -----------------------------------------------------------------------------
-- 3) anon ต้องไม่มีสิทธิ์อะไรใน schema public
--
-- ฟังก์ชัน: เพิกถอนจาก PUBLIC และ anon แล้วให้ authenticated เฉพาะตัวที่เดิม execute ได้
-- (ผู้ใช้ที่ login แล้วได้สิทธิ์เท่าเดิมทุกประการ — เว้นสองตัวในข้อ 2 ที่ถูกถอนไปแล้วก่อนถึงจุดนี้)
-- ตาราง/view/sequence: anon ไม่มีทางใช้งานจริง (ทุก policy เป็น to authenticated) ถอนทั้งหมด
-- -----------------------------------------------------------------------------

do $$
declare
  f record;
  had_auth boolean;
  had_service boolean;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    had_auth := has_function_privilege('authenticated', f.oid, 'execute');
    had_service := exists (select 1 from pg_roles where rolname = 'service_role')
      and has_function_privilege('service_role', f.oid, 'execute');
    execute format('revoke execute on function %s from public, anon', f.sig);
    if had_auth then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    -- service_role (ฝั่ง server เท่านั้น) คงสิทธิ์เดิม ไม่ให้การถอน PUBLIC ทำให้สูญเสียไปโดยอ้อม
    if had_service then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end
$$;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ฟังก์ชัน/ตารางที่จะสร้างใหม่ภายหลังด้วยบทบาทที่รัน migration นี้: ไม่ให้ anon โดยค่าเริ่มต้น
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- -----------------------------------------------------------------------------
-- 4) audit_events.provenance
--
-- DB_TRUSTED   = เขียนโดย RPC ธุรกรรม (security definer) ในทรานแซกชันเดียวกับข้อมูลที่บันทึกถึง
-- APP_REPORTED = แอปรายงานผ่าน record_audit_event() — ฐานข้อมูลตรวจสิทธิ์และการมีอยู่ของ entity
--                แต่ไม่ได้พิสูจน์ว่าเนื้อหา (before/after/metadata) ตรงกับสิ่งที่เกิดขึ้นจริง
--
-- แถวเดิม: จัดเป็น APP_REPORTED ถ้าเป็นคู่ (action, entity_type) ที่แอปรายงานตามปกติ
-- นอกนั้น (stock/budget movement, user.roles_change ฯลฯ) เป็น DB_TRUSTED
-- (audit_events กันการแก้ด้วยการเพิกถอน update/delete จาก authenticated/anon ไม่มี trigger — migration รันเป็นเจ้าของตารางจึง update ได้)
-- -----------------------------------------------------------------------------

alter table public.audit_events add column provenance text not null default 'DB_TRUSTED';
alter table public.audit_events
  add constraint audit_events_provenance_valid check (provenance in ('DB_TRUSTED', 'APP_REPORTED'));

-- -----------------------------------------------------------------------------
-- สิทธิ์ที่ต้องมีต่อคู่ (action, entity_type) ที่แอปรายงานได้ — คืน null ถ้าไม่อนุญาต
-- ใช้ chain เดียวกับที่ server action ตรวจก่อนเรียก (ดู src/server/**/actions.ts)
-- 'SELF' = ต้องเป็นเหตุการณ์ของผู้เรียกเอง (entity_id = auth.uid())
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

    when p_action = 'entity.create' and p_entity_type = 'procurement' then 'procurement.create'
    when p_action = 'entity.update' and p_entity_type = 'procurement' then 'procurement.edit_draft'
    when p_action = 'procurement.status_change' and p_entity_type = 'procurement' then 'procurement.submit'

    when p_action in ('entity.create', 'admin.action') and p_entity_type = 'budget_account' then 'budget.manage'
    when p_action in ('entity.create', 'admin.action') and p_entity_type = 'inventory_item' then 'inventory.adjust'

    when p_action = 'report.export' and p_entity_type = 'report_export' then 'reports.export'
    else null
  end;
$$;

revoke execute on function public.audit_reportable_permission(text, text) from public, anon;
grant execute on function public.audit_reportable_permission(text, text) to authenticated;

-- backfill provenance ของแถวเดิม
update public.audit_events
set provenance = 'APP_REPORTED'
where public.audit_reportable_permission(action, entity_type) is not null;

-- -----------------------------------------------------------------------------
-- record_audit_event — ช่องทาง "แอปรายงาน" ที่ถูกจำกัด (F-07)
-- -----------------------------------------------------------------------------

create or replace function public.record_audit_event(
  p_request_id text,
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_before_json jsonb default null,
  p_after_json jsonb default null,
  p_metadata_json jsonb default null,
  p_ip_hash text default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_required text;
  v_exists boolean;
  v_entity uuid;
begin
  if v_actor is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะบันทึก audit event ได้' using errcode = 'insufficient_privilege';
  end if;

  if not public.current_profile_is_active() then
    raise exception 'บัญชีนี้ถูกปิดใช้งาน' using errcode = 'insufficient_privilege';
  end if;

  v_required := public.audit_reportable_permission(p_action, p_entity_type);

  if v_required is null then
    raise exception 'เหตุการณ์ % ของ % แอปรายงานเองไม่ได้ — ต้องเกิดจาก RPC ธุรกรรมในฐานข้อมูล', p_action, p_entity_type
      using errcode = 'insufficient_privilege';
  end if;

  if v_required = 'SELF' then
    if p_entity_id is distinct from v_actor::text then
      raise exception 'รายงานเหตุการณ์ % ได้เฉพาะของตนเอง', p_action using errcode = 'insufficient_privilege';
    end if;
  elsif not public.has_permission(v_required) then
    raise exception 'ไม่มีสิทธิ์รายงานเหตุการณ์ % ของ %', p_action, p_entity_type
      using errcode = 'insufficient_privilege';
  end if;

  -- อ้างถึงแถวที่มีอยู่จริงเท่านั้น ปลอมเหตุการณ์ของสิ่งที่ไม่มีอยู่ไม่ได้
  if p_entity_type = 'report_export' then
    if p_entity_id not in ('budget-report', 'procurement-register', 'document-status') then
      raise exception 'ไม่รู้จักรายงาน %', p_entity_id using errcode = 'check_violation';
    end if;
  else
    begin
      v_entity := p_entity_id::uuid;
    exception when invalid_text_representation then
      raise exception 'entity_id ของ % ต้องเป็น UUID', p_entity_type using errcode = 'check_violation';
    end;

    execute format(
      'select exists (select 1 from public.%I where id = $1)',
      case p_entity_type
        when 'profile' then 'profiles'
        when 'fiscal_year' then 'fiscal_years'
        when 'funding_source' then 'funding_sources'
        when 'project' then 'projects'
        when 'vendor' then 'vendors'
        when 'procurement' then 'procurements'
        when 'budget_account' then 'budget_accounts'
        when 'inventory_item' then 'inventory_items'
      end
    ) into v_exists using v_entity;

    if not v_exists then
      raise exception 'ไม่พบ % ที่อ้างถึง', p_entity_type using errcode = 'foreign_key_violation';
    end if;
  end if;

  -- กัน payload ขนาดผิดปกติ (log ไม่ใช่ที่เก็บไฟล์)
  if length(coalesce(p_before_json::text, '')) + length(coalesce(p_after_json::text, ''))
     + length(coalesce(p_metadata_json::text, '')) > 32768 then
    raise exception 'ข้อมูลประกอบ audit event ใหญ่เกินกำหนด' using errcode = 'check_violation';
  end if;

  insert into public.audit_events (
    request_id, actor_id, action, entity_type, entity_id,
    before_json, after_json, metadata_json, ip_hash, user_agent, provenance
  ) values (
    p_request_id, v_actor, p_action, p_entity_type, p_entity_id,
    p_before_json, p_after_json, p_metadata_json,
    left(p_ip_hash, 64), left(p_user_agent, 512), 'APP_REPORTED'
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_audit_event(text, text, text, text, jsonb, jsonb, jsonb, text, text) is
  'ช่องทางแอปรายงาน audit event (provenance = APP_REPORTED): จำกัดคู่ action/entity ตรวจสิทธิ์และการมีอยู่ของแถว '
  'เหตุการณ์ธุรกรรมต้องเขียนโดย RPC ของธุรกรรมนั้นเอง (provenance = DB_TRUSTED)';

revoke execute on function public.record_audit_event(
  text, text, text, text, jsonb, jsonb, jsonb, text, text
) from public, anon;
grant execute on function public.record_audit_event(
  text, text, text, text, jsonb, jsonb, jsonb, text, text
) to authenticated;
