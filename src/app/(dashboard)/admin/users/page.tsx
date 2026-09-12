import type { Metadata } from 'next';
import { requirePermissionForPage } from '@/server/auth/guard';
import { listRoleOptions, listUsers, loadUserFormOptions } from '@/server/users/repository';
import { inviteUser, setUserActive, setUserRoles } from '@/server/users/actions';
import { UserInviteForm } from '@/features/users/user-invite-form';
import { UserRolesForm } from '@/features/users/user-roles-form';
import { ActiveToggleButton } from '@/features/master-data/active-toggle-button';
import { formatThaiDateTime } from '@/lib/format/thai-date';

export const metadata: Metadata = { title: 'ผู้ใช้และสิทธิ์' };

/**
 * จัดการผู้ใช้และสิทธิ์ (FR-AUTH-001, FR-AUTH-003)
 *
 * ก่อนมีหน้านี้ การเพิ่มผู้ใช้ต้องรัน SQL เอง ซึ่งโรงเรียนทำไม่ได้ — เท่ากับระบบ
 * เริ่มใช้จริงไม่ได้เลยแม้ฟีเจอร์อื่นจะครบ
 *
 * **ไม่มีปุ่มลบผู้ใช้** โปรไฟล์ถูกอ้างโดยประวัติการอนุมัติและรายการงบ การลบจะทำให้
 * ประวัติที่ตรวจสอบได้กลายเป็นประวัติที่ชี้ไปที่ว่างเปล่า ใช้การปิดบัญชีแทน (ข้อ 4.2)
 */
export default async function UsersPage() {
  const viewer = await requirePermissionForPage('/admin/users', 'users.manage');

  const [users, roles, options] = await Promise.all([
    listUsers(),
    listRoleOptions(),
    loadUserFormOptions(),
  ]);

  const managerRoles = new Set(roles.filter((role) => role.managesUsers).map((role) => role.code));
  const activeManagers = users.filter(
    (user) => user.isActive && user.roleCodes.some((code) => managerRoles.has(code)),
  ).length;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">ผู้ใช้และสิทธิ์</h1>
        <p className="text-slate-600">
          เพิ่มผู้ใช้ กำหนดบทบาท และปิดบัญชีที่ไม่ได้ใช้แล้ว การเปลี่ยนสิทธิ์ทุกครั้งถูกบันทึกไว้ใน
          audit log
        </p>
      </header>

      {/*
        เตือนเมื่อเหลือผู้ดูแลคนเดียว

        ฐานข้อมูลกันไม่ให้ถอดคนสุดท้ายออกอยู่แล้ว แต่การรู้ล่วงหน้าว่า "ตอนนี้เหลือคนเดียว"
        ทำให้โรงเรียนตั้งคนสำรองไว้ก่อน แทนที่จะมารู้ตอนที่คนคนนั้นลาออกไปแล้ว
      */}
      {activeManagers <= 1 ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <span aria-hidden="true">⚠ </span>
          ตอนนี้มีผู้ที่จัดการผู้ใช้ได้เพียง {activeManagers} คน
          ควรตั้งผู้ดูแลสำรองไว้อย่างน้อยอีกหนึ่งคน มิฉะนั้นถ้าบัญชีนี้ใช้ไม่ได้
          จะไม่มีใครแก้สิทธิ์ได้อีกเลยนอกจากเข้าฐานข้อมูลตรง
        </p>
      ) : null}

      <section
        aria-labelledby="invite-heading"
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <h2 id="invite-heading" className="mb-1 text-lg font-semibold">
          เชิญผู้ใช้ใหม่
        </h2>
        <p className="mb-4 text-sm text-slate-600">
          ระบบส่งคำเชิญไปที่อีเมล แล้วให้เจ้าของบัญชีตั้งรหัสผ่านเอง —
          <strong> ผู้ดูแลไม่ต้องตั้งและไม่ได้รู้รหัสผ่านของใคร</strong>
        </p>

        <UserInviteForm
          roles={roles}
          options={options}
          onInvite={async (input) => {
            'use server';
            return inviteUser(input);
          }}
        />
      </section>

      <section aria-labelledby="list-heading" className="space-y-3">
        <h2 id="list-heading" className="text-lg font-semibold">
          ผู้ใช้ทั้งหมด ({users.length})
        </h2>

        {users.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-700">
            ยังไม่มีผู้ใช้ในระบบ
          </p>
        ) : (
          <ul className="space-y-3">
            {users.map((user) => (
              <li
                key={user.id}
                className={`rounded-lg border p-5 ${
                  user.isActive ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="font-medium">
                      {[user.titleTh, user.firstNameTh, user.lastNameTh].filter(Boolean).join(' ')}
                      {user.id === viewer.id ? (
                        <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900">
                          บัญชีของคุณ
                        </span>
                      ) : null}
                      {!user.isActive ? (
                        <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                          ปิดบัญชีแล้ว
                        </span>
                      ) : null}
                    </p>
                    <p className="font-mono text-sm text-slate-600">{user.email}</p>
                    <p className="text-sm text-slate-600">
                      {[user.positionNameTh, user.departmentNameTh].filter(Boolean).join(' · ') ||
                        'ยังไม่ได้ระบุตำแหน่งและหน่วยงาน'}
                    </p>
                    <p className="text-sm text-slate-500">
                      {user.lastLoginAt
                        ? `เข้าระบบล่าสุด ${formatThaiDateTime(new Date(user.lastLoginAt))}`
                        : 'ยังไม่เคยเข้าระบบ'}
                    </p>
                  </div>

                  {/*
                    ไม่แสดงปุ่มปิดบัญชีให้กับบัญชีของตัวเอง

                    ฐานข้อมูลปฏิเสธอยู่แล้ว การแสดงปุ่มที่กดแล้วถูกปฏิเสธทุกครั้ง
                    แย่กว่าไม่มีปุ่ม เพราะผู้ใช้ไม่มีทางแก้ให้กดได้
                  */}
                  {user.id === viewer.id ? null : (
                    <ActiveToggleButton
                      isActive={user.isActive}
                      action={async (next) => {
                        'use server';
                        return setUserActive({ userId: user.id, isActive: next });
                      }}
                    />
                  )}
                </div>

                <div className="mt-4 border-t border-slate-100 pt-4">
                  <UserRolesForm
                    userId={user.id}
                    roles={roles}
                    currentRoleCodes={user.roleCodes}
                    onSave={async (input) => {
                      'use server';
                      return setUserRoles(input);
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
