import { expect, test } from '@playwright/test';

/**
 * Smoke test ของ Phase 1
 *
 * ครอบคลุมสิ่งที่ Gate A ต้องเห็น: ไม่มี public sign-up,
 * หน้าที่ต้องเข้าสู่ระบบถูกกันจริง และ health check ตอบโดยไม่รั่วข้อมูล
 *
 * E2E ที่ต้องใช้บัญชีจริง (สร้างคำขอ → ตรวจ → อนุมัติ → ออกเอกสาร) อยู่ใน Phase 3-5
 * และต้องรันบน environment ที่มีข้อมูลสมมติเท่านั้น
 */

test('หน้าเข้าสู่ระบบแสดงผลและไม่มีช่องทางสมัครสมาชิก (FR-AUTH-002)', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'ระบบงานพัสดุและจัดซื้อจัดจ้าง' })).toBeVisible();
  await expect(page.getByLabel('อีเมล')).toBeVisible();
  await expect(page.getByLabel('รหัสผ่าน')).toBeVisible();
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ' })).toBeVisible();

  await expect(page.getByRole('link', { name: /สมัคร|ลงทะเบียน|register|sign ?up/i })).toHaveCount(
    0,
  );
});

test('ผู้ที่ยังไม่เข้าสู่ระบบถูกส่งไปหน้าเข้าสู่ระบบ (ข้อ 4.2)', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test('หน้าผู้ดูแลระบบถูกกันไว้และจำปลายทางเดิม', async ({ page }) => {
  await page.goto('/admin/system');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test('health check ตอบ ok โดยไม่เปิดเผยข้อมูลภายใน (FR-SYS-001)', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);

  const body = (await response.json()) as Record<string, unknown>;
  expect(body.status).toBe('ok');
  // ต้องไม่มีข้อมูลระบบภายในหลุดออกมาใน endpoint ที่เปิดสาธารณะ
  expect(Object.keys(body).sort()).toEqual(['status', 'timestamp']);
});

test('security headers ถูกส่งมาครบ (ข้อ 14.1)', async ({ page }) => {
  const response = await page.goto('/login');
  const headers = response?.headers() ?? {};

  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");

  // เบราว์เซอร์ต้องต่อไปที่ Supabase ได้ ไม่งั้นเข้าสู่ระบบไม่ได้เลย
  // ตรวจว่า connect-src มี origin ที่ตั้งค่าไว้จริง ไม่ใช่ค่าที่ hard-code ไว้
  const supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321')
    .origin;
  expect(headers['content-security-policy']).toContain(`connect-src 'self' ${supabaseOrigin}`);
  // ห้ามประกาศเทคโนโลยีเบื้องหลังโดยไม่จำเป็น
  expect(headers['x-powered-by']).toBeUndefined();
});

test('หน้ารายการจัดซื้อจัดจ้างถูกกันไว้และจำปลายทางเดิม', async ({ page }) => {
  // หน้าเหล่านี้แสดงข้อมูลการเงินของโรงเรียน จึงต้องกันไว้ก่อนเข้าสู่ระบบเสมอ
  await page.goto('/procurements');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fprocurements$/);

  await page.goto('/procurements/new');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fprocurements%2Fnew$/);
});
