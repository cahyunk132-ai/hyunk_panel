'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { SetupScreen } from '@/components/SetupScreen';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';

const RESEND_COOLDOWN_SECONDS = 30;

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(() => searchParams.get('email') ?? '');
  const [hasSession, setHasSession] = useState(false);
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setCooldown((left) => {
        if (left <= 1 && cooldownTimer.current) clearInterval(cooldownTimer.current);
        return Math.max(0, left - 1);
      });
    }, 1000);
  }

  useEffect(() => () => {
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
  }, []);

  // Cek session saat halaman dibuka + dengarkan perubahan auth: begitu email
  // terverifikasi (user klik link di email pada tab ini) langsung ke dashboard.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!active) return;
      setChecking(false);
      if (!user) {
        setHasSession(false);
        return;
      }
      setHasSession(true);
      if (user.email) setEmail((prev) => prev || user.email!);
      if (user.email_confirmed_at) {
        router.replace('/dashboard');
        router.refresh();
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      if (!user) return;
      if (user.email_confirmed_at) {
        router.replace('/dashboard');
        router.refresh();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  async function resend() {
    const target = email.trim();
    if (!target) {
      setError('Isi email akun kamu dulu');
      return;
    }
    setStatus('sending');
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: target });
      if (resendError) throw resendError;
      setStatus('sent');
      startCooldown();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal mengirim ulang email';
      setError(
        message.toLowerCase().includes('for security purposes') || message.toLowerCase().includes('rate limit')
          ? 'Terlalu sering mengirim ulang. Coba lagi beberapa menit.'
          : message,
      );
      setStatus('idle');
    }
  }

  async function signOut() {
    await fetch('/api/auth/signout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="rounded-2xl border border-line bg-base-850/90 p-8 shadow-card backdrop-blur">
        <div className="mb-6 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-accent/25 bg-accent-soft text-accent">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
              <path d="m3 7 9 6 9-6" />
            </svg>
          </span>
          <h1 className="mt-4 text-lg font-extrabold tracking-wide">Verifikasi email kamu</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Cek email kamu untuk verifikasi akun. Klik link di email itu untuk mengaktifkan akun
            Hyunk Panel, lalu kamu akan diarahkan ke dashboard.
          </p>
        </div>

        {checking ? (
          <p className="py-4 text-center text-xs text-ink-faint">Memeriksa akun…</p>
        ) : (
          <div className="space-y-4">
            <Field
              label="Email akun"
              required
              hint={hasSession ? 'Email dari sesi kamu saat ini' : 'Email yang dipakai saat mendaftar'}
            >
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="kamu@contoh.com"
                autoComplete="email"
                readOnly={hasSession}
              />
            </Field>

            {status === 'sent' && !error && (
              <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
                Email verifikasi dikirim ulang ke <span className="font-medium">{email.trim()}</span>.
                Cek inbox &amp; folder spam.
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <Button
              type="button"
              onClick={() => void resend()}
              loading={status === 'sending'}
              disabled={cooldown > 0}
              className="w-full"
            >
              {cooldown > 0 ? `Kirim ulang (${cooldown}s)` : 'Kirim ulang email verifikasi'}
            </Button>

            <div className="flex items-center justify-between gap-3 pt-1 text-xs">
              <Link href="/login" className="text-accent hover:underline">
                ← Kembali ke login
              </Link>
              {hasSession && (
                <button type="button" onClick={() => void signOut()} className="text-ink-faint hover:text-red-400">
                  Keluar
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-faint">
        Tidak menerima email? Cek folder spam, atau pastikan alamat email benar. Link verifikasi
        berlaku terbatas — minta link baru bila sudah kedaluwarsa.
      </p>
    </div>
  );
}

export default function VerifyEmailPage() {
  if (!isSupabaseConfigured()) {
    return <SetupScreen />;
  }
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
