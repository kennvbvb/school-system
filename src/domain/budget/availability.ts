/**
 * การคิดยอดงบที่ใช้ได้จาก ledger
 *
 * นิยามนี้เป็น **แหล่งความจริงเดียว** ของทั้งระบบ ทั้งหน้าจอและ server เรียกฟังก์ชันนี้
 * เพื่อไม่ให้เกิดกรณีที่หน้าจอบอกว่าเงินพอแต่ server ปฏิเสธ (ADR 0008)
 *
 * ยังเป็นสมมติฐานจนกว่าโรงเรียนจะยืนยันว่าถือ "ยอดที่กันไว้แต่ยังไม่จ่าย"
 * เป็นเงินที่ใช้ไม่ได้หรือไม่ — คำถาม Q17 ใน docs/assumptions.md
 */
import { indexMovements, resolveDirection } from './movement';
import type { BudgetMovement, MovementType } from './movement';

export interface BudgetSummary {
  /** งบที่ได้รับสุทธิ: จัดสรร + เพิ่ม + รับโอน − ลด − โอนออก */
  grantedSatang: bigint;
  /** ยอดที่กันไว้และยังไม่ได้คืน */
  reservedSatang: bigint;
  /** ยอดผูกพันและจ่ายจริง */
  usedSatang: bigint;
  /** granted − reserved − used */
  availableSatang: bigint;
}

// GRANT เป็นกลุ่มปริยาย: ชนิดที่ไม่ใช่การกันยอดและไม่ใช่การใช้ยอด ถือเป็นการให้/ลดงบ
// เขียนแบบนี้เพื่อให้ชนิดใหม่ที่เพิ่มภายหลังไม่หายไปจากสรุปโดยเงียบ ๆ
const RESERVE_TYPES: readonly MovementType[] = ['RESERVE', 'RELEASE'];

const USE_TYPES: readonly MovementType[] = ['COMMIT', 'ACTUAL'];

/**
 * จัดกลุ่มแถวหนึ่งว่าไปอยู่ยอดไหนในสรุป
 *
 * REVERSAL ไปอยู่กลุ่มเดียวกับแถวที่มันย้อน มิฉะนั้นการย้อนการกันยอด
 * จะไปลดยอดงบที่ได้รับแทนที่จะคืนยอดที่กันไว้ ซึ่งทำให้สรุปอ่านผิด
 */
function bucketOf(
  movement: BudgetMovement,
  byId: ReadonlyMap<string, BudgetMovement>,
): 'GRANT' | 'RESERVE' | 'USE' {
  let effectiveType = movement.type;

  if (movement.type === 'REVERSAL' && movement.reversesMovementId) {
    const target = byId.get(movement.reversesMovementId);
    if (target) effectiveType = target.type;
  }

  if (RESERVE_TYPES.includes(effectiveType)) return 'RESERVE';
  if (USE_TYPES.includes(effectiveType)) return 'USE';
  return 'GRANT';
}

/**
 * คิดยอดจากรายการเคลื่อนไหวทั้งหมดของบัญชีงบหนึ่ง
 *
 * รับ movements ทั้งชุดเพราะ REVERSAL ต้องหาแถวต้นทางให้เจอ
 * การส่งมาบางส่วนจะทำให้ทิศทางของ REVERSAL ตีความไม่ได้
 */
export function summarize(movements: readonly BudgetMovement[]): BudgetSummary {
  const byId = indexMovements(movements);

  let granted = 0n;
  let reserved = 0n;
  let used = 0n;

  for (const movement of movements) {
    const direction = resolveDirection(movement, byId);
    const bucket = bucketOf(movement, byId);

    if (bucket === 'GRANT') {
      granted += direction === 'CREDIT' ? movement.amountSatang : -movement.amountSatang;
      continue;
    }

    // ในสองกลุ่มนี้ DEBIT คือการ "ใช้" ยอด จึงทำให้ตัวเลขในกลุ่มเพิ่มขึ้น
    const delta = direction === 'DEBIT' ? movement.amountSatang : -movement.amountSatang;
    if (bucket === 'RESERVE') reserved += delta;
    else used += delta;
  }

  return {
    grantedSatang: granted,
    reservedSatang: reserved,
    usedSatang: used,
    availableSatang: granted - reserved - used,
  };
}

/** ยอดที่ใช้ได้ — ทางลัดของ summarize() สำหรับผู้เรียกที่ต้องการเลขเดียว */
export function calculateAvailable(movements: readonly BudgetMovement[]): bigint {
  return summarize(movements).availableSatang;
}

/**
 * ยอดที่ใช้ได้หลังลงแถวใหม่ โดยยังไม่ได้ลงจริง
 *
 * ใช้ตอบคำถาม "ถ้าลงรายการนี้แล้วเงินจะพอไหม" ก่อนเขียนฐานข้อมูล
 */
export function availableAfter(
  movements: readonly BudgetMovement[],
  candidate: BudgetMovement,
): bigint {
  return calculateAvailable([...movements, candidate]);
}
