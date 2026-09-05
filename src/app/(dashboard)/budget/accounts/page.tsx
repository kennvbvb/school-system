import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAnyPermissionForPage } from '@/server/auth/guard';
import { listBudgetAccounts, loadBudgetAccountOptions } from '@/server/budget/repository';
import { createBudgetAccount } from '@/server/budget/actions';
import { BudgetAccountForm } from '@/features/budget/budget-account-form';
import { ACCOUNT_STATUS_LABELS_TH, formatBaht } from '@/features/budget/format';

export const metadata: Metadata = { title: 'บัญชีงบประมาณ' };

/**
 * รายการบัญชีงบพร้อมยอดคงเหลือ
 *
 * ยอดทุกช่องมาจาก view `budget_account_balances` ไม่มีคอลัมน์ยอดในตาราง
 * และไม่มีการคำนวณซ้ำที่นี่ — ยอดที่แก้ได้โดยไม่มีร่องรอยคือยอดที่ตรวจสอบไม่ได้
 *
 * ไม่มีเงื่อนไขกรองว่าใครเห็นบัญชีใด — RLS เป็นผู้ตัดสิน ผู้ที่ไม่มี `budget.read`
 * จะไม่เห็นแถวใดเลยแม้จะเปิดหน้านี้ได้
 */
export default async function BudgetAccountsPage() {
  const viewer = await requireAnyPermissionForPage(
    '/budget/accounts',
    'budget.read',
    'budget.manage',
  );

  const canManage = viewer.permissions.has('budget.manage');
  const [accounts, options] = await Promise.all([
    listBudgetAccounts(),
    canManage ? loadBudgetAccountOptions() : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">บัญชีงบประมาณ</h1>
        <p className="text-slate-600">
          ยอดคงเหลือคำนวณจากรายการเคลื่อนไหวทั้งหมด ไม่ได้เก็บเป็นตัวเลขที่แก้ทับได้
        </p>
      </header>

      {canManage && options ? (
        options.fiscalYears.length === 0 ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-900">
            ยังไม่มีปีงบประมาณที่เปิดอยู่ จึงสร้างบัญชีงบไม่ได้ —{' '}
            <Link href="/admin/master-data/fiscal-years" className="underline">
              เพิ่มปีงบประมาณก่อน
            </Link>
          </p>
        ) : (
          <section
            aria-labelledby="add-heading"
            className="rounded-lg border border-slate-200 bg-white p-5"
          >
            <h2 id="add-heading" className="mb-4 text-lg font-semibold">
              สร้างบัญชีงบ
            </h2>
            <BudgetAccountForm options={options} action={createBudgetAccount} />
          </section>
        )
      ) : null}

      <section aria-labelledby="list-heading" className="space-y-3">
        <h2 id="list-heading" className="text-lg font-semibold">
          บัญชีงบทั้งหมด
        </h2>

        {accounts.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">
            ยังไม่มีบัญชีงบที่คุณเข้าถึงได้
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[58rem] text-sm">
              <caption className="sr-only">บัญชีงบพร้อมยอดคงเหลือ</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    รหัสบัญชี
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    ผูกกับ
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    ปีงบ
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    งบที่ได้รับ
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    กันไว้
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    ใช้ไปแล้ว
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    ใช้ได้
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    สถานะ
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => {
                  const scope =
                    account.projectName ??
                    account.fundingSourceName ??
                    account.departmentName ??
                    '—';
                  const isNegative = account.balance.available.startsWith('-');

                  return (
                    <tr key={account.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 font-mono text-xs">
                        <Link
                          href={{ pathname: `/budget/accounts/${account.id}` }}
                          className="text-sky-800 underline underline-offset-2"
                        >
                          {account.code}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{scope}</td>
                      <td className="px-4 py-3 text-slate-600">{account.fiscalYearCode ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatBaht(account.balance.granted)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatBaht(account.balance.reserved)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatBaht(account.balance.used)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${
                          isNegative ? 'text-rose-700' : ''
                        }`}
                      >
                        {formatBaht(account.balance.available)}
                        {isNegative ? <span className="sr-only"> (ติดลบ)</span> : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            account.status === 'OPEN'
                              ? 'bg-emerald-100 text-emerald-900'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {ACCOUNT_STATUS_LABELS_TH[account.status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
