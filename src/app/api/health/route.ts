import { NextResponse } from 'next/server';

/**
 * Health check (FR-SYS-001)
 *
 * ตั้งใจไม่เปิดเผยข้อมูลลับ: ไม่บอกสถานะการเชื่อมต่อฐานข้อมูล ชื่อโฮสต์
 * หรือค่าตั้งใด ๆ เพราะ endpoint นี้เข้าถึงได้โดยไม่ต้องเข้าสู่ระบบ
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { status: 'ok', timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
