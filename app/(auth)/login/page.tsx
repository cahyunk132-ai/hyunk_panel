'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { SetupScreen } from '@/components/SetupScreen';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      const next = searchParams.get('next') ?? '/dashboard';
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error && err.message.toLowerCase().includes('invalid')
          ? 'Email atau password salah'
          : err instanceof Error
            ? err.message
            : 'Login gagal',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="rounded-2xl border border-line bg-base-850/90 p-8 shadow-card backdrop-blur">
        <div className="mb-8 text-center">
          <svg className="mx-auto h-11 w-11" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="14" fill="#171b26" />
            <path d="M18 16h7v12h14V16h7v32h-7V35H25v13h-7z" fill="#3ecfcf" />
          </svg>
          <h1 className="mt-4 text-lg font-extrabold tracking-wide">HYUNK PANEL</h1>
          <p className="mt-1 text-xs text-ink-muted">One Panel. Every Node. Every Server.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email" required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@wangstore.web.id"
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Password" required>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </Field>

          {error && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <Button type="submit" loading={loading} className="w-full">
            Masuk
          </Button>
        </form>
      </div>
      <p className="mt-4 text-center text-[11px] text-ink-faint">
        Hanya akun terdaftar yang bisa masuk. Hubungi admin untuk akses.
      </p>
    </div>
  );
}

export default function LoginPage() {
  if (!isSupabaseConfigured()) {
    return <SetupScreen />;
  }
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
