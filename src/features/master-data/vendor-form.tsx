'use client';

import { useMemo, useState } from 'react';
import {
  CheckboxField,
  FormError,
  SubmitButton,
  TextAreaField,
  TextField,
} from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import { findDuplicateVendors, hasBlockingDuplicate } from '@/domain/master-data/vendor';
import type { ActionOutcome } from '@/features/forms/use-action-form';
import type { DuplicateFinding, VendorSummary } from '@/domain/master-data/vendor';

/**
 * ฟอร์มผู้ขาย ใช้ทั้งเพิ่มใหม่และแก้ไข (FR-MST-005, FR-MST-009)
 *
 * เรียก `findDuplicateVendors` — ฟังก์ชันเดียวกับที่ server ใช้บังคับจริง —
 * ในเบราว์เซอร์ระหว่างพิมพ์ ผู้ใช้จึงเห็นว่าซ้ำก่อนกดบันทึก ไม่ใช่หลังกดแล้ว
 * ถูกปฏิเสธ ทำได้เพราะรายการผู้ขายอยู่บนหน้านี้อยู่แล้วสำหรับตาราง จึงไม่ต้อง
 * เรียก server เพิ่มเลย
 *
 * **การตรวจในเบราว์เซอร์เป็นเรื่อง UX ล้วน ๆ** server ตรวจซ้ำด้วยข้อมูลสด
 * ทุกครั้งและเป็นผู้ตัดสิน (ข้อ 4.2) — รายการที่ส่งมาที่นี่อาจเก่าไปแล้วถ้ามี
 * ผู้ใช้อีกคนเพิ่มผู้ขายระหว่างที่หน้านี้เปิดค้างอยู่
 */

export interface VendorFormValues {
  vendorCode: string;
  name: string;
  taxId: string | undefined;
  branchNo: string | undefined;
  address: string | undefined;
  contactName: string | undefined;
  phone: string | undefined;
  email: string | undefined;
  note: string | undefined;
  isActive: boolean;
  acknowledgedDuplicate: boolean;
}

export interface VendorFormInitial {
  vendorCode: string;
  name: string;
  taxId: string | null;
  branchNo: string | null;
  address: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  isActive: boolean;
}

const EMPTY: VendorFormInitial = {
  vendorCode: '',
  name: '',
  taxId: null,
  branchNo: null,
  address: null,
  contactName: null,
  phone: null,
  email: null,
  note: null,
  isActive: true,
};

/** ช่องที่เว้นว่างต้องส่งเป็น undefined ไม่ใช่ '' มิฉะนั้น schema จะฟ้องว่ารูปแบบผิด */
const orUndefined = (value: string): string | undefined =>
  value.trim() === '' ? undefined : value;

export function VendorForm({
  action,
  existingVendors,
  initial,
  submitLabel,
  mode,
}: {
  action: (values: VendorFormValues) => Promise<ActionOutcome>;
  /** ผู้ขายที่มีอยู่สำหรับเทียบซ้ำ — ผู้เรียกตัดตัวเองออกแล้วเมื่ออยู่ในโหมดแก้ไข */
  existingVendors: readonly VendorSummary[];
  initial?: VendorFormInitial;
  submitLabel: string;
  mode: 'create' | 'edit';
}) {
  const start = initial ?? EMPTY;

  const [vendorCode, setVendorCode] = useState(start.vendorCode);
  const [name, setName] = useState(start.name);
  const [taxId, setTaxId] = useState(start.taxId ?? '');
  const [branchNo, setBranchNo] = useState(start.branchNo ?? '');
  const [address, setAddress] = useState(start.address ?? '');
  const [contactName, setContactName] = useState(start.contactName ?? '');
  const [phone, setPhone] = useState(start.phone ?? '');
  const [email, setEmail] = useState(start.email ?? '');
  const [note, setNote] = useState(start.note ?? '');
  const [isActive, setIsActive] = useState(start.isActive);
  const [acknowledged, setAcknowledged] = useState(false);

  const form = useActionForm({
    onSuccess: () => {
      if (mode !== 'create') return;

      setVendorCode('');
      setName('');
      setTaxId('');
      setBranchNo('');
      setAddress('');
      setContactName('');
      setPhone('');
      setEmail('');
      setNote('');
      setIsActive(true);
      setAcknowledged(false);
    },
  });

  const duplicates = useMemo(
    () =>
      name.trim() === '' && taxId.trim() === ''
        ? []
        : findDuplicateVendors(
            { name, taxId: orUndefined(taxId) ?? null, branchNo: orUndefined(branchNo) ?? null },
            existingVendors,
          ),
    [name, taxId, branchNo, existingVendors],
  );

  const blocked = hasBlockingDuplicate(duplicates);
  const needsAcknowledgement = !blocked && duplicates.length > 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await form.submit(() =>
      action({
        vendorCode,
        name,
        taxId: orUndefined(taxId),
        branchNo: orUndefined(branchNo),
        address: orUndefined(address),
        contactName: orUndefined(contactName),
        phone: orUndefined(phone),
        email: orUndefined(email),
        note: orUndefined(note),
        isActive,
        acknowledgedDuplicate: acknowledged,
      }),
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormError message={form.errorMessage} />

      <DuplicateNotice findings={duplicates} />

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="รหัสผู้ขาย"
          required
          value={vendorCode}
          onChange={setVendorCode}
          error={form.fieldError('vendorCode')}
          hint="เช่น V-001"
        />
        <TextField
          label="ชื่อผู้ขาย"
          required
          value={name}
          onChange={setName}
          error={form.fieldError('name')}
        />
        <TextField
          label="เลขประจำตัวผู้เสียภาษี"
          value={taxId}
          onChange={setTaxId}
          error={form.fieldError('taxId')}
          hint="ตัวเลข 13 หลัก เว้นว่างได้ถ้ายังไม่ทราบ"
        />
        <TextField
          label="รหัสสาขา"
          value={branchNo}
          onChange={setBranchNo}
          error={form.fieldError('branchNo')}
          hint="เว้นว่าง = สำนักงานใหญ่"
        />
        <TextField
          label="ชื่อผู้ติดต่อ"
          value={contactName}
          onChange={setContactName}
          error={form.fieldError('contactName')}
        />
        <TextField
          label="เบอร์โทร"
          value={phone}
          onChange={setPhone}
          error={form.fieldError('phone')}
        />
        <TextField
          label="อีเมล"
          value={email}
          onChange={setEmail}
          error={form.fieldError('email')}
        />
        <TextAreaField
          label="ที่อยู่"
          value={address}
          onChange={setAddress}
          error={form.fieldError('address')}
          className="md:col-span-2"
        />
        <TextAreaField
          label="หมายเหตุ"
          value={note}
          onChange={setNote}
          error={form.fieldError('note')}
          className="md:col-span-2"
        />
      </div>

      <CheckboxField
        label="ใช้งานอยู่"
        checked={isActive}
        onChange={setIsActive}
        hint="ปิดใช้แล้วจะเลือกในรายการจัดซื้อใหม่ไม่ได้ แต่เอกสารเดิมยังแสดงชื่อได้ถูกต้อง"
      />

      {needsAcknowledgement ? (
        <CheckboxField
          label="ยืนยันว่าเป็นผู้ขายคนละราย"
          checked={acknowledged}
          onChange={setAcknowledged}
          hint="ระบบจะบันทึกคำยืนยันนี้ไว้ในประวัติการแก้ไข"
        />
      ) : null}

      <SubmitButton isSubmitting={form.isSubmitting} disabled={blocked}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}

/**
 * แสดงผลตรวจซ้ำแยกระดับ
 *
 * BLOCK ใช้ `role="alert"` เพราะเป็นเหตุที่ทำให้บันทึกไม่ได้เลย ส่วน WARN ใช้
 * `role="status"` เพราะไม่ได้ขัดจังหวะการกรอก แต่ต้องได้ยินว่ามีข้อความขึ้นมา
 */
function DuplicateNotice({ findings }: { findings: readonly DuplicateFinding[] }) {
  if (findings.length === 0) return null;

  const blocking = findings.filter((finding) => finding.severity === 'BLOCK');
  const warnings = findings.filter((finding) => finding.severity === 'WARN');

  return (
    <div className="space-y-3">
      {blocking.length > 0 ? (
        <div
          role="alert"
          className="rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900"
        >
          <p className="font-medium">เป็นผู้ขายรายเดิมที่มีอยู่แล้ว</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {blocking.map((finding) => (
              <li key={finding.vendor.id}>{finding.reasonTh}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm">
            หากต้องการแก้ไขข้อมูล ให้แก้ที่ผู้ขายรายเดิมแทนการเพิ่มใหม่
          </p>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900"
        >
          <p className="font-medium">อาจซ้ำกับผู้ขายที่มีอยู่</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {warnings.map((finding) => (
              <li key={finding.vendor.id}>{finding.reasonTh}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm">ถ้าเป็นคนละราย ให้ติ๊กยืนยันด้านล่างแล้วบันทึกต่อได้</p>
        </div>
      ) : null}
    </div>
  );
}
