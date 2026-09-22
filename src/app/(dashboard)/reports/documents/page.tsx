import type { Metadata } from 'next';
import { requireAnyPermissionForPage } from '@/server/auth/guard';
import {
  DOCUMENT_EXCEPTION_LIMIT,
  loadDocumentExceptions,
  loadDocumentSequenceRows,
  loadFiscalYearOptions,
} from '@/server/reports/repository';
import { parseDocumentStatusFilter } from '@/domain/documents/sequence-report-schemas';
import {
  buildDocumentStatusReport,
  SEQUENCE_FLAG_LABELS_TH,
} from '@/domain/documents/sequence-report';
import { DocumentStatusFilters } from '@/features/reports/document-status-filters';
import { DocumentSequenceTable } from '@/features/reports/document-sequence-table';
import { DocumentExceptionList } from '@/features/reports/document-exception-list';
import { DOCUMENT_KIND_LABELS_TH } from '@/features/documents/format';

export const metadata: Metadata = { title: 'รายงานสถานะเอกสาร' };

/**
 * รายงานสถานะเอกสาร (PR-09)
 *
 * ปิดข้อค้นพบสองข้อที่ทะเบียนจัดซื้อจัดจ้างตั้งใจไม่ทำ เพราะเป็นเรื่องของ
 * **ทะเบียนเลขที่เอกสาร** ไม่ใช่ของทะเบียนรายการ:
 *
 *   F-12  ลำดับซ้ำ — ลำดับ 139 ปรากฏ 2 แถวในไฟล์จริง
 *   F-13  เลขกระโดด — `๑๓/๒๕๖๙` แล้วต่อด้วย `๙๑/๒๕๖๙`, `๙๒/๒๕๖๙`
 *
 * **อ่านอย่างเดียว และไม่มีปุ่มแก้เลขอัตโนมัติ** ตามกลไกที่ระบุไว้สำหรับ F-13 คือ
 * "ห้ามแก้อัตโนมัติโดยเดา" — เลขที่ถูกต้องคือเลขที่โรงเรียนใช้จริงในเอกสารกระดาษ
 * ระบบไม่มีทางรู้ว่าเลขที่ขาดคือเลขที่ยังไม่ได้ออก หรือเลขที่ออกแล้วแต่ยังไม่บันทึก
 */
export default async function DocumentStatusPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAnyPermissionForPage(
    '/reports/documents',
    'documents.issue',
    'procurement.read.all',
  );

  const filter = parseDocumentStatusFilter(await searchParams);
  const [sequenceRows, exceptions, fiscalYears] = await Promise.all([
    loadDocumentSequenceRows(filter),
    loadDocumentExceptions(filter),
    loadFiscalYearOptions(),
  ]);

  const report = buildDocumentStatusReport(sequenceRows);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">รายงานสถานะเอกสาร</h1>
        <p className="text-slate-600">
          ลำดับเลขที่เอกสารแยกตามปีงบประมาณและชนิดเอกสาร
          ซึ่งเป็นขอบเขตเดียวกับที่ระบบใช้กันเลขซ้ำอยู่จริง
        </p>
      </header>

      {/*
        คำเตือนที่ต้องอยู่เหนือตัวเลขเสมอ

        เลขลำดับเป็นค่าที่ระบบ "เดา" จากข้อความของเลขที่เอกสาร ไม่ใช่ข้อเท็จจริง
        ที่โรงเรียนกรอกเข้ามา ถ้าผู้อ่านไม่รู้ข้อนี้ เขาจะเชื่อว่าช่องว่างที่เห็น
        คือเลขที่หายไปจริง ทั้งที่อาจเป็นเพียงรูปแบบเลขที่ระบบแกะไม่ตรง
      */}
      <p className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
        <strong>ตัวเลขในหน้านี้เป็นข้อสังเกต ไม่ใช่ข้อสรุป</strong> — ระบบแยก &ldquo;เลขลำดับ&rdquo;
        ออกจากข้อความของเลขที่เอกสารด้วยการเดา เลขที่ขาดช่วงจึงอาจเกิดจากรูปแบบเลขที่ระบบแกะไม่ตรง
        หรือจากเลขที่โรงเรียนยังไม่ได้บันทึกเข้าระบบ ไม่ได้แปลว่าเอกสารหายไปจริง
        ระบบไม่มีปุ่มแก้เลขให้อัตโนมัติโดยเจตนา
        เพราะเลขที่ถูกต้องคือเลขที่อยู่ในเอกสารจริงของโรงเรียน
      </p>

      <DocumentStatusFilters filter={filter} fiscalYears={fiscalYears} />

      {report.rows.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">
          ยังไม่มีการบันทึกเลขที่เอกสารตามเงื่อนไขที่เลือก
          ทะเบียนนี้จะเริ่มมีข้อมูลเมื่อมีการบันทึกเลขที่เอกสารของรายการจัดซื้อจัดจ้าง
        </p>
      ) : (
        <>
          <section
            aria-labelledby="summary-heading"
            className="rounded-lg border border-slate-200 bg-white p-5"
          >
            <h2 id="summary-heading" className="text-lg font-semibold">
              สรุป
            </h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { label: 'ลำดับที่ติดตาม', value: report.totals.sequenceCount },
                { label: 'ออกเลขแล้ว', value: report.totals.issuedCount },
                { label: 'ยกเลิกเลขแล้ว', value: report.totals.voidedCount },
                { label: 'รอออกเลข', value: report.totals.pendingCount },
                { label: 'ไม่ต้องมีเลข', value: report.totals.notRequiredCount },
                { label: 'เลขที่ขาดรวม', value: report.totals.missingCount },
              ].map((item) => (
                <li
                  key={item.label}
                  className="flex items-baseline justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm"
                >
                  <span>{item.label}</span>
                  <span className="font-semibold tabular-nums">
                    {item.value.toLocaleString('th-TH')}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/*
            ลำดับที่มีข้อสังเกตถูกยกขึ้นมาก่อนตาราง ด้วยเหตุผลเดียวกับบัญชีงบที่ติดลบ
            ในรายงานงบ — ข้อผิดพลาดที่ต้องไล่หาเองในตารางคือข้อผิดพลาดที่ไม่มีใครเห็น
            ซึ่งเป็นสาเหตุที่ F-12 และ F-13 อยู่ในไฟล์จริงมาตลอดโดยไม่มีใครทัก
          */}
          {report.flagged.length > 0 ? (
            <section
              aria-labelledby="flagged-heading"
              className="rounded-lg border border-amber-300 bg-amber-50 p-5"
            >
              <h2 id="flagged-heading" className="text-lg font-semibold text-amber-900">
                ลำดับที่มีข้อสังเกต ({report.flagged.length} ลำดับ)
              </h2>
              <ul className="mt-3 space-y-1 text-sm">
                {report.flagged.map((entry) => (
                  <li
                    key={`${entry.row.fiscalYearId}-${entry.row.documentKind}`}
                    className="flex flex-wrap items-baseline gap-x-2"
                  >
                    <span className="text-amber-900">
                      {entry.row.fiscalYearCode ?? '—'} ·{' '}
                      {DOCUMENT_KIND_LABELS_TH[entry.row.documentKind]}
                    </span>
                    <span className="text-amber-800">
                      {entry.flags.map((flag) => SEQUENCE_FLAG_LABELS_TH[flag]).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="sequence-heading" className="space-y-3">
            <h2 id="sequence-heading" className="text-lg font-semibold">
              ลำดับเลขที่เอกสาร
            </h2>
            <DocumentSequenceTable rows={report.rows} />
          </section>
        </>
      )}

      <section aria-labelledby="exceptions-heading" className="space-y-3">
        <h2 id="exceptions-heading" className="text-lg font-semibold">
          เอกสารที่ไม่ได้อยู่ในสถานะออกเลขแล้ว ({exceptions.rows.length.toLocaleString('th-TH')}
          {exceptions.truncated ? '+' : ''} ฉบับ)
        </h2>
        <p className="text-sm text-slate-600">
          ทั้งสามสถานะต้องมีเหตุผลกำกับเสมอ หน้านี้จึงเป็นที่เดียวที่อ่านเหตุผลทั้งหมดต่อกันได้
          รายการนี้ไม่รวมเอกสารของรายการที่ถูกลบแล้ว
          แต่การวิเคราะห์ลำดับด้านบนยังนับเลขของรายการเหล่านั้น เพราะเลขที่ถูกใช้ไปแล้ว
          นำกลับมาใช้ไม่ได้
        </p>

        {exceptions.truncated ? (
          <p
            role="status"
            className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
          >
            มีเอกสารเกิน {DOCUMENT_EXCEPTION_LIMIT.toLocaleString('th-TH')} ฉบับ
            หน้านี้จึงแสดงเฉพาะที่เก่าที่สุดก่อน กรุณาเลือกปีงบประมาณหรือชนิดเอกสารให้แคบลง —
            ตัวเลขสรุปด้านบนไม่ได้นับจากรายการนี้ จึงยังถูกต้องครบถ้วน
          </p>
        ) : null}

        {exceptions.rows.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">
            ไม่มีเอกสารที่ค้างอยู่ตามเงื่อนไขที่เลือก
          </p>
        ) : (
          <DocumentExceptionList rows={exceptions.rows} />
        )}
      </section>

      {/*
        ยังไม่ตรวจว่า "รายการนี้ต้องมีเอกสารชนิดใดบ้าง"

        เอกสารที่ต้องใช้ขึ้นกับทั้งประเภทงานและวิธีจัดหา และแผนต่อเนื่องเตือนไว้ว่า
        "อย่าบังคับทุก classification ให้ใช้ document pack เดียวกัน" ระบบยังไม่มี
        ตารางที่บอกว่าชุดเอกสารของแต่ละกรณีคืออะไร การเดาเอาเองจะกลายเป็นการทวง
        เอกสารที่ระเบียบไม่ได้บังคับ — คำถาม Q35
      */}
    </div>
  );
}
