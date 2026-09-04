'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client';
import { sanitizeInternalPath } from '@/lib/request-id';

const loginSchema = z.object({
  email: z.email({ message: 'รูปแบบอีเมลไม่ถูกต้อง' }),
  password: z.string().min(1, { message: 'กรุณากรอกรหัสผ่าน' }),
});

/**
 * ฟอร์มเข้าสู่ระบบ
 *
 * ข้อความ error ตั้งใจไม่บอกว่า "ไม่พบอีเมลนี้" หรือ "รหัสผ่านผิด" แยกกัน
 * เพื่อไม่ให้ใช้หน้านี้สำรวจว่าอีเมลใดมีบัญชีอยู่ในระบบ (ข้อ 19.5)
 */
export function LoginForm({ returnTo }: { returnTo?: string }) {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: String(formData.get('email') ?? '')
        .trim()
        .toLowerCase(),
      password: String(formData.get('password') ?? ''),
    });

    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง');
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword(parsed.data);

      if (error) {
        setErrorMessage('อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีนี้ยังไม่ได้รับอนุญาตให้ใช้ระบบ');
        return;
      }

      // refresh() ทำให้ Server Component อ่าน session ใหม่ที่เพิ่งตั้ง
      router.replace(sanitizeInternalPath(returnTo) ?? '/dashboard');
      router.refresh();
    } catch {
      setErrorMessage('ติดต่อระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="space-y-1.5">
        <label htmlFor={emailId} className="block font-medium">
          อีเมล
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="username"
          required
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={passwordId} className="block font-medium">
          รหัสผ่าน
        </label>
        <input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5"
        />
      </div>

      {errorMessage ? (
        // role="alert" ให้ screen reader อ่านทันที และมีทั้งไอคอนข้อความ ไม่ใช้สีอย่างเดียว
        <p
          id={errorId}
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-900"
        >
          <span aria-hidden="true">⚠ </span>
          {errorMessage}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        aria-describedby={errorMessage ? errorId : undefined}
        className="bg-brand-600 hover:bg-brand-700 w-full rounded-md px-5 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
      </button>
    </form>
  );
}
