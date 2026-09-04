import 'server-only';
import { cache } from 'react';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import { PermissionSet } from '@/domain/auth/permissions';
import type { PermissionCode, RoleCode } from '@/domain/auth/permissions';
import { isPermissionCode } from '@/domain/auth/permissions';

export interface CurrentUser {
  id: string;
  email: string;
  fullNameTh: string;
  departmentId: string | null;
  positionId: string | null;
  roles: RoleCode[];
  permissions: PermissionSet;
}

interface ProfileRow {
  id: string;
  email: string;
  title_th: string | null;
  first_name_th: string;
  last_name_th: string;
  department_id: string | null;
  position_id: string | null;
  is_active: boolean;
}

interface UserRoleRow {
  role_code: string;
}

/**
 * อ่านผู้ใช้ปัจจุบันพร้อมบทบาทและสิทธิ์
 *
 * ใช้ getUser() ไม่ใช่ getSession() เพราะ getUser() ตรวจ token กับ Supabase Auth จริง
 * ส่วน getSession() เชื่อ cookie ที่ผู้ใช้ถืออยู่ ซึ่งปลอมได้
 *
 * ห่อด้วย React cache() เพื่อไม่ให้ยิงฐานข้อมูลซ้ำในหนึ่ง request
 * ที่มีหลาย Server Component เรียกใช้
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'id, email, title_th, first_name_th, last_name_th, department_id, position_id, is_active',
    )
    .eq('id', user.id)
    .maybeSingle<ProfileRow>();

  // ไม่มี profile หรือถูกปิดบัญชี = ยังไม่ได้รับอนุญาตให้ใช้ระบบ (FR-AUTH-002, FR-AUTH-003)
  // แม้จะมีบัญชีใน auth.users แล้วก็ตาม
  if (!profile || !profile.is_active) return null;

  const { data: roleRows } = await supabase
    .from('user_roles')
    .select('role_code')
    .eq('user_id', user.id)
    .returns<UserRoleRow[]>();

  const roles = (roleRows ?? []).map((row) => row.role_code as RoleCode);
  const permissions = await loadPermissions(supabase, roles);

  return {
    id: profile.id,
    email: profile.email,
    fullNameTh: [profile.title_th, profile.first_name_th, profile.last_name_th]
      .filter(Boolean)
      .join(' '),
    departmentId: profile.department_id,
    positionId: profile.position_id,
    roles,
    permissions,
  };
});

/**
 * สิทธิ์ที่มีผลจริงอ่านจากตาราง role_permissions ไม่ใช่จากค่าคงที่ในโค้ด
 * เพราะผู้ดูแลระบบปรับการผูกบทบาทกับสิทธิ์ได้โดยไม่ต้อง deploy ใหม่
 */
async function loadPermissions(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  roles: readonly RoleCode[],
): Promise<PermissionSet> {
  if (roles.length === 0) return new PermissionSet([]);

  const { data } = await supabase
    .from('role_permissions')
    .select('permission_code')
    .in('role_code', roles as string[])
    .returns<{ permission_code: string }[]>();

  const codes = (data ?? [])
    .map((row) => row.permission_code)
    .filter((code): code is PermissionCode => isPermissionCode(code));

  return new PermissionSet(codes);
}
