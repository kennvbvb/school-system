/**
 * Permission codes และ role mapping ตั้งต้น (ข้อ 4.1, 4.3)
 *
 * ค่าที่นี่เป็น "แหล่งความจริงของโค้ด" ส่วนการผูก role→permission ที่ใช้จริง
 * อยู่ในตาราง role_permissions เพื่อให้ผู้ดูแลระบบปรับได้โดยไม่ต้อง deploy
 * migration แรกจะ seed ตารางให้ตรงกับค่าที่ประกาศไว้ในไฟล์นี้
 */

export const PERMISSIONS = [
  'users.read',
  'users.manage',
  'masters.read',
  'masters.manage',
  'procurement.read.own',
  'procurement.read.all',
  'procurement.create',
  'procurement.edit_draft',
  'procurement.submit',
  'procurement.review',
  'procurement.approve',
  'procurement.cancel',
  'procurement.override_validation',
  'budget.read',
  'budget.manage',
  'budget.override',
  'documents.preview',
  'documents.issue',
  'documents.print',
  'inventory.read',
  'inventory.receive',
  'inventory.issue',
  'inventory.adjust',
  'assets.read',
  'assets.manage',
  'reports.export',
  'audit.read',
  'templates.manage',
  'settings.manage',
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number];

export const ROLES = [
  'SYSTEM_ADMIN',
  'PROCUREMENT_OFFICER',
  'REQUESTER',
  'REVIEWER',
  'APPROVER',
  'FINANCE',
  'INVENTORY_OFFICER',
  'AUDITOR',
] as const;

export type RoleCode = (typeof ROLES)[number];

export const ROLE_LABELS_TH: Readonly<Record<RoleCode, string>> = {
  SYSTEM_ADMIN: 'ผู้ดูแลระบบ',
  PROCUREMENT_OFFICER: 'เจ้าหน้าที่พัสดุ',
  REQUESTER: 'ผู้ขอ',
  REVIEWER: 'ผู้ตรวจสอบ',
  APPROVER: 'ผู้อนุมัติ',
  FINANCE: 'เจ้าหน้าที่การเงิน',
  INVENTORY_OFFICER: 'เจ้าหน้าที่คลังพัสดุ',
  AUDITOR: 'ผู้ตรวจสอบภายใน',
};

/** ค่าตั้งต้นที่ใช้ seed ตาราง role_permissions — โรงเรียนปรับได้ภายหลังผ่านหน้าผู้ดูแล */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<RoleCode, readonly PermissionCode[]>> = {
  SYSTEM_ADMIN: PERMISSIONS,
  PROCUREMENT_OFFICER: [
    'masters.read',
    'procurement.read.all',
    'procurement.create',
    'procurement.edit_draft',
    'procurement.submit',
    'procurement.cancel',
    'budget.read',
    'documents.preview',
    'documents.issue',
    'documents.print',
    'inventory.read',
    'inventory.receive',
    'assets.read',
    'reports.export',
  ],
  REQUESTER: [
    'masters.read',
    'procurement.read.own',
    'procurement.create',
    'procurement.edit_draft',
    'procurement.submit',
    'documents.preview',
  ],
  REVIEWER: [
    'masters.read',
    'procurement.read.all',
    'procurement.review',
    'budget.read',
    'documents.preview',
  ],
  APPROVER: [
    'masters.read',
    'procurement.read.all',
    'procurement.approve',
    'procurement.override_validation',
    'budget.read',
    'documents.preview',
  ],
  FINANCE: [
    'masters.read',
    'procurement.read.all',
    'budget.read',
    'budget.manage',
    'reports.export',
  ],
  INVENTORY_OFFICER: [
    'masters.read',
    'procurement.read.all',
    'inventory.read',
    'inventory.receive',
    'inventory.issue',
    'inventory.adjust',
    'assets.read',
    'assets.manage',
    'reports.export',
  ],
  AUDITOR: [
    'masters.read',
    'procurement.read.all',
    'budget.read',
    'inventory.read',
    'assets.read',
    'reports.export',
    'audit.read',
  ],
};

export function isPermissionCode(value: string): value is PermissionCode {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * ตัวประเมินสิทธิ์ — ใช้ร่วมกันทั้งฝั่ง server และการซ่อน/แสดงเมนู
 *
 * การซ่อนปุ่มฝั่ง browser เป็นเพียงเรื่อง UX เท่านั้น
 * ทุก mutation ต้องเรียก requirePermission ที่ server อีกชั้นเสมอ (ข้อ 4.2)
 */
export class PermissionSet {
  private readonly granted: ReadonlySet<PermissionCode>;

  constructor(permissions: Iterable<PermissionCode>) {
    this.granted = new Set(permissions);
  }

  has(permission: PermissionCode): boolean {
    return this.granted.has(permission);
  }

  hasAll(permissions: readonly PermissionCode[]): boolean {
    return permissions.every((permission) => this.granted.has(permission));
  }

  hasAny(permissions: readonly PermissionCode[]): boolean {
    return permissions.some((permission) => this.granted.has(permission));
  }

  toArray(): PermissionCode[] {
    return [...this.granted].sort();
  }
}

export function permissionsForRoles(roles: readonly RoleCode[]): PermissionSet {
  const collected = roles.flatMap((role) => DEFAULT_ROLE_PERMISSIONS[role] ?? []);
  return new PermissionSet(collected);
}
