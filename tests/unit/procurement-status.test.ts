import { describe, expect, it } from 'vitest';
import {
  PROCUREMENT_ACTIONS,
  PROCUREMENT_STATUSES,
  TRANSITIONS,
  TransitionError,
  assertTransitionAllowed,
  isEditableStatus,
} from '@/domain/procurement/status';
import { PERMISSIONS } from '@/domain/auth/permissions';
import type { PermissionCode } from '@/domain/auth/permissions';

const ALL: readonly PermissionCode[] = PERMISSIONS;

describe('assertTransitionAllowed — เส้นทางปกติ', () => {
  it('เดินครบ flow ตั้งแต่ Draft ถึง Received', () => {
    expect(assertTransitionAllowed({ from: 'DRAFT', action: 'submit', permissions: ALL })).toBe(
      'PENDING_REVIEW',
    );
    expect(
      assertTransitionAllowed({ from: 'PENDING_REVIEW', action: 'review_pass', permissions: ALL }),
    ).toBe('PENDING_APPROVAL');
    expect(
      assertTransitionAllowed({ from: 'PENDING_APPROVAL', action: 'approve', permissions: ALL }),
    ).toBe('APPROVED');
    expect(assertTransitionAllowed({ from: 'APPROVED', action: 'issue', permissions: ALL })).toBe(
      'ISSUED',
    );
    expect(
      assertTransitionAllowed({ from: 'ISSUED', action: 'receive_partial', permissions: ALL }),
    ).toBe('PARTIALLY_RECEIVED');
    expect(
      assertTransitionAllowed({
        from: 'PARTIALLY_RECEIVED',
        action: 'receive_all',
        permissions: ALL,
      }),
    ).toBe('RECEIVED');
  });

  it('ส่งกลับแก้ไขแล้วส่งใหม่ได้', () => {
    expect(
      assertTransitionAllowed({
        from: 'PENDING_REVIEW',
        action: 'review_return',
        permissions: ALL,
        reason: 'แนบใบเสนอราคาไม่ครบ',
      }),
    ).toBe('NEEDS_REVISION');
    expect(
      assertTransitionAllowed({ from: 'NEEDS_REVISION', action: 'submit', permissions: ALL }),
    ).toBe('PENDING_REVIEW');
  });
});

describe('assertTransitionAllowed — การป้องกัน', () => {
  it('ปฏิเสธการข้ามขั้นตอน', () => {
    expect(() =>
      assertTransitionAllowed({ from: 'DRAFT', action: 'approve', permissions: ALL }),
    ).toThrow(TransitionError);
    expect(() =>
      assertTransitionAllowed({ from: 'DRAFT', action: 'issue', permissions: ALL }),
    ).toThrow(/สถานะ DRAFT/);
  });

  it('ปฏิเสธการอนุมัติซ้ำ (FR-APR-006)', () => {
    expect(() =>
      assertTransitionAllowed({ from: 'APPROVED', action: 'approve', permissions: ALL }),
    ).toThrow(TransitionError);
  });

  it('ปฏิเสธเมื่อผู้ใช้ไม่มีสิทธิ์ที่กำหนด', () => {
    try {
      assertTransitionAllowed({
        from: 'PENDING_APPROVAL',
        action: 'approve',
        permissions: ['procurement.read.all'],
      });
      throw new Error('ควรจะโยน error');
    } catch (error) {
      expect(error).toBeInstanceOf(TransitionError);
      expect((error as TransitionError).code).toBe('FORBIDDEN');
    }
  });

  it('บังคับเหตุผลสำหรับการส่งกลับ ปฏิเสธ และยกเลิก', () => {
    for (const action of ['review_return', 'reject', 'cancel'] as const) {
      const from = action === 'review_return' ? 'PENDING_REVIEW' : 'PENDING_APPROVAL';
      expect(() => assertTransitionAllowed({ from, action, permissions: ALL })).toThrow(
        /ต้องระบุเหตุผล/,
      );
      expect(() =>
        assertTransitionAllowed({ from, action, permissions: ALL, reason: '   ' }),
      ).toThrow(/ต้องระบุเหตุผล/);
    }
  });

  it('ตรวจสถานะก่อนสิทธิ์ เพื่อไม่เผยว่าผู้ใช้ขาดสิทธิ์ใด', () => {
    try {
      assertTransitionAllowed({ from: 'RECEIVED', action: 'approve', permissions: [] });
      throw new Error('ควรจะโยน error');
    } catch (error) {
      expect((error as TransitionError).code).toBe('INVALID_TRANSITION');
    }
  });

  it('รายการที่รับของครบแล้วยกเลิกไม่ได้', () => {
    expect(() =>
      assertTransitionAllowed({
        from: 'RECEIVED',
        action: 'cancel',
        permissions: ALL,
        reason: 'ทดสอบ',
      }),
    ).toThrow(TransitionError);
  });
});

describe('ความสมบูรณ์ของตาราง transition', () => {
  it('ทุก action มีอย่างน้อยหนึ่งกฎ และอ้างสถานะที่มีจริง', () => {
    for (const action of PROCUREMENT_ACTIONS) {
      const rules = TRANSITIONS[action];
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(PROCUREMENT_STATUSES).toContain(rule.from);
        expect(PROCUREMENT_STATUSES).toContain(rule.to);
        expect(PERMISSIONS).toContain(rule.permission);
      }
    }
  });

  it('ไม่มีกฎซ้ำสำหรับคู่ (action, from) เดียวกัน', () => {
    for (const action of PROCUREMENT_ACTIONS) {
      const froms = TRANSITIONS[action].map((rule) => rule.from);
      expect(new Set(froms).size).toBe(froms.length);
    }
  });

  it('สถานะปลายทางอย่าง REJECTED และ CANCELLED ไม่มีทางออก', () => {
    for (const action of PROCUREMENT_ACTIONS) {
      for (const terminal of ['REJECTED', 'CANCELLED', 'RECEIVED'] as const) {
        const rule = TRANSITIONS[action].find((item) => item.from === terminal);
        expect(rule).toBeUndefined();
      }
    }
  });
});

describe('isEditableStatus', () => {
  it('แก้ได้เฉพาะ DRAFT และ NEEDS_REVISION', () => {
    expect(isEditableStatus('DRAFT')).toBe(true);
    expect(isEditableStatus('NEEDS_REVISION')).toBe(true);
    for (const status of PROCUREMENT_STATUSES) {
      if (status !== 'DRAFT' && status !== 'NEEDS_REVISION') {
        expect(isEditableStatus(status)).toBe(false);
      }
    }
  });
});
