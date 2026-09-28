import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase/server-client';
import type { StockMovementType } from '@/domain/inventory/movement';

/**
 * การอ่านข้อมูลคลังพัสดุ
 *
 * ยอดคงเหลืออ่านจาก view `stock_item_balances` เสมอ (แถวล่าสุดของ ledger)
 * ไม่คำนวณซ้ำที่นี่ — เหตุผลเดียวกับ budget: ยอดที่แก้ได้โดยไม่มีร่องรอย
 * คือยอดที่ตรวจสอบไม่ได้ (ดู migration 0021)
 *
 * รายการพัสดุและรายการเคลื่อนไหวอ่านได้เฉพาะผู้ถือ `inventory.read`
 * ซึ่งบังคับด้วย RLS ไม่ใช่เงื่อนไขที่นี่
 */

export interface InventoryItemSummary {
  id: string;
  code: string;
  nameTh: string;
  status: 'ACTIVE' | 'INACTIVE';
  categoryName: string | null;
  unitLabel: string | null;
  locationName: string | null;
  minimumQuantity: string;
  note: string | null;
  onHand: string;
  /** true = ยอดคงเหลือต่ำกว่าจุดสั่งซื้อซ้ำ ใช้เตือนบนหน้ารายการ */
  belowMinimum: boolean;
}

interface ItemRow {
  id: string;
  code: string;
  name_th: string;
  status: 'ACTIVE' | 'INACTIVE';
  minimum_quantity: string;
  note: string | null;
  item_categories: { name_th: string } | null;
  units: { name_th: string } | null;
  locations: { name_th: string } | null;
}

interface BalanceRow {
  item_id: string;
  on_hand: string;
}

const ITEM_COLUMNS =
  'id, code, name_th, status, minimum_quantity, note, ' +
  'item_categories(name_th), units(name_th), locations(name_th)';

/*
 * ดึงยอดแยกอีก query แทนการ join — PostgREST ยังไม่รู้จักความสัมพันธ์ระหว่าง
 * ตารางกับ view ที่ไม่มี foreign key เหตุผลเดียวกับ loadBalances ของ budget
 */
async function loadOnHand(itemIds: readonly string[]): Promise<Map<string, string>> {
  if (itemIds.length === 0) return new Map();

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('stock_item_balances')
    .select('item_id, on_hand')
    .in('item_id', [...itemIds])
    .returns<BalanceRow[]>();

  return new Map((data ?? []).map((row) => [row.item_id, row.on_hand]));
}

function toSummary(row: ItemRow, onHand: Map<string, string>): InventoryItemSummary {
  const balance = onHand.get(row.id) ?? '0';
  return {
    id: row.id,
    code: row.code,
    nameTh: row.name_th,
    status: row.status,
    categoryName: row.item_categories?.name_th ?? null,
    unitLabel: row.units?.name_th ?? null,
    locationName: row.locations?.name_th ?? null,
    minimumQuantity: row.minimum_quantity,
    note: row.note,
    onHand: balance,
    belowMinimum: Number(balance) < Number(row.minimum_quantity),
  };
}

export async function listInventoryItems(): Promise<InventoryItemSummary[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('inventory_items')
    .select(ITEM_COLUMNS)
    .order('code')
    .returns<ItemRow[]>();

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const onHand = await loadOnHand(rows.map((row) => row.id));
  return rows.map((row) => toSummary(row, onHand));
}

export async function getInventoryItem(id: string): Promise<InventoryItemSummary | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('inventory_items')
    .select(ITEM_COLUMNS)
    .eq('id', id)
    .maybeSingle<ItemRow>();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const onHand = await loadOnHand([data.id]);
  return toSummary(data, onHand);
}

export interface StockMovementRow {
  id: string;
  type: StockMovementType;
  quantity: string;
  balanceAfter: string;
  effectiveDate: string;
  reference: string;
  reason: string | null;
  requestedByName: string | null;
  approvedByName: string | null;
  reversesMovementId: string | null;
  /** true = แถวนี้ถูกย้อนไปแล้ว จึงย้อนซ้ำไม่ได้ */
  isReversed: boolean;
  createdAt: string;
}

interface MovementDbRow {
  id: string;
  movement_type: StockMovementType;
  quantity: string;
  balance_after: string;
  effective_date: string;
  reference: string;
  reason: string | null;
  reverses_movement_id: string | null;
  created_at: string;
  requested_by_profile: { first_name_th: string; last_name_th: string } | null;
  approved_by_profile: { first_name_th: string; last_name_th: string } | null;
}

function profileLabel(
  profile: { first_name_th: string; last_name_th: string } | null,
): string | null {
  return profile ? `${profile.first_name_th} ${profile.last_name_th}` : null;
}

/**
 * รายการเคลื่อนไหว (stock card) ของรายการพัสดุหนึ่ง เรียงใหม่ก่อนเก่า
 *
 * `isReversed` คำนวณจากชุดที่ดึงมาทั้งหมด ไม่ใช่ query แยกต่อแถว — reverses_movement_id
 * ชี้ไปแถวของรายการพัสดุเดียวกันเสมอ (ฐานข้อมูลไม่ได้บังคับข้ามรายการ แต่ server action
 * ไม่เปิดช่องให้ย้อนข้ามรายการ) จึงหาได้จากชุดนี้ชุดเดียว
 */
export async function listStockMovements(itemId: string): Promise<StockMovementRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('stock_movements')
    .select(
      'id, movement_type, quantity, balance_after, effective_date, reference, reason, ' +
        'reverses_movement_id, created_at, ' +
        'requested_by_profile:profiles!stock_movements_requested_by_fkey(first_name_th, last_name_th), ' +
        'approved_by_profile:profiles!stock_movements_approved_by_fkey(first_name_th, last_name_th)',
    )
    .eq('item_id', itemId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .returns<MovementDbRow[]>();

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const reversedIds = new Set(
    rows.flatMap((row) => (row.reverses_movement_id ? [row.reverses_movement_id] : [])),
  );

  return rows.map((row) => ({
    id: row.id,
    type: row.movement_type,
    quantity: row.quantity,
    balanceAfter: row.balance_after,
    effectiveDate: row.effective_date,
    reference: row.reference,
    reason: row.reason,
    requestedByName: profileLabel(row.requested_by_profile),
    approvedByName: profileLabel(row.approved_by_profile),
    reversesMovementId: row.reverses_movement_id,
    isReversed: reversedIds.has(row.id),
    createdAt: row.created_at,
  }));
}

export interface InventoryItemOptions {
  categories: { id: string; label: string }[];
  units: { id: string; label: string }[];
  locations: { id: string; label: string }[];
}

export async function loadInventoryItemOptions(): Promise<InventoryItemOptions> {
  const supabase = await createSupabaseServerClient();

  const [categories, units, locations] = await Promise.all([
    supabase
      .from('item_categories')
      .select('id, code, name_th')
      .eq('is_active', true)
      .order('code')
      .returns<{ id: string; code: string; name_th: string }[]>(),
    supabase
      .from('units')
      .select('id, code, name_th')
      .eq('is_active', true)
      .order('code')
      .returns<{ id: string; code: string; name_th: string }[]>(),
    supabase
      .from('locations')
      .select('id, code, name_th')
      .eq('is_active', true)
      .order('code')
      .returns<{ id: string; code: string; name_th: string }[]>(),
  ]);

  return {
    categories: (categories.data ?? []).map((row) => ({
      id: row.id,
      label: `${row.name_th} (${row.code})`,
    })),
    units: (units.data ?? []).map((row) => ({ id: row.id, label: `${row.name_th} (${row.code})` })),
    locations: (locations.data ?? []).map((row) => ({
      id: row.id,
      label: `${row.name_th} (${row.code})`,
    })),
  };
}

/** ตัวเลือกผู้เบิก/ผู้อนุมัติ — ใช้ผู้ใช้ที่ active ทั้งหมด เหมือนตัวเลือกผู้ลงนามในเอกสารอื่น */
export async function loadActorOptions(): Promise<{ id: string; label: string }[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, employee_code, first_name_th, last_name_th')
    .eq('is_active', true)
    .order('first_name_th')
    .returns<
      { id: string; employee_code: string; first_name_th: string; last_name_th: string }[]
    >();

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    label: `${row.first_name_th} ${row.last_name_th} (${row.employee_code})`,
  }));
}
