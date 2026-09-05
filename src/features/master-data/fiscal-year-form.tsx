'use client';

import { useState } from 'react';
import { FormError, SubmitButton, TextField } from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import type { ActionOutcome } from '@/features/forms/use-action-form';

/**
 * ฟอร์มเพิ่มปีงบประมาณ
 *
 * **ไม่มีค่าเริ่มต้นของวันเริ่ม-สิ้นสุด** โดยเจตนา
 *
 * การเติม 1 ต.ค. – 30 ก.ย. ให้อัตโนมัติจะทำให้คนกรอกกดผ่านไปโดยไม่ตรวจ
 * ทั้งที่คำถาม Q6 (ปีงบประมาณของโรงเรียนเริ่มและสิ้นสุดวันใด) ยังไม่มีคำตอบ
 * ค่าที่ระบบเดาให้แล้วไม่มีใครทักท้วง คือค่าที่กลายเป็นข้อเท็จจริงผิด ๆ ในภายหลัง
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
          onChange={setYearBE}
          error={form.fieldError('yearBE')}
          hint="กรอกเป็นปีพุทธศักราช เช่น 2569"
        />
        <TextField
          label="วันเริ่มต้น"
          type="date"
          required
          value={startDate}
          onChange={setStartDate}
          error={form.fieldError('startDate')}
        />
        <TextField
          label="วันสิ้นสุด"
          type="date"
          required
          value={endDate}
          onChange={setEndDate}
          error={form.fieldError('endDate')}
        />
      </div>

      <SubmitButton isSubmitting={form.isSubmitting}>เพิ่มปีงบประมาณ</SubmitButton>
    </form>
  );
}
