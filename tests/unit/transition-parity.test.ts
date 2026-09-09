import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PROCUREMENT_ACTIONS,
  SELF_ACTION_FORBIDDEN,
  TRANSITIONS,
  availableActions,
} from '@/domain/procurement/status';
import type { ProcurementAction } from '@/domain/procurement/status';

/**
 * กติกาการเปลี่ยนสถานะอยู่สองที่โดยจำเป็น
 *
 *   - `src/domain/procurement/status.ts` — ให้หน้าจอรู้ว่าจะแสดงปุ่มใด
 *   - `procurement_transition_rule()` ใน migration 0013 — เป็นผู้บังคับจริง
 *
 * แยกกันไม่ได้ เพราะชั้นโดเมนห้ามพึ่งฐานข้อมูล และฐานข้อมูลต้องบังคับได้เอง
 * แม้ไม่มีแอป แต่ถ้าสองที่ไม่ตรงกันจะเกิดกรณีที่หน้าจอแสดงปุ่มแล้ว server ปฏิเสธ
 * ซึ่งผู้ใช้แก้ตามไม่ได้เลย
 *
 * test นี้อ่าน SQL จริงมาเทียบ ไม่ใช่เทียบกับสำเนาที่เขียนไว้ในนี้ —
 * สำเนาจะเก่าเงียบ ๆ พร้อมกับของจริง (แนวเดียวกับ rule-parity.test.ts ของ PR-03)
 */
const MIGRATION = 'supabase/migrations/20260909000200_procurement_transition.sql';

interface SqlRule {
  action: string;
  from: string;
  to: string;
  permission: string;
  requiresReason: boolean;
}

function rulesInSql(): SqlRule[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('create or replace function public.procurement_transition_rule');
  expect(start).toBeGreaterThan(-1);

  const body = sql.slice(start, sql.indexOf('$$;', start));
  const rowPattern = /\('(\w+)',\s*'([A-Z_]+)',\s*'([A-Z_]+)',\s*'([\w.]+)',\s*(true|false)\)/g;

  return [...body.matchAll(rowPattern)].map((match) => ({
    action: match[1] as string,
    from: match[2] as string,
    to: match[3] as string,
    permission: match[4] as string,
    requiresReason: match[5] === 'true',
  }));
}

function rulesInDomain(): SqlRule[] {
  return PROCUREMENT_ACTIONS.flatMap((action) =>
    TRANSITIONS[action].map((rule) => ({
      action,
      from: rule.from,
      to: rule.to,
      permission: rule.permission,
      requiresReason: rule.requiresReason,
    })),
  );
}

const sortKey = (rule: SqlRule) => `${rule.action}|${rule.from}`;
const bySortKey = (a: SqlRule, b: SqlRule) => sortKey(a).localeCompare(sortKey(b));

describe('กติกาการเปลี่ยนสถานะตรงกันระหว่างโดเมนกับฐานข้อมูล', () => {
  /*
   * `submit` อยู่ในโดเมนแต่ไม่อยู่ใน SQL โดยเจตนา
   *
   * การส่งอนุมัติต้องผ่าน procurement_submit() ซึ่งตรวจกฎครบชุดก่อนเปลี่ยนสถานะ
   * ถ้าใส่ไว้ในตารางกติกาด้วย จะมีทางส่งอนุมัติที่ข้ามการตรวจทั้งหมดของ PR-03
   */
  it('SQL ไม่มี submit — การส่งอนุมัติมีเส้นทางของตัวเอง', () => {
    expect(rulesInSql().map((rule) => rule.action)).not.toContain('submit');
  });

  it('ทุกแถวตรงกันหมด ทั้งสถานะปลายทาง สิทธิ์ และการบังคับเหตุผล', () => {
    const fromSql = [...rulesInSql()].sort(bySortKey);
    const fromDomain = rulesInDomain()
      .filter((rule) => rule.action !== 'submit')
      .sort(bySortKey);

    expect(fromSql).toEqual(fromDomain);
  });

  it('ไม่มีกติกาใดใน SQL ที่โดเมนไม่รู้จัก', () => {
    const domainKeys = new Set(rulesInDomain().map(sortKey));

    for (const rule of rulesInSql()) {
      expect(domainKeys.has(sortKey(rule)), `${sortKey(rule)} ไม่มีในโดเมน`).toBe(true);
    }
  });

  it('รายการที่ห้ามทำกับรายการของตัวเองตรงกันทั้งสองฝั่ง', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const start = sql.indexOf('create or replace function public.is_self_action_forbidden');
    expect(start).toBeGreaterThan(-1);

    const body = sql.slice(start, sql.indexOf('$$;', start));
    const fromSql = [...body.matchAll(/'(\w+)'/g)]
      .map((match) => match[1] as string)
      .filter((value) => (PROCUREMENT_ACTIONS as readonly string[]).includes(value));

    expect([...fromSql].sort()).toEqual([...SELF_ACTION_FORBIDDEN].sort());
  });

  /*
   * ข้อที่ต้องเป็นจริงตลอด ไม่ว่าตารางกติกาจะเปลี่ยนไปอย่างไร
   *
   * ทุกการกระทำที่พาไปสถานะซึ่งย้อนกลับไม่ได้ ต้องบังคับให้ระบุเหตุผล
   * เพราะเป็นจุดที่ผู้ตรวจสอบจะย้อนกลับมาถามว่า "ทำไม"
   */
  it.each(['review_return', 'approve_return', 'reject', 'cancel'] as ProcurementAction[])(
    '%s บังคับให้ระบุเหตุผลทุกแถว',
    (action) => {
      const rules = TRANSITIONS[action];

      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule.requiresReason, `${action} จาก ${rule.from} ไม่ได้บังคับเหตุผล`).toBe(true);
      }
    },
  );
});

describe('availableActions — ใช้ตัดสินว่าจะแสดงปุ่มใด', () => {
  const REVIEWER = ['procurement.review'] as const;
  const APPROVER = ['procurement.approve'] as const;

  it('ผู้ตรวจสอบเห็นทั้งผ่านและส่งกลับเมื่อรายการรอตรวจสอบ', () => {
    expect(
      availableActions({ status: 'PENDING_REVIEW', permissions: REVIEWER, isOwner: false }),
    ).toEqual(['review_pass', 'review_return']);
  });

  it('ไม่แสดงปุ่มที่ผู้ใช้ไม่มีสิทธิ์', () => {
    expect(
      availableActions({ status: 'PENDING_REVIEW', permissions: APPROVER, isOwner: false }),
    ).toEqual([]);
  });

  /*
   * จุดที่หน้าจอต้องสอดคล้องกับ server
   *
   * ถ้าแสดงปุ่มให้เจ้าของรายการ ผู้ใช้จะกดแล้วโดนปฏิเสธทุกครั้งโดยไม่มีทางแก้
   * — ปุ่มที่กดไม่ได้เลยแย่กว่าไม่มีปุ่ม
   */
  it('เจ้าของรายการไม่เห็นปุ่มตรวจสอบและอนุมัติของรายการตัวเอง', () => {
    expect(
      availableActions({ status: 'PENDING_REVIEW', permissions: REVIEWER, isOwner: true }),
    ).toEqual([]);
    expect(
      availableActions({ status: 'PENDING_APPROVAL', permissions: APPROVER, isOwner: true }),
    ).toEqual([]);
  });

  it('เจ้าของยังเห็นปุ่มยกเลิกของรายการตัวเอง', () => {
    expect(
      availableActions({
        status: 'PENDING_APPROVAL',
        permissions: ['procurement.cancel'],
        isOwner: true,
      }),
    ).toEqual(['cancel']);
  });

  it('ไม่มีปุ่มส่งอนุมัติในชุดนี้ เพราะมีเส้นทางของตัวเอง', () => {
    expect(
      availableActions({
        status: 'DRAFT',
        permissions: ['procurement.submit', 'procurement.cancel'],
        isOwner: true,
      }),
    ).toEqual(['cancel']);
  });

  it.each(['REJECTED', 'RECEIVED', 'CANCELLED'] as const)(
    'สถานะปลายทาง %s ไม่มีปุ่มใดเลย',
    (status) => {
      expect(
        availableActions({
          status,
          permissions: [
            'procurement.review',
            'procurement.approve',
            'procurement.cancel',
            'documents.issue',
            'inventory.receive',
          ],
          isOwner: false,
        }),
      ).toEqual([]);
    },
  );
});
