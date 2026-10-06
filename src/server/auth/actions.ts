'use server';

import { getCurrentUser } from '@/server/auth/session';
import { recordAuditEvent } from '@/server/audit/audit-log';

/**
 * บันทึกว่าผู้ใช้ตั้งหรือเปลี่ยนรหัสผ่าน (FR-AUD-001)
 *
 * เรียกจากหน้าตั้งรหัสผ่าน **หลัง** Supabase เปลี่ยนรหัสผ่านสำเร็จแล้ว ไม่ใช่ก่อน
 * ผลคือถ้าบันทึกไม่สำเร็จ รหัสผ่านก็เปลี่ยนไปแล้วและย้อนไม่ได้ จึงเป็นแบบ best-effort:
 * ล้มแล้ว log ไว้ ไม่ทำให้ผู้ใช้เห็นว่าตั้งรหัสผ่านไม่สำเร็จทั้งที่สำเร็จแล้ว
 *
 * ผู้เรียกคือผู้ใช้เองเท่านั้น (actor มาจาก `auth.uid()` ใน RPC) และ **ไม่บันทึกอะไรที่เกี่ยวกับ
 * ค่ารหัสผ่านเลย** (FR-AUD-004) มีเพียงว่าเหตุการณ์นี้เกิดขึ้น
 *
 * บัญชีที่ยังไม่มีโปรไฟล์หรือถูกปิดจะไม่มี audit เพราะ RPC ปฏิเสธ — บัญชีเหล่านั้น
 * เข้าระบบไม่ได้อยู่แล้ว จึงข้ามเงียบ ๆ ได้
 */
export async function recordPasswordSet(): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) return;

    const result = await recordAuditEvent({
      action: 'auth.password_set',
      entityType: 'profile',
      entityId: user.id,
    });

    if (!result.ok) {
      console.error('[auth] บันทึก audit การตั้งรหัสผ่านไม่สำเร็จ');
    }
  } catch (error) {
    console.error('[auth] บันทึก audit การตั้งรหัสผ่านล้มเหลว', error);
  }
}
