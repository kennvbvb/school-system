-- =============================================================================
-- จำลองสภาพแวดล้อมของ Supabase สำหรับรัน migration และ test บน PostgreSQL เปล่า
--
-- ใช้เมื่อรัน Supabase CLI ไม่ได้ (เช่นเครื่องที่ไม่มี Docker)
-- CI ใช้ Supabase CLI จริงจึงไม่ต้องใช้ไฟล์นี้
--
-- สำคัญ: ต้องมี default privileges ให้ role authenticated ก่อนรัน migration
-- มิฉะนั้น role จะไม่มีสิทธิ์อะไรเลยตั้งแต่ต้น แล้วคำสั่ง revoke ในระบบ
-- จะดู "ได้ผล" ทั้งที่ไม่ได้ทำอะไร — test เรื่อง append-only จะผ่านด้วยเหตุผลผิด
-- =============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

-- Supabase อ่าน user ปัจจุบันจาก JWT claim ที่ตั้งไว้ในตัวแปรของ session
create or replace function auth.uid()
returns uuid
language sql
stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated;

-- ตารางที่ migration สร้างหลังจากนี้จะได้สิทธิ์อัตโนมัติ เหมือนที่ Supabase ทำ
-- RLS เป็นชั้นที่กรองจริง ส่วน grant เป็นเพียงการเปิดประตูให้ RLS ได้ทำงาน
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant usage, select on sequences to authenticated;
alter default privileges in schema public grant execute on functions to authenticated;
