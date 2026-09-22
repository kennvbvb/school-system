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

test('หน้าข้อมูลพื้นฐานและบัญชีงบถูกกันไว้และจำปลายทางเดิม', async ({ page }) => {
  /*
   * หน้าเหล่านี้เปลี่ยนวงเงินและกติกาของทั้งระบบ (ปีงบประมาณ โครงการ บัญชีงบ)
   * จึงต้องกันไว้ก่อนเข้าสู่ระบบเสมอ และต้องจำปลายทางเดิมไว้เพื่อไม่ให้ผู้ใช้
   * ต้องไล่หาหน้าเดิมใหม่หลังเข้าสู่ระบบ
   */
  await page.goto('/admin/master-data');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin%2Fmaster-data$/);

  await page.goto('/admin/master-data/fiscal-years');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin%2Fmaster-data%2Ffiscal-years$/);

  await page.goto('/budget/accounts');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fbudget%2Faccounts$/);
});

test('กล่องงานรออนุมัติถูกกันไว้และจำปลายทางเดิม', async ({ page }) => {
  /*
   * กล่องงานแสดงรายการที่รออนุมัติทั้งโรงเรียนพร้อมยอดเงิน จึงต้องกันไว้
   * ก่อนเข้าสู่ระบบเสมอ เช่นเดียวกับหน้ารายการจัดซื้อ
   */
  await page.goto('/approvals/inbox');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fapprovals%2Finbox$/);
});

test('หน้าทะเบียนผู้ขายถูกกันไว้และจำปลายทางเดิม', async ({ page }) => {
  /*
   * ตารางผู้ขายมีเลขประจำตัวผู้เสียภาษี ที่อยู่ และเบอร์โทรของนิติบุคคลจริง
   * จึงต้องกันไว้ก่อนเข้าสู่ระบบเสมอ รวมถึงหน้าแก้ไขรายตัวซึ่งเป็น dynamic route
   * — route แบบ [id] มักถูกลืมเมื่อเพิ่ม matcher ของ proxy
   */
  await page.goto('/admin/master-data/vendors');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin%2Fmaster-data%2Fvendors$/);

  await page.goto('/admin/master-data/vendors/00000000-0000-4000-8000-000000000001');
  await expect(page).toHaveURL(
    /\/login\?returnTo=%2Fadmin%2Fmaster-data%2Fvendors%2F00000000-0000-4000-8000-000000000001$/,
  );
});

test('หน้าจัดการผู้ใช้และสิทธิ์ถูกกันไว้และจำปลายทางเดิม', async ({ page }) => {
  /*
   * หน้านี้แสดงอีเมลและตำแหน่งของบุคลากรทุกคน และเปลี่ยนสิทธิ์ของทั้งระบบได้
   * เป็นหน้าที่ผู้ไม่หวังดีอยากเข้าถึงที่สุด จึงต้องกันไว้ก่อนเข้าสู่ระบบเสมอ
   */
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin%2Fusers$/);
});

test('หน้า audit log ถูกกันไว้และจำปลายทางเดิม', async ({ page }) => {
  /*
   * audit log แสดงว่าใครทำอะไรกับข้อมูลอะไรบ้างทั้งระบบ รวมถึงชื่อบุคลากร
   * เป็นภาพรวมที่ผู้ไม่หวังดีใช้วางแผนได้ดีที่สุด จึงต้องกันไว้ก่อนเข้าสู่ระบบเสมอ
   */
  await page.goto('/admin/audit-log');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin%2Faudit-log$/);
});

test('หน้ารายงานงบประมาณถูกกันไว้และจำปลายทางเดิม', async ({ page }) => {
  /*
   * รายงานนี้รวมยอดงบทั้งโรงเรียนไว้ในหน้าเดียว รวมถึงบัญชีที่ใช้งบเกิน
   * ซึ่งเป็นข้อมูลที่ต้องกันไว้ก่อนเข้าสู่ระบบเสมอ ไม่ใช่กันด้วยการซ่อนเมนู
   */
  await page.goto('/reports/budget');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Freports%2Fbudget$/);
});

test('ตัวกรองในรายงานงบไม่ทำให้หน้าล้มก่อนตรวจสิทธิ์', async ({ page }) => {
  /*
   * ค่าที่ผิดรูปแบบต้องถูกปัดทิ้งที่ schema ไม่ใช่ทำให้ได้หน้า error
   * ซึ่งจะบอกผู้ไม่มีสิทธิ์ว่ามีหน้านี้อยู่จริงและทำงานถึงชั้นไหนแล้ว
   */
  await page.goto('/reports/budget?fiscalYearId=ไม่ใช่uuid&asOf=31/09/2568&dimension=xxx');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test('หน้าทะเบียนจัดซื้อจัดจ้างถูกกันไว้และจำปลายทางเดิม', async ({ page }) => {
  /*
   * ทะเบียนรวมชื่อเรื่อง ผู้ขาย เลขที่เอกสาร และยอดเงินของทั้งโรงเรียนไว้ในหน้าเดียว
   * เป็นภาพรวมของการใช้จ่ายที่ต้องกันไว้ก่อนเข้าสู่ระบบเสมอ ไม่ใช่กันด้วยการซ่อนเมนู
   */
  await page.goto('/reports/procurements');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Freports%2Fprocurements$/);
});

test('ตัวกรองในทะเบียนไม่ทำให้หน้าล้มก่อนตรวจสิทธิ์', async ({ page }) => {
  /*
   * ค่าที่ผิดรูปแบบต้องถูกปัดทิ้งที่ schema ไม่ใช่ทำให้ได้หน้า error
   * ซึ่งจะบอกผู้ไม่มีสิทธิ์ว่ามีหน้านี้อยู่จริงและทำงานถึงชั้นไหนแล้ว
   */
  await page.goto(
    '/reports/procurements?fiscalYearId=ไม่ใช่uuid&status=xxx&classification=yyy&dateFrom=31/09/2568',
  );
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test('หน้ารายงานสถานะเอกสารถูกกันไว้และจำปลายทางเดิม', async ({ page }) => {
  /*
   * รายงานนี้เปิดโครงสร้างเลขที่เอกสารทั้งโรงเรียน รวมถึงช่วงที่ขาดและเลขที่ซ้ำ
   * ซึ่งเป็นข้อมูลที่ผู้ไม่หวังดีใช้ปลอมเอกสารได้ดีที่สุด จึงต้องกันไว้ก่อนเข้าสู่ระบบเสมอ
   */
  await page.goto('/reports/documents');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Freports%2Fdocuments$/);
});

test('ตัวกรองในรายงานสถานะเอกสารไม่ทำให้หน้าล้มก่อนตรวจสิทธิ์', async ({ page }) => {
  await page.goto(
    '/reports/documents?fiscalYearId=ไม่ใช่uuid&documentKind=xxx&exceptionStatus=ISSUED',
  );
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});
