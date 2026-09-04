import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PermissionSet,
  ROLES,
  ROLE_LABELS_TH,
  isPermissionCode,
  permissionsForRoles,
} from '@/domain/auth/permissions';

describe('PermissionSet', () => {
  const set = new PermissionSet(['procurement.create', 'procurement.submit']);

  it('ตรวจสิทธิ์เดี่ยว', () => {
    expect(set.has('procurement.create')).toBe(true);
    expect(set.has('procurement.approve')).toBe(false);
  });

  it('hasAll ต้องครบทุกข้อ', () => {
    expect(set.hasAll(['procurement.create', 'procurement.submit'])).toBe(true);
    expect(set.hasAll(['procurement.create', 'procurement.approve'])).toBe(false);
    expect(set.hasAll([])).toBe(true);
  });

  it('hasAny ต้องมีอย่างน้อยหนึ่งข้อ', () => {
    expect(set.hasAny(['procurement.approve', 'procurement.submit'])).toBe(true);
    expect(set.hasAny(['procurement.approve'])).toBe(false);
    expect(set.hasAny([])).toBe(false);
  });

  it('ตัดสิทธิ์ซ้ำออก', () => {
    expect(new PermissionSet(['users.read', 'users.read']).toArray()).toEqual(['users.read']);
  });
});

describe('permissionsForRoles', () => {
  it('รวมสิทธิ์จากหลายบทบาท', () => {
    const combined = permissionsForRoles(['REQUESTER', 'REVIEWER']);
    expect(combined.has('procurement.create')).toBe(true);
    expect(combined.has('procurement.review')).toBe(true);
    expect(combined.has('procurement.approve')).toBe(false);
  });

  it('SYSTEM_ADMIN ได้ทุกสิทธิ์', () => {
    expect(permissionsForRoles(['SYSTEM_ADMIN']).toArray()).toHaveLength(PERMISSIONS.length);
  });

  it('ไม่มีบทบาทแปลว่าไม่มีสิทธิ์', () => {
    expect(permissionsForRoles([]).toArray()).toEqual([]);
  });
});

describe('ความสอดคล้องของตารางบทบาท', () => {
  it('ทุกบทบาทมีป้ายภาษาไทยและรายการสิทธิ์', () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS_TH[role]).toBeTruthy();
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toBeDefined();
    }
  });

  it('สิทธิ์ทุกตัวที่อ้างในบทบาทมีอยู่จริงในรายการกลาง', () => {
    for (const role of ROLES) {
      for (const permission of DEFAULT_ROLE_PERMISSIONS[role]) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it('AUDITOR อ่านและส่งออกได้ แต่แก้ไขไม่ได้ (ข้อ 4.1)', () => {
    const auditor = permissionsForRoles(['AUDITOR']);
    expect(auditor.has('reports.export')).toBe(true);
    expect(auditor.has('audit.read')).toBe(true);
    for (const forbidden of [
      'procurement.create',
      'procurement.edit_draft',
      'procurement.approve',
      'inventory.adjust',
      'assets.manage',
      'users.manage',
    ] as const) {
      expect(auditor.has(forbidden)).toBe(false);
    }
  });

  it('เฉพาะ SYSTEM_ADMIN เท่านั้นที่จัดการผู้ใช้ แม่แบบ และค่าตั้ง (ข้อ 4.2)', () => {
    for (const role of ROLES) {
      if (role === 'SYSTEM_ADMIN') continue;
      const set = permissionsForRoles([role]);
      expect(set.has('users.manage')).toBe(false);
      expect(set.has('templates.manage')).toBe(false);
      expect(set.has('settings.manage')).toBe(false);
    }
  });
});

describe('isPermissionCode', () => {
  it('ยอมรับเฉพาะรหัสที่ประกาศไว้', () => {
    expect(isPermissionCode('procurement.approve')).toBe(true);
    expect(isPermissionCode('procurement.destroy')).toBe(false);
  });
});
