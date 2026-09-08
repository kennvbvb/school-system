import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermissionForPage } from '@/server/auth/guard';
import { listVendors } from '@/server/master-data/repository';
import { updateVendor } from '@/server/master-data/actions';
import { VendorForm } from '@/features/master-data/vendor-form';
import { toVendorSummaries } from '../summaries';
import type { VendorFormValues } from '@/features/master-data/vendor-form';

export const metadata: Metadata = { title: 'แก้ไขผู้ขาย' };

/**
 * แก้ไขผู้ขาย
 *
 * `notFound()` เมื่ออ่านไม่เจอ ครอบคลุมทั้ง "ไม่มีรายการนี้" และ "RLS ไม่ให้เห็น"
 * โดยไม่แยกสองกรณีให้ผู้ใช้รู้ เพราะการแยกจะบอกผู้ไม่มีสิทธิ์ว่ามีข้อมูลอยู่จริง
 */
export default async function EditVendorPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermissionForPage('/admin/master-data/vendors', 'masters.manage');

  const { id } = await params;
  const vendors = await listVendors();
  const vendor = vendors.find((row) => row.id === id);

  if (!vendor) notFound();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/admin/master-data/vendors" className="text-sm text-sky-800 underline">
          ← ผู้ขาย
        </Link>
        <h1 className="text-2xl font-semibold">{vendor.name}</h1>
        <p className="font-mono text-sm text-slate-600">{vendor.vendorCode}</p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <VendorForm
          mode="edit"
          submitLabel="บันทึกการแก้ไข"
          action={async (values: VendorFormValues) => {
            'use server';
            return updateVendor({ ...values, vendorId: id });
          }}
          existingVendors={toVendorSummaries(vendors.filter((row) => row.id !== id))}
          initial={{
            vendorCode: vendor.vendorCode,
            name: vendor.name,
            taxId: vendor.taxId,
            branchNo: vendor.branchNo,
            address: vendor.address,
            contactName: vendor.contactName,
            phone: vendor.phone,
            email: vendor.email,
            note: vendor.note,
            isActive: vendor.isActive,
          }}
        />
      </section>
    </div>
  );
}
