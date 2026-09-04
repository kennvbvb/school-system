import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: {
    default: 'ระบบงานพัสดุและจัดซื้อจัดจ้าง',
    template: '%s | ระบบงานพัสดุและจัดซื้อจัดจ้าง',
  },
  description: 'ระบบงานพัสดุและจัดซื้อจัดจ้างภายในโรงเรียน สำหรับบุคลากรภายในเท่านั้น',
  // ระบบภายใน ไม่ต้องการให้ search engine เก็บ index
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
