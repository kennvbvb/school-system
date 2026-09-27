import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAnyPermissionForPage } from '@/server/auth/guard';
import { listInventoryItems, loadInventoryItemOptions } from '@/server/inventory/repository';
import { createInventoryItem } from '@/server/inventory/actions';
import { ItemForm } from '@/features/inventory/item-form';
import { ITEM_STATUS_LABELS_TH, formatQuantity } from '@/features/inventory/format';

export const metadata: Metadata = { title: 'รายการพัสดุ' };

/**
 * รายการพัสดุพร้อมยอดคงเหลือ
 *
 * ยอดทุกช่องมาจาก view `stock_item_balances` (แถวล่าสุดของ ledger) ไม่มีคอลัมน์
 * ยอดในตาราง — ยอดที่แก้ได้โดยไม่มีร่องรอยคือยอดที่ตรวจสอบไม่ได้ (เหตุผลเดียวกับ
 * budget ledger)
 *
 * ไม่มีเงื่อนไขกรองว่าใครเห็นรายการใด — RLS เป็นผู้ตัดสิน ผู้ที่ไม่มี
 * `inventory.read` จะไม่เห็นแถวใดเลยแม้จะเปิดหน้านี้ได้
 */
export default async function InventoryItemsPage() {
  const viewer = await requireAnyPermissionForPage(
    '/inventory/items',
    'inventory.read',
    'inventory.receive',
    'inventory.issue',
    'inventory.adjust',
  );

  const canManage = viewer.permissions.has('inventory.adjust');
  const [items, options] = await Promise.all([
    listInventoryItems(),
    canManage ? loadInventoryItemOptions() : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">รายการพัสดุ</h1>
        <p className="text-slate-600">
          ยอดคงเหลือคำนวณจากรายการเคลื่อนไหวทั้งหมด ไม่ได้เก็บเป็นตัวเลขที่แก้ทับได้
        </p>
      </header>

      {canManage && options ? (
        options.units.length === 0 ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-900">
            ยังไม่มีหน่วยนับที่เปิดใช้งาน จึงสร้างรายการพัสดุไม่ได้ —{' '}
            <Link href="/admin/master-data/units" className="underline">
              เพิ่มหน่วยนับก่อน
            </Link>
          </p>
        ) : (
          <section
            aria-labelledby="add-heading"
            className="rounded-lg border border-slate-200 bg-white p-5"
          >
            <h2 id="add-heading" className="mb-4 text-lg font-semibold">
              สร้างรายการพัสดุ
            </h2>
            <ItemForm
              categories={options.categories}
              units={options.units}
              locations={options.locations}
              action={createInventoryItem}
            />
          </section>
        )
      ) : null}

      <section aria-labelledby="list-heading" className="space-y-3">
        <h2 id="list-heading" className="text-lg font-semibold">
          พัสดุทั้งหมด
        </h2>

        {items.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">
            ยังไม่มีรายการพัสดุที่คุณเข้าถึงได้
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[56rem] text-sm">
              <caption className="sr-only">รายการพัสดุพร้อมยอดคงเหลือ</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    รหัส
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    ชื่อรายการ
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    หมวด
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    ที่จัดเก็บ
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    คงเหลือ
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    หน่วย
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    สถานะ
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link
                        href={{ pathname: `/inventory/items/${item.id}` }}
                        className="text-sky-800 underline underline-offset-2"
                      >
                        {item.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{item.nameTh}</td>
                    <td className="px-4 py-3 text-slate-600">{item.categoryName ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{item.locationName ?? '—'}</td>
                    <td
                      className={`px-4 py-3 text-right font-mono tabular-nums ${
                        item.belowMinimum ? 'font-semibold text-rose-700' : ''
                      }`}
                    >
                      {formatQuantity(item.onHand)}
                      {item.belowMinimum ? (
                        <span className="sr-only"> (ต่ำกว่าจุดสั่งซื้อซ้ำ)</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.unitLabel ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          item.status === 'ACTIVE'
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {ITEM_STATUS_LABELS_TH[item.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
