import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTION_LABELS_TH,
  AUDIT_GROUPS,
  AUDIT_GROUP_LABELS_TH,
  actionsInGroup,
  actionsMissingFromGroups,
  summarizeChanges,
} from '@/domain/audit/audit-view';
import { hasActiveFilter, parseAuditFilter } from '@/domain/audit/schemas';

describe('ป้ายและกลุ่มของ action', () => {
  /*
   * ข้อที่สำคัญที่สุดของไฟล์นี้
   *
   * ถ้ามีใครเพิ่ม action ใหม่แล้วลืมจัดกลุ่ม ผู้ตรวจสอบที่กรองตามกลุ่มจะไม่เห็น
   * เหตุการณ์นั้นเลย และไม่มีอะไรบอกว่าหายไป — เป็นความเงียบที่อันตรายที่สุด
   * ของหน้าจอตรวจสอบ
   */
  it('ทุก action อยู่ในกลุ่มใดกลุ่มหนึ่ง', () => {
    expect(actionsMissingFromGroups()).toEqual([]);
  });

  it('ทุก action มีป้ายภาษาไทยที่ไม่ว่าง', () => {
    for (const [action, label] of Object.entries(AUDIT_ACTION_LABELS_TH)) {
      expect(label.trim(), action).not.toBe('');
      /* ป้ายต้องไม่ใช่รหัสเดิม มิฉะนั้นเท่ากับไม่ได้แปล */
      expect(label, action).not.toBe(action);
    }
  });

  it('ทุกกลุ่มมีป้ายภาษาไทย', () => {
    for (const group of AUDIT_GROUPS) {
      expect(AUDIT_GROUP_LABELS_TH[group].trim()).not.toBe('');
    }
  });

  it('ALL ไม่กรองอะไรเลย', () => {
    expect(actionsInGroup('ALL')).toEqual([]);
  });

  it('กลุ่มเงินครอบคลุมการเบิกจ่ายและการเปลี่ยนสถานะ', () => {
    expect(actionsInGroup('MONEY')).toContain('procurement.disburse');
    expect(actionsInGroup('MONEY')).toContain('procurement.disburse_void');
    expect(actionsInGroup('MONEY')).toContain('procurement.status_change');
  });

  it('กลุ่มสิทธิ์ครอบคลุมการเปลี่ยนบทบาทและการเข้าระบบ', () => {
    expect(actionsInGroup('SECURITY')).toContain('user.roles_change');
    expect(actionsInGroup('SECURITY')).toContain('auth.login_failed');
  });

  /* ไม่มี action ใดอยู่สองกลุ่ม มิฉะนั้นการกรองจะนับซ้ำและตีความยาก */
  it('ไม่มี action ใดอยู่มากกว่าหนึ่งกลุ่ม', () => {
    const seen = new Set<string>();

    for (const group of AUDIT_GROUPS) {
      for (const action of actionsInGroup(group)) {
        expect(seen.has(action), `${action} อยู่หลายกลุ่ม`).toBe(false);
        seen.add(action);
      }
    }
  });
});

describe('summarizeChanges', () => {
  it('บอกว่าช่องไหนเปลี่ยนจากอะไรเป็นอะไร', () => {
    expect(summarizeChanges({ amount: 100, note: 'เดิม' }, { amount: 250, note: 'เดิม' })).toEqual([
      { field: 'amount', before: '100', after: '250' },
    ]);
  });

  /* การเพิ่มหรือลบช่องเป็นการเปลี่ยนแปลงที่ผู้ตรวจสอบต้องเห็น ไม่ใช่สิ่งที่ละไว้ได้ */
  it('ช่องที่มีอยู่ฝั่งเดียวก็ถือว่าเปลี่ยน', () => {
    expect(summarizeChanges({}, { isActive: false })).toEqual([
      { field: 'isActive', before: null, after: 'false' },
    ]);

    expect(summarizeChanges({ note: 'มี' }, {})).toEqual([
      { field: 'note', before: 'มี', after: null },
    ]);
  });

  it('เรียงตามชื่อช่องเพื่อให้ผลลัพธ์เหมือนเดิมทุกครั้ง', () => {
    const changes = summarizeChanges({ zeta: 1, alpha: 1 }, { zeta: 2, alpha: 2 });

    expect(changes.map((change) => change.field)).toEqual(['alpha', 'zeta']);
  });

  it('ค่าซ้อนแสดงเป็น JSON ย่อ ไม่ไล่ลงไปทีละชั้น', () => {
    const changes = summarizeChanges({ roles: ['A'] }, { roles: ['A', 'B'] });

    expect(changes).toEqual([{ field: 'roles', before: '["A"]', after: '["A","B"]' }]);
  });

  it('ไม่มีอะไรเปลี่ยนก็คืนรายการว่าง', () => {
    expect(summarizeChanges({ a: 1 }, { a: 1 })).toEqual([]);
    expect(summarizeChanges(null, null)).toEqual([]);
  });

  /* ค่ายาวมากทำให้ตารางล้นจนอ่านรายการอื่นไม่ได้ */
  it('ตัดค่าที่ยาวเกินไป', () => {
    const long = 'ก'.repeat(500);
    const [change] = summarizeChanges({}, { note: long });

    expect(change?.after?.length).toBe(200);
  });
});

describe('ตัวกรองจาก query string', () => {
  it('ค่าว่างได้ค่าเริ่มต้นที่ดูทั้งหมด', () => {
    const filter = parseAuditFilter({});

    expect(filter.group).toBe('ALL');
    expect(hasActiveFilter(filter)).toBe(false);
  });

  /*
   * ค่าที่ผิดรูปแบบถูกปัดทิ้ง ไม่ทำให้ทั้งหน้าล้ม
   *
   * ผู้ตรวจสอบที่แก้ URL เองแล้วเจอหน้า error จะไม่รู้ว่าต้องแก้อะไร
   * ส่วนการเห็นรายการทั้งหมดเป็นสถานะที่เข้าใจได้และแก้ต่อได้จากหน้าจอ
   */
  it('กลุ่มที่ไม่รู้จักกลายเป็น ALL แทนที่จะพัง', () => {
    expect(parseAuditFilter({ group: 'ไม่มีกลุ่มนี้' }).group).toBe('ALL');
  });

  it('ผู้กระทำที่ไม่ใช่ uuid ถูกปัดทิ้ง', () => {
    expect(parseAuditFilter({ actorId: 'not-a-uuid' }).actorId).toBeUndefined();
  });

  it('วันที่ผิดรูปแบบถูกปัดทิ้ง', () => {
    expect(parseAuditFilter({ from: '31/12/2569' }).from).toBeUndefined();
  });

  it('รับค่าที่ถูกต้องครบทุกช่อง', () => {
    const filter = parseAuditFilter({
      group: 'MONEY',
      actorId: '00000000-0000-4000-8000-000000000001',
      entityType: 'procurement',
      from: '2026-01-01',
      to: '2026-01-31',
    });

    expect(filter.group).toBe('MONEY');
    expect(filter.entityType).toBe('procurement');
    expect(hasActiveFilter(filter)).toBe(true);
  });

  /* searchParams ของ Next.js ให้ array ได้เมื่อคีย์ซ้ำใน URL */
  it('คีย์ที่ซ้ำใน URL ใช้ค่าแรก', () => {
    expect(parseAuditFilter({ group: ['MONEY', 'DATA'] }).group).toBe('MONEY');
  });

  it('cursor อย่างเดียวไม่ถือว่ากำลังกรอง', () => {
    expect(hasActiveFilter(parseAuditFilter({ before: '2026-01-01T00:00:00Z' }))).toBe(false);
  });
});

describe('หน้า audit log อ่านอย่างเดียว', () => {
  /*
   * ตาราง audit_events เป็น append-only ทั้ง policy และ table privilege
   * (FR-AUD-002) ถ้าหน้านี้มีทางเขียน จะขัดกับเหตุผลทั้งหมดของการมีตารางนี้
   */
  it('repository ไม่มีคำสั่งเขียนใด ๆ', () => {
    const source = readFileSync('src/server/audit/repository.ts', 'utf8');

    expect(source).not.toMatch(/\.insert\(/);
    expect(source).not.toMatch(/\.update\(/);
    expect(source).not.toMatch(/\.delete\(/);
    expect(source).not.toMatch(/\.upsert\(/);
  });

  /*
   * ไม่ดึง ip_hash และ user_agent มาแสดง
   *
   * ทั้งคู่มีไว้สืบสวนเหตุผิดปกติเป็นรายกรณี การดึงมาในหน้าที่เปิดดูทุกวัน
   * ทำให้ข้อมูลอยู่ใน payload ของหน้าโดยไม่จำเป็น (ข้อ 14.2)
   */
  it('ไม่ดึง ip_hash และ user_agent มาที่หน้าจอ', () => {
    const source = readFileSync('src/server/audit/repository.ts', 'utf8');
    const columns = source.slice(source.indexOf('const COLUMNS'), source.indexOf('function toRow'));

    expect(columns).not.toContain('ip_hash');
    expect(columns).not.toContain('user_agent');
  });

  it('หน้าเรียก requirePermissionForPage ด้วยสิทธิ์ audit.read', () => {
    const source = readFileSync('src/app/(dashboard)/admin/audit-log/page.tsx', 'utf8');

    expect(source).toContain("requirePermissionForPage('/admin/audit-log', 'audit.read')");
  });
});
