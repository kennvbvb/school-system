'use client';

import { useState } from 'react';
import {
  FormError,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import type { SelectOption } from '@/features/forms/fields';
import type { ActionOutcome } from '@/features/forms/use-action-form';

export interface ItemFormValues {
  code: string;
  nameTh: string;
  itemCategoryId: string;
  unitId: string;
  locationId: string;
  minimumQuantity: string;
  note: string;
}

/** สร้างรายการพัสดุใหม่ — ต้องมี inventory.adjust (ดูเหตุผลใน migration RLS) */
export function ItemForm({
  categories,
  units,
  locations,
  action,
}: {
  categories: readonly SelectOption[];
  units: readonly SelectOption[];
  locations: readonly SelectOption[];
  action: (values: ItemFormValues) => Promise<ActionOutcome>;
}) {
  const [code, setCode] = useState('');
  const [nameTh, setNameTh] = useState('');
  const [itemCategoryId, setItemCategoryId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [minimumQuantity, setMinimumQuantity] = useState('0');
  const [note, setNote] = useState('');

  const form = useActionForm({
    onSuccess: () => {
      setCode('');
      setNameTh('');
      setItemCategoryId('');
      setUnitId('');
      setLocationId('');
      setMinimumQuantity('0');
      setNote('');
    },
  });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await form.submit(() =>
      action({ code, nameTh, itemCategoryId, unitId, locationId, minimumQuantity, note }),
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormError message={form.errorMessage} />

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="รหัสพัสดุ"
          required
          value={code}
          onChange={setCode}
          error={form.fieldError('code')}
          hint="ตัวอักษรภาษาอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง"
        />
        <TextField
          label="ชื่อรายการ"
          required
          value={nameTh}
          onChange={setNameTh}
          error={form.fieldError('nameTh')}
        />
        <SelectField
          label="หมวดพัสดุ"
          value={itemCategoryId}
          onChange={setItemCategoryId}
          options={categories}
          error={form.fieldError('itemCategoryId')}
        />
        <SelectField
          label="หน่วยนับ"
          required
          value={unitId}
          onChange={setUnitId}
          options={units}
          error={form.fieldError('unitId')}
        />
        <SelectField
          label="สถานที่จัดเก็บ"
          value={locationId}
          onChange={setLocationId}
          options={locations}
          error={form.fieldError('locationId')}
        />
        <TextField
          label="จุดสั่งซื้อซ้ำ"
          value={minimumQuantity}
          onChange={setMinimumQuantity}
          error={form.fieldError('minimumQuantity')}
          hint="เตือนเมื่อยอดคงเหลือต่ำกว่าจำนวนนี้"
        />
        <TextAreaField
          label="หมายเหตุ"
          rows={2}
          value={note}
          onChange={setNote}
          error={form.fieldError('note')}
          className="md:col-span-2"
        />
      </div>

      <SubmitButton isSubmitting={form.isSubmitting}>สร้างรายการพัสดุ</SubmitButton>
    </form>
  );
}
