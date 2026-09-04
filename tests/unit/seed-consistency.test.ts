import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES } from '@/domain/auth/permissions';
import type { PermissionCode, RoleCode } from '@/domain/auth/permissions';

/**
 * ตาราง permissions/roles ในฐานข้อมูลต้องตรงกับที่ประกาศไว้ในโค้ดเสมอ
 * ถ้าหลุดจากกัน RLS จะอนุญาต/ปฏิเสธไม่ตรงกับที่ domain service คาดหวัง
 * test นี้จับความไม่ตรงกันตั้งแต่ CI โดยไม่ต้องยกฐานข้อมูลขึ้นมา
 *
 * seed แบ่งเป็นสองไฟล์ที่มีหน้าที่ต่างกันชัดเจน:
 *   seed-reference.sql = ข้อมูลบังคับที่ผูกกับโค้ด รันทุก environment
 *   seed-sample.sql    = ข้อมูลสมมติ รันเฉพาะ local/preview
 * test ด้านล่างตรวจทั้งความสอดคล้องกับโค้ด และตรวจว่าสองไฟล์ไม่ปะปนกัน
 */
const readSeed = (file: string): string =>
  readFileSync(join(process.cwd(), 'supabase', file), 'utf8');

const referenceSql = readSeed('seed-reference.sql');
const sampleSql = readSeed('seed-sample.sql');

/**
 * ตัดบรรทัดคอมเมนต์ออกก่อนวิเคราะห์โครงสร้าง SQL
 * มิฉะนั้นคำอธิบายที่พูดถึงคำสั่ง SQL จะถูกนับเป็นคำสั่งจริง
 */
const sqlOnly = (sql: string): string =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

function seededPermissionCodes(): Set<string> {
  const block = referenceSql.slice(
    referenceSql.indexOf('insert into public.permissions'),
    referenceSql.indexOf('on conflict (code) do update set description_th'),
  );
  return new Set([...block.matchAll(/\('([a-z_.]+)',\s*'/g)].map((match) => match[1] as string));
}

function seededRoleCodes(): Set<string> {
  const block = referenceSql.slice(
    referenceSql.indexOf('insert into public.roles'),
    referenceSql.indexOf('on conflict (code) do update set name_th'),
  );
  return new Set([...block.matchAll(/\('([A-Z_]+)',/g)].map((match) => match[1] as string));
}

function seededRolePermissionPairs(): Set<string> {
  const start = referenceSql.indexOf(
    'insert into public.role_permissions (role_code, permission_code) values',
  );
  const block = referenceSql.slice(start);
  const pairs = new Set<string>();

  for (const match of block.matchAll(/\('([A-Z_]+)',\s*'([a-z_.]+)'\)/g)) {
    pairs.add(`${match[1]}:${match[2]}`);
  }

  // SYSTEM_ADMIN ถูก seed ด้วย select ทุกสิทธิ์ ไม่ได้เขียนเป็นคู่ตรง ๆ
  for (const permission of PERMISSIONS) {
    pairs.add(`SYSTEM_ADMIN:${permission}`);
  }

  return pairs;
}

describe('supabase/seed-reference.sql สอดคล้องกับ src/domain/auth/permissions.ts', () => {
  it('รหัสสิทธิ์ตรงกันทั้งสองฝั่ง', () => {
    expect([...seededPermissionCodes()].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('รหัสบทบาทตรงกันทั้งสองฝั่ง', () => {
    expect([...seededRoleCodes()].sort()).toEqual([...ROLES].sort());
  });

  it('การผูกบทบาทกับสิทธิ์ตรงกันทั้งสองฝั่ง', () => {
    const seeded = seededRolePermissionPairs();
    const expected = new Set<string>();

    for (const role of ROLES) {
      for (const permission of DEFAULT_ROLE_PERMISSIONS[
        role as RoleCode
      ] as readonly PermissionCode[]) {
        expected.add(`${role}:${permission}`);
      }
    }

    expect([...seeded].sort()).toEqual([...expected].sort());
  });
});

describe('การแบ่งหน้าที่ระหว่างไฟล์ seed ทั้งสอง', () => {
  /**
   * ไฟล์ reference ถูกรันบน Production ด้วย จึงต้องไม่มีข้อมูลสมมติปนเข้าไป
   * ถ้ามีใครเผลอเพิ่มหน่วยงานตัวอย่างลงไฟล์นี้ หน่วยงานสมมติจะโผล่ในระบบจริง
   */
  it('ไฟล์ reference ไม่มีข้อมูลสมมติปนอยู่', () => {
    const sql = sqlOnly(referenceSql);
    // เทียบกับ "(ตัวอย่าง)" ที่มีวงเล็บ ซึ่งเป็นธรรมเนียมกำกับข้อมูลสมมติของโครงการ
    // ไม่ใช่คำว่า "ตัวอย่าง" ลอย ๆ เพราะเป็นคำที่ใช้ในคำอธิบายสิทธิ์ตามปกติ
    // เช่น documents.preview มีคำอธิบายว่า "ดูตัวอย่างเอกสาร"
    expect(sql).not.toMatch(/\(ตัวอย่าง\)/);
    expect(sql).not.toMatch(/insert into public\.departments/);
    expect(sql).not.toMatch(/insert into public\.positions/);
  });

  /**
   * ตรงกันข้าม ไฟล์ sample ต้องไม่แตะตารางที่เป็นข้อมูลอ้างอิงของระบบ
   * มิฉะนั้นการข้ามไฟล์นี้บน Production จะทำให้ได้สิทธิ์ไม่ครบโดยไม่รู้ตัว
   */
  it('ไฟล์ sample ไม่แตะตารางสิทธิ์และบทบาท', () => {
    const sql = sqlOnly(sampleSql);
    for (const table of ['permissions', 'roles', 'role_permissions'] as const) {
      expect(sql).not.toMatch(new RegExp(`insert into public\\.${table}\\b`));
    }
  });

  it('ข้อมูลสมมติทุกแถวกำกับด้วยคำว่า "(ตัวอย่าง)" ให้เห็นชัด', () => {
    const rows = [...sqlOnly(sampleSql).matchAll(/\('[A-Z_]+',\s*'([^']+)'/g)].map(
      (match) => match[1] as string,
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const name of rows) {
      expect(name).toContain('(ตัวอย่าง)');
    }
  });

  it('ทั้งสองไฟล์รันซ้ำได้โดยไม่พัง (มี on conflict ทุกคำสั่ง insert)', () => {
    for (const raw of [referenceSql, sampleSql]) {
      const sql = sqlOnly(raw);
      const inserts = (sql.match(/insert into public\./g) ?? []).length;
      const guards = (sql.match(/on conflict/g) ?? []).length;
      expect(inserts).toBeGreaterThan(0);
      expect(guards).toBe(inserts);
    }
  });

  it('ไม่มีไฟล์ใดเก็บรหัสผ่านหรือ secret (ข้อ 14.2)', () => {
    for (const sql of [referenceSql, sampleSql]) {
      expect(sql).not.toMatch(/password/i);
      expect(sql).not.toMatch(/service_role/i);
    }
  });
});
