'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { SetupScreen } from '@/components/SetupScreen';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';

const MIN_PASSWORD = 8;

/**
 * /reset-password — form password baru setelah user mengklik link reset.
 *
 * Token bisa datang dari dua jalur:
 *  1. /auth/callback sudah menukar `code` jadi session cookie → halaman ini
 *     langsung melihat user (jalur utama, redirectTo panel).
 *  2. Supabase mengarahkan link langsung ke halaman ini dengan `?code=...` atau
 *     `?token_hash=...&type=recovery` → ditukar di sini.
 */
function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [preparing, setPreparing] = useState(true);
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const code = searchParams.get('code');
    const tokenHash = searchParams.get('token_hash');
    const rawType = searchParams.get('type');
    const otpType = (
      ['recovery', 'invite', 'signup', 'magiclink', 'email_change', 'email'] as const
    ).find((candidate) => candidate === rawType);
    let active = true;

    (async () => {
      // supabase-js (PKCE) sudah menukar `?code=` sendiri saat init dan
      // menghapusnya dari address bar — jadi cek session dulu sebelum mencoba
      // menukar ulang (code sekali pakai).
      let user = (await supabase.auth.getUser()).data.user;

      if (!user && code) {
        await supabase.auth.exchangeCodeForSession(code).catch(() => undefined);
        user = (await supabase.auth.getUser()).data.user;
      } else if (!user && tokenHash && otpType) {
        await supabase.auth
          .verifyOtp({ token_hash: tokenHash, type: otpType })
          .catch(() => undefined);
        user = (await supabase.auth.getUser()).data.user;
      }

      if (!active) return;
      setPreparing(false);
      if (user) {
        setReady(true);
      } else if (code || tokenHash) {
        setLinkError('Link reset tidak valid atau sudah kedaluwarsa. Minta link baru.');
      } else {
        setLinkError('Buka halaman ini dari link di email reset password kamu.');
      }

      // Bersihkan token dari address bar supaya refresh tidak menukar ulang code
      // yang sudah terpakai.
      if (code || tokenHash) {
        try {
          window.history.replaceState(null, '', window.location.pathname);
        } catch {
          // diabaikan
        }
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') {
        setPreparing(false);
        setLinkError(null);
        setReady(true);
        return;
      }
      if (event === 'SIGNED_OUT') setReady(false);
      if (session?.user && event === 'SIGNED_IN') setReady(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [searchParams]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(`Password minimal ${MIN_PASSWORD} karakter`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Konfirmasi password tidak sama');
      return;
    }

    setSaving(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      // Keluar dari sesi recovery: middleware mengarahkan user yang masih login
      // dari /login ke /dashboard, jadi session harus dibuang dulu.
      await supabase.auth.signOut();
      await fetch('/api/auth/signout', { method: 'POST' }).catch(() => undefined);

      router.replace('/login?reset=success');
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal mengubah password';
      const lower = message.toLowerCase();
      setError(
        lower.includes('expired') || lower.includes('session not found') || lower.includes('invalid')
          ? 'Sesi reset sudah berakhir. Minta link reset baru.'
          : lower.includes('password should be at least')
            ? `Password minimal ${MIN_PASSWORD} karakter`
            : message,
      );
      setSaving(false);
    }
  }

  if (preparing) {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border border-line bg-base-850/90 p-10 text-ink-muted shadow-card backdrop-blur">
        <Spinner size="lg" />
        <p className="text-xs">Menyiapkan form reset password…</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-sm">
        <div className="rounded-2xl border border-line bg-base-850/90 p-8 text-center shadow-card backdrop-blur">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-400">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M12 8v5M12 17h.01" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          </span>
          <h1 className="mt-4 text-base font-bold">Tidak bisa mereset password</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {linkError ?? 'Link reset tidak valid.'}
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Button type="button" onClick={() => router.replace('/forgot-password')} className="w-full">
              Minta link reset baru
            </Button>
            <Link
              href="/login"
              className="rounded-lg border border-line bg-base-600 px-4 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              Kembali ke login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="rounded-2xl border border-line bg-base-850/90 p-8 shadow-card backdrop-blur">
        <div className="mb-6 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-accent/25 bg-accent-soft text-accent">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 4 6.5v5c0 4.6 3.2 8.3 8 9.5 4.8-1.2 8-4.9 8-9.5v-5L12 3Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </span>
          <h1 className="mt-4 text-lg font-extrabold tracking-wide">Buat password baru</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Pilih password baru untuk akun kamu. Setelah tersimpan kamu akan diminta masuk ulang.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Password baru" required hint={`Minimal ${MIN_PASSWORD} karakter`}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              required
            />
          </Field>
          <Field label="Konfirmasi password baru" required>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              required
            />
          </Field>

          {error && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <Button type="submit" loading={saving} className="w-full">
            Simpan password baru
          </Button>
        </form>

        <p className="mt-5 text-center text-xs">
          <Link href="/login" className="text-accent hover:underline">
            ← Kembali ke login
          </Link>
        </p>
      </div>
      <p className="mt-4 text-center text-[11px] text-ink-faint">
        Demi keamanan, link reset hanya bisa dipakai sekali dan sesi lainnya akan dikeluarkan.
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  if (!isSupabaseConfigured()) {
    return <SetupScreen />;
  }
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
