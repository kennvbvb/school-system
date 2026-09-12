'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { requirePermission } from '@/server/auth/guard';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import { createSupabaseAdminClient } from '@/server/supabase/admin-client';
import { recordAuditEvent } from '@/server/audit/audit-log';
import { REQUEST_ID_HEADER, generateRequestId, sanitizeRequestId } from '@/lib/request-id';
import {
  userActiveSchema,
  userInviteSchema,
  userRolesSchema,
  userUpdateSchema,
} from '@/domain/auth/user-schemas';
import type { ActionResult } from '@/server/action-result';

/**
 * Server action ของการจัดการผู้ใช้ (FR-AUTH-001, FR-AUTH-003)
 *
 * **ระบบไม่รับ ไม่ส่ง และไม่เก็บรหัสผ่านเลย** การสร้างบัญชีใช้การเชิญทางอีเมล
 * แล้วให้เจ้าของบัญชีตั้งรหัสผ่านเอง — ข้อ 14.2 ห้ามบันทึกรหัสผ่านลง log
 * และวิธีที่แน่นอนที่สุดคือไม่ให้รหัสผ่านผ่านระบบนี้ตั้งแต่แรก
 *
 * การเปลี่ยนบทบาทและการเปิด/ปิดบัญชีทำผ่าน RPC ที่บังคับกติกา "ต้องเหลือผู้ดูแล
 * อย่างน้อยหนึ่งคน" และเขียน audit ในทรานแซกชันเดียวกับข้อมูล — การตรวจที่นี่
 * อย่างเดียวไม่พอ เพราะเลี่ยงได้ด้วยการเรียกฐานข้อมูลตรง
 */

export type { ActionResult } from '@/server/action-result';

function fromRpcError(message: string): ActionResult<never> {
  if (/^[฀-๿]/.test(message)) {
    return { ok: false, error: message };
  }
  console.error('[users] RPC ล้มเหลว', message);
  return { ok: false, error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' };
}

function toActionError(error: unknown): ActionResult<never> {
  console.error('[users] action ล้มเหลว', error);
  return { ok: false, error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' };
}

async function currentRequestId(): Promise<string> {
  const headerList = await headers();
  return sanitizeRequestId(headerList.get(REQUEST_ID_HEADER)) ?? generateRequestId();
}

/**
 * เชิญผู้ใช้ใหม่ — สร้างบัญชีเข้าระบบ โปรไฟล์ และบทบาท
 *
 * **ต้องใช้ service-role key** เพราะการสร้างบัญชีใน `auth.users` ทำแทนผู้ใช้ไม่ได้
 * ด้วยสิทธิ์ของผู้ใช้ทั่วไป ถ้ายังไม่ได้ตั้งค่า จะบอกตรง ๆ ว่าต้องตั้งอะไร
 * แทนการซ่อนปุ่มไว้เฉย ๆ ซึ่งทำให้ผู้ดูแลไม่รู้ว่าทำไมทำไม่ได้
 *
 * ลำดับ: สร้างบัญชี → สร้างโปรไฟล์ → ผูกบทบาท
 * **ถ้าขั้นใดหลังสร้างบัญชีล้ม จะเหลือบัญชีที่ไม่มีโปรไฟล์** ซึ่งเข้าระบบไม่ได้อยู่ดี
 * (ไม่มีโปรไฟล์ = ยังไม่ได้รับอนุญาต) และผู้ดูแลเชิญซ้ำได้ จึงไม่ลบบัญชีทิ้งเอง
 * เพราะการลบบัญชีอัตโนมัติเสี่ยงลบบัญชีที่มีอยู่ก่อนแล้วโดยบังเอิญ
 */
export async function inviteUser(input: unknown): Promise<ActionResult<string>> {
  try {
    const actor = await requirePermission('users.manage');

    const parsed = userInviteSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message;
      return { ok: false, error: first ?? 'ข้อมูลที่ส่งมาไม่ถูกต้อง' };
    }

    const { email, roleCodes, ...profile } = parsed.data;

    let admin: ReturnType<typeof createSupabaseAdminClient>;
    try {
      admin = createSupabaseAdminClient();
    } catch {
      return {
        ok: false,
        error:
          'ยังเชิญผู้ใช้ใหม่ไม่ได้ เพราะระบบยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY — ' +
          'กรุณาให้ผู้ดูแลระบบตั้งค่าใน Vercel แล้ว Redeploy',
      };
    }

    const invited = await admin.auth.admin.inviteUserByEmail(email);

    if (invited.error || !invited.data.user) {
      /*
       * ไม่ส่งข้อความดิบจาก Supabase ต่อให้ผู้ใช้ทั้งก้อน
       *
       * ข้อความเหล่านั้นเป็นภาษาอังกฤษเชิงเทคนิคและอาจเปิดเผยโครงสร้างภายใน
       * แต่ต้องแยก "อีเมลนี้มีบัญชีอยู่แล้ว" ออกมา เพราะเป็นกรณีที่ผู้ดูแลแก้เองได้
       */
      const raw = invited.error?.message ?? 'ไม่ทราบสาเหตุ';
      console.error('[users] เชิญผู้ใช้ไม่สำเร็จ', raw);

      if (/already|registered|exists/i.test(raw)) {
        return { ok: false, error: 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาตรวจรายชื่อผู้ใช้ที่มีอยู่' };
      }

      return {
        ok: false,
        error:
          'ส่งคำเชิญไม่สำเร็จ — ตรวจว่า Supabase ตั้งค่าการส่งอีเมล (SMTP) ไว้แล้ว ' +
          'และอีเมลปลายทางถูกต้อง',
      };
    }

    const userId = invited.data.user.id;
    const supabase = await createSupabaseServerClient();

    const { error: profileError } = await supabase.from('profiles').insert({
      id: userId,
      email,
      title_th: profile.titleTh ?? null,
      first_name_th: profile.firstNameTh,
      last_name_th: profile.lastNameTh,
      employee_code: profile.employeeCode ?? null,
      position_id: profile.positionId ?? null,
      department_id: profile.departmentId ?? null,
      is_active: true,
    });

    if (profileError) {
      console.error('[users] สร้างโปรไฟล์ไม่สำเร็จ', profileError.message);
      return {
        ok: false,
        error:
          'สร้างบัญชีเข้าระบบแล้วแต่บันทึกโปรไฟล์ไม่สำเร็จ ' +
          'ผู้ใช้จะยังเข้าระบบไม่ได้จนกว่าจะเชิญซ้ำอีกครั้ง',
      };
    }

    const requestId = await currentRequestId();
    const { error: rolesError } = await supabase.rpc('user_set_roles', {
      p_user_id: userId,
      p_role_codes: roleCodes,
      p_request_id: requestId,
    });

    if (rolesError) return fromRpcError(rolesError.message);

    /*
     * audit ของการสร้างบัญชีเขียนที่นี่ ไม่ใช่ใน RPC
     *
     * การสร้างบัญชีเกิดนอกฐานข้อมูลของเรา (ที่ Supabase Auth) จึงไม่มีทรานแซกชัน
     * เดียวกันให้ผูกด้วย ส่วนการผูกบทบาทมี audit ของตัวเองจาก RPC อยู่แล้ว
     * **ไม่บันทึกอะไรที่เกี่ยวกับรหัสผ่าน เพราะไม่มีรหัสผ่านให้บันทึก**
     */
    await recordAuditEvent({
      actorId: actor.id,
      action: 'user.invite',
      entityType: 'profile',
      entityId: userId,
      after: { email, roleCodes },
    });

    revalidatePath('/admin/users');
    return { ok: true, data: userId };
  } catch (error) {
    return toActionError(error);
  }
}

/** แก้ข้อมูลโปรไฟล์ — ไม่แตะอีเมล เพราะอีเมลคือกุญแจเข้าระบบ */
export async function updateUserProfile(input: unknown): Promise<ActionResult<void>> {
  try {
    const actor = await requirePermission('users.manage');

    const parsed = userUpdateSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message;
      return { ok: false, error: first ?? 'ข้อมูลที่ส่งมาไม่ถูกต้อง' };
    }

    const { userId, ...profile } = parsed.data;
    const supabase = await createSupabaseServerClient();

    const { data: before } = await supabase
      .from('profiles')
      .select('title_th, first_name_th, last_name_th, employee_code, position_id, department_id')
      .eq('id', userId)
      .maybeSingle();

    const { error } = await supabase
      .from('profiles')
      .update({
        title_th: profile.titleTh ?? null,
        first_name_th: profile.firstNameTh,
        last_name_th: profile.lastNameTh,
        employee_code: profile.employeeCode ?? null,
        position_id: profile.positionId ?? null,
        department_id: profile.departmentId ?? null,
      })
      .eq('id', userId);

    if (error) {
      console.error('[users] แก้โปรไฟล์ไม่สำเร็จ', error.message);
      return { ok: false, error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' };
    }

    await recordAuditEvent({
      actorId: actor.id,
      action: 'entity.update',
      entityType: 'profile',
      entityId: userId,
      before: before ?? undefined,
      after: profile,
    });

    revalidatePath('/admin/users');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

/** เปลี่ยนชุดบทบาท — RPC เป็นผู้บังคับว่าต้องเหลือผู้ดูแลอย่างน้อยหนึ่งคน */
export async function setUserRoles(input: unknown): Promise<ActionResult<void>> {
  try {
    await requirePermission('users.manage');

    const parsed = userRolesSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message;
      return { ok: false, error: first ?? 'ข้อมูลที่ส่งมาไม่ถูกต้อง' };
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc('user_set_roles', {
      p_user_id: parsed.data.userId,
      p_role_codes: parsed.data.roleCodes,
      p_request_id: await currentRequestId(),
    });

    if (error) return fromRpcError(error.message);

    revalidatePath('/admin/users');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

/** เปิดหรือปิดบัญชี — ไม่มีการลบผู้ใช้ เพราะโปรไฟล์ถูกอ้างโดยประวัติการอนุมัติ */
export async function setUserActive(input: unknown): Promise<ActionResult<void>> {
  try {
    await requirePermission('users.manage');

    const parsed = userActiveSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message;
      return { ok: false, error: first ?? 'ข้อมูลที่ส่งมาไม่ถูกต้อง' };
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc('user_set_active', {
      p_user_id: parsed.data.userId,
      p_is_active: parsed.data.isActive,
      p_request_id: await currentRequestId(),
    });

    if (error) return fromRpcError(error.message);

    revalidatePath('/admin/users');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
