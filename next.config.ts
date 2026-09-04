import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 *
 * อ้างอิงข้อกำหนด: FR-SYS, 14.1 Security requirements
 * CSP ตั้งไว้แบบเข้มโดยค่าเริ่มต้น หากต้องเพิ่ม origin ให้แก้ที่นี่ที่เดียว
 * และบันทึกเหตุผลไว้ใน docs/decisions/
 */
const scriptSrc =
  process.env.NODE_ENV === 'development'
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : "'self' 'unsafe-inline'";

/**
 * เบราว์เซอร์ต้องต่อไปที่ Supabase ได้ จึงต้องอนุญาต origin ของโครงการที่ตั้งค่าไว้จริง
 *
 * อ่านจาก NEXT_PUBLIC_SUPABASE_URL แทนการ hard-code `https://*.supabase.co`
 * ด้วยเหตุผลสองข้อ:
 *   1. ตอนพัฒนาในเครื่อง Supabase อยู่ที่ http://127.0.0.1:54321 ซึ่ง wildcard ไม่ครอบคลุม
 *      ถ้าไม่อ่านจากค่าตั้ง การเข้าสู่ระบบใน local จะถูก CSP บล็อกทั้งหมด
 *   2. ใน production การระบุ origin ของโครงการตัวเดียวรัดกุมกว่าการเปิดทุก subdomain
 */
function supabaseOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

const connectSrc = ["'self'", supabaseOrigin()].filter(Boolean).join(' ');

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
