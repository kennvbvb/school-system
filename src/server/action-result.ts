import 'server-only';
import type { ZodError } from 'zod';

/**
 * ผลลัพธ์มาตรฐานของ server action
 *
 * ทุก action คืนค่าแบบนี้แทนการโยน error ออกไปถึงฟอร์ม เพราะฟอร์มต้องแสดง
 * ข้อความที่ผู้ใช้แก้ตามได้ ไม่ใช่หน้า error ของ framework
 *
 * ข้อความใน `error` ต้องไม่เปิดเผยโครงสร้างภายในหรือชื่อสิทธิ์ที่ขาด
 * เพราะผู้ที่ไม่มีสิทธิ์จะใช้ข้อความนั้นสำรวจระบบได้ (ข้อ 14.2)
 */
export type ActionResult<T = void> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** แปลง ZodError เป็นรูปที่ฟอร์มนำไปแสดงใต้ช่องที่ผิดได้ */
export function toFieldErrors(error: ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    const existing = result[key];
    if (existing) existing.push(issue.message);
    else result[key] = [issue.message];
  }

  return result;
}

export const INVALID_INPUT_MESSAGE = 'ข้อมูลที่กรอกยังไม่ถูกต้อง';
