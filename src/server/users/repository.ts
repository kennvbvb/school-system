import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server-client';

/**
 * การอ่านข้อมูลผู้ใช้และบทบาทสำหรับหน้าจอผู้ดูแล
 *
 * ทุก query ผ่าน client ของผู้ใช้ ไม่ใช่ service-role — RLS จึงเป็นตัวกรองว่าใครเห็นอะไร
 * (ADR 0003, 0004) ผู้ที่ไม่มีสิทธิ์ `users.read` จะเห็นเฉพาะโปรไฟล์ของตัวเอง
 *
 * **ไม่แสดงรายการที่ปิดบัญชีแล้วแยกออกไป** ผู้ดูแลต้องเห็นทั้งหมดในที่เดียว
 * มิฉะนั้นจะเปิดบัญชีที่ปิดไปแล้วกลับมาไม่ได้เพราะหาไม่เจอ
 */

export interface UserRow {
  id: string;
  email: string;
  employeeCode: string | null;
  titleTh: string | null;
  firstNameTh: string;
  lastNameTh: string;
  positionId: string | null;
  positionNameTh: string | null;
  departmentId: string | null;
  departmentNameTh: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  roleCodes: string[];
}

export interface RoleOption {
  code: string;
  nameTh: string;
  descriptionTh: string | null;
  /** บทบาทนี้ถือสิทธิ์จัดการผู้ใช้หรือไม่ — หน้าจอใช้เตือนก่อนถอดออก */
  managesUsers: boolean;
}

interface ProfileRaw {
  id: string;
  email: string;
  employee_code: string | null;
  title_th: string | null;
  first_name_th: string;
  last_name_th: string;
  position_id: string | null;
  department_id: string | null;
  is_active: boolean;
  last_login_at: string | null;
  positions: { name_th: string } | null;
  departments: { name_th: string } | null;
}

export async function listUsers(): Promise<UserRow[]> {
  const supabase = await createSupabaseServerClient();

  /*
   * ดึงบทบาทแยก query แทนการ join ซ้อน
   *
   * PostgREST คืนความสัมพันธ์แบบหลายชั้นเป็นโครงซ้อนที่ต้องแกะหลายชั้น และการ join
   * user_roles เข้ามาด้วยจะทำให้ profiles ซ้ำเป็นจำนวนบทบาท ซึ่งต้องยุบเองอยู่ดี
   */
  const [profiles, roles] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, email, employee_code, title_th, first_name_th, last_name_th, ' +
          'position_id, department_id, is_active, last_login_at, ' +
          'positions(name_th), departments(name_th)',
      )
      .order('is_active', { ascending: false })
      .order('first_name_th')
      .returns<ProfileRaw[]>(),
    supabase
      .from('user_roles')
      .select('user_id, role_code')
      .returns<{ user_id: string; role_code: string }[]>(),
  ]);

  if (profiles.error) throw new Error(profiles.error.message);
  if (roles.error) throw new Error(roles.error.message);

  const rolesByUser = new Map<string, string[]>();
  for (const row of roles.data ?? []) {
    const list = rolesByUser.get(row.user_id) ?? [];
    list.push(row.role_code);
    rolesByUser.set(row.user_id, list);
  }

  return (profiles.data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    employeeCode: row.employee_code,
    titleTh: row.title_th,
    firstNameTh: row.first_name_th,
    lastNameTh: row.last_name_th,
    positionId: row.position_id,
    positionNameTh: row.positions?.name_th ?? null,
    departmentId: row.department_id,
    departmentNameTh: row.departments?.name_th ?? null,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    roleCodes: (rolesByUser.get(row.id) ?? []).sort(),
  }));
}

/**
 * บทบาททั้งหมดพร้อมข้อมูลว่าบทบาทใดถือสิทธิ์จัดการผู้ใช้
 *
 * อ่านจาก `role_permissions` จริง ไม่ได้เขียนชื่อบทบาทตายไว้ — ผู้ดูแลย้ายสิทธิ์
 * ไปบทบาทอื่นได้ และหน้าจอต้องเตือนตามความเป็นจริง ณ ตอนนั้น
 */
export async function listRoleOptions(): Promise<RoleOption[]> {
  const supabase = await createSupabaseServerClient();

  const [roles, managers] = await Promise.all([
    supabase
      .from('roles')
      .select('code, name_th, description_th')
      .order('code')
      .returns<{ code: string; name_th: string; description_th: string | null }[]>(),
    supabase
      .from('role_permissions')
      .select('role_code')
      .eq('permission_code', 'users.manage')
      .returns<{ role_code: string }[]>(),
  ]);

  if (roles.error) throw new Error(roles.error.message);
  if (managers.error) throw new Error(managers.error.message);

  const managing = new Set((managers.data ?? []).map((row) => row.role_code));

  return (roles.data ?? []).map((row) => ({
    code: row.code,
    nameTh: row.name_th,
    descriptionTh: row.description_th,
    managesUsers: managing.has(row.code),
  }));
}

export interface UserFormOptions {
  positions: { id: string; label: string }[];
  departments: { id: string; label: string }[];
}

/** ตัวเลือกตำแหน่งและหน่วยงาน — เฉพาะที่ยังใช้งานอยู่ (FR-MST-008) */
export async function loadUserFormOptions(): Promise<UserFormOptions> {
  const supabase = await createSupabaseServerClient();

  const [positions, departments] = await Promise.all([
    supabase
      .from('positions')
      .select('id, name_th')
      .eq('is_active', true)
      .order('name_th')
      .returns<{ id: string; name_th: string }[]>(),
    supabase
      .from('departments')
      .select('id, name_th')
      .eq('is_active', true)
      .order('name_th')
      .returns<{ id: string; name_th: string }[]>(),
  ]);

  if (positions.error) throw new Error(positions.error.message);
  if (departments.error) throw new Error(departments.error.message);

  return {
    positions: (positions.data ?? []).map((row) => ({ id: row.id, label: row.name_th })),
    departments: (departments.data ?? []).map((row) => ({ id: row.id, label: row.name_th })),
  };
}
