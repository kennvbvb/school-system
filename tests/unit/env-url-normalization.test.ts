import { describe, expect, it } from 'vitest';
import { REQUIRED_PUBLIC_ENV_VARS, findMissingPublicEnvVars } from '@/lib/env/required';

/**
 * เดิม env schema ใช้ z.url() ตรง ๆ ซึ่งปฏิเสธค่าที่ไม่มี scheme
 *
 * ปัญหาคือ Vercel และ Supabase แสดง URL ในหน้า dashboard โดยไม่มี scheme
 * (เช่น "abc.vercel.app") คนที่คัดลอกมาวางจึงได้หน้า error ทั้งที่เจตนาชัดเจน
 * และข้อความ error ก็ไม่ได้บอกว่าผิดตรงไหน
 *
 * test นี้ยืนยันกติกาการ normalize ซึ่งต้องเหมือนกันทั้งฝั่ง server และ client
 */
import { z } from 'zod';

/** สำเนากติกาเดียวกับใน env/server.ts และ env/client.ts */
const urlField = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (trimmed === '' || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}, z.url());

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
    for (const invalid of ['', '   ', 'ไม่ใช่ url เลย']) {
      expect(urlField.safeParse(invalid).success).toBe(false);
    }
  });
});

describe('findMissingPublicEnvVars', () => {
  const complete: Record<string, string> = {
    NEXT_PUBLIC_APP_URL: 'https://example.com',
    NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  };

  it('ไม่พบอะไรเมื่อตั้งค่าครบ', () => {
    expect(findMissingPublicEnvVars((name) => complete[name])).toEqual([]);
  });

  it('รายงานตัวที่ขาด', () => {
    const partial = { ...complete };
    delete partial.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(findMissingPublicEnvVars((name) => partial[name])).toEqual([
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ]);
  });

  it('ถือค่าว่างและช่องว่างล้วนเท่ากับไม่ได้ตั้ง', () => {
    // Vercel ยอมให้บันทึกตัวแปรที่มีค่าว่างได้ ซึ่งใช้งานไม่ได้จริง
    expect(findMissingPublicEnvVars(() => '')).toHaveLength(REQUIRED_PUBLIC_ENV_VARS.length);
    expect(findMissingPublicEnvVars(() => '   ')).toHaveLength(REQUIRED_PUBLIC_ENV_VARS.length);
  });

  it('รายงานทุกตัวเมื่อไม่ได้ตั้งอะไรเลย', () => {
    expect(findMissingPublicEnvVars(() => undefined)).toEqual(
      REQUIRED_PUBLIC_ENV_VARS.map((v) => v.name),
    );
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

  it('ทุกตัวที่บังคับมีอยู่ใน .env.example', async () => {
    const { readFileSync } = await import('node:fs');
    const example = readFileSync('.env.example', 'utf8');
    for (const variable of REQUIRED_PUBLIC_ENV_VARS) {
      expect(example).toContain(variable.name);
    }
  });
});
