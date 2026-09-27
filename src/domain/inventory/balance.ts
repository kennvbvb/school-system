/**
 * การคิดยอดคงเหลือคลังพัสดุจาก ledger
 *
 * นิยามนี้เป็น **แหล่งความจริงเดียว** ของฝั่งโดเมน — ฐานข้อมูลคำนวณด้วยตรรกะเดียวกัน
 * ใน stock_post_movement() (denormalize เป็น balance_after ต่อแถวเพื่อความเร็ว
 * ในการอ่าน) ฟังก์ชันที่นี่ใช้สำหรับทดสอบและสำหรับกรณีที่ต้องคิดยอดจากชุดข้อมูล
 * ในหน่วยความจำ (เช่น preview ก่อนส่งฟอร์ม)
 */
import { StockMovementError, indexStockMovements, resolveStockDirection } from './movement';
import type { StockMovement } from './movement';

/**
 * คิดยอดคงเหลือจากรายการเคลื่อนไหวทั้งหมดของรายการพัสดุหนึ่ง เรียงตามลำดับที่ลง
 *
 * รับ movements ทั้งชุดเพราะ REVERSAL ต้องหาแถวต้นทางให้เจอ การส่งมาบางส่วน
 * จะทำให้ทิศทางของ REVERSAL ตีความไม่ได้ — เหมือนกับ summarize() ของงบประมาณ
 */
export function calculateStockBalance(movements: readonly StockMovement[]): bigint {
  const byId = indexStockMovements(movements);

  let balance = 0n;
  for (const movement of movements) {
    const direction = resolveStockDirection(movement, byId);
    balance += direction === 'INCREASE' ? movement.quantityUnits : -movement.quantityUnits;
  }

  return balance;
}

/**
 * ยอดคงเหลือหลังลงแถวใหม่ โดยยังไม่ได้ลงจริง
 *
 * ใช้ตอบคำถาม "ถ้าลงรายการนี้แล้วยอดจะติดลบไหม" ก่อนเขียนฐานข้อมูล/แสดงพรีวิว
 */
export function stockBalanceAfter(
  movements: readonly StockMovement[],
  candidate: StockMovement,
): bigint {
  return calculateStockBalance([...movements, candidate]);
}

/**
 * ปฏิเสธการลงรายการที่จะทำให้ยอดคงเหลือติดลบ
 *
 * ต่างจากงบประมาณ: ไม่มีทางยกเว้น (override) เลยไม่ว่าสิทธิ์ใด เพราะของจริง
 * ที่ไม่มีอยู่เบิกออกไปไม่ได้จริง — ตรงกับ constraint `stock_movements_balance_not_negative`
 * และการตรวจใน stock_post_movement() ที่ฐานข้อมูล (migration 0022)
 */
export function assertSufficientStock(
  movements: readonly StockMovement[],
  candidate: StockMovement,
): void {
  if (stockBalanceAfter(movements, candidate) < 0n) {
    throw new StockMovementError('BALANCE_WOULD_GO_NEGATIVE', 'ยอดคงเหลือไม่พอสำหรับรายการนี้');
  }
}
