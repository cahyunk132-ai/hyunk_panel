import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Environment variable ${name} belum di-set`);
  return v;
}

/**
 * Client Supabase server-side yang membawa session user (cookie).
 * Dipakai untuk membaca identitas user di API route / server component.
 * RLS diterapkan sesuai role user ini.
 */
export function getSupabaseServerClient(): SupabaseClient {
  const cookieStore = cookies();
  return createServerClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]);
          });
        } catch {
          // Dipanggil dari Server Component — aman diabaikan; middleware yang me-refresh session.
        }
      },
    },
  });
}

/**
 * Client dengan SERVICE ROLE — bypass RLS. Hanya untuk API route setelah
 * session + permission user diverifikasi secara eksplisit. Jangan pernah
 * import file ini dari komponen client.
 */
export function getSupabaseServiceClient(): SupabaseClient {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isSupabaseServerConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  return url.startsWith('http') && !url.includes('xxxx') && key.length > 20;
}
