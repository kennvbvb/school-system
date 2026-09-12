/**
 * กติกาการจัดการผู้ใช้และบทบาท (FR-AUTH-001, FR-AUTH-003, ข้อ 4.1, 11.1)
 *
 * กฎสองข้อในไฟล์นี้มีไว้กัน **การล็อกทุกคนออกจากระบบ** ซึ่งเป็นความผิดพลาดที่
 * แก้เองจากหน้าจอไม่ได้เลย — ต้องเข้าฐานข้อมูลตรงไปแก้ ซึ่งโรงเรียนทำเองไม่ได้
 *
 *   1. ปิดบัญชีตัวเองไม่ได้
 *   2. ถอดบทบาทที่ถือสิทธิ์จัดการผู้ใช้ออกจากคนสุดท้ายไม่ได้
 *
 * ข้อ 2 ไม่ได้ห้ามลดสิทธิ์ตัวเอง แต่ห้ามทำจน **ไม่เหลือใครเลย** ที่จัดการผู้ใช้ได้
 * ผู้ดูแลสองคนยังลดสิทธิ์ของกันและกันได้ตามปกติ
 *
 * ไฟล์นี้เป็นตรรกะบริสุทธิ์ ห้าม import Supabase หรือ Next.js
 * กติกาเดียวกันถูกบังคับซ้ำที่ฐานข้อมูล — ดู migration 0018 และ
 * `tests/unit/user-admin.test.ts` ที่อ่าน SQL จริงมาเทียบ
 */
import type { PermissionCode } from './permissions';

/**
 * สิทธิ์ที่ถ้าไม่มีใครถืออยู่เลย จะไม่มีใครกู้ระบบคืนได้จากหน้าจอ
 *
 * ใช้ `users.manage` ไม่ใช่ชื่อบทบาท `SYSTEM_ADMIN` โดยเจตนา — บทบาทเป็นข้อมูล
 * ที่ผู้ดูแลแก้ได้ผ่านตาราง `role_permissions` ถ้าผูกกฎไว้กับชื่อบทบาท การย้าย
 * สิทธิ์ไปบทบาทอื่นจะทำให้กฎนี้เฝ้าของที่ไม่สำคัญแล้ว
 */
export const LOCKOUT_GUARD_PERMISSION: PermissionCode = 'users.manage';

export interface UserAdminSubject {
  id: string;
  isActive: boolean;
  roleCodes: readonly string[];
}

export type UserAdminRejection =
  'CANNOT_DEACTIVATE_SELF' | 'LAST_USER_MANAGER' | 'UNKNOWN_ROLE' | 'NO_ROLE_ASSIGNED';

export const USER_ADMIN_MESSAGES_TH: Record<UserAdminRejection, string> = {
  CANNOT_DEACTIVATE_SELF: 'ปิดบัญชีของตัวเองไม่ได้ ให้ผู้ดูแลระบบคนอื่นเป็นผู้ปิดบัญชีนี้แทน',
  LAST_USER_MANAGER:
    'ต้องเหลือผู้ที่จัดการผู้ใช้ได้อย่างน้อยหนึ่งคนเสมอ มิฉะนั้นจะไม่มีใครแก้สิทธิ์ได้อีกเลย',
  UNKNOWN_ROLE: 'มีบทบาทที่ระบบไม่รู้จักอยู่ในรายการที่เลือก',
  NO_ROLE_ASSIGNED: 'ผู้ใช้ต้องมีอย่างน้อยหนึ่งบทบาท มิฉะนั้นจะเข้าใช้ระบบไม่ได้เลย',
};

/**
 * ตรวจการเปลี่ยนสถานะเปิด/ปิดบัญชี
 *
 * `remainingManagers` คือจำนวนผู้ใช้ที่ยัง active และถือสิทธิ์จัดการผู้ใช้
 * **โดยไม่นับคนที่กำลังถูกแก้** — ผู้เรียกเป็นผู้คำนวณ เพราะชั้นโดเมนอ่านฐานข้อมูลไม่ได้
 */
export function checkSetActive(input: {
  actorId: string;
  target: UserAdminSubject;
  nextActive: boolean;
  targetManagesUsers: boolean;
  remainingManagers: number;
}): UserAdminRejection | null {
  if (!input.nextActive && input.target.id === input.actorId) {
    return 'CANNOT_DEACTIVATE_SELF';
  }

  if (!input.nextActive && input.targetManagesUsers && input.remainingManagers < 1) {
    return 'LAST_USER_MANAGER';
  }

  return null;
}

/**
 * ตรวจการเปลี่ยนชุดบทบาท
 *
 * `nextRolesManageUsers` บอกว่าชุดบทบาทใหม่ยังถือสิทธิ์จัดการผู้ใช้อยู่หรือไม่
 * ต้องคำนวณจากตาราง `role_permissions` จริง ไม่ใช่จากรายชื่อบทบาทที่เขียนตายไว้
 */
export function checkSetRoles(input: {
  target: UserAdminSubject;
  nextRoles: readonly string[];
  knownRoles: readonly string[];
  nextRolesManageUsers: boolean;
  targetManagesUsers: boolean;
  remainingManagers: number;
}): UserAdminRejection | null {
  if (input.nextRoles.length === 0) {
    return 'NO_ROLE_ASSIGNED';
  }

  if (input.nextRoles.some((role) => !input.knownRoles.includes(role))) {
    return 'UNKNOWN_ROLE';
  }

  /*
   * เสียสิทธิ์จัดการผู้ใช้ไป และไม่เหลือใครอื่นแล้ว
   *
   * ตรวจเฉพาะกรณีที่ **กำลังจะเสีย** ไม่ใช่ทุกครั้งที่แก้บทบาท — ผู้ดูแลที่ยังถือสิทธิ์
   * อยู่หลังแก้เสร็จ ไม่ได้ทำให้ระบบเสี่ยงอะไร
   */
  if (input.targetManagesUsers && !input.nextRolesManageUsers && input.remainingManagers < 1) {
    return 'LAST_USER_MANAGER';
  }

  return null;
}
