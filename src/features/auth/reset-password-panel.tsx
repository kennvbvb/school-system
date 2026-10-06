'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClientWithoutUrlDetection } from '@/lib/supabase/browser-client';
import { recordPasswordSet } from '@/server/auth/actions';
import { FORGOT_PASSWORD_PATH, parseAuthHash } from '@/domain/auth/auth-link';
import { PASSWORD_MIN_LENGTH, newPasswordSchema } from '@/domain/auth/password';

type PanelState =
  { status: 'checking' } | { status: 'ready' } | { status: 'invalid'; expired: boolean };

/**
 * หน้าตั้งรหัสผ่านใหม่ ใช้ร่วมกันสองทาง
 *
 *   1. ผู้ถูกเชิญกดลิงก์ในอีเมลคำเชิญ -> token มาใน URL hash -> อ่านเองแล้ว setSession
 *   2. ผู้ลืมรหัสผ่านกดลิงก์รีเซ็ต -> /auth/callback แลก code เป็น session ที่ server แล้ว
 *      พามาที่นี่ -> มี session ใน cookie อยู่แล้ว
 *
 * ถ้าไม่มี session ทั้งสองทาง แปลว่าลิงก์ไม่ถูกต้อง/หมดอายุ/ถูกใช้ไปแล้ว ไม่แสดงฟอร์ม
 * (ต่อให้ส่งฟอร์มไปก็ไม่มีสิทธิ์เปลี่ยน แต่ไม่ควรให้ผู้ใช้กรอกเปล่า)
 *
 * **token ถูกลบออกจาก URL ก่อนเรียกอะไรต่อ** ไม่ให้ค้างในประวัติเบราว์เซอร์หรือ Referer
 * และไม่ log ค่า token ที่ใดเลย (FR-AUD-004)
 */
export function ResetPasswordPanel() {
  const router = useRouter();
  const passwordId = useId();
  const confirmId = useId();
  const hintId = useId();
  const errorId = useId();

  const [state, setState] = useState<PanelState>({ status: 'checking' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // React Strict Mode เรียก effect สองรอบตอน dev — hash ถูกลบรอบแรกแล้ว รอบสองจะเห็นว่าว่าง
  const hasBootstrapped = useRef(false);

  useEffect(() => {
    if (hasBootstrapped.current) return;
    hasBootstrapped.current = true;

    async function bootstrap() {
      const parsedHash = parseAuthHash(window.location.hash);

      if (parsedHash.kind !== 'none') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }

      if (parsedHash.kind === 'error') {
        setState({ status: 'invalid', expired: parsedHash.reason === 'expired' });
        return;
      }

      try {
        const supabase = createSupabaseBrowserClientWithoutUrlDetection();

        if (parsedHash.kind === 'session') {
          const { error } = await supabase.auth.setSession({
            access_token: parsedHash.accessToken,
            refresh_token: parsedHash.refreshToken,
          });
          setState(error ? { status: 'invalid', expired: true } : { status: 'ready' });
          return;
        }

        // ไม่มี token ใน URL — ดูว่ามี session จากการแลก code ที่ /auth/callback หรือไม่
        const { data } = await supabase.auth.getUser();
        setState(data.user ? { status: 'ready' } : { status: 'invalid', expired: false });
      } catch {
        setState({ status: 'invalid', expired: false });
      }
    }

    void bootstrap();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const parsed = newPasswordSchema.safeParse({
      password: String(formData.get('password') ?? ''),
      confirmPassword: String(formData.get('confirmPassword') ?? ''),
    });

    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง');
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClientWithoutUrlDetection();
      const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

      if (error) {
        // ไม่แสดงข้อความดิบจาก auth provider — แปลเฉพาะกรณีที่ผู้ใช้แก้เองได้
        if (error.code === 'same_password') {
          setErrorMessage('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
        } else if (error.code === 'weak_password') {
          setErrorMessage('รหัสผ่านนี้ไม่ผ่านเกณฑ์ความปลอดภัยของระบบ กรุณาตั้งให้คาดเดายากขึ้น');
        } else {
          console.error('[auth] ตั้งรหัสผ่านไม่สำเร็จ', error.code ?? error.status);
          setErrorMessage('ตั้งรหัสผ่านไม่สำเร็จ ลิงก์อาจหมดอายุ กรุณาขอลิงก์ใหม่อีกครั้ง');
        }
        return;
      }

      // รีเซ็ตแล้วต้องตัด session อื่นของบัญชีนี้ทิ้ง — ถ้ามีใครถือ session เก่าอยู่ (เช่นเครื่องที่หาย)
      // รหัสผ่านใหม่ต้องไม่ปล่อยให้เขายังเข้าได้ ล้มก็ไม่เป็นไร รหัสผ่านเปลี่ยนไปแล้ว
      await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined);
      await recordPasswordSet();

      router.replace('/dashboard');
      router.refresh();
    } catch {
      setErrorMessage('ติดต่อระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (state.status === 'checking') {
    return (
      <p role="status" className="text-slate-600">
        กำลังตรวจสอบลิงก์…
      </p>
    );
  }

  if (state.status === 'invalid') {
    return (
      <div className="space-y-4">
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-900"
        >
          <span aria-hidden="true">⚠ </span>
          {state.expired
            ? 'ลิงก์หมดอายุหรือถูกใช้ไปแล้ว'
            : 'ลิงก์ไม่ถูกต้อง หรือยังไม่ได้เข้าสู่ระบบผ่านลิงก์ในอีเมล'}
        </p>
        <p className="text-slate-600">
          ขอลิงก์ใหม่ได้ที่{' '}
          <Link href={FORGOT_PASSWORD_PATH} className="text-brand-700 underline">
            หน้าลืมรหัสผ่าน
          </Link>{' '}
          หากเป็นบัญชีที่เพิ่งถูกเชิญและยังขอลิงก์ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="space-y-1.5">
        <label htmlFor={passwordId} className="block font-medium">
          รหัสผ่านใหม่
        </label>
        <input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-describedby={hintId}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5"
        />
        <p id={hintId} className="text-sm text-slate-600">
          ยาวอย่างน้อย {PASSWORD_MIN_LENGTH} ตัวอักษร ใช้ประโยคหรือคำหลายคำต่อกันได้
          และไม่ควรซ้ำกับรหัสผ่านที่ใช้ที่อื่น
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={confirmId} className="block font-medium">
          ยืนยันรหัสผ่านใหม่
        </label>
        <input
          id={confirmId}
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5"
        />
      </div>

      {errorMessage ? (
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
        {isSubmitting ? 'กำลังบันทึก…' : 'ตั้งรหัสผ่าน'}
      </button>
    </form>
  );
}
