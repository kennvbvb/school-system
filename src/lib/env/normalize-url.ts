/**
 * ทำค่า URL จาก environment ให้อยู่ในรูปเดียว — เติม https:// ถ้าไม่มี scheme และตัด "/" ท้าย
 *
 * ไฟล์นี้ไม่ import อะไรเลย เพราะถูกใช้จากหลายที่ที่มี runtime ต่างกัน:
 * schema ของ env (server/client/proxy) และ next.config.ts ที่คำนวณ CSP ตอน build
 * ทุกที่ต้องได้ค่าเดียวกันจากค่า env ตัวเดียวกัน ไม่เช่นนั้น proxy จะยอมรับค่าที่ CSP หรือ
 * Supabase client อ่านไม่ออก (เช่น "abc.supabase.co" ที่ new URL() ปฏิเสธ)
 *
 * Vercel และ Supabase แสดง URL ในหน้า dashboard โดยไม่มี scheme การเติม https:// ให้ปลอดภัย
 * เพราะทั้งสองบริการให้บริการผ่าน https เท่านั้น ส่วนการพัฒนาในเครื่องใช้ http://localhost
 * ซึ่งมี scheme อยู่แล้วจึงไม่ถูกแตะ
 *
 * ลำดับสำคัญ: ต้องเติม scheme ก่อนแล้วค่อยตัด "/" ท้าย ถ้าตัดก่อนค่าอย่าง
 * "https://" จะเหลือ "https:" ซึ่งหลุดกติกา scheme แล้วถูกเติมซ้ำเป็น
 * "https://https:" ที่นับเป็น URL ถูกต้องทั้งที่ผู้ดูแลยังกรอกไม่เสร็จ
 */
export function normalizeUrlValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return trimmed;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}
