import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAnyPermissionForPage } from '@/server/auth/guard';
import { checkProcurementRules, getProcurement } from '@/server/procurement/repository';
import { submitProcurement } from '@/server/procurement/actions';
import { ValidationSummary } from '@/features/procurements/validation-summary';
import { ProcurementSubmitButton } from '@/features/procurements/submit-button';
import { isEditable } from '@/domain/procurement/draft';
import { isOverridableRule, isRuleCode } from '@/domain/validation/rules';
import { TAX_MODE_LABELS_TH } from '@/domain/procurement/schemas';
import { formatThaiDate } from '@/lib/format/thai-date';
import { satangToThaiBahtText } from '@/domain/money/thai-baht-text';
import { decimalStringToSatang } from '@/domain/money/money';
import { STATUS_CLASSES, STATUS_LABELS_TH, formatBaht } from '@/features/procurements/format';

export const metadata: Metadata = { title: 'รายละเอียดรายการจัดซื้อจัดจ้าง' };

export default async function ProcurementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireAnyPermissionForPage(
    `/procurements/${id}`,
    'procurement.read.own',
    'procurement.read.all',
  );

  const procurement = await getProcurement(id);

  /*
   * ไม่พบ กับ ไม่มีสิทธิ์เห็น ตอบเหมือนกันโดยเจตนา
   * ถ้าตอบต่างกัน ผู้ที่ไม่มีสิทธิ์จะใช้หน้านี้สำรวจได้ว่ารายการใดมีอยู่จริง
   */
  if (!procurement) notFound();

  const canEdit =
    isEditable(procurement.status) &&
    viewer.permissions.has('procurement.edit_draft') &&
    (viewer.permissions.has('procurement.read.all') || procurement.createdBy === viewer.id);

  /*
   * ตรวจกฎเฉพาะสถานะที่ยังส่งอนุมัติได้
   *
   * รายการที่ผ่านขั้นนี้ไปแล้วถูกตรวจไปแล้ว ณ ตอนส่ง และผลถูกบันทึกไว้ใน
   * procurement_validations การตรวจใหม่ตอนนี้จะได้ผลตามข้อมูลปัจจุบัน
   * ซึ่งไม่ใช่สิ่งที่ผู้อนุมัติเห็นตอนนั้น จึงไม่แสดงเพื่อไม่ให้เข้าใจผิด
   */
  const canSubmit =
    isEditable(procurement.status) &&
    viewer.permissions.has('procurement.submit') &&
    (viewer.permissions.has('procurement.read.all') || procurement.createdBy === viewer.id);

  const findings = canSubmit ? await checkProcurementRules(procurement.id) : [];
  const canOverride = viewer.permissions.has('procurement.override_validation');
  const errorFindings = findings.filter((finding) => finding.severity === 'ERROR');
  /*
   * ใช้ isOverridableRule จากชั้นโดเมน ไม่เขียนรายการซ้ำที่นี่
   *
   * รายการกฎที่ยกเว้นได้มีอยู่แล้วสองที่คือโดเมนและ SQL ซึ่งจำเป็นเพราะคนละชั้น
   * การเพิ่มที่สามในหน้าจอจะทำให้มีจุดที่ลืมแก้ตอนเพิ่มกฎใหม่
   *
   * รหัสที่ฐานข้อมูลส่งมาเป็น text จึงต้องผ่าน isRuleCode ก่อน — รหัสที่ระบบ
   * ไม่รู้จักถือว่ายกเว้นไม่ได้ ซึ่งเป็นค่าเริ่มต้นที่ปลอดภัยกว่า
   */
  const isOverridable = (code: string) => isRuleCode(code) && isOverridableRule(code);
  const hasOverridableErrors = errorFindings.some((finding) => isOverridable(finding.ruleCode));
  const hasBlockingErrors = errorFindings.some(
    (finding) => !canOverride || !isOverridable(finding.ruleCode),
  );

  const grandTotalSatang = decimalStringToSatang(procurement.totals.grandTotal);
  const fundingSatang = decimalStringToSatang(procurement.totals.fundingTotal);
  const fundingMatches = grandTotalSatang === fundingSatang;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-mono text-sm text-slate-500">{procurement.reference}</p>
          <h1 className="text-2xl font-semibold">{procurement.subject}</h1>
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[procurement.status]}`}
          >
            {STATUS_LABELS_TH[procurement.status]}
          </span>
        </div>

        <div className="flex gap-2">
          <Link
            href="/procurements"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            กลับไปรายการ
          </Link>
          {canEdit ? (
            <Link
              href={{ pathname: `/procurements/${procurement.id}/edit` }}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              แก้ไข
            </Link>
          ) : null}
        </div>
      </header>

      {canSubmit ? (
        <section aria-labelledby="validation-heading" className="space-y-4">
          <h2 id="validation-heading" className="text-lg font-semibold">
            ผลตรวจก่อนส่งอนุมัติ
          </h2>

          <ValidationSummary findings={findings} procurementId={procurement.id} canEdit={canEdit} />

          <ProcurementSubmitButton
            procurementId={procurement.id}
            version={procurement.version}
            hasBlockingErrors={hasBlockingErrors}
            hasOverridableErrors={hasOverridableErrors}
            canOverride={canOverride}
            action={submitProcurement}
          />
        </section>
      ) : null}

      {procurement.exceptionReason ? (
        <section
          aria-labelledby="exception-heading"
          className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-900"
        >
          <h2 id="exception-heading" className="mb-2 font-semibold">
            รายการนี้ส่งอนุมัติโดยใช้ข้อยกเว้น
          </h2>
          <p>{procurement.exceptionReason}</p>
        </section>
      ) : null}

      <section
        aria-labelledby="general-heading"
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <h2 id="general-heading" className="mb-3 font-semibold">
          ข้อมูลทั่วไป
        </h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-slate-500">ผู้ขาย</dt>
            <dd>{procurement.vendorName ?? 'ยังไม่ระบุ'}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">วิธีคิดภาษี</dt>
            <dd>{TAX_MODE_LABELS_TH[procurement.taxMode]}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">วันที่ขอ</dt>
            <dd>{formatThaiDate(new Date(`${procurement.requestDate}T00:00:00Z`))}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">ต้องการใช้ภายใน</dt>
            <dd>
              {procurement.requiredDate
                ? formatThaiDate(new Date(`${procurement.requiredDate}T00:00:00Z`))
                : 'ยังไม่ระบุ'}
            </dd>
          </div>
          {procurement.purpose ? (
            <div className="sm:col-span-2">
              <dt className="text-sm text-slate-500">เหตุผลและความจำเป็น</dt>
              <dd className="whitespace-pre-line">{procurement.purpose}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="items-heading" className="space-y-3">
        <h2 id="items-heading" className="text-lg font-semibold">
          รายการพัสดุ
        </h2>

        {procurement.items.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-700">
            ยังไม่มีรายการพัสดุ
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">รายการพัสดุของรายการจัดซื้อนี้</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    บรรทัด
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    รายละเอียด
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    จำนวน
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    ราคาต่อหน่วย
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    ส่วนลด
                  </th>
                </tr>
              </thead>
              <tbody>
                {procurement.items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 text-slate-500">{item.lineNo}</td>
                    <td className="px-4 py-3">{item.description}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{item.quantity}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {item.unitPrice}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {item.discountAmount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <dl className="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <div className="flex justify-between py-1">
            <dt>ยอดก่อนหักส่วนลด</dt>
            <dd className="font-mono tabular-nums">{formatBaht(procurement.totals.subtotal)}</dd>
          </div>
          <div className="flex justify-between py-1">
            <dt>ส่วนลดรวม</dt>
            <dd className="font-mono tabular-nums">
              {formatBaht(procurement.totals.discountTotal)}
            </dd>
          </div>
          <div className="flex justify-between py-1">
            <dt>ภาษีรวม</dt>
            <dd className="font-mono tabular-nums">{formatBaht(procurement.totals.taxTotal)}</dd>
          </div>
          <div className="mt-2 flex justify-between border-t border-slate-300 pt-2 font-semibold">
            <dt>ยอดรวมทั้งสิ้น</dt>
            <dd className="font-mono tabular-nums">{formatBaht(procurement.totals.grandTotal)}</dd>
          </div>
          <div className="pt-1 text-right text-sm text-slate-600">
            ({satangToThaiBahtText(grandTotalSatang)})
          </div>
        </dl>
      </section>

      <section aria-labelledby="funding-heading" className="space-y-3">
        <h2 id="funding-heading" className="text-lg font-semibold">
          แหล่งเงิน
        </h2>

        {procurement.fundingAllocations.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-700">
            ยังไม่ได้ระบุแหล่งเงิน
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {procurement.fundingAllocations.map((row) => (
              <li key={row.id} className="flex justify-between px-4 py-3">
                <span className="font-mono text-sm">{row.budgetAccountId.slice(0, 8)}…</span>
                <span className="font-mono tabular-nums">{formatBaht(row.amount)}</span>
              </li>
            ))}
          </ul>
        )}

        {/* เตือนตั้งแต่ขั้นร่าง เพื่อให้แก้ก่อนถึงขั้นที่ระบบปฏิเสธการส่งอนุมัติ */}
        {!fundingMatches ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
            <span aria-hidden="true">⚠ </span>
            ยอดแหล่งเงินรวม {formatBaht(procurement.totals.fundingTotal)} บาท
            ยังไม่เท่ากับยอดรวมของรายการ {formatBaht(procurement.totals.grandTotal)} บาท —
            ต้องแก้ให้ตรงกันก่อนส่งอนุมัติ
          </p>
        ) : null}
      </section>
    </div>
  );
}
