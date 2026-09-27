/**
 * ตัวจำกัดอัตราการเรียกส่งออกรายงาน — แก้ finding [P1] "ไม่มี rate limiting
 * สำหรับงานสร้างไฟล์" จากรายงานตรวจสอบวันที่ 27 กันยายน 2569
 *
 * **ตั้งใจไม่ใส่ `import 'server-only'`** ด้วยเหตุผลเดียวกับ export-file.ts —
 * ไฟล์นี้เป็นตรรกะล้วน (Map ในหน่วยความจำ + เลขคณิต) ไม่มี dependency บน
 * next/headers หรือ request context ใด ๆ การไม่ใส่ทำให้ vitest ทดสอบ sliding
 * window/pruning logic ได้ตรง ๆ ซึ่งสำคัญกว่าการป้องกัน import ผิดที่ในกรณีนี้
 * (ไฟล์นี้ถูกเรียกจาก Route Handler เท่านั้นเช่นเดียวกัน)
 *
 * **ข้อจำกัดที่ต้องเข้าใจก่อนใช้งาน**
 *
 * นี่คือ sliding window ในหน่วยความจำของ process เดียว ไม่ใช่ระบบจำกัดอัตรา
 * แบบกระจาย (distributed rate limit) — ทั้งระบบยังไม่มี store กลาง (Redis,
 * Vercel KV หรือตารางในฐานข้อมูล) ให้ใช้ร่วมกันระหว่าง serverless instance
 * ดังนั้น:
 *
 *   1. ผู้ใช้คนเดียวที่ถูกส่ง request ไปลง instance คนละตัวของ Vercel จะไม่ถูก
 *      นับรวมกัน — การป้องกันจึงเป็น "ดีกว่าไม่มีเลย" ไม่ใช่ "รับประกันเพดาน"
 *   2. หน่วยความจำจะหายไปเมื่อ instance เย็นตัวลง (cold start) นับใหม่ทุกครั้ง
 *   3. ยังไม่มี metric ที่ส่งออกไปเก็บไว้ที่อื่น (ตามที่รายงานเสนอ "structured
 *      metric") — เห็นได้แค่ log บน instance เดียวกันเท่านั้น
 *
 * การป้องกันที่รับประกันได้จริงต้องมี store กลาง ซึ่งเป็นงานแยกที่ใหญ่กว่า
 * ขอบเขตของ PR-09d (ต้องเลือกและตั้งค่า infra ใหม่) จึงบันทึกไว้เป็นข้อจำกัด
 * ที่ทราบใน docs/assumptions.md แทนที่จะขยายขอบเขตของ PR นี้
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 6;

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

/** ตัดทิ้ง bucket ที่ไม่มีการเรียกมานานแล้ว กันหน่วยความจำโตไม่มีที่สิ้นสุด */
function pruneStaleBuckets(now: number): void {
  for (const [key, bucket] of buckets) {
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < WINDOW_MS);
    if (bucket.timestamps.length === 0) buckets.delete(key);
  }
}

export interface ExportRateLimitResult {
  allowed: boolean;
  /** จำนวนวินาทีที่ควรบอกผู้ใช้ให้รอ เมื่อ allowed === false */
  retryAfterSeconds: number;
}

/**
 * ตรวจและบันทึกการเรียกหนึ่งครั้งภายใต้ key เดียวกัน (แนะนำให้ประกอบจาก
 * userId + reportKey เพื่อไม่ให้ผู้ใช้คนหนึ่งกระทบเพดานของอีกรายงานหนึ่ง)
 */
export function checkExportRateLimit(key: string): ExportRateLimitResult {
  const now = Date.now();
  pruneStaleBuckets(now);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < WINDOW_MS);

  if (bucket.timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldest = bucket.timestamps[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  bucket.timestamps.push(now);
  return { allowed: true, retryAfterSeconds: 0 };
}
