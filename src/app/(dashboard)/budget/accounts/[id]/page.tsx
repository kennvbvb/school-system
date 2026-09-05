import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAnyPermissionForPage } from '@/server/auth/guard';
import {
  getBudgetAccount,
  listBudgetAccounts,
  listBudgetMovements,
} from '@/server/budget/repository';
import {
  closeBudgetAccount,
  postBudgetMovement,
  reverseBudgetMovement,
  transferBudget,
} from '@/server/budget/actions';
import { formatThaiDate, toBangkokDateString } from '@/lib/format/thai-date';
import { MovementForm } from '@/features/budget/movement-form';
import { TransferForm } from '@/features/budget/transfer-form';
import { ReasonActionButton } from '@/features/master-data/reason-action-button';
import {
  ACCOUNT_STATUS_LABELS_TH,
  MOVEMENT_TYPE_CLASSES,
  MOVEMENT_TYPE_LABELS_TH,
  formatBaht,
} from '@/features/budget/format';

export const metadata: Metadata = { title: 'รายละเอียดบัญชีงบ' };

/**
 * รายละเอียดบัญชีงบ: ยอดคงเหลือ รายการเคลื่อนไหว และการลงรายการ
 *
 * ตอบ "ไม่พบ" เหมือนกันทั้งกรณีที่ไม่มีอยู่จริงและกรณีที่ไม่มีสิทธิ์เห็น
 * เพื่อไม่ให้ใช้หน้านี้สำรวจว่าบัญชีใดมีอยู่ในระบบ (แนวเดียวกับหน้ารายการจัดซื้อ)
 */
export default async function BudgetAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAnyPermissionForPage(
    `/budget/accounts/${id}`,
    'budget.read',
    'budget.manage',
  );

  const account = await getBudgetAccount(id);
  if (!account) notFound();

  const canManage = viewer.permissions.has('budget.manage');
  const [movements, allAccounts] = await Promise.all([
    listBudgetMovements(account.id),
    canManage ? listBudgetAccounts() : Promise.resolve([]),
  ]);

  const today = toBangkokDateString(new Date());
  const isNegative = account.balance.available.startsWith('-');

  const transferTargets = allAccounts
    .filter((row) => row.status === 'OPEN' && row.fiscalYearId === account.fiscalYearId)
    .map((row) => ({ id: row.id, label: `${row.code} — ${row.projectName ?? 'ไม่ระบุโครงการ'}` }));

  const balanceRows = [
    { label: 'งบที่ได้รับสุทธิ', value: account.balance.granted },
    { label: 'กันไว้ (ยังไม่จ่าย)', value: account.balance.reserved },
    { label: 'ผูกพันและจ่ายจริง', value: account.balance.used },
    { label: 'คงเหลือที่ใช้ได้', value: account.balance.available },
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/budget/accounts" className="text-sm text-sky-800 underline">
          ← บัญชีงบประมาณ
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">{account.code}</h1>
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
              account.status === 'OPEN'
                ? 'bg-emerald-100 text-emerald-900'
                : 'bg-slate-200 text-slate-700'
            }`}
          >
            {ACCOUNT_STATUS_LABELS_TH[account.status]}
          </span>
        </div>
        <p className="text-slate-600">
          {[
            account.projectName ? `โครงการ: ${account.projectName}` : null,
            account.fundingSourceName ? `แหล่งเงิน: ${account.fundingSourceName}` : null,
            account.departmentName ? `หน่วยงาน: ${account.departmentName}` : null,
            account.fiscalYearCode ? `ปีงบ: ${account.fiscalYearCode}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      <section aria-labelledby="balance-heading" className="space-y-3">
        <h2 id="balance-heading" className="text-lg font-semibold">
          ยอดคงเหลือ
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {balanceRows.map((row, index) => (
            <div key={row.label} className="rounded-lg border border-slate-200 bg-white p-4">
              <dt className="text-sm text-slate-600">{row.label}</dt>
              <dd
                className={`mt-1 font-mono text-xl tabular-nums ${
                  index === balanceRows.length - 1 && isNegative
                    ? 'font-semibold text-rose-700'
                    : ''
                }`}
              >
                {formatBaht(row.value)}
              </dd>
            </div>
          ))}
        </dl>

        {isNegative ? (
          <p
            role="alert"
            className="rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900"
          >
            บัญชีนี้มียอดคงเหลือติดลบ — ต้องมีเอกสารโอนงบหรือขออนุมัติเพิ่มงบรองรับ (ข้อค้นพบ F-01
            และ F-02)
          </p>
        ) : null}
      </section>

      {canManage && account.status === 'OPEN' ? (
        <>
          <section
            aria-labelledby="post-heading"
            className="rounded-lg border border-slate-200 bg-white p-5"
          >
            <h2 id="post-heading" className="mb-4 text-lg font-semibold">
              ลงรายการงบ
            </h2>
            <MovementForm accountId={account.id} defaultDate={today} action={postBudgetMovement} />
          </section>

          {transferTargets.length > 1 ? (
            <section
              aria-labelledby="transfer-heading"
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <h2 id="transfer-heading" className="mb-4 text-lg font-semibold">
                โอนงบไปบัญชีอื่น
              </h2>
              <TransferForm
                accounts={transferTargets}
                currentAccountId={account.id}
                defaultDate={today}
                action={transferBudget}
              />
            </section>
          ) : (
            <p className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
              ยังไม่มีบัญชีงบอื่นในปีงบประมาณเดียวกัน จึงยังโอนงบไม่ได้
            </p>
          )}
        </>
      ) : null}

      <section aria-labelledby="movements-heading" className="space-y-3">
        <h2 id="movements-heading" className="text-lg font-semibold">
          รายการเคลื่อนไหว
        </h2>

        {movements.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">
            ยังไม่มีรายการเคลื่อนไหว — เริ่มด้วยการจัดสรรงบตั้งต้น
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[52rem] text-sm">
              <caption className="sr-only">
                รายการเคลื่อนไหวของบัญชีงบ {account.code} เรียงจากใหม่ไปเก่า
              </caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    วันที่มีผล
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    ประเภท
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    จำนวน (บาท)
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    เหตุผล / อ้างอิง
                  </th>
                  {canManage ? (
                    <th scope="col" className="px-4 py-3 font-medium">
                      การจัดการ
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr
                    key={movement.id}
                    className="border-b border-slate-100 align-top last:border-0"
                  >
                    <td className="px-4 py-3 text-slate-600">
                      {formatThaiDate(new Date(`${movement.effectiveDate}T00:00:00Z`))}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${MOVEMENT_TYPE_CLASSES[movement.type]}`}
                      >
                        {MOVEMENT_TYPE_LABELS_TH[movement.type]}
                      </span>
                      {movement.isReversed ? (
                        <span className="mt-1 block text-xs text-rose-700">ถูกย้อนแล้ว</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatBaht(movement.amount)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {movement.reason ?? '—'}
                      {movement.approvalReference ? (
                        <span className="mt-1 block text-xs">
                          หนังสือ: {movement.approvalReference}
                        </span>
                      ) : null}
                    </td>
                    {canManage ? (
                      <td className="px-4 py-3">
                        {/*
                          ย้อนได้เฉพาะแถวที่ยังไม่ถูกย้อน และไม่ใช่แถวย้อนเอง
                          ฐานข้อมูลปฏิเสธทั้งสองกรณีอยู่แล้ว (migration 0005 และ 0009)
                          การซ่อนปุ่มเป็นเรื่องความชัดเจน ไม่ใช่การควบคุม
                        */}
                        {movement.type !== 'REVERSAL' &&
                        !movement.isReversed &&
                        account.status === 'OPEN' ? (
                          <ReasonActionButton
                            label="ย้อนรายการ"
                            title="ย้อนรายการนี้"
                            confirmLabel="ยืนยันการย้อน"
                            reasonLabel="เหตุผลการย้อนรายการ"
                            variant="danger"
                            action={async (reason) => {
                              'use server';
                              /*
                               * ใช้วันที่มีผลของรายการเดิม ไม่ใช่วันนี้
                               *
                               * การย้อนเป็นการแก้รายการของงวดนั้น จึงต้องอยู่ในงวดเดียวกัน
                               * และวันนี้อาจอยู่นอกช่วงปีงบประมาณของบัญชี ซึ่งจะถูกปฏิเสธ
                               */
                              return reverseBudgetMovement({
                                movementId: movement.id,
                                effectiveDate: movement.effectiveDate,
                                reason,
                              });
                            }}
                          />
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage && account.status === 'OPEN' ? (
        <section aria-labelledby="close-heading" className="space-y-3">
          <h2 id="close-heading" className="text-lg font-semibold">
            ปิดบัญชีงบ
          </h2>
          <p className="text-sm text-slate-600">
            บัญชีที่ปิดแล้วลงรายการเพิ่มไม่ได้ และเปิดกลับจากหน้านี้ไม่ได้
            ถ้าต้องใช้งบเพิ่มให้โอนงบเข้าบัญชีอื่นแทน
          </p>
          <ReasonActionButton
            label="ปิดบัญชีงบ"
            title={`ปิดบัญชีงบ ${account.code}`}
            confirmLabel="ยืนยันการปิดบัญชี"
            reasonLabel="เหตุผลการปิดบัญชี"
            variant="danger"
            action={async (reason) => {
              'use server';
              return closeBudgetAccount({ accountId: account.id, reason });
            }}
          />
        </section>
      ) : null}
    </div>
  );
}
