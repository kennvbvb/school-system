'use client';

import { useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  procurementDraftSchema,
  TAX_MODES,
  TAX_MODE_LABELS_TH,
} from '@/domain/procurement/schemas';
import type { TaxModeCode } from '@/domain/procurement/schemas';
import { totalOfDraft } from '@/domain/procurement/draft';
import { formatSatang } from '@/domain/money/money';
import { satangToThaiBahtText } from '@/domain/money/thai-baht-text';
import { useUnsavedChangesWarning } from './use-unsaved-warning';

/**
 * ฟอร์มสร้าง/แก้ไขรายการจัดซื้อจัดจ้าง
 *
 * ยอดที่แสดงที่นี่คำนวณด้วย domain function ตัวเดียวกับที่ server ใช้ตรวจ
 * และตรงกับ view ในฐานข้อมูล (มี test ยืนยัน) ผู้ใช้จึงเห็นยอดเดียวกันทุกที่
 *
 * ยอดนี้เป็นเพียงการแสดงผล — ไม่ถูกส่งไปกับฟอร์ม และตารางก็ไม่มีคอลัมน์ให้เขียน
 */

export interface SelectOption {
  id: string;
  label: string;
}

export interface ProcurementFormOptions {
  fiscalYears: SelectOption[];
  vendors: SelectOption[];
  departments: SelectOption[];
  units: SelectOption[];
  budgetAccounts: SelectOption[];
}

interface ItemDraft {
  key: string;
  lineNo: number;
  description: string;
  quantity: string;
  unitId: string;
  unitPrice: string;
  discountAmount: string;
  taxRate: string;
}

interface FundingDraft {
  key: string;
  lineNo: number;
  budgetAccountId: string;
  amount: string;
}

export interface ProcurementFormValues {
  id?: string;
  expectedVersion?: number;
  subject: string;
  purpose: string;
  taxMode: TaxModeCode;
  fiscalYearId: string;
  departmentId: string;
  vendorId: string;
  requestDate: string;
  requiredDate: string;
  note: string;
  items: Omit<ItemDraft, 'key'>[];
  fundingAllocations: Omit<FundingDraft, 'key'>[];
}

export interface SubmitResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

let keyCounter = 0;
const nextKey = () => `row-${++keyCounter}`;

const emptyItem = (lineNo: number): ItemDraft => ({
  key: nextKey(),
  lineNo,
  description: '',
  quantity: '1',
  unitId: '',
  unitPrice: '0',
  discountAmount: '0',
  taxRate: '0',
});

export function ProcurementForm({
  initialValues,
  options,
  onSubmit,
  submitLabel,
}: {
  initialValues: ProcurementFormValues;
  options: ProcurementFormOptions;
  onSubmit: (values: ProcurementFormValues) => Promise<SubmitResult>;
  submitLabel: string;
}) {
  const router = useRouter();
  const errorId = useId();

  const [values, setValues] = useState(initialValues);
  const [items, setItems] = useState<ItemDraft[]>(() =>
    initialValues.items.length > 0
      ? initialValues.items.map((item) => ({ ...item, key: nextKey() }))
      : [emptyItem(1)],
  );
  const [funding, setFunding] = useState<FundingDraft[]>(() =>
    initialValues.fundingAllocations.map((row) => ({ ...row, key: nextKey() })),
  );

  const [isDirty, setIsDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useUnsavedChangesWarning(isDirty && !isSubmitting);

  /** ยอดคำนวณสด ๆ จากสิ่งที่กรอกอยู่ ใช้ฟังก์ชันเดียวกับ server */
  const totals = useMemo(() => {
    const parsed = procurementDraftSchema.safeParse({
      subject: values.subject || 'x',
      taxMode: values.taxMode,
      fiscalYearId: values.fiscalYearId || '11111111-1111-4111-8111-111111111111',
      requestDate: values.requestDate || '2026-01-01',
      items: items.map((item) => ({
        lineNo: item.lineNo,
        description: item.description || 'x',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountAmount: item.discountAmount,
        taxRate: item.taxRate,
      })),
    });

    // ระหว่างพิมพ์ ค่ายังไม่ครบเป็นเรื่องปกติ — แสดงศูนย์แทนการขึ้น error รบกวน
    if (!parsed.success) return null;
    return totalOfDraft(parsed.data);
  }, [items, values.subject, values.taxMode, values.fiscalYearId, values.requestDate]);

  function update<K extends keyof ProcurementFormValues>(key: K, value: ProcurementFormValues[K]) {
    setIsDirty(true);
    setValues((current) => ({ ...current, [key]: value }));
  }

  function updateItem(key: string, patch: Partial<ItemDraft>) {
    setIsDirty(true);
    setItems((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addItem() {
    setIsDirty(true);
    setItems((current) => [...current, emptyItem(current.length + 1)]);
  }

  function removeItem(key: string) {
    setIsDirty(true);
    // เรียงเลขบรรทัดใหม่เสมอ เพื่อไม่ให้เกิดช่องว่างที่ผู้ใช้ตีความว่าข้อมูลหาย
    setItems((current) =>
      current.filter((row) => row.key !== key).map((row, index) => ({ ...row, lineNo: index + 1 })),
    );
  }

  function addFunding() {
    setIsDirty(true);
    setFunding((current) => [
      ...current,
      { key: nextKey(), lineNo: current.length + 1, budgetAccountId: '', amount: '0' },
    ]);
  }

  function removeFunding(key: string) {
    setIsDirty(true);
    setFunding((current) =>
      current.filter((row) => row.key !== key).map((row, index) => ({ ...row, lineNo: index + 1 })),
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setFieldErrors({});
    setIsSubmitting(true);

    const result = await onSubmit({
      ...values,
      items: items.map(({ key: _key, ...rest }) => rest),
      fundingAllocations: funding.map(({ key: _key, ...rest }) => rest),
    });

    if (result.ok) {
      setIsDirty(false);
      router.push('/procurements');
      router.refresh();
      return;
    }

    setIsSubmitting(false);
    setErrorMessage(result.error ?? 'บันทึกไม่สำเร็จ');
    setFieldErrors(result.fieldErrors ?? {});
  }

  const fieldError = (name: string) => fieldErrors[name]?.[0];

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {errorMessage ? (
        <p
          id={errorId}
          role="alert"
          className="rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900"
        >
          {errorMessage}
        </p>
      ) : null}

      <section aria-labelledby="general-heading" className="space-y-4">
        <h2 id="general-heading" className="text-lg font-semibold">
          ข้อมูลทั่วไป
        </h2>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm font-medium">ชื่อเรื่อง</span>
            <input
              required
              value={values.subject}
              onChange={(event) => update('subject', event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
            {fieldError('subject') ? (
              <span className="mt-1 block text-sm text-rose-700">{fieldError('subject')}</span>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">ปีงบประมาณ</span>
            <select
              required
              value={values.fiscalYearId}
              onChange={(event) => update('fiscalYearId', event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">— เลือก —</option>
              {options.fiscalYears.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {fieldError('fiscalYearId') ? (
              <span className="mt-1 block text-sm text-rose-700">{fieldError('fiscalYearId')}</span>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">วิธีคิดภาษี</span>
            <select
              value={values.taxMode}
              onChange={(event) => update('taxMode', event.target.value as TaxModeCode)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            >
              {TAX_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {TAX_MODE_LABELS_TH[mode]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">ผู้ขาย</span>
            <select
              value={values.vendorId}
              onChange={(event) => update('vendorId', event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">— ยังไม่ระบุ —</option>
              {options.vendors.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">หน่วยงานที่ขอ</span>
            <select
              value={values.departmentId}
              onChange={(event) => update('departmentId', event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">— ยังไม่ระบุ —</option>
              {options.departments.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">วันที่ขอ</span>
            <input
              type="date"
              required
              value={values.requestDate}
              onChange={(event) => update('requestDate', event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
            {fieldError('requestDate') ? (
              <span className="mt-1 block text-sm text-rose-700">{fieldError('requestDate')}</span>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">ต้องการใช้ภายในวันที่</span>
            <input
              type="date"
              value={values.requiredDate}
              onChange={(event) => update('requiredDate', event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm font-medium">เหตุผลและความจำเป็น</span>
            <textarea
              rows={3}
              value={values.purpose}
              onChange={(event) => update('purpose', event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
        </div>
      </section>

      <section aria-labelledby="items-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="items-heading" className="text-lg font-semibold">
            รายการพัสดุ
          </h2>
          <button
            type="button"
            onClick={addItem}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            เพิ่มบรรทัด
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[52rem] text-sm">
            <caption className="sr-only">รายการพัสดุที่ขอซื้อหรือขอจ้าง</caption>
            <thead className="bg-slate-50 text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  บรรทัด
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  รายละเอียด
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  จำนวน
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  หน่วย
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  ราคาต่อหน่วย
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  ส่วนลด
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  ภาษี %
                </th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">ลบ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.key} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-500">{item.lineNo}</td>
                  <td className="px-3 py-2">
                    <input
                      required
                      aria-label={`รายละเอียดบรรทัดที่ ${item.lineNo}`}
                      value={item.description}
                      onChange={(event) =>
                        updateItem(item.key, { description: event.target.value })
                      }
                      className="w-full min-w-40 rounded-md border border-slate-300 px-2 py-1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      required
                      inputMode="decimal"
                      aria-label={`จำนวนบรรทัดที่ ${item.lineNo}`}
                      value={item.quantity}
                      onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label={`หน่วยนับบรรทัดที่ ${item.lineNo}`}
                      value={item.unitId}
                      onChange={(event) => updateItem(item.key, { unitId: event.target.value })}
                      className="w-28 rounded-md border border-slate-300 px-2 py-1"
                    >
                      <option value="">—</option>
                      {options.units.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      required
                      inputMode="decimal"
                      aria-label={`ราคาต่อหน่วยบรรทัดที่ ${item.lineNo}`}
                      value={item.unitPrice}
                      onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })}
                      className="w-28 rounded-md border border-slate-300 px-2 py-1 text-right"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      inputMode="decimal"
                      aria-label={`ส่วนลดบรรทัดที่ ${item.lineNo}`}
                      value={item.discountAmount}
                      onChange={(event) =>
                        updateItem(item.key, { discountAmount: event.target.value })
                      }
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      inputMode="decimal"
                      aria-label={`อัตราภาษีบรรทัดที่ ${item.lineNo}`}
                      value={item.taxRate}
                      onChange={(event) => updateItem(item.key, { taxRate: event.target.value })}
                      className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeItem(item.key)}
                      disabled={items.length === 1}
                      className="rounded-md px-2 py-1 text-sm text-rose-700 hover:bg-rose-50 disabled:text-slate-300"
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          aria-live="polite"
          className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
        >
          {totals === null ? (
            <p className="text-slate-600">กรอกจำนวนและราคาให้ครบเพื่อดูยอดรวม</p>
          ) : (
            <>
              <p className="font-semibold">ยอดรวม {formatSatang(totals)} บาท</p>
              <p className="text-sm text-slate-600">({satangToThaiBahtText(totals)})</p>
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="funding-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="funding-heading" className="text-lg font-semibold">
            แหล่งเงิน
          </h2>
          <button
            type="button"
            onClick={addFunding}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            เพิ่มแหล่งเงิน
          </button>
        </div>

        <p className="text-sm text-slate-600">
          หนึ่งรายการใช้เงินจากหลายบัญชีงบได้ ผลรวมต้องเท่ากับยอดรวมของรายการก่อนส่งอนุมัติ
        </p>

        {funding.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-3 text-slate-600">
            ยังไม่ได้ระบุแหล่งเงิน — ระบุก่อนส่งอนุมัติได้
          </p>
        ) : (
          <ul className="space-y-2">
            {funding.map((row) => (
              <li key={row.key} className="flex flex-wrap items-end gap-3">
                <label className="flex-1">
                  <span className="mb-1 block text-sm font-medium">
                    บัญชีงบบรรทัดที่ {row.lineNo}
                  </span>
                  <select
                    required
                    value={row.budgetAccountId}
                    onChange={(event) => {
                      setIsDirty(true);
                      setFunding((current) =>
                        current.map((item) =>
                          item.key === row.key
                            ? { ...item, budgetAccountId: event.target.value }
                            : item,
                        ),
                      );
                    }}
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  >
                    <option value="">— เลือก —</option>
                    {options.budgetAccounts.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="mb-1 block text-sm font-medium">จำนวนเงิน</span>
                  <input
                    required
                    inputMode="decimal"
                    value={row.amount}
                    onChange={(event) => {
                      setIsDirty(true);
                      setFunding((current) =>
                        current.map((item) =>
                          item.key === row.key ? { ...item, amount: event.target.value } : item,
                        ),
                      );
                    }}
                    className="w-36 rounded-md border border-slate-300 px-3 py-2 text-right"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => removeFunding(row.key)}
                  className="rounded-md px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
                >
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex items-center gap-3 border-t border-slate-200 pt-5">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-slate-900 px-5 py-2.5 font-medium text-white hover:bg-slate-700 disabled:bg-slate-400"
        >
          {isSubmitting ? 'กำลังบันทึก…' : submitLabel}
        </button>
        {isDirty ? (
          <span className="text-sm text-amber-800">มีการแก้ไขที่ยังไม่ได้บันทึก</span>
        ) : null}
      </div>
    </form>
  );
}
