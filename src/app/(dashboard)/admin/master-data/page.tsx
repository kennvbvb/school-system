import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAnyPermissionForPage } from '@/server/auth/guard';

export const metadata: Metadata = { title: 'ข้อมูลพื้นฐาน' };

/**
 * หน้ารวมของข้อมูลพื้นฐาน
 *
 * เรียงตามลำดับที่ต้องกรอกจริง: ปีงบประมาณ → แหล่งเงิน → โครงการ → บัญชีงบ
 * เพราะแต่ละขั้นอ้างถึงขั้นก่อนหน้า ผู้ใช้ที่เริ่มจากโครงการจะติดทันทีเพราะยังไม่มี
 * ปีงบประมาณให้เลือก การเรียงลำดับที่นี่จึงเป็นส่วนหนึ่งของคำอธิบาย ไม่ใช่แค่เมนู
 */

const SECTIONS = [
  {
    href: '/admin/master-data/fiscal-years',
    step: 1,
    title: 'ปีงบประมาณ',
    description:
      'กำหนดวันเริ่มและวันสิ้นสุดของแต่ละปี ทุกอย่างที่เหลืออ้างถึงปีงบประมาณ จึงต้องมีก่อน',
    permission: 'settings.manage',
  },
  {
    href: '/admin/master-data/funding-sources',
    step: 2,
    title: 'แหล่งเงิน',
    description: 'ที่มาของเงิน เช่น เงินอุดหนุน หรือเงินรายได้สถานศึกษา ใช้ข้ามปีงบประมาณได้',
    permission: 'masters.manage',
  },
  {
    href: '/admin/master-data/projects',
    step: 3,
    title: 'โครงการ',
    description: 'โครงการของแต่ละปีงบประมาณ — วงเงินไม่ได้กำหนดที่นี่ แต่กำหนดที่บัญชีงบ',
    permission: 'masters.manage',
  },
  {
    href: '/budget/accounts',
    step: 4,
    title: 'บัญชีงบและวงเงิน',
    description: 'สร้างบัญชีงบของโครงการ แล้วจัดสรรวงเงิน — ต้องมีก่อนจึงจะสร้างรายการจัดซื้อได้',
    permission: 'budget.manage',
  },
] as const;

export default async function MasterDataPage() {
  const viewer = await requireAnyPermissionForPage(
    '/admin/master-data',
    'masters.manage',
    'settings.manage',
    'budget.manage',
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">ข้อมูลพื้นฐาน</h1>
        <p className="text-slate-600">
          ตั้งค่าตามลำดับด้านล่าง ระบบจะสร้างรายการจัดซื้อจัดจ้างได้เมื่อมีบัญชีงบที่มีวงเงินแล้ว
        </p>
      </header>

      <ol className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map((section) => {
          const allowed = viewer.permissions.has(section.permission);

          return (
            <li key={section.href} className="rounded-lg border border-slate-200 bg-white p-5">
              <p className="text-sm font-medium text-slate-500">ขั้นที่ {section.step}</p>
              {allowed ? (
                <Link
                  href={{ pathname: section.href }}
                  className="mt-1 block text-lg font-semibold text-sky-800 underline underline-offset-2"
                >
                  {section.title}
                </Link>
              ) : (
                <p className="mt-1 text-lg font-semibold text-slate-400">{section.title}</p>
              )}
              <p className="mt-2 text-sm text-slate-600">{section.description}</p>
              {allowed ? null : (
                <p className="mt-2 text-sm text-slate-500">คุณไม่มีสิทธิ์จัดการส่วนนี้</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
