import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermissionForPage } from '@/server/auth/guard';
import {
  loadFiscalYearOptions,
  loadProcurementRegister,
  REGISTER_ROW_LIMIT,
} from '@/server/reports/repository';
import {
  hasReversedDateRange,
  parseProcurementRegisterFilter,
} from '@/domain/procurement/register-schemas';
import { buildProcurementRegister, REGISTER_FLAG_LABELS_TH } from '@/domain/procurement/register';
import { RegisterFilters } from '@/features/reports/register-filters';
import { RegisterTable } from '@/features/reports/register-table';
import { ExportLinks } from '@/features/reports/export-links';
import { procurementRegisterExportHref } from '@/features/reports/export-hrefs';
import { formatSatang } from '@/features/reports/format';
import { STATUS_LABELS_TH } from '@/features/procurements/format';

export const metadata: Metadata = { title: 'รายงานทะเบียนจัดซื้อจัดจ้าง' };

/**
 * ทะเบียนจัดซื้อจัดจ้าง (PR-09)
 *
 * หน้า /procurements ตอบคำถาม "งานของฉันถึงไหนแล้ว" ส่วนหน้านี้ตอบคำถามที่
 * ผู้ตรวจถาม คือ "ปีนี้โรงเรียนจัดซื้อจัดจ้างอะไรไปบ้าง รวมเป็นเงินเท่าไร
 * และมีแถวใดที่กรอกไม่ครบ" ซึ่งเป็นคำถามที่ไฟล์สเปรดชีตเดิมตอบผิดอยู่หลายจุด
 * (F-14 12 แถวไม่มีเลขเอกสาร, F-15 3 แถวไม่มีจำนวนเงิน)
 *
 * ใช้ procurement.read.all ไม่ใช่ procurement.read.own สำหรับการดูบนจอ เพราะ
 * "ทะเบียน" ที่เห็นเฉพาะรายการของตัวเองคือสมุดคุมที่ไม่ครบเล่ม ผู้อ่านจะสรุป
 * ยอดของโรงเรียนจากมันโดยไม่รู้ว่ายังขาดอะไรอยู่ — ส่วนการส่งออกเป็นไฟล์ต้องมี
 * reports.export เพิ่มอีกสิทธิ์หนึ่ง (ดู src/app/(dashboard)/reports/procurements/export/route.ts)
 * เพราะการดูบนจอกับการนำข้อมูลออกนอกระบบเป็นคนละเรื่องกัน
 *
 * **อ่านอย่างเดียว** ไม่มี mutation ใด ๆ
 */
export default async function ProcurementRegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermissionForPage('/reports/procurements', 'procurement.read.all');

  const filter = parseProcurementRegisterFilter(await searchParams);
  const [result, fiscalYears] = await Promise.all([
    loadProcurementRegister(filter),
    loadFiscalYearOptions(),
  ]);

  const register = buildProcurementRegister(result.rows);
  const reversedRange = hasReversedDateRange(filter);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">ทะเบียนจัดซื้อจัดจ้าง</h1>
        <p className="text-slate-600">
          ทุกรายการที่ยังไม่ถูกลบ เรียงตามวันที่ขอจากใหม่ไปเก่า
          จำนวนเงินคิดจากรายการย่อยที่ฐานข้อมูล ไม่ได้อ่านจากยอดที่เก็บไว้ต่างหาก
        </p>
      </header>

      <RegisterFilters filter={filter} fiscalYears={fiscalYears} />

      {/* ช่วงวันที่กลับด้านให้ผลลัพธ์ศูนย์แถวเสมอ ซึ่งอ่านได้ว่า "ช่วงนี้ไม่มีรายการ"
          — คำตอบที่ผิดและน่าเชื่อ จึงต้องบอกตรง ๆ ว่าเงื่อนไขที่ใส่มาเป็นไปไม่ได้ */}
      {reversedRange ? (
        <p
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          วันที่เริ่มต้นอยู่หลังวันที่สิ้นสุด ช่วงวันที่นี้จึงไม่มีทางมีรายการใดเลย
          กรุณาสลับวันที่ทั้งสองช่อง
        </p>
      ) : null}

      {/*
        ข้อมูลถูกตัด = ไม่แสดงยอดรวม

        ยอดรวมของแถวที่เหลือรอดซึ่งติดป้ายว่า "ยอดรวม" คือคำตอบที่ผิดและน่าเชื่อ
        ซึ่งอันตรายกว่าการไม่มีตัวเลขให้ดู ผู้อ่านที่เห็นตัวเลขไปแล้วจะไม่กลับมาตรวจ
      */}
      {result.truncated ? (
        <p
          role="status"
          className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900"
        >
          มีรายการเกิน {REGISTER_ROW_LIMIT.toLocaleString('th-TH')} รายการ
          หน้านี้จึงแสดงเพียงบางส่วนและ<strong>ไม่แสดงยอดรวม</strong>
          เพราะยอดรวมของข้อมูลที่ไม่ครบจะทำให้เข้าใจผิด กรุณาเลือกปีงบประมาณ หรือช่วงวันที่ให้แคบลง
        </p>
      ) : null}

      {register.count === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">
          ไม่พบรายการตามเงื่อนไขที่เลือก
        </p>
      ) : (
        <>
          {result.truncated ? null : (
            <section
              aria-labelledby="summary-heading"
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <h2 id="summary-heading" className="text-lg font-semibold">
                สรุปทะเบียน
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                รวม {register.count.toLocaleString('th-TH')} รายการ เป็นเงิน{' '}
                <span className="font-mono font-semibold tabular-nums">
                  {formatSatang(register.grandTotalSatang)}
                </span>{' '}
                บาท — ยอดนี้รวมทุกสถานะ รวมรายการที่ยังไม่อนุมัติและที่ยกเลิกแล้ว
                จึงไม่ใช่ยอดที่โรงเรียนใช้จ่ายจริง (ดูยอดที่ใช้จริงได้ที่รายงานงบประมาณ)
              </p>

              <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {register.byStatus.map((group) => (
                  <li
                    key={group.status}
                    className="flex items-baseline justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm"
                  >
                    <span>
                      {STATUS_LABELS_TH[group.status]}{' '}
                      <span className="text-slate-500">({group.count})</span>
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatSatang(group.grandTotalSatang)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/*
            แถวที่มีข้อสังเกตถูกยกขึ้นมาไว้ก่อนตาราง ด้วยเหตุผลเดียวกับบัญชีงบ
            ที่ติดลบในรายงานงบ — ข้อผิดพลาดที่ต้องไล่หาเองในตารางยาว ๆ
            คือข้อผิดพลาดที่ไม่มีใครเห็น ซึ่งเป็นสาเหตุที่ F-14 และ F-15
            อยู่ในไฟล์จริงมาตลอดโดยไม่มีใครทัก
          */}
          {register.flagged.length > 0 ? (
            <section
              aria-labelledby="flagged-heading"
              className="rounded-lg border border-amber-300 bg-amber-50 p-5"
            >
              <h2 id="flagged-heading" className="text-lg font-semibold text-amber-900">
                รายการที่ออกเอกสารแล้วแต่ข้อมูลยังไม่ครบ ({register.flagged.length} รายการ)
              </h2>
              <p className="mt-1 text-sm text-amber-900">
                ตรวจเฉพาะรายการที่ออกใบสั่งซื้อไปแล้ว รายการที่ยังอยู่ระหว่างจัดทำ ไม่ถูกนับ
                เพราะยังไม่ถึงขั้นที่ต้องมีข้อมูลครบ ระบบไม่ได้ตัดสินว่าผิดระเบียบ —
                ผู้มีอำนาจของโรงเรียนเป็นผู้พิจารณา
              </p>
              <ul className="mt-3 space-y-1 text-sm">
                {register.flagged.map((entry) => (
                  <li
                    key={entry.row.procurementId}
                    className="flex flex-wrap items-baseline gap-x-2"
                  >
                    <Link
                      href={{ pathname: `/procurements/${entry.row.procurementId}` }}
                      className="font-mono text-xs text-amber-900 underline underline-offset-2"
                    >
                      {entry.row.reference}
                    </Link>
                    <span className="text-amber-900">{entry.row.subject}</span>
                    <span className="text-amber-800">
                      {entry.flags.map((flag) => REGISTER_FLAG_LABELS_TH[flag]).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <RegisterTable rows={register.rows} />
        </>
      )}

      {/*
        ซ่อนปุ่มส่งออกเมื่อข้อมูลถูกตัดด้วย — Route Handler ปฏิเสธคำขอส่งออก
        ในกรณีนี้อยู่แล้ว (ดูคอมเมนต์ที่ export/route.ts) ปุ่มที่กดแล้วได้ error
        เสมอไม่มีประโยชน์อะไร แค่ทำให้ผู้ใช้ต้องลองกดก่อนถึงจะรู้
      */}
      {user.permissions.has('reports.export') && !result.truncated ? (
        <ExportLinks
          groups={[
            {
              label: 'ทะเบียนจัดซื้อจัดจ้าง',
              links: [
                { label: 'XLSX', href: procurementRegisterExportHref(filter, 'xlsx') },
                { label: 'CSV', href: procurementRegisterExportHref(filter, 'csv') },
              ],
            },
          ]}
        />
      ) : null}
    </div>
  );
}
