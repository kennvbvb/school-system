import type { VendorSummary } from '@/domain/master-data/vendor';
import type { VendorDetail } from '@/server/master-data/repository';

/**
 * ตัดข้อมูลผู้ขายให้เหลือเฉพาะช่องที่ใช้ตรวจซ้ำ ก่อนส่งไปให้ฟอร์มในเบราว์เซอร์
 *
 * ฟอร์มต้องมีชื่อ เลขผู้เสียภาษี และสาขา จึงจะเตือนเรื่องซ้ำได้ แต่ไม่ต้องใช้
 * เบอร์โทร ที่อยู่ อีเมล หรือชื่อผู้ติดต่อเลย การส่งไปทั้งก้อนจะทำให้ข้อมูลติดต่อ
 * ของผู้ขายทุกรายถูกฝังลงใน payload ของหน้าโดยไม่มีอะไรใช้ (แผนข้อ 11.2)
 *
 * ตารางบนหน้าเดียวกันแสดงเบอร์โทรอยู่ แต่ render ที่ server จึงไม่ได้ส่งค่าที่
 * ไม่ได้แสดงตามไปด้วย
 */
export function toVendorSummaries(vendors: readonly VendorDetail[]): VendorSummary[] {
  return vendors.map((vendor) => ({
    id: vendor.id,
    vendorCode: vendor.vendorCode,
    name: vendor.name,
    taxId: vendor.taxId,
    branchNo: vendor.branchNo,
    isActive: vendor.isActive,
  }));
}
