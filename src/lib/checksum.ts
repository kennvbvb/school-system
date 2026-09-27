import { createHash } from 'node:crypto';

/**
 * checksum ของไฟล์ที่ส่งออก (ข้อ PR-09 "export log เก็บ ... checksum เมื่อเหมาะสม")
 *
 * เก็บ SHA-256 แบบเต็ม ไม่ตัดสั้นเหมือน hashIp ของ src/server/audit/audit-log.ts
 * เพราะจุดประสงค์ต่างกัน — hashIp ต้องการกันย้อนกลับเป็น IP จริง ส่วนอันนี้ต้องการ
 * ให้ผู้ตรวจสอบเทียบไฟล์ที่ถืออยู่กับค่าที่บันทึกใน audit event ได้แม่นที่สุด
 * (แนวคิดเดียวกับ checksum ของเอกสารที่ออกแล้วใน UAT ข้อ 8 "reprint โดย checksum เดิม")
 *
 * ไม่ import 'server-only' เพราะ node:crypto ใช้ได้ทั้งฝั่งทดสอบและฝั่งเซิร์ฟเวอร์
 * และไฟล์นี้ไม่มีความลับใด ๆ ให้ต้องกันการ bundle ไปฝั่ง client
 */
export function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
