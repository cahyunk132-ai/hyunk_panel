'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { SetupScreen } from '@/components/SetupScreen';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { authCallbackUrl } from '@/lib/utils/app-url';

const RESEND_COOLDOWN_SECONDS = 30;

function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    },
    [],
  );

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

  async function sendLink() {
    const target = email.trim();
    setSending(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(target, {
        redirectTo: authCallbackUrl('recovery'),
      });
      if (resetError) throw resetError;
      // Supabase selalu menjawab sukses (anti tebak akun) — tampilkan konfirmasi
      // yang sama apa pun emailnya.
      setSentTo(target);
      startCooldown();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal mengirim link reset';
      const lower = message.toLowerCase();
      setError(
        lower.includes('for security purposes') || lower.includes('rate limit')
          ? 'Terlalu sering meminta link reset. Coba lagi beberapa menit.'
          : message,
      );
    } finally {
      setSending(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await sendLink();
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="rounded-2xl border border-line bg-base-850/90 p-8 shadow-card backdrop-blur">
        <div className="mb-6 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-accent/25 bg-accent-soft text-accent">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="10.5" width="16" height="10" rx="2" />
              <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5M12 15v2" />
            </svg>
          </span>
          <h1 className="mt-4 text-lg font-extrabold tracking-wide">Lupa password</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Masukkan email akun kamu. Kami kirim link untuk membuat password baru.
          </p>
        </div>

        {sentTo ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5 text-xs leading-relaxed text-emerald-300">
              Link reset password sudah dikirim ke <span className="font-medium">{sentTo}</span> —
              bila email itu terdaftar di panel. Cek inbox &amp; folder spam.
            </div>
            {error && (
              <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={() => void sendLink()}
              loading={sending}
              disabled={cooldown > 0}
              className="w-full"
            >
              {cooldown > 0 ? `Kirim ulang link (${cooldown}s)` : 'Kirim ulang link reset'}
            </Button>
            <p className="text-center text-xs">
              <Link href="/login" className="text-accent hover:underline">
                ← Kembali ke login
              </Link>
            </p>
          </div>
        ) : (
          <>
            <form onSubmit={onSubmit} className="space-y-4">
              <Field label="Email" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="kamu@contoh.com"
                  autoComplete="email"
                  required
                />
              </Field>

              {error && (
                <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}

              <Button type="submit" loading={sending} className="w-full">
                Kirim link reset
              </Button>
            </form>

            <p className="mt-5 text-center text-xs text-ink-muted">
              Ingat password kamu?{' '}
              <Link href="/login" className="font-medium text-accent hover:underline">
                Masuk
              </Link>
            </p>
          </>
        )}
      </div>
      <p className="mt-4 text-center text-[11px] text-ink-faint">
        Link reset berlaku singkat dan hanya bisa dipakai sekali. Belum punya akun?{' '}
        <Link href="/register" className="text-ink-muted hover:text-accent hover:underline">
          Daftar
        </Link>
      </p>
    </div>
  );
}

export default function ForgotPasswordPage() {
  if (!isSupabaseConfigured()) {
    return <SetupScreen />;
  }
  return <ForgotPasswordForm />;
}
