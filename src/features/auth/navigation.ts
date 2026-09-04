import type { PermissionCode } from '@/domain/auth/permissions';

/**
 * โครงเมนูหลัก พร้อมสิทธิ์ที่จำเป็นของแต่ละรายการ (ข้อ 4.2, 12)
 *
 * การซ่อนเมนูที่นี่เป็นเรื่อง UX เท่านั้น ไม่ใช่การควบคุมการเข้าถึง
 * ทุกหน้าปลายทางต้องเรียก requirePermissionForPage ด้วยสิทธิ์ชุดเดียวกันซ้ำที่ server
 */
export interface NavItem {
  href: string;
  labelTh: string;
  /** ต้องมีสิทธิ์อย่างน้อยหนึ่งข้อในรายการนี้จึงจะเห็นเมนู */
  anyOf: readonly PermissionCode[];
  /** true = หน้ายังไม่ถูกสร้างใน Phase 1 แสดงเมนูแบบปิดใช้งานไว้ก่อน */
  comingSoon?: boolean;
}

export interface NavSection {
  titleTh: string;
  items: readonly NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    titleTh: 'ภาพรวม',
    items: [
      {
        href: '/dashboard',
        labelTh: 'หน้าแรก',
        anyOf: ['procurement.read.own', 'procurement.read.all', 'inventory.read', 'assets.read'],
      },
    ],
  },
  {
    titleTh: 'งานจัดซื้อจัดจ้าง',
    items: [
      {
        href: '/procurements',
        labelTh: 'รายการจัดซื้อจัดจ้าง',
        anyOf: ['procurement.read.own', 'procurement.read.all'],
        comingSoon: true,
      },
      {
        href: '/approvals/inbox',
        labelTh: 'รอตรวจ / รออนุมัติ',
        anyOf: ['procurement.review', 'procurement.approve'],
        comingSoon: true,
      },
    ],
  },
  {
    titleTh: 'คลังพัสดุและครุภัณฑ์',
    items: [
      {
        href: '/inventory/items',
        labelTh: 'คลังวัสดุ',
        anyOf: ['inventory.read'],
        comingSoon: true,
      },
      { href: '/assets', labelTh: 'ทะเบียนครุภัณฑ์', anyOf: ['assets.read'], comingSoon: true },
    ],
  },
  {
    titleTh: 'รายงาน',
    items: [
      {
        href: '/reports/procurements',
        labelTh: 'รายงานจัดซื้อจัดจ้าง',
        anyOf: ['reports.export'],
        comingSoon: true,
      },
    ],
  },
  {
    titleTh: 'ผู้ดูแลระบบ',
    items: [
      {
        href: '/admin/users',
        labelTh: 'ผู้ใช้และสิทธิ์',
        anyOf: ['users.manage'],
        comingSoon: true,
      },
      {
        href: '/admin/master-data',
        labelTh: 'ข้อมูลพื้นฐาน',
        anyOf: ['masters.manage'],
        comingSoon: true,
      },
      { href: '/admin/audit-log', labelTh: 'Audit log', anyOf: ['audit.read'], comingSoon: true },
      { href: '/admin/system', labelTh: 'ข้อมูลระบบ', anyOf: ['settings.manage'] },
    ],
  },
];

export interface PermissionChecker {
  hasAny(permissions: readonly PermissionCode[]): boolean;
}

/** คัดเฉพาะเมนูที่ผู้ใช้มีสิทธิ์เห็น และตัด section ที่ว่างทิ้ง */
export function visibleSections(
  checker: PermissionChecker,
  sections: readonly NavSection[] = NAV_SECTIONS,
): NavSection[] {
  return sections
    .map((section) => ({
      titleTh: section.titleTh,
      items: section.items.filter((item) => checker.hasAny(item.anyOf)),
    }))
    .filter((section) => section.items.length > 0);
}
