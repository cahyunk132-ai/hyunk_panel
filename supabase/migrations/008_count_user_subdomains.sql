-- ============================================================================
-- HYUNK PANEL — Migration 008: count_user_subdomains (kuota subdomain)
-- ============================================================================
-- DEPRECATED — dipertahankan hanya sebagai riwayat. Sistem subdomain sekarang
-- satu subdomain aktif per server TANPA kuota per user, dan function kuota ini
-- dihapus lagi oleh 009_drop_subdomain_quota.sql. Jangan dipakai di kode baru:
-- function ini hanya akan hidup kembali bila migration ini dijalankan ulang.
-- ============================================================================
-- Bug: kuota subdomain dihitung hanya dari `servers.owner_id`, sehingga buyer
-- yang servernya dibuat admin (server TANPA owner_id, buyer hanya terdaftar di
-- `server_users`) selalu punya hitungan 0 → kuota tidak pernah berkurang.
--
-- Function ini menghitung subdomain dari SEMUA server yang bisa diakses user:
--   - server miliknya sendiri            → servers.owner_id = p_user_id
--   - server yang ditugaskan kepadanya   → server_users.user_id = p_user_id
-- COUNT(DISTINCT ...) mencegah double count bila kedua kondisi terpenuhi
-- (mis. owner juga punya baris server_users — lihat migrasi 002 & 007).
--
-- Jalankan setelah 006_server_subdomains.sql. Aman dijalankan ulang (idempotent).
-- ============================================================================

create or replace function public.count_user_subdomains(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct ss.id)::integer
  from public.server_subdomains ss
  join public.servers s on s.id = ss.server_id
  left join public.server_users su
    on su.server_id = ss.server_id
   and su.user_id = p_user_id
  where s.owner_id = p_user_id
     or su.user_id = p_user_id;
$$;

comment on function public.count_user_subdomains(uuid) is
  'Jumlah subdomain yang dihitung ke kuota user: semua subdomain pada server yang ia miliki (servers.owner_id) atau yang ditugaskan kepadanya (server_users).';

-- ─── Hak eksekusi ───────────────────────────────────────────────────────────
-- Panel memanggilnya lewat service role (bypass RLS), tapi berikan akses ke
-- `authenticated` juga supaya function tetap berguna bila dipanggil dari klien.
revoke all on function public.count_user_subdomains(uuid) from public;
grant execute on function public.count_user_subdomains(uuid) to authenticated, service_role;
