'use client';

import { useState } from 'react';
import { suggestFiscalYearRange } from '@/domain/master-data/fiscal-year';
import { FormError, SubmitButton, TextField } from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import type { ActionOutcome } from '@/features/forms/use-action-form';

/**
 * ฟอร์มเพิ่มปีงบประมาณ
 *
 * เมื่อกรอกปี พ.ศ. ระบบจะ **เสนอ** วันเริ่ม-สิ้นสุดตามกติกาที่โรงเรียนยืนยันแล้ว
 * (1 ต.ค. ถึง 30 ก.ย. — คำตอบ Q6) แต่ยังแก้ได้ทั้งสองช่อง
 *
 * เสนอเฉพาะตอนที่ช่องยังว่าง ไม่เขียนทับค่าที่ผู้ใช้แก้เอง เพราะปีที่มีการเปลี่ยน
 * ระเบียบหรือปีที่กรอกย้อนหลังอาจมีช่วงต่างออกไป และการเขียนทับจะทำให้ค่าที่ตั้งใจ
 * แก้หายไปโดยไม่รู้ตัวเมื่อกลับไปแก้ปี พ.ศ.
 */
export function FiscalYearForm({
  action,
}: {
  action: (values: {
    code: string;
    yearBE: number;
    startDate: string;
    endDate: string;
  }) => Promise<ActionOutcome>;
}) {
  const [code, setCode] = useState('');
  const [yearBE, setYearBE] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const form = useActionForm({
    onSuccess: () => {
      setCode('');
      setYearBE('');
      setStartDate('');
      setEndDate('');
    },
  });

  /*
   * เสนอช่วงวันที่จากปี พ.ศ. ที่กรอก
   *
   * ปี พ.ศ. ต้องอยู่ในช่วงที่ schema ยอมรับก่อนจึงจะเสนอ มิฉะนั้นตอนพิมพ์เลข
   * ตัวแรก ("2") จะได้ช่วงปี ค.ศ. 1459 ซึ่งเป็นค่าที่ไม่มีความหมายและกวนสายตา
   */
  function changeYearBE(value: string) {
    setYearBE(value);

    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 2500 || parsed > 2700) return;

    const suggested = suggestFiscalYearRange(parsed);
    if (startDate === '') setStartDate(suggested.startDate);
    if (endDate === '') setEndDate(suggested.endDate);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await form.submit(() =>
      action({
        code,
        // ส่งเป็นตัวเลขเพราะ schema รับ number — ค่าว่างกลายเป็น NaN ซึ่ง schema ปฏิเสธ
        yearBE: Number.parseInt(yearBE, 10),
        startDate,
        endDate,
      }),
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormError message={form.errorMessage} />

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="รหัสปีงบประมาณ"
          required
          value={code}
          onChange={setCode}
          error={form.fieldError('code')}
          hint="เช่น FY2569 — ใช้อ้างอิงในรายงานและเลขเอกสาร"
        />
        <TextField
          label="ปีงบประมาณ (พ.ศ.)"
          type="number"
          required
          value={yearBE}
          onChange={changeYearBE}
          error={form.fieldError('yearBE')}
          hint="กรอกเป็นปีพุทธศักราช เช่น 2569 แล้วระบบจะเสนอช่วงวันที่ให้"
        />
        <TextField
          label="วันเริ่มต้น"
          type="date"
          required
          value={startDate}
          onChange={setStartDate}
          error={form.fieldError('startDate')}
          hint="ตามระเบียบคือ 1 ตุลาคม แก้ได้ถ้าปีนี้ต่างออกไป"
        />
        <TextField
          label="วันสิ้นสุด"
          type="date"
          required
          value={endDate}
          onChange={setEndDate}
          error={form.fieldError('endDate')}
          hint="ตามระเบียบคือ 30 กันยายน"
        />
      </div>

      <SubmitButton isSubmitting={form.isSubmitting}>เพิ่มปีงบประมาณ</SubmitButton>
    </form>
  );
}
