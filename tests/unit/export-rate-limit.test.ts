import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkExportRateLimit } from '@/server/reports/export-rate-limit';

/**
 * key ต้องไม่ซ้ำกันระหว่างเทสต์ เพราะ bucket เก็บอยู่ใน module-level Map ที่
 * ใช้ร่วมกันตลอดอายุของ process — สุ่มด้วย test index กันเทสต์หนึ่งกระทบอีกเทสต์
 */
let keySeq = 0;
function uniqueKey(): string {
  keySeq += 1;
  return `test-user-${keySeq}`;
}

describe('checkExportRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T09:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('อนุญาตทุกครั้งจนกว่าจะถึงเพดานภายในหน้าต่างเวลาเดียวกัน', () => {
    const key = uniqueKey();
    for (let i = 0; i < 6; i += 1) {
      expect(checkExportRateLimit(key).allowed).toBe(true);
    }
    const seventh = checkExportRateLimit(key);
    expect(seventh.allowed).toBe(false);
  });

  it('บอกจำนวนวินาทีที่ควรรอเมื่อเกินเพดาน', () => {
    const key = uniqueKey();
    for (let i = 0; i < 6; i += 1) checkExportRateLimit(key);

    const result = checkExportRateLimit(key);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('นับแยกกันตาม key — คนละ key ไม่กระทบเพดานของกันและกัน', () => {
    const keyA = uniqueKey();
    const keyB = uniqueKey();
    for (let i = 0; i < 6; i += 1) checkExportRateLimit(keyA);

    expect(checkExportRateLimit(keyA).allowed).toBe(false);
    expect(checkExportRateLimit(keyB).allowed).toBe(true);
  });

  it('เมื่อเวลาผ่านไปเกินหน้าต่าง (60 วินาที) นับใหม่ได้อีก', () => {
    const key = uniqueKey();
    for (let i = 0; i < 6; i += 1) checkExportRateLimit(key);
    expect(checkExportRateLimit(key).allowed).toBe(false);

    vi.advanceTimersByTime(60_001);

    expect(checkExportRateLimit(key).allowed).toBe(true);
  });

  it('sliding window: คำขอเก่าที่หลุดหน้าต่างแล้วไม่ถูกนับต่อ แม้คำขอใหม่ยังไม่เกิน 60 วินาที', () => {
    const key = uniqueKey();
    // ใช้โควตาไป 3 ครั้งแรก
    for (let i = 0; i < 3; i += 1) checkExportRateLimit(key);

    // ผ่านไป 61 วินาที (คำขอ 3 ครั้งแรกหลุดหน้าต่างไปแล้ว) แล้วใช้โควตาเต็มอีกครั้ง
    vi.advanceTimersByTime(61_000);
    for (let i = 0; i < 6; i += 1) {
      expect(checkExportRateLimit(key).allowed).toBe(true);
    }
    expect(checkExportRateLimit(key).allowed).toBe(false);
  });
});
