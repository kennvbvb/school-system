import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PATHNAME_HEADER, sanitizeInternalPath } from '@/lib/request-id';
import { getCurrentUser } from './session';
import type { CurrentUser } from './session';
import type { PermissionCode } from '@/domain/auth/permissions';

/**
 * การ์ดสำหรับ Server Component, Route Handler และ Server Action
 *
 * ทุก operation ที่เปลี่ยนข้อมูลต้องเรียก requirePermission ก่อนเสมอ (ข้อ 13)
 * การซ่อนปุ่มฝั่ง browser ไม่นับเป็นการตรวจสิทธิ์
 */

export class AuthorizationError extends Error {
  readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN';

  constructor(code: AuthorizationError['code'], message: string) {
    super(message);
    this.name = 'AuthorizationError';
    this.code = code;
  }
}

/**
 * ใช้ในหน้าเว็บ: ไม่ได้เข้าสู่ระบบ → ส่งไปหน้า login พร้อมจำปลายทางเดิม
 *
 * ถ้าไม่ระบุ returnTo จะอ่าน pathname จาก header ที่ proxy ใส่ไว้
 * จุดนี้สำคัญเพราะ layout ของกลุ่ม (dashboard) ทำงานก่อน page เสมอ
 * ถ้า layout redirect ไปโดยไม่มี returnTo ผู้ใช้จะเสียปลายทางเดิมไป
 * แม้ page จะระบุ returnTo ไว้เองก็ตาม
 */
export async function requireUserForPage(returnTo?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    const headerList = await headers();
    const target = sanitizeInternalPath(returnTo ?? headerList.get(PATHNAME_HEADER));
    redirect(target ? `/login?returnTo=${encodeURIComponent(target)}` : '/login');
  }

  return user;
}

/** ใช้ใน Server Action และ Route Handler: โยน error ให้ผู้เรียกจัดการเอง */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new AuthorizationError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อนใช้งาน');
  }

  return user;
}

/**
 * ตรวจว่าผู้ใช้มีสิทธิ์ครบทุกข้อที่ระบุ
 *
 * ข้อความ error ไม่ระบุว่าขาดสิทธิ์ตัวไหน เพื่อไม่ให้ผู้ไม่มีสิทธิ์
 * ใช้ error message สำรวจโครงสร้างสิทธิ์ของระบบ
 */
export async function requirePermission(
  ...required: readonly PermissionCode[]
): Promise<CurrentUser> {
  const user = await requireUser();

  if (!user.permissions.hasAll(required)) {
    throw new AuthorizationError('FORBIDDEN', 'คุณไม่มีสิทธิ์ดำเนินการนี้');
  }

  return user;
}

/**
 * ตรวจว่าผู้ใช้มีสิทธิ์อย่างน้อยหนึ่งข้อในรายการ
 *
 * มีคู่กับ requirePermission เพราะเมนู (features/auth/navigation.ts) ใช้กติกา
 * "อย่างใดอย่างหนึ่ง" อยู่แล้ว เช่น หน้ารายการจัดซื้อที่เปิดให้ทั้งผู้ที่เห็น
 * เฉพาะของตนและผู้ที่เห็นทั้งหมด ถ้าไม่มีตัวนี้ หน้าเหล่านั้นจะต้องเขียน
 * เงื่อนไขเองซึ่งทำให้กติกาการเข้าถึงกระจายออกไปจากที่เดียว
 */
export async function requireAnyPermission(
  ...allowed: readonly PermissionCode[]
): Promise<CurrentUser> {
  const user = await requireUser();

  if (!user.permissions.hasAny(allowed)) {
    throw new AuthorizationError('FORBIDDEN', 'คุณไม่มีสิทธิ์ดำเนินการนี้');
  }

  return user;
}

/** เวอร์ชันสำหรับหน้าเว็บ: ไม่มีสิทธิ์ → ส่งไปหน้าแจ้งว่าเข้าถึงไม่ได้ */
export async function requirePermissionForPage(
  returnTo: string,
  ...required: readonly PermissionCode[]
): Promise<CurrentUser> {
  const user = await requireUserForPage(returnTo);

  if (!user.permissions.hasAll(required)) {
    redirect('/forbidden');
  }

  return user;
}

/** เวอร์ชันสำหรับหน้าเว็บของ requireAnyPermission */
export async function requireAnyPermissionForPage(
  returnTo: string,
  ...allowed: readonly PermissionCode[]
): Promise<CurrentUser> {
  const user = await requireUserForPage(returnTo);

  if (!user.permissions.hasAny(allowed)) {
    redirect('/forbidden');
  }

  return user;
}
