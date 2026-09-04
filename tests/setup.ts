import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * เวลาที่ใช้ใน test ต้องคงที่ ไม่ขึ้นกับเขตเวลาของเครื่องที่รัน
 * ฟังก์ชันวันที่ของระบบระบุ timeZone: 'Asia/Bangkok' ไว้ชัดเจนอยู่แล้ว
 * บรรทัดนี้เป็นการยืนยันซ้ำว่า test จะจับ regression ได้แม้ CI ใช้ UTC
 */
process.env.TZ = 'UTC';

/**
 * เราตั้ง globals: false ไว้ใน vitest.config.mts เพื่อบังคับให้ทุกไฟล์ import
 * describe/it/expect มาเอง ผลข้างเคียงคือ auto-cleanup ของ Testing Library
 * ไม่ถูกลงทะเบียนให้ จึงต้องเรียกเอง มิฉะนั้น DOM จากเทสก่อนหน้าจะค้าง
 * แล้ว query อย่าง getByLabelText จะเจอหลาย element
 */
afterEach(() => {
  cleanup();
});
