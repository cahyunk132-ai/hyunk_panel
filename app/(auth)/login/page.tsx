'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { SetupScreen } from '@/components/SetupScreen';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { toast } from '@/lib/utils/toast';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const noticeShown = useRef(false);

  // Notifikasi hasil alur auth lain (reset password, verifikasi email, link rusak).
  useEffect(() => {
    if (noticeShown.current) return;
    const reset = searchParams.get('reset');
    const verified = searchParams.get('verified');
    const registered = searchParams.get('registered');
    const authFailed = searchParams.get('auth') === 'failed';
    const reason = searchParams.get('reason');

    if (reset === 'success') {
      noticeShown.current = true;
      toast.success('Password berhasil diubah');
    } else if (verified === '1') {
      noticeShown.current = true;
      toast.success('Email terverifikasi. Silakan masuk.');
    } else if (registered === '1') {
      noticeShown.current = true;
      toast.info('Akun terdaftar. Cek email kamu untuk verifikasi.');
    } else if (authFailed) {
      noticeShown.current = true;
      toast.error(reason ?? 'Link tidak valid atau sudah kedaluwarsa');
    }
    if (!noticeShown.current) return;

    // Bersihkan query string supaya toast tidak muncul lagi saat refresh.
    try {
      window.history.replaceState(null, '', '/login');
    } catch {
      // diabaikan — sekadar kosmetik
    }
  }, [searchParams]);

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
      const message = err instanceof Error ? err.message : 'Login gagal';
      // Akun belum verifikasi email → arahkan ke halaman verifikasi (bawa email
      // supaya tombol "kirim ulang" langsung terisi).
      if (message.toLowerCase().includes('email not confirmed')) {
        router.replace(`/verify-email?email=${encodeURIComponent(email.trim())}`);
        return;
      }
      setError(message.toLowerCase().includes('invalid') ? 'Email atau password salah' : message);
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
            <div className="space-y-1.5">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
              <div className="text-right">
                <Link
                  href="/forgot-password"
                  className="text-[11px] text-accent hover:underline"
                >
                  Lupa password?
                </Link>
              </div>
            </div>
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

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-line-soft" />
          <span className="text-[10px] uppercase tracking-widest text-ink-faint">atau</span>
          <span className="h-px flex-1 bg-line-soft" />
        </div>

        <Link
          href="/register"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-base-600 px-4 py-2 text-sm text-ink transition-colors hover:bg-base-700"
        >
          Buat akun baru
        </Link>
      </div>
      <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-faint">
        Akun baru wajib verifikasi email sebelum bisa masuk. Akses node &amp; server diatur admin
        lewat halaman Users.
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
