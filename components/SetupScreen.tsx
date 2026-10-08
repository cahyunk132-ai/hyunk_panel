'use client';

import { isSupabaseConfigured } from '@/lib/supabase/client';

/** Layar yang muncul bila env Supabase belum diisi — memandu setup langkah demi langkah. */
export function SetupScreen() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-8 py-10">
      <div className="text-center">
        <svg className="mx-auto h-12 w-12" viewBox="0 0 64 64">
          <rect width="64" height="64" rx="14" fill="#171b26" />
          <path d="M18 16h7v12h14V16h7v32h-7V35H25v13h-7z" fill="#3ecfcf" />
        </svg>
        <h1 className="mt-4 text-xl font-bold">HYUNK PANEL</h1>
        <p className="mt-1 text-sm text-ink-muted">One Panel. Every Node. Every Server.</p>
      </div>

      <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-5 text-sm">
        <p className="font-semibold text-amber-300">Panel belum dikonfigurasi</p>
        <p className="mt-1 text-ink-muted">
          Variabel environment belum diisi. Ikuti langkah di <code className="font-mono text-accent">README.md</code>:
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-ink-muted">
          <li>Buat project di Supabase, lalu jalankan SQL migration <code className="font-mono text-xs">001_initial.sql</code> dan <code className="font-mono text-xs">002_role_management.sql</code>.</li>
          <li>
            Isi <code className="font-mono text-xs">.env.local</code> (di Vercel: Project → Settings → Environment Variables):
            <pre className="mt-2 overflow-x-auto rounded-lg bg-base-950 p-3 font-mono text-[11px] leading-relaxed text-ink">{`NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
WINGS_TOKEN_ENCRYPTION_KEY=<openssl rand -hex 32>
WINGS_SEED_NODE_TOKEN=<token wings node>
NEXT_PUBLIC_APP_URL=https://panel.wangstore.web.id`}</pre>
          </li>
          <li>Buat user pertama di Supabase Auth, lalu set <code className="font-mono text-xs">role = 'owner_panel'</code> di tabel <code className="font-mono text-xs">public.users</code>.</li>
          <li>Login, lalu panggil <code className="font-mono text-xs">POST /api/admin/seed</code> untuk mengimpor node + 5 server existing.</li>
        </ol>
      </div>
    </div>
  );
}

/** Guard untuk halaman client-side: render SetupScreen bila env belum ada. */
export function useNeedsSetup(): boolean {
  return !isSupabaseConfigured();
}
