import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermissionForPage } from '@/server/auth/guard';
import { listProjects, loadMasterDataOptions } from '@/server/master-data/repository';
import { createProject, setProjectActive } from '@/server/master-data/actions';
import { ProjectForm } from '@/features/master-data/project-form';
import { ActiveToggleButton } from '@/features/master-data/active-toggle-button';

export const metadata: Metadata = { title: 'โครงการ' };

/** จัดการโครงการ (FR-MST-006) — วงเงินอยู่ที่บัญชีงบ ไม่ได้อยู่ที่นี่ (ADR 0008) */
export default async function ProjectsPage() {
  await requirePermissionForPage('/admin/master-data/projects', 'masters.manage');

  const [projects, options] = await Promise.all([listProjects(), loadMasterDataOptions()]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/admin/master-data" className="text-sm text-sky-800 underline">
          ← ข้อมูลพื้นฐาน
        </Link>
        <h1 className="text-2xl font-semibold">โครงการ</h1>
        <p className="text-slate-600">รหัสโครงการซ้ำข้ามปีงบประมาณได้ แต่ห้ามซ้ำภายในปีเดียวกัน</p>
      </header>

      {options.fiscalYears.length === 0 ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-900">
          ยังไม่มีปีงบประมาณในระบบ จึงสร้างโครงการไม่ได้ —{' '}
          <Link href="/admin/master-data/fiscal-years" className="underline">
            เพิ่มปีงบประมาณก่อน
          </Link>
        </p>
      ) : (
        <section
          aria-labelledby="add-heading"
          className="rounded-lg border border-slate-200 bg-white p-5"
        >
          <h2 id="add-heading" className="mb-4 text-lg font-semibold">
            เพิ่มโครงการ
          </h2>
          <ProjectForm options={options} action={createProject} />
        </section>
      )}

      <section aria-labelledby="list-heading" className="space-y-3">
        <h2 id="list-heading" className="text-lg font-semibold">
          โครงการที่มีอยู่
        </h2>

        {projects.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">
            ยังไม่มีโครงการ
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[52rem] text-sm">
              <caption className="sr-only">รายการโครงการทั้งหมด</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    รหัส
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    ชื่อโครงการ
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    ปีงบประมาณ
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    แหล่งเงิน
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    หน่วยงาน
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    สถานะ
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    การจัดการ
                  </th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">{project.code}</td>
                    <td className="px-4 py-3">{project.nameTh}</td>
                    <td className="px-4 py-3 text-slate-600">{project.fiscalYearCode ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{project.fundingSourceName ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{project.departmentName ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          project.isActive
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {project.isActive ? 'ใช้งานอยู่' : 'ปิดใช้แล้ว'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ActiveToggleButton
                        isActive={project.isActive}
                        action={async (next) => {
                          'use server';
                          return setProjectActive(project.id, next);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
