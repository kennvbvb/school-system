/**
 * ตัดข้อมูลอ่อนไหวออกก่อนเขียนลง audit log หรือ structured log (FR-AUD-004, ข้อ 14.1)
 *
 * เป็น pure function โดยเจตนา ไม่ผูกกับ server runtime เพื่อให้ทดสอบตรงได้
 * และเรียกใช้ซ้ำได้จากทั้ง audit writer และ error logger
 */

/** ชื่อ field ที่ต้องไม่ปรากฏใน log ไม่ว่าจะซ้อนลึกแค่ไหน */
const SENSITIVE_KEYS = [
  'password',
  'passwd',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'servicerolekey',
  'authorization',
  'cookie',
  'bankdataencrypted',
] as const;

export const REDACTED = '[redacted]';

/** ความลึกสูงสุดที่เดินลงไป — กันทั้งโครงสร้างวนซ้ำและ payload ที่ลึกผิดปกติ */
const MAX_DEPTH = 8;

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, depth + 1));

  const output: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    // ตัดขีด ขีดล่าง และตัวพิมพ์ออก เพื่อให้ apiKey, API-KEY และ api_key ถูกจับเหมือนกัน
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    output[key] = SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive))
      ? REDACTED
      : redactSensitive(nested, depth + 1);
  }

  return output;
}
