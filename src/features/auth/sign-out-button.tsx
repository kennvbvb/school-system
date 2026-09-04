'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client';

export function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      // scope 'global' = ออกจากระบบทุกอุปกรณ์ (FR-AUTH-005)
      await supabase.auth.signOut({ scope: 'global' });
      router.replace('/login');
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isSigningOut}
      className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-100 disabled:opacity-60"
    >
      {isSigningOut ? 'กำลังออก…' : 'ออกจากระบบ'}
    </button>
  );
}
