import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermissionForPage } from '@/server/auth/guard';
import { listVendors } from '@/server/master-data/repository';
import { createVendor, setVendorActive } from '@/server/master-data/actions';
import { VendorForm } from '@/features/master-data/vendor-form';
import { ActiveToggleButton } from '@/features/master-data/active-toggle-button';
import { toVendorSummaries } from './summaries';

export const metadata: Metadata = { title: 'ผู้ขาย' };

/**
 * ทะเบียนผู้ขาย (FR-MST-005, FR-MST-009)
 *
 * หน้านี้เป็นทางเดียวที่เพิ่มผู้ขายเข้าระบบได้ — ก่อนหน้านี้ตารางและตรรกะตรวจซ้ำ
 * มีอยู่แล้วแต่ไม่มีหน้าจอ ทำให้ผูกผู้ขายกับรายการจัดซื้อจริงไม่ได้เลย
 */
export default async function VendorsPage() {
  await requirePermissionForPage('/admin/master-data/vendors', 'masters.manage');
  const vendors = await listVendors();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/admin/master-data" className="text-sm text-sky-800 underline">
          ← ข้อมูลพื้นฐาน
        </Link>
        <h1 className="text-2xl font-semibold">ผู้ขาย</h1>
        <p className="text-slate-600">
          ระบบเตือนเมื่อชื่อคล้ายผู้ขายที่มีอยู่ และไม่ยอมให้บันทึกซ้ำเมื่อเลขประจำตัว
          ผู้เสียภาษีและสาขาตรงกัน
        </p>
      </header>

      <section
        aria-labelledby="add-heading"
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <h2 id="add-heading" className="mb-4 text-lg font-semibold">
          เพิ่มผู้ขาย
        </h2>
        <VendorForm
          mode="create"
          submitLabel="เพิ่มผู้ขาย"
          action={createVendor}
          existingVendors={toVendorSummaries(vendors)}
        />
      </section>

      <section aria-labelledby="list-heading" className="space-y-3">
        <h2 id="list-heading" className="text-lg font-semibold">
          ผู้ขายที่มีอยู่
        </h2>

        {vendors.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">
            ยังไม่มีผู้ขาย
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[52rem] text-sm">
              <caption className="sr-only">รายการผู้ขายทั้งหมด</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    รหัส
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    ชื่อ
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    เลขผู้เสียภาษี
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    สาขา
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    ติดต่อ
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
                {vendors.map((vendor) => (
                  <tr key={vendor.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">{vendor.vendorCode}</td>
                    <td className="px-4 py-3">{vendor.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{vendor.taxId ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {vendor.branchNo ?? 'สำนักงานใหญ่'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{vendor.phone ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          vendor.isActive
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {vendor.isActive ? 'ใช้งานอยู่' : 'ปิดใช้แล้ว'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Link
                          href={{ pathname: `/admin/master-data/vendors/${vendor.id}` }}
                          className="text-sm text-sky-800 underline"
                        >
                          แก้ไข
                        </Link>
                        <ActiveToggleButton
                          isActive={vendor.isActive}
                          action={async (next) => {
                            'use server';
                            return setVendorActive(vendor.id, next);
                          }}
                        />
                      </div>
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
