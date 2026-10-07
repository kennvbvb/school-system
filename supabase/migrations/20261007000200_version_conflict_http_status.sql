-- =============================================================================
-- RPC ที่แจ้ง "version ชน" ด้วย SQLSTATE 40001 (serialization_failure) ทำให้ PostgREST ไม่ตอบกลับ
--
-- พบตอนทดสอบ RPC บันทึกร่างผ่าน PostgREST 12.2.3 จริง: ฟังก์ชันที่ `raise ... using errcode =
-- 'serialization_failure'` ทำให้คำขอ HTTP **ค้างไม่ตอบ** (PostgREST ลองซ้ำเมื่อเจอ 40001 และ
-- วนต่อเนื่อง — ยืนยันด้วยการลบฟังก์ชันระหว่างที่คำขอค้าง คำขอจึงจบด้วย 404 หลัง ~45 วินาที)
-- SQL test ตรงบน PostgreSQL ไม่เห็นปัญหานี้เพราะไม่ผ่าน PostgREST
--
-- ฟังก์ชันเดิมสองตัวใช้รหัสนี้กับกรณี "มีผู้อื่นแก้ไขไปแล้ว" (optimistic concurrency): procurement_submit
-- (ส่งอนุมัติ) และ procurement_transition (ดำเนินการตามสายอนุมัติ) — ผู้ใช้ที่กดซ้ำด้วยหน้าเก่าจะเจอหน้าค้าง
-- แทนข้อความให้โหลดใหม่
-- (ยังไม่ยืนยันว่า PostgREST เวอร์ชันที่ Supabase โฮสต์ลองซ้ำแบบเดียวกัน แต่ 409 ที่ตอบกลับทันทีถูกต้องกว่า
-- ในทุกกรณี)
--
-- ทางแก้: เปลี่ยนเป็น PT409 — PostgREST แปลง PTnnn เป็น HTTP nnn ตรง ๆ (ได้ 409 พร้อมข้อความไทยเดิม)
-- ข้อความ ลำดับการตรวจ และตรรกะอื่นของฟังก์ชันไม่เปลี่ยน แก้เฉพาะรหัส error โดยสร้างฟังก์ชันซ้ำจากนิยามเดิม
-- (create or replace คงสิทธิ์ execute เดิมไว้) — ใช้ DO block แทนการคัดลอกฟังก์ชันขนาดใหญ่มาแก้
-- ตรรกะเดียวกันซ้ำ เพื่อไม่ให้เปลี่ยนอะไรเกินรหัส error
-- =============================================================================

do $$
declare
  f record;
  v_def text;
  v_count integer := 0;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosrc ~* 'errcode\s*=\s*''serialization_failure'''
  loop
    v_def := regexp_replace(
      pg_get_functiondef(f.oid),
      'errcode(\s*)=(\s*)''serialization_failure''',
      'errcode\1=\2''PT409''',
      'gi'
    );
    execute v_def;
    v_count := v_count + 1;
    raise notice 'เปลี่ยนรหัส version ชนเป็น PT409: %', f.sig;
  end loop;

  -- ต้องเจออย่างน้อยหนึ่งตัว และไม่เหลือตัวใดที่ยังใช้ 40001 — ถ้าไม่เจอเลยแปลว่าการค้นหาผิดและ migration
  -- นี้ไม่ได้ทำงาน (ฟังก์ชันที่ migration หลังสร้างทับตัวเดิมไม่นับ: ตรวจจากนิยามปัจจุบันในฐานข้อมูล)
  if v_count < 1 then
    raise exception 'ไม่พบฟังก์ชันที่ใช้ serialization_failure เลย — การค้นหาผิด';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~* 'errcode\s*=\s*''serialization_failure'''
  ) then
    raise exception 'ยังมีฟังก์ชันใน public ที่ใช้ serialization_failure หลังแปลงแล้ว';
  end if;
end
$$;
