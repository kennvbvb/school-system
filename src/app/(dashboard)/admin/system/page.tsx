import type { Metadata } from 'next';
import { requirePermissionForPage } from '@/server/auth/guard';
import { getServerEnv } from '@/lib/env/server';
import { formatThaiDateTime } from '@/lib/format/thai-date';

export const metadata: Metadata = { title: 'ข้อมูลระบบ' };

/**
 * หน้าข้อมูลระบบสำหรับผู้ดูแล (FR-SYS-003)
 *
 * เป็นตัวอย่างการบังคับสิทธิ์ที่ server ตามที่ Gate A ต้องตรวจ:
 * ผู้ที่ไม่มี settings.manage จะถูกส่งไป /forbidden ก่อนที่หน้าจะ render
 * แม้จะพิมพ์ URL ตรงเข้ามาก็ตาม
 *
 * ตั้งใจแสดงเฉพาะ "ชื่อ" ของค่าตั้ง ไม่แสดงค่าจริงของ secret ใด ๆ (ข้อ 14.1)
 */
export default async function AdminSystemPage() {
  const user = await requirePermissionForPage('/admin/system', 'settings.manage');
  const env = getServerEnv();

  const rows: { label: string; value: string }[] = [
    { label: 'เวอร์ชันแอปพลิเคชัน (commit)', value: env.APP_COMMIT_SHA },
    { label: 'สภาพแวดล้อม', value: env.NODE_ENV },
    { label: 'เขตเวลาของระบบ', value: env.APP_TIMEZONE },
    { label: 'Bucket เอกสารที่ออกแล้ว', value: env.DOCUMENT_STORAGE_BUCKET },
    { label: 'Bucket ไฟล์แนบ', value: env.ATTACHMENT_STORAGE_BUCKET },
    {
      label: 'Service role key',
      value: env.SUPABASE_SERVICE_ROLE_KEY ? 'ตั้งค่าแล้ว (ไม่แสดงค่า)' : 'ยังไม่ได้ตั้งค่า',
    },
    { label: 'ผู้เปิดดูหน้านี้', value: user.email },
    { label: 'เวลาที่เปิดดู', value: formatThaiDateTime(new Date()) },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">ข้อมูลระบบ</h1>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left">
          <caption className="sr-only">ค่าตั้งและเวอร์ชันของระบบ</caption>
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">
                รายการ
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                ค่า
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-slate-100 last:border-0">
                <th scope="row" className="px-4 py-3 font-normal">
                  {row.label}
                </th>
                <td className="px-4 py-3 font-mono text-sm break-all">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
