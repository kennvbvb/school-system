import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright — smoke test สำหรับ flow หลัก (ข้อ 19.3)
 *
 * ใน CI ให้ชี้ PLAYWRIGHT_BASE_URL ไปที่ Vercel Preview หรือ test environment
 * ที่แยกข้อมูลออกจาก Production เด็ดขาด (ข้อ 17.1)
 * ถ้าไม่ตั้ง จะยกเซิร์ฟเวอร์ dev ขึ้นมาเองที่ localhost
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const useExternalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // กัน test.only ที่เผลอ commit ติดไปกับ PR
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          /*
           * บาง environment (เช่น container ของ CI หรือ sandbox) มี Chromium ติดตั้งไว้แล้ว
           * คนละ revision กับที่ Playwright คาดหวัง ตั้ง PLAYWRIGHT_CHROMIUM_EXECUTABLE
           * ชี้ไปที่ไบนารีนั้นเพื่อใช้ตัวที่มีอยู่ แทนการดาวน์โหลดใหม่
           * ถ้าไม่ตั้ง จะใช้เบราว์เซอร์ที่ `npx playwright install` โหลดมาตามปกติ
           */
          ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
            : {}),
        },
      },
    },
  ],
  ...(useExternalServer
    ? {}
    : {
        webServer: {
          command: 'npm run build && npm run start',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      }),
});
