import 'server-only';
import { NextResponse } from 'next/server';
import type { AuthorizationError } from '@/server/auth/guard';

/**
 * ตัวช่วยร่วมของ Route Handler ส่งออกรายงานทั้งสามหน้า (PR-09d)
 *
 * แยกออกมาเพื่อไม่ให้ทั้งสาม route.ts ต้องเขียนการแปลง error เป็น HTTP response
 * และการสร้างชื่อไฟล์ซ้ำกันสามที่ — ถ้าแก้ข้อความ error ต้องแก้ที่เดียว
 */

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';

export type ExportFormat = 'xlsx' | 'csv';

/** อ่านและตรวจ `format` จาก query string — คืน null เมื่อไม่ใช่ค่าที่รู้จัก */
export function parseExportFormat(searchParams: URLSearchParams): ExportFormat | null {
  const value = searchParams.get('format');
  return value === 'xlsx' || value === 'csv' ? value : null;
}

/**
 * แปลง AuthorizationError เป็น HTTP response ที่เหมาะสม
 *
 * เป็น JSON เสมอ ไม่ใช่ redirect ไปหน้า login/403 เหมือนหน้าเว็บทั่วไป เพราะ
 * ปุ่มดาวน์โหลดจะไม่ปรากฏให้ผู้ที่ไม่มีสิทธิ์เห็นตั้งแต่แรก path นี้จึงถูกเรียกถึง
 * ได้ก็ต่อเมื่อมีคนพิมพ์ URL ตรง ๆ เท่านั้น (ข้อ UAT "ผู้ไม่มีสิทธิ์เรียก URL/API
 * ตรงแล้วถูกปฏิเสธ") — JSON ที่ปฏิเสธชัดเจนตอบโจทย์นั้นได้โดยไม่ต้องมี UI รองรับ
 */
export function authorizationErrorResponse(error: AuthorizationError): NextResponse {
  const status = error.code === 'UNAUTHENTICATED' ? 401 : 403;
  return NextResponse.json({ error: error.message }, { status });
}

export function badRequestResponse(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** ข้อมูลถูกตัด (เกินเพดานที่หน้าจอเดียวกันใช้) จึงปฏิเสธการส่งออกแทนที่จะส่งไฟล์ที่ไม่ครบ */
export function truncatedResponse(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 422 });
}

function timestampForFilename(): string {
  // 'YYYYMMDDTHHmmssZ' — ปลอดภัยกับทุกระบบไฟล์ ไม่มีเครื่องหมาย ':' หรือช่องว่าง
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

/** ชื่อไฟล์เป็นภาษาอังกฤษล้วนโดยตั้งใจ — ชื่อไฟล์ภาษาไทยมีปัญหาความเข้ากันได้
 * กับบางเบราว์เซอร์/ระบบไฟล์เมื่อไม่ได้เข้ารหัสตาม RFC 5987 ให้ครบ ซึ่งซับซ้อน
 * เกินความจำเป็นสำหรับชื่อไฟล์ที่ไม่ต้องสื่อความหมายเป็นภาษาไทยก็ได้ */
export function exportFilename(reportKey: string, format: ExportFormat): string {
  return `${reportKey}-${timestampForFilename()}.${format}`;
}

export function fileResponse(
  buffer: Buffer,
  format: ExportFormat,
  reportKey: string,
): NextResponse {
  const contentType = format === 'xlsx' ? XLSX_CONTENT_TYPE : CSV_CONTENT_TYPE;
  const filename = exportFilename(reportKey, format);

  /*
   * Response ของ Web API (ที่ NextResponse สืบทอดมา) รับ BodyInit ตามชนิดของ
   * lib.dom.d.ts ซึ่งคาดหวัง Uint8Array<ArrayBuffer> ตรง ๆ ส่วน Buffer ของ Node
   * (และการห่อ view รอบ buffer.buffer ของมัน) เป็น Uint8Array<ArrayBufferLike>
   * ที่กว้างกว่า (รวม SharedArrayBuffer) จึงไม่ตรงชนิดแม้จะเป็นค่าเดียวกันจริง
   * ตอนรันไทม์ — Uint8Array.from() คัดลอกเป็น Uint8Array<ArrayBuffer> ธรรมดา
   * ให้ตรงชนิดที่สุด ไฟล์ส่งออกมีขนาดเล็กพอที่การคัดลอกนี้ไม่กระทบประสิทธิภาพ
   */
  return new NextResponse(Uint8Array.from(buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.byteLength),
      // ไฟล์มีข้อมูลของโรงเรียนโดยตรง ไม่ควรถูก cache เก็บไว้ที่ตัวกลางใด ๆ
      'Cache-Control': 'no-store',
    },
  });
}
