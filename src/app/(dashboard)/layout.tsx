import { AppShell } from '@/components/app-shell';
import { requireUserForPage } from '@/server/auth/guard';

/**
 * Layout ของทุกหน้าหลังเข้าสู่ระบบ
 *
 * การ์ดอยู่ที่นี่เพื่อให้ทุกหน้าในกลุ่มนี้ถูกตรวจโดยอัตโนมัติ
 * แต่หน้าที่ต้องการสิทธิ์เฉพาะยังต้องเรียก requirePermissionForPage ของตัวเองอีกชั้น
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserForPage();

  return <AppShell user={user}>{children}</AppShell>;
}
