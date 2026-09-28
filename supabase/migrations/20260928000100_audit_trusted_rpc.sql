-- =============================================================================
-- Migration 0023 — PR-S01: ปิด direct insert ของ audit_events, สร้าง trusted RPC
--
-- ที่มา: รายงานตรวจสอบวันที่ 27 กันยายน 2569 (P0 ที่ทิ้งไว้ตอนแก้ PR-09d — ดู
-- docs/assumptions.md ข้อ 2.28) — เป็นงานที่กระทบ RLS ของตารางที่ทุก mutation
-- ในระบบใช้ร่วมกัน จึงแยกเป็น PR ของตัวเองบน main แทนที่จะทำพ่วงไปกับ PR อื่น
--
-- ช่องโหว่เดิม: policy `audit_events_insert` ตรวจแค่ "บัญชี active"
-- (current_profile_is_active()) ไม่ได้ตรวจว่า actor_id ที่ผู้เรียกส่งมาตรงกับ
-- ผู้เรียกจริงหรือไม่ ผู้ใช้ที่มี valid session จึงเรียก Supabase REST API ตรง
-- (ข้าม Next.js server action ทั้งหมด) แล้ว insert แถวที่ actor_id เป็นคนอื่นได้
-- — audit_events เป็นตารางเดียวที่ระบบอ้างว่า "แก้ไม่ได้ ตรวจสอบย้อนหลังได้เสมอ"
-- (append-only ทั้ง policy และ trigger) แต่ตัวตนผู้กระทำในแถวกลับปลอมได้จากช่องทาง
-- ที่ไม่ใช่แอป ทำให้หลักฐานทั้งตารางใช้ยืนยันอะไรไม่ได้จริง
--
-- ทางแก้ (เหมือน budget_movements/stock_movements): ปิด insert policy/privilege
-- ทั้งหมด เขียนได้ทางเดียวคือ RPC ที่กำหนด actor_id จาก auth.uid() ของผู้เรียก
-- เองเสมอ ไม่รับค่าจาก client
--
-- ไม่กระทบ RPC เดิมที่ insert เข้า audit_events อยู่แล้วในทรานแซกชันเดียวกับ
-- ข้อมูลหลัก (budget_post_movement, stock_post_movement, procurement_transition,
-- procurement_disburse ฯลฯ) เพราะทุกตัวเป็น security definer ที่รันเป็นเจ้าของ
-- ฟังก์ชัน (ผู้รัน migration) ซึ่งไม่ถูก grant/revoke ของ authenticated/anon
-- บังคับอยู่แล้ว — เหตุผลเดียวกับที่ตารางเหล่านั้นเองก็ไม่มี insert policy
--
-- ข้อจำกัดที่ทราบ: RPC นี้ต้องมี auth.uid() (คือต้องมี session) จึงยังไม่รองรับ
-- เหตุการณ์ที่เกิดก่อนมี session เช่น auth.login_failed ของผู้ใช้ที่พิมพ์รหัส
-- ผิด — ฟีเจอร์นั้นยังไม่มี call site จริงในโค้ด (มีแค่ชนิดที่ประกาศไว้) จึงยังไม่
-- ต้องแก้ในรอบนี้ ถ้าจะทำต้องออกแบบเส้นทางแยกสำหรับผู้เรียกที่ยังไม่ authenticated
-- =============================================================================

drop policy if exists audit_events_insert on public.audit_events;
revoke insert on public.audit_events from authenticated, anon;

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
begin
  if v_actor is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะบันทึก audit event ได้' using errcode = 'insufficient_privilege';
  end if;

  if not public.current_profile_is_active() then
    raise exception 'บัญชีนี้ถูกปิดใช้งาน' using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_events (
    request_id, actor_id, action, entity_type, entity_id,
    before_json, after_json, metadata_json, ip_hash, user_agent
  ) values (
    p_request_id, v_actor, p_action, p_entity_type, p_entity_id,
    p_before_json, p_after_json, p_metadata_json, p_ip_hash, p_user_agent
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.record_audit_event(
  text, text, text, text, jsonb, jsonb, jsonb, text, text
) from public, anon;

grant execute on function public.record_audit_event(
  text, text, text, text, jsonb, jsonb, jsonb, text, text
) to authenticated;
