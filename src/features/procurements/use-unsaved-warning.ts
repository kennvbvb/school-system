'use client';

import { useEffect } from 'react';

/**
 * เตือนก่อนออกจากหน้าเมื่อยังมีการแก้ที่ไม่ได้บันทึก
 *
 * ข้อค้นพบจากเอกสารจริงคือข้อมูลกระจายและกรอกซ้ำหลายที่ ฟอร์มของระบบนี้จึงยาว
 * การปิดแท็บโดยไม่ตั้งใจแล้วเสียงานทั้งหมดเป็นความเสียหายที่ป้องกันได้ถูก ๆ
 *
 * ครอบคลุมเฉพาะการปิด/รีโหลดแท็บ ซึ่งเป็นสิ่งที่เบราว์เซอร์ยอมให้ดักได้
 * การกดลิงก์ภายในแอปต้องจัดการแยกที่ตัวลิงก์ เพราะ Next.js router
 * ไม่มี hook กลางสำหรับยกเลิกการนำทางที่ใช้ได้กับทุกกรณี
 */
export function useUnsavedChangesWarning(hasUnsavedChanges: boolean): void {
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      // เบราว์เซอร์สมัยใหม่แสดงข้อความมาตรฐานของตัวเอง ไม่ใช้ข้อความที่เรากำหนด
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);
}
