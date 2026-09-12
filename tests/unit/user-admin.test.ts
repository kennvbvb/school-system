import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCKOUT_GUARD_PERMISSION, checkSetActive, checkSetRoles } from '@/domain/auth/user-admin';
import { PERMISSIONS } from '@/domain/auth/permissions';
import { userActiveSchema, userInviteSchema, userRolesSchema } from '@/domain/auth/user-schemas';

/**
 * กฎกันการล็อกทุกคนออกจากระบบอยู่สองที่โดยจำเป็น
 *
 *   - ที่นี่ — ให้หน้าจอบอกผู้ดูแลล่วงหน้าว่าทำไม่ได้
 *   - `user_set_roles()` / `user_set_active()` ใน migration 0018 — เป็นผู้บังคับจริง
 *
 * ถ้าสองที่ไม่ตรงกัน จะเกิดกรณีที่หน้าจอยอมแล้ว server ปฏิเสธ หรือแย่กว่านั้นคือ
 * หน้าจอยอมและ server ยอมด้วย แล้วไม่มีใครแก้สิทธิ์ได้อีกเลย
 */
const MIGRATION = 'supabase/migrations/20260912000100_user_administration.sql';

const subject = (over: Partial<Parameters<typeof checkSetRoles>[0]['target']> = {}) => ({
  id: over.id ?? 'user-1',
  isActive: over.isActive ?? true,
  roleCodes: over.roleCodes ?? ['SYSTEM_ADMIN'],
});

describe('checkSetActive', () => {
  it('ปิดบัญชีตัวเองไม่ได้ แม้จะมีผู้ดูแลคนอื่นเหลืออยู่', () => {
    expect(
      checkSetActive({
        actorId: 'user-1',
        target: subject({ id: 'user-1' }),
        nextActive: false,
        targetManagesUsers: true,
        remainingManagers: 5,
      }),
    ).toBe('CANNOT_DEACTIVATE_SELF');
  });

  it('ปิดบัญชีผู้ดูแลคนสุดท้ายไม่ได้', () => {
    expect(
      checkSetActive({
        actorId: 'user-2',
        target: subject({ id: 'user-1' }),
        nextActive: false,
        targetManagesUsers: true,
        remainingManagers: 0,
      }),
    ).toBe('LAST_USER_MANAGER');
  });

  it('ปิดบัญชีผู้ดูแลได้เมื่อยังเหลืออีกคน', () => {
    expect(
      checkSetActive({
        actorId: 'user-2',
        target: subject({ id: 'user-1' }),
        nextActive: false,
        targetManagesUsers: true,
        remainingManagers: 1,
      }),
    ).toBeNull();
  });

  /* เปิดบัญชีคืนไม่เคยทำให้ระบบไม่มีผู้ดูแล จึงไม่ต้องตรวจอะไร */
  it('เปิดบัญชีคืนทำได้เสมอ', () => {
    expect(
      checkSetActive({
        actorId: 'user-1',
        target: subject({ id: 'user-1', isActive: false }),
        nextActive: true,
        targetManagesUsers: true,
        remainingManagers: 0,
      }),
    ).toBeNull();
  });
});

describe('checkSetRoles', () => {
  const knownRoles = ['SYSTEM_ADMIN', 'REQUESTER', 'APPROVER'];

  it('ต้องมีอย่างน้อยหนึ่งบทบาท', () => {
    expect(
      checkSetRoles({
        target: subject(),
        nextRoles: [],
        knownRoles,
        nextRolesManageUsers: false,
        targetManagesUsers: true,
        remainingManagers: 5,
      }),
    ).toBe('NO_ROLE_ASSIGNED');
  });

  it('ปฏิเสธบทบาทที่ระบบไม่รู้จัก', () => {
    expect(
      checkSetRoles({
        target: subject(),
        nextRoles: ['NOT_A_ROLE'],
        knownRoles,
        nextRolesManageUsers: false,
        targetManagesUsers: false,
        remainingManagers: 5,
      }),
    ).toBe('UNKNOWN_ROLE');
  });

  it('ถอดสิทธิ์จัดการผู้ใช้จากคนสุดท้ายไม่ได้', () => {
    expect(
      checkSetRoles({
        target: subject(),
        nextRoles: ['REQUESTER'],
        knownRoles,
        nextRolesManageUsers: false,
        targetManagesUsers: true,
        remainingManagers: 0,
      }),
    ).toBe('LAST_USER_MANAGER');
  });

  it('ถอดสิทธิ์ได้เมื่อยังเหลือผู้ดูแลคนอื่น', () => {
    expect(
      checkSetRoles({
        target: subject(),
        nextRoles: ['REQUESTER'],
        knownRoles,
        nextRolesManageUsers: false,
        targetManagesUsers: true,
        remainingManagers: 1,
      }),
    ).toBeNull();
  });

  /*
   * ผู้ดูแลคนสุดท้ายที่ยังถือสิทธิ์อยู่หลังแก้เสร็จ ไม่ได้ทำให้ระบบเสี่ยงอะไร
   * กฎนี้ห้ามเฉพาะ "กำลังจะเสียสิทธิ์" ไม่ใช่ห้ามแก้บทบาทของผู้ดูแลคนสุดท้ายเลย
   */
  it('ผู้ดูแลคนสุดท้ายยังเพิ่มบทบาทอื่นให้ตัวเองได้', () => {
    expect(
      checkSetRoles({
        target: subject(),
        nextRoles: ['SYSTEM_ADMIN', 'APPROVER'],
        knownRoles,
        nextRolesManageUsers: true,
        targetManagesUsers: true,
        remainingManagers: 0,
      }),
    ).toBeNull();
  });
});

describe('schema ของการจัดการผู้ใช้', () => {
  const base = {
    email: 'Someone@Example.Test',
    firstNameTh: 'ทดสอบ',
    lastNameTh: 'ผู้ใช้',
    roleCodes: ['REQUESTER'],
  };

  it('ลดอีเมลเป็นตัวพิมพ์เล็ก ตรงกับ constraint ของฐานข้อมูล', () => {
    const parsed = userInviteSchema.parse(base);
    expect(parsed.email).toBe('someone@example.test');
  });

  it('ยุบบทบาทที่ส่งซ้ำมา', () => {
    const parsed = userRolesSchema.parse({
      userId: '00000000-0000-4000-8000-000000000001',
      roleCodes: ['REQUESTER', 'REQUESTER', 'APPROVER'],
    });

    expect(parsed.roleCodes).toEqual(['REQUESTER', 'APPROVER']);
  });

  it('ปฏิเสธชุดบทบาทที่ว่าง', () => {
    expect(userInviteSchema.safeParse({ ...base, roleCodes: [] }).success).toBe(false);
  });

  it('ปฏิเสธอีเมลที่รูปแบบผิด', () => {
    expect(userInviteSchema.safeParse({ ...base, email: 'ไม่ใช่อีเมล' }).success).toBe(false);
  });

  it('ช่องที่ไม่บังคับรับค่าว่างจากฟอร์ม HTML ได้', () => {
    const parsed = userInviteSchema.parse({ ...base, titleTh: '', employeeCode: '' });

    expect(parsed.titleTh).toBeUndefined();
    expect(parsed.employeeCode).toBeUndefined();
  });

  it('สถานะบัญชีรับเฉพาะ boolean', () => {
    expect(
      userActiveSchema.safeParse({
        userId: '00000000-0000-4000-8000-000000000001',
        isActive: 'true',
      }).success,
    ).toBe(false);
  });

  /*
   * ข้อที่สำคัญที่สุดของ schema ชุดนี้
   *
   * ระบบไม่รับรหัสผ่านเลย — ถ้ามีใครเพิ่มช่องรหัสผ่านเข้ามาภายหลัง จะมีรหัสผ่าน
   * ไหลผ่าน server action และมีโอกาสหลุดลง log ซึ่งข้อ 14.2 ห้ามไว้
   */
  it('ไม่มีช่องที่เกี่ยวกับรหัสผ่านในทุก schema', () => {
    const source = readFileSync('src/domain/auth/user-schemas.ts', 'utf8');

    expect(source).not.toMatch(/password/i);
    expect(source).not.toMatch(/รหัสผ่าน[^ๆ]{0,4}:/);
  });
});

/*
 * ตัดคอมเมนต์ `--` ออกก่อนเทียบ
 *
 * ไฟล์ migration นี้มีคอมเมนต์ภาษาไทยอธิบายกฎอยู่มาก ถ้าเทียบกับข้อความดิบ
 * การ "ปิดโค้ดทิ้งไว้เป็นคอมเมนต์" จะยังทำให้ assertion ผ่าน ซึ่งเป็นการทดสอบที่
 * จับ regression ไม่ได้จริง
 */
const strippedSql = (source: string): string =>
  source
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

const functionBody = (source: string, name: string): string => {
  const start = source.indexOf(`create or replace function public.${name}`);
  expect(start, `ไม่พบฟังก์ชัน ${name} ใน migration`).toBeGreaterThan(-1);

  return strippedSql(source.slice(start, source.indexOf('$$;', start)));
};

describe('กฎกันล็อกตัวเองออกตรงกันระหว่างโดเมนกับฐานข้อมูล', () => {
  const sql = strippedSql(readFileSync(MIGRATION, 'utf8'));

  /*
   * ทั้งสองฝั่งต้องดูจาก **สิทธิ์** ไม่ใช่ชื่อบทบาท
   *
   * บทบาทเป็นข้อมูลที่ผู้ดูแลแก้ได้ผ่าน role_permissions ถ้าฝั่งใดผูกกฎไว้กับชื่อ
   * 'SYSTEM_ADMIN' การย้ายสิทธิ์ไปบทบาทอื่นจะทำให้กฎนั้นเฝ้าของที่ไม่สำคัญแล้ว
   */
  it('SQL ตรวจจากสิทธิ์ users.manage ไม่ใช่ชื่อบทบาท', () => {
    expect(sql).toContain("permission_code = 'users.manage'");
    expect(sql).not.toContain("role_code = 'SYSTEM_ADMIN'");
  });

  it('โดเมนใช้สิทธิ์ตัวเดียวกัน', () => {
    expect(LOCKOUT_GUARD_PERMISSION).toBe('users.manage');
    expect(PERMISSIONS).toContain(LOCKOUT_GUARD_PERMISSION);
  });

  it('SQL นับเฉพาะผู้ดูแลที่บัญชียังเปิดอยู่ และไม่นับคนที่กำลังถูกแก้', () => {
    const body = functionBody(readFileSync(MIGRATION, 'utf8'), 'other_active_user_managers');

    expect(body).toMatch(/where\s+p\.is_active/);
    expect(body).toMatch(/and\s+p\.id\s*<>\s*p_excluding/);
    expect(body).toMatch(/rp\.permission_code\s*=\s*'users\.manage'/);
  });

  it('ทั้งสองฟังก์ชันที่เปลี่ยนสิทธิ์ตรวจ users.manage ก่อนเสมอ', () => {
    const source = readFileSync(MIGRATION, 'utf8');

    for (const fn of ['user_set_roles', 'user_set_active']) {
      const body = functionBody(source, fn);

      expect(body, `${fn} ไม่ได้ตรวจสิทธิ์`).toContain("has_permission('users.manage')");
    }
  });
});
