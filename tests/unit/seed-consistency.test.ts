import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES } from '@/domain/auth/permissions';
import type { PermissionCode, RoleCode } from '@/domain/auth/permissions';

/**
 * ตาราง permissions/roles ในฐานข้อมูลต้องตรงกับที่ประกาศไว้ในโค้ดเสมอ
 * ถ้าหลุดจากกัน RLS จะอนุญาต/ปฏิเสธไม่ตรงกับที่ domain service คาดหวัง
 * test นี้จับความไม่ตรงกันตั้งแต่ CI โดยไม่ต้องยกฐานข้อมูลขึ้นมา
 */
const seedSql = readFileSync(join(process.cwd(), 'supabase', 'seed.sql'), 'utf8');

function seededPermissionCodes(): Set<string> {
  const block = seedSql.slice(
    seedSql.indexOf('insert into public.permissions'),
    seedSql.indexOf('on conflict (code) do update set description_th'),
  );
  return new Set([...block.matchAll(/\('([a-z_.]+)',\s*'/g)].map((match) => match[1] as string));
}

function seededRoleCodes(): Set<string> {
  const block = seedSql.slice(
    seedSql.indexOf('insert into public.roles'),
    seedSql.indexOf('on conflict (code) do update set name_th'),
  );
  return new Set([...block.matchAll(/\('([A-Z_]+)',/g)].map((match) => match[1] as string));
}

function seededRolePermissionPairs(): Set<string> {
  const start = seedSql.indexOf(
    'insert into public.role_permissions (role_code, permission_code) values',
  );
  const block = seedSql.slice(start);
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

describe('supabase/seed.sql สอดคล้องกับ src/domain/auth/permissions.ts', () => {
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

  it('seed ไม่มีข้อมูลจริงของโรงเรียนหรือรหัสผ่าน (ข้อ 14.2)', () => {
    expect(seedSql).not.toMatch(/password/i);
    expect(seedSql).not.toMatch(/service_role/i);
  });
});
