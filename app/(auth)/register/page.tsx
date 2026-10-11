'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { SetupScreen } from '@/components/SetupScreen';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { authCallbackUrl } from '@/lib/utils/app-url';

const MIN_PASSWORD = 8;

/** Pesan error Supabase → bahasa Indonesia yang mudah dimengerti. */
function humanizeSignUpError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('already registered') || lower.includes('already been registered')) {
    return 'Email sudah terdaftar. Silakan masuk atau pakai "Lupa password?".';
  }
  if (lower.includes('unable to validate email')) return 'Format email tidak valid';
  if (lower.includes('password should be at least')) return `Password minimal ${MIN_PASSWORD} karakter`;
  if (lower.includes('rate limit') || lower.includes('for security purposes')) {
    return 'Terlalu banyak percobaan. Coba lagi beberapa menit.';
  }
  if (lower.includes('failed to send')) {
    return 'Gagal mengirim email verifikasi. Cek konfigurasi SMTP di Supabase.';
  }
  return message;
}

function RegisterForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (username.trim().length < 3) {
      setError('Username minimal 3 karakter');
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Password minimal ${MIN_PASSWORD} karakter`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Konfirmasi password tidak sama');
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          // username dipakai trigger handle_new_user untuk mengisi public.users.
          data: { username: username.trim() },
          emailRedirectTo: authCallbackUrl('signup'),
        },
      });
      if (signUpError) throw signUpError;

      // Bila email sudah terdaftar, Supabase (dengan setting tertentu) tetap
      // menjawab 200 tapi tanpa identities — anggap gagal supaya user tidak
      // menunggu email yang tidak akan pernah datang.
      if (data.user && data.user.identities && data.user.identities.length === 0 && !data.session) {
        throw new Error('User already registered');
      }

      if (data.session) {
        // "Confirm email" dimatikan di Supabase → akun langsung aktif.
        router.replace('/dashboard');
        router.refresh();
        return;
      }

      router.replace(`/verify-email?email=${encodeURIComponent(email.trim())}`);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Pendaftaran gagal';
      setError(humanizeSignUpError(message));
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
          <h1 className="mt-4 text-lg font-extrabold tracking-wide">Daftar Akun</h1>
          <p className="mt-1 text-xs text-ink-muted">
            Buat akun Hyunk Panel, lalu verifikasi email kamu.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Username" required hint="3–32 karakter, tampil di panel">
            <Input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="hyunk"
              autoComplete="username"
              minLength={3}
              maxLength={32}
              required
            />
          </Field>
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
          <Field label="Password" required hint={`Minimal ${MIN_PASSWORD} karakter`}>
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
          <Field label="Konfirmasi password" required>
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

          <Button type="submit" loading={loading} className="w-full">
            Daftar
          </Button>
        </form>

        <p className="mt-5 text-center text-xs text-ink-muted">
          Sudah punya akun?{' '}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Masuk
          </Link>
        </p>
      </div>
      <p className="mt-4 text-center text-[11px] text-ink-faint">
        Akun baru mendapat role <span className="text-ink-muted">User</span>. Akses node &amp; server
        diatur admin lewat halaman Users.
      </p>
    </div>
  );
}

export default function RegisterPage() {
  if (!isSupabaseConfigured()) {
    return <SetupScreen />;
  }
  return <RegisterForm />;
}
