import { describe, expect, it } from 'vitest';
import {
  REQUIRED_PUBLIC_ENV_VARS,
  findInvalidPublicEnvVars,
  publicEnvSchema,
  urlField,
} from '@/lib/env/required';

/**
 * เดิม env schema ใช้ z.url() ตรง ๆ ซึ่งปฏิเสธค่าที่ไม่มี scheme
 *
 * ปัญหาคือ Vercel และ Supabase แสดง URL ในหน้า dashboard โดยไม่มี scheme
 * (เช่น "abc.vercel.app") คนที่คัดลอกมาวางจึงได้หน้า error ทั้งที่เจตนาชัดเจน
 * และข้อความ error ก็ไม่ได้บอกว่าผิดตรงไหน
 *
 * test นี้ตรวจ urlField ตัวจริงที่ทั้ง server, client และ proxy ใช้ร่วมกัน
 * ไม่ใช่สำเนา เพื่อให้การแก้กติกาที่ใดที่หนึ่งไม่หลุดสายตา test
 */
describe('การ normalize URL ใน environment variables', () => {
  it('เติม https:// ให้ค่าที่คัดลอกมาจาก dashboard โดยไม่มี scheme', () => {
    expect(urlField.parse('abcdefgh.supabase.co')).toBe('https://abcdefgh.supabase.co');
    expect(urlField.parse('my-app.vercel.app')).toBe('https://my-app.vercel.app');
  });

  it('ไม่แตะค่าที่มี scheme อยู่แล้ว', () => {
    expect(urlField.parse('https://abcdefgh.supabase.co')).toBe('https://abcdefgh.supabase.co');
    expect(urlField.parse('http://localhost:3000')).toBe('http://localhost:3000');
    expect(urlField.parse('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321');
  });

  it('ตัดช่องว่างและ slash ท้ายที่มักติดมาตอนคัดลอก', () => {
    expect(urlField.parse('  https://abc.supabase.co/  ')).toBe('https://abc.supabase.co');
    expect(urlField.parse('abc.vercel.app///')).toBe('https://abc.vercel.app');
  });

  it('ยังปฏิเสธค่าที่ไม่ใช่ URL จริง ๆ', () => {
    for (const invalid of ['', '   ', 'ไม่ใช่ url เลย', 'มี ช่องว่าง.com']) {
      expect(urlField.safeParse(invalid).success).toBe(false);
    }
  });

  it('ปฏิเสธค่าที่กรอกมาแค่ scheme', () => {
    // ตัด "/" ท้ายก่อนเติม scheme จะได้ "https://https:" ซึ่งนับเป็น URL ถูกต้อง
    // ทั้งที่ผู้ดูแลยังกรอกไม่เสร็จ ลำดับใน urlField จึงต้องเติม scheme ก่อนตัด
    for (const invalid of ['https://', 'https:///', 'http://']) {
      expect(urlField.safeParse(invalid).success).toBe(false);
    }
  });
});

describe('findInvalidPublicEnvVars', () => {
  const complete: Record<string, string> = {
    NEXT_PUBLIC_APP_URL: 'https://example.com',
    NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  };

  const read =
    (values: Record<string, string | undefined>) =>
    (name: string): string | undefined =>
      values[name];

  it('ไม่พบอะไรเมื่อตั้งค่าครบและถูกต้อง', () => {
    expect(findInvalidPublicEnvVars(read(complete))).toEqual([]);
  });

  it('ยอมรับค่าที่ไม่มี scheme เหมือนกับที่หน้าเว็บยอมรับ', () => {
    expect(
      findInvalidPublicEnvVars(read({ ...complete, NEXT_PUBLIC_SUPABASE_URL: 'abc.supabase.co' })),
    ).toEqual([]);
  });

  it('รายงานตัวที่ขาด', () => {
    const partial = { ...complete };
    delete partial.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(findInvalidPublicEnvVars(read(partial))).toEqual(['NEXT_PUBLIC_SUPABASE_ANON_KEY']);
  });

  it('รายงานตัวที่ตั้งไว้แล้วแต่ค่าใช้ไม่ได้', () => {
    // กรณีที่เคยหลุดไปเป็นหน้า "เกิดข้อผิดพลาดในระบบ" พร้อมรหัสอ้างอิงเท่านั้น
    expect(
      findInvalidPublicEnvVars(read({ ...complete, NEXT_PUBLIC_APP_URL: 'ไม่ใช่ url' })),
    ).toEqual(['NEXT_PUBLIC_APP_URL']);
    expect(
      findInvalidPublicEnvVars(read({ ...complete, NEXT_PUBLIC_SUPABASE_URL: 'https://' })),
    ).toEqual(['NEXT_PUBLIC_SUPABASE_URL']);
  });

  it('ถือค่าว่างและช่องว่างล้วนเท่ากับไม่ได้ตั้ง', () => {
    // Vercel ยอมให้บันทึกตัวแปรที่มีค่าว่างได้ ซึ่งใช้งานไม่ได้จริง
    expect(findInvalidPublicEnvVars(() => '')).toHaveLength(REQUIRED_PUBLIC_ENV_VARS.length);
    expect(findInvalidPublicEnvVars(() => '   ')).toHaveLength(REQUIRED_PUBLIC_ENV_VARS.length);
  });

  it('รายงานทุกตัวเมื่อไม่ได้ตั้งอะไรเลย', () => {
    expect(findInvalidPublicEnvVars(() => undefined)).toEqual(
      REQUIRED_PUBLIC_ENV_VARS.map((v) => v.name),
    );
  });

  it('เรียงตามลำดับในรายการเสมอ ไม่ใช่ตามลำดับที่ zod รายงาน', () => {
    expect(
      findInvalidPublicEnvVars(
        read({ NEXT_PUBLIC_SUPABASE_ANON_KEY: '', NEXT_PUBLIC_APP_URL: '' }),
      ),
    ).toEqual(['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']);
  });

  it('ไม่ทำให้ค่าหลุดออกมาทางผลลัพธ์', () => {
    // ผลลัพธ์ถูกนำไป log และแสดงบนหน้าจอ จึงต้องมีแต่ชื่อตัวแปรเท่านั้น
    const secretish = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret ที่ไม่ใช่ url';
    const result = findInvalidPublicEnvVars(read({ ...complete, NEXT_PUBLIC_APP_URL: secretish }));
    expect(result.join(' ')).not.toContain(secretish);
    expect(result).toEqual(['NEXT_PUBLIC_APP_URL']);
  });
});

describe('รายการตัวแปรที่บังคับ', () => {
  it('ทุกตัวมีคำแนะนำภาษาไทยกำกับ', () => {
    for (const variable of REQUIRED_PUBLIC_ENV_VARS) {
      expect(variable.hintTh.trim().length).toBeGreaterThan(0);
    }
  });

  it('บังคับเฉพาะตัวที่ขาดแล้วระบบทำงานไม่ได้', () => {
    const names = REQUIRED_PUBLIC_ENV_VARS.map((v) => v.name);
    expect(names).toEqual([
      'NEXT_PUBLIC_APP_URL',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ]);
    // ตัวที่มี default หรือยังไม่มีฟีเจอร์ที่ใช้ ต้องไม่ถูกบังคับ
    for (const optional of [
      'SUPABASE_SERVICE_ROLE_KEY',
      'SENTRY_DSN',
      'APP_TIMEZONE',
      'APP_COMMIT_SHA',
    ]) {
      expect(names).not.toContain(optional);
    }
  });

  it('รายการกับ schema ต้องตรงกัน', () => {
    // ถ้าเพิ่มตัวแปรใน schema แต่ลืมใส่ในรายการ proxy จะไม่ตรวจตัวนั้น
    expect(Object.keys(publicEnvSchema.shape).sort()).toEqual(
      REQUIRED_PUBLIC_ENV_VARS.map((v) => v.name).sort(),
    );
  });

  it('ทุกตัวที่บังคับมีอยู่ใน .env.example', async () => {
    const { readFileSync } = await import('node:fs');
    const example = readFileSync('.env.example', 'utf8');
    for (const variable of REQUIRED_PUBLIC_ENV_VARS) {
      expect(example).toContain(variable.name);
    }
  });
});
