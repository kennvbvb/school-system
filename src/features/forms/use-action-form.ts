'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * สถานะร่วมของฟอร์มที่เรียก server action
 *
 * มีอยู่เพื่อให้ทุกฟอร์มจัดการสามอย่างนี้เหมือนกัน: กันการกดซ้ำระหว่างส่ง
 * แสดง error ระดับฟอร์มและระดับช่อง และรีเฟรชข้อมูลบนหน้าหลังบันทึกสำเร็จ
 *
 * `router.refresh()` จำเป็นแม้จะมี revalidatePath ฝั่ง server เพราะ revalidate
 * ล้าง cache ของเส้นทาง แต่ไม่ได้สั่งให้แท็บที่เปิดอยู่ดึงข้อมูลใหม่
 */

export interface ActionOutcome {
  ok: boolean;
  error?: string | undefined;
  fieldErrors?: Record<string, string[]> | undefined;
}

export function useActionForm(options: { onSuccess?: () => void } = {}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const { onSuccess } = options;

  const submit = useCallback(
    async (run: () => Promise<ActionOutcome>): Promise<boolean> => {
      setIsSubmitting(true);
      setErrorMessage(null);
      setFieldErrors({});

      try {
        const result = await run();

        if (!result.ok) {
          setErrorMessage(result.error ?? 'บันทึกไม่สำเร็จ');
          setFieldErrors(result.fieldErrors ?? {});
          return false;
        }

        onSuccess?.();
        router.refresh();
        return true;
      } catch (error) {
        /*
         * ข้อผิดพลาดที่หลุดออกมาถึงตรงนี้คือเครือข่ายล่มหรือ action โยน error
         * ที่ไม่ได้ถูกจับ ไม่ใช่ผลลัพธ์ที่ผู้ใช้แก้ตามได้ จึงแสดงข้อความกลาง
         * และเก็บรายละเอียดไว้ที่ console สำหรับผู้ดูแล
         */
        console.error('[form] เรียก server action ไม่สำเร็จ', error);
        setErrorMessage('เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [onSuccess, router],
  );

  const fieldError = useCallback(
    (name: string): string | undefined => fieldErrors[name]?.[0],
    [fieldErrors],
  );

  return { isSubmitting, errorMessage, fieldError, submit };
}
