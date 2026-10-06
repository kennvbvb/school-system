'use client';

import { useId, useState } from 'react';
import { z } from 'zod';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client';
import { AUTH_CALLBACK_PATH } from '@/domain/auth/auth-link';

const emailSchema = z.email({ message: 'รูปแบบอีเมลไม่ถูกต้อง' });

/**
 * ฟอร์มขอลิงก์รีเซ็ตรหัสผ่าน (FR-AUTH-003)
 *
 * **หน้าจอตอบเหมือนกันไม่ว่าอีเมลนั้นมีบัญชีอยู่หรือไม่** เพื่อไม่ให้ใช้ฟอร์มนี้สำรวจว่า
 * อีเมลใดอยู่ในระบบ (ข้อ 19.5 เหมือนหน้าเข้าสู่ระบบ) ข้อยกเว้นเดียวคือส่งคำขอบ่อยเกินไป
 * ซึ่งต้องบอกให้รอ ข้อความนั้นไม่ขึ้นกับว่าอีเมลมีอยู่จริงหรือไม่
 *
 * ลิงก์ในอีเมลกลับมาที่ origin เดียวกับที่ขอ (ไม่ใช่ค่าจาก env) เพราะ PKCE เก็บ code verifier
 * ไว้ในเบราว์เซอร์ที่ขอ ถ้าไปเปิดอีกที่หนึ่งจะแลก code ไม่ได้
 */
export function ForgotPasswordForm() {
  const emailId = useId();
  const messageId = useId();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSent, setIsSent] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const parsed = emailSchema.safeParse(
      String(formData.get('email') ?? '')
        .trim()
        .toLowerCase(),
    );

    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง');
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
        redirectTo: `${window.location.origin}${AUTH_CALLBACK_PATH}`,
      });

      if (error?.status === 429) {
        setErrorMessage('ขอลิงก์บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
        return;
      }

      if (error) {
        console.error('[auth] ขอลิงก์รีเซ็ตรหัสผ่านไม่สำเร็จ', error.status);
        setErrorMessage('ส่งคำขอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        return;
      }

      setIsSent(true);
    } catch {
      setErrorMessage('ติดต่อระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isSent) {
    return (
      <p
        role="status"
        className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-green-900"
      >
        <span aria-hidden="true">✓ </span>
        หากอีเมลนี้มีบัญชีอยู่ในระบบ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้แล้ว
        ลิงก์มีอายุจำกัดและใช้ได้ครั้งเดียว กรุณาเปิดลิงก์ในเบราว์เซอร์เดียวกับที่ขอ
        หากไม่ได้รับอีเมลภายในไม่กี่นาที ให้ตรวจโฟลเดอร์สแปมหรือติดต่อผู้ดูแลระบบ
      </p>
    );
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

      {errorMessage ? (
        <p
          id={messageId}
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
        aria-describedby={errorMessage ? messageId : undefined}
        className="bg-brand-600 hover:bg-brand-700 w-full rounded-md px-5 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? 'กำลังส่ง…' : 'ส่งลิงก์ตั้งรหัสผ่านใหม่'}
      </button>
    </form>
  );
}
