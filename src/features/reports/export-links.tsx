/**
 * ส่วนแสดงลิงก์ดาวน์โหลดของหน้ารายงาน (PR-09d)
 *
 * เป็น server component ธรรมดา — ไม่ใช้ next/link เพราะปลายทางเป็น Route Handler
 * ที่ตอบเป็นไฟล์ให้ดาวน์โหลด ไม่ใช่หน้าเว็บที่ Next ต้อง prefetch หรือติดตาม
 * ด้วย typedRoutes การใช้ `<a>` ธรรมดายังทำให้เบราว์เซอร์ดาวน์โหลดไฟล์แบบ
 * native ได้ทันทีโดยไม่ต้องมี JavaScript ฝั่ง client เลย
 */
export interface ExportLinkGroup {
  label: string;
  links: readonly { label: string; href: string }[];
}

export function ExportLinks({ groups }: { groups: readonly ExportLinkGroup[] }) {
  return (
    <section
      aria-labelledby="export-heading"
      className="rounded-lg border border-slate-200 bg-white p-5"
    >
      <h2 id="export-heading" className="text-lg font-semibold">
        ส่งออกไฟล์
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        ไฟล์ที่ได้ตรงกับตัวกรองที่เลือกอยู่ในหน้านี้ และมีบันทึกการส่งออกไว้ในประวัติการใช้งานเสมอ
      </p>
      <ul className="mt-3 space-y-2">
        {groups.map((group) => (
          <li key={group.label} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-medium">{group.label}</span>
            {group.links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sky-800 hover:bg-slate-50"
              >
                ดาวน์โหลด {link.label}
              </a>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
