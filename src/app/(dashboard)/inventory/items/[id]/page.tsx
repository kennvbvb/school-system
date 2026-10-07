import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAnyPermissionForPage } from '@/server/auth/guard';
import {
  getInventoryItem,
  listStockMovements,
  loadActorOptions,
} from '@/server/inventory/repository';
import {
  adjustStock,
  issueStock,
  receiveStock,
  reverseStockMovement,
  setInventoryItemStatus,
} from '@/server/inventory/actions';
import { formatThaiDate, toBangkokDateString } from '@/lib/format/thai-date';
import { ReceiveForm } from '@/features/inventory/receive-form';
import { IssueForm } from '@/features/inventory/issue-form';
import { AdjustmentForm } from '@/features/inventory/adjustment-form';
import { ReasonActionButton } from '@/features/master-data/reason-action-button';
import {
  ITEM_STATUS_LABELS_TH,
  STOCK_MOVEMENT_TYPE_CLASSES,
  STOCK_MOVEMENT_TYPE_LABELS_TH,
  formatQuantity,
} from '@/features/inventory/format';

export const metadata: Metadata = { title: 'บัตรบัญชีพัสดุ' };

/**
 * บัตรบัญชีพัสดุ (stock card): ยอดคงเหลือ รายการเคลื่อนไหว และการลงรายการ
 *
 * ตอบ "ไม่พบ" เหมือนกันทั้งกรณีที่ไม่มีอยู่จริงและกรณีที่ไม่มีสิทธิ์เห็น
 * เพื่อไม่ให้ใช้หน้านี้สำรวจว่ารายการใดมีอยู่ในระบบ (แนวเดียวกับบัญชีงบ)
 */
export default async function InventoryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAnyPermissionForPage(
    `/inventory/items/${id}`,
    'inventory.read',
    'inventory.receive',
    'inventory.issue',
    'inventory.adjust',
  );

  const item = await getInventoryItem(id);
  if (!item) notFound();

  const canReceive = viewer.permissions.has('inventory.receive');
  const canIssue = viewer.permissions.has('inventory.issue');
  const canAdjust = viewer.permissions.has('inventory.adjust');

  const [movements, actors] = await Promise.all([
    listStockMovements(item.id),
    canIssue || canAdjust ? loadActorOptions() : Promise.resolve({ requesters: [], approvers: [] }),
  ]);

  const today = toBangkokDateString(new Date());
  const hasMovements = movements.length > 0;
  const isActive = item.status === 'ACTIVE';

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/inventory/items" className="text-sm text-sky-800 underline">
          ← รายการพัสดุ
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">{item.code}</h1>
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isActive ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-200 text-slate-700'
            }`}
          >
            {ITEM_STATUS_LABELS_TH[item.status]}
          </span>
        </div>
        <p className="text-slate-600">
          {item.nameTh} ·{' '}
          {[
            item.categoryName ? `หมวด: ${item.categoryName}` : null,
            item.locationName ? `จัดเก็บที่: ${item.locationName}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      <section aria-labelledby="balance-heading" className="space-y-3">
        <h2 id="balance-heading" className="text-lg font-semibold">
          ยอดคงเหลือ
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-sm text-slate-600">คงเหลือ</dt>
            <dd
              className={`mt-1 font-mono text-xl tabular-nums ${
                item.belowMinimum ? 'font-semibold text-rose-700' : ''
              }`}
            >
              {formatQuantity(item.onHand)} {item.unitLabel ?? ''}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-sm text-slate-600">จุดสั่งซื้อซ้ำ</dt>
            <dd className="mt-1 font-mono text-xl tabular-nums">
              {formatQuantity(item.minimumQuantity)} {item.unitLabel ?? ''}
            </dd>
          </div>
        </div>

        {item.belowMinimum ? (
          <p
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900"
          >
            ยอดคงเหลือต่ำกว่าจุดสั่งซื้อซ้ำ ควรพิจารณาจัดซื้อเพิ่ม
          </p>
        ) : null}
      </section>

      {isActive ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {canReceive ? (
            <section
              aria-labelledby="receive-heading"
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <h2 id="receive-heading" className="mb-4 text-lg font-semibold">
                รับเข้า / รับคืน / ยอดยกมา
              </h2>
              <ReceiveForm
                itemId={item.id}
                defaultDate={today}
                hasMovements={hasMovements}
                action={receiveStock}
              />
            </section>
          ) : null}

          {canIssue ? (
            <section
              aria-labelledby="issue-heading"
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <h2 id="issue-heading" className="mb-4 text-lg font-semibold">
                เบิกจ่าย
              </h2>
              <IssueForm
                itemId={item.id}
                defaultDate={today}
                requesters={actors.requesters}
                approvers={actors.approvers}
                action={issueStock}
              />
            </section>
          ) : null}

          {canAdjust ? (
            <section
              aria-labelledby="adjust-heading"
              className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-2"
            >
              <h2 id="adjust-heading" className="mb-4 text-lg font-semibold">
                ปรับยอด
              </h2>
              <AdjustmentForm
                itemId={item.id}
                defaultDate={today}
                approvers={actors.approvers}
                action={adjustStock}
              />
            </section>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="movements-heading" className="space-y-3">
        <h2 id="movements-heading" className="text-lg font-semibold">
          รายการเคลื่อนไหว (บัตรบัญชีพัสดุ)
        </h2>

        {movements.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">
            ยังไม่มีรายการเคลื่อนไหว — เริ่มด้วยการลงยอดยกมา หรือรับเข้าครั้งแรกได้เลย
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[60rem] text-sm">
              <caption className="sr-only">
                รายการเคลื่อนไหวของ {item.code} เรียงจากใหม่ไปเก่า
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
                    จำนวน
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    คงเหลือหลังรายการ
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    อ้างอิง / ผู้เกี่ยวข้อง
                  </th>
                  {canAdjust ? (
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
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STOCK_MOVEMENT_TYPE_CLASSES[movement.type]}`}
                      >
                        {STOCK_MOVEMENT_TYPE_LABELS_TH[movement.type]}
                      </span>
                      {movement.isReversed ? (
                        <span className="mt-1 block text-xs text-rose-700">ถูกย้อนแล้ว</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatQuantity(movement.quantity)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatQuantity(movement.balanceAfter)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {movement.reference}
                      {movement.reason ? (
                        <span className="mt-1 block text-xs">{movement.reason}</span>
                      ) : null}
                      {movement.requestedByName ? (
                        <span className="mt-1 block text-xs">
                          ผู้เบิก: {movement.requestedByName}
                        </span>
                      ) : null}
                      {movement.approvedByName ? (
                        <span className="mt-1 block text-xs">
                          ผู้อนุมัติ: {movement.approvedByName}
                        </span>
                      ) : null}
                    </td>
                    {canAdjust ? (
                      <td className="px-4 py-3">
                        {/*
                          ย้อนได้เฉพาะแถวที่ยังไม่ถูกย้อน และไม่ใช่แถวย้อนเอง
                          ฐานข้อมูลปฏิเสธทั้งสองกรณีอยู่แล้ว (migration 0022)
                          การซ่อนปุ่มเป็นเรื่องความชัดเจน ไม่ใช่การควบคุม
                        */}
                        {movement.type !== 'REVERSAL' && !movement.isReversed ? (
                          <ReasonActionButton
                            label="ย้อนรายการ"
                            title="ย้อนรายการนี้"
                            confirmLabel="ยืนยันการย้อน"
                            reasonLabel="เหตุผลการย้อนรายการ"
                            variant="danger"
                            action={async (reason) => {
                              'use server';
                              return reverseStockMovement({
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

      {canAdjust ? (
        <section aria-labelledby="status-heading" className="space-y-3">
          <h2 id="status-heading" className="text-lg font-semibold">
            สถานะรายการพัสดุ
          </h2>
          <p className="text-sm text-slate-600">
            {isActive
              ? 'รายการที่ปิดใช้งานแล้วลงรายการเคลื่อนไหวเพิ่มไม่ได้'
              : 'รายการนี้ปิดใช้งานอยู่ เปิดใช้งานอีกครั้งได้จากปุ่มด้านล่าง'}
          </p>
          <ReasonActionButton
            label={isActive ? 'ปิดใช้งานรายการพัสดุ' : 'เปิดใช้งานรายการพัสดุ'}
            title={`${isActive ? 'ปิด' : 'เปิด'}ใช้งาน ${item.code}`}
            confirmLabel="ยืนยัน"
            reasonLabel="เหตุผล (สำหรับ audit log)"
            variant={isActive ? 'danger' : 'primary'}
            action={async (reason) => {
              'use server';
              return setInventoryItemStatus({
                itemId: item.id,
                status: isActive ? 'INACTIVE' : 'ACTIVE',
                reason,
              });
            }}
          />
        </section>
      ) : null}
    </div>
  );
}
