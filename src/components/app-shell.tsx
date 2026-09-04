import Link from 'next/link';
import { visibleSections } from '@/features/auth/navigation';
import { ROLE_LABELS_TH } from '@/domain/auth/permissions';
import { SignOutButton } from '@/features/auth/sign-out-button';
import type { CurrentUser } from '@/server/auth/session';

/**
 * โครงหน้าจอหลักภาษาไทย (P0-004)
 *
 * เมนูถูกกรองตามสิทธิ์ของผู้ใช้ที่ resolve มาจาก server แล้ว
 * data-print="hide" ทำให้ส่วนนำทางไม่ติดไปกับหน้าพิมพ์ (ข้อ 12.6)
 */
export function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const sections = visibleSections(user.permissions);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow"
      >
        ข้ามไปยังเนื้อหาหลัก
      </a>

      <header data-print="hide" className="border-b border-slate-200 bg-white px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <Link href="/dashboard" className="font-semibold">
            ระบบงานพัสดุและจัดซื้อจัดจ้าง
          </Link>

          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-700">
              {user.fullNameTh}
              {user.roles.length > 0 ? (
                <span className="text-slate-500">
                  {' · '}
                  {user.roles.map((role) => ROLE_LABELS_TH[role] ?? role).join(', ')}
                </span>
              ) : null}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 md:flex-row md:px-6">
        <nav data-print="hide" aria-label="เมนูหลัก" className="shrink-0 space-y-5 md:w-60">
          {sections.map((section) => (
            <div key={section.titleTh}>
              <h2 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                {section.titleTh}
              </h2>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    {item.comingSoon ? (
                      // ยังไม่ถึงเฟสของหน้านี้ — แสดงไว้ให้เห็นภาพรวมแต่กดไม่ได้
                      <span
                        aria-disabled="true"
                        className="flex items-center justify-between rounded-md px-3 py-2 text-slate-400"
                      >
                        {item.labelTh}
                        <span className="text-xs">ยังไม่เปิดใช้</span>
                      </span>
                    ) : (
                      <Link
                        href={item.href}
                        className="block rounded-md px-3 py-2 hover:bg-slate-100"
                      >
                        {item.labelTh}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <main id="main-content" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
