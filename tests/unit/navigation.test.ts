import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS, visibleSections } from '@/features/auth/navigation';
import { PERMISSIONS, permissionsForRoles } from '@/domain/auth/permissions';

describe('visibleSections', () => {
  it('ผู้ที่ไม่มีสิทธิ์ใดเลยไม่เห็นเมนูใด', () => {
    expect(visibleSections(permissionsForRoles([]))).toEqual([]);
  });

  it('ผู้ดูแลระบบเห็นทุก section', () => {
    expect(visibleSections(permissionsForRoles(['SYSTEM_ADMIN']))).toHaveLength(
      NAV_SECTIONS.length,
    );
  });

  it('ผู้ขอไม่เห็นเมนูผู้ดูแลระบบและเมนูอนุมัติ', () => {
    const sections = visibleSections(permissionsForRoles(['REQUESTER']));
    const hrefs = sections.flatMap((section) => section.items.map((item) => item.href));

    expect(hrefs).toContain('/procurements');
    expect(hrefs).not.toContain('/approvals/inbox');
    expect(hrefs).not.toContain('/admin/users');
    expect(hrefs).not.toContain('/admin/audit-log');
  });

  it('ผู้ตรวจสอบภายในเห็น audit log แต่ไม่เห็นการจัดการผู้ใช้', () => {
    const hrefs = visibleSections(permissionsForRoles(['AUDITOR'])).flatMap((section) =>
      section.items.map((item) => item.href),
    );

    expect(hrefs).toContain('/admin/audit-log');
    expect(hrefs).not.toContain('/admin/users');
  });

  /*
   * รายงานงบใช้สิทธิ์ `budget.read` ไม่ใช่ `reports.export` — หน้านี้เป็นการดูบนจอ
   * ไม่ใช่การนำข้อมูลออกนอกระบบ ถ้าผูกกับ reports.export ผู้อนุมัติที่ต้องดู
   * ยอดคงเหลือก่อนอนุมัติจะเข้าไม่ได้ ทั้งที่เห็นยอดรายบัญชีอยู่แล้ว
   */
  it('ผู้อนุมัติและผู้ตรวจสอบภายในเห็นรายงานงบ แต่ผู้ขอไม่เห็น', () => {
    const hrefsOf = (role: Parameters<typeof permissionsForRoles>[0][number]) =>
      visibleSections(permissionsForRoles([role])).flatMap((section) =>
        section.items.map((item) => item.href),
      );

    expect(hrefsOf('APPROVER')).toContain('/reports/budget');
    expect(hrefsOf('AUDITOR')).toContain('/reports/budget');
    expect(hrefsOf('FINANCE')).toContain('/reports/budget');
    expect(hrefsOf('REQUESTER')).not.toContain('/reports/budget');
  });

  it('ตัด section ที่ไม่มีรายการเหลือทิ้ง ไม่แสดงหัวข้อว่าง', () => {
    for (const section of visibleSections(permissionsForRoles(['INVENTORY_OFFICER']))) {
      expect(section.items.length).toBeGreaterThan(0);
    }
  });

  it('ทุกเมนูอ้างสิทธิ์ที่มีอยู่จริงและมี href ที่ขึ้นต้นด้วย /', () => {
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        expect(item.anyOf.length).toBeGreaterThan(0);
        expect(item.href.startsWith('/')).toBe(true);
        for (const permission of item.anyOf) {
          expect(PERMISSIONS).toContain(permission);
        }
      }
    }
  });
});
