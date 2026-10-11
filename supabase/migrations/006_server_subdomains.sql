-- ============================================================================
-- HYUNK PANEL — Migration 006: Subdomain Manager (server_subdomains)
-- ============================================================================
-- Setiap server dapat punya satu subdomain aktif (mis. "kenz.wangstore.web.id")
-- yang diarahkan reverse proxy ke IP:port server tersebut.
-- Jalankan setelah 005_auto_backup.sql. Aman dijalankan ulang (idempotent).
-- ============================================================================

-- ─── Tabel: server_subdomains ───────────────────────────────────────────────
create table if not exists public.server_subdomains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  subdomain TEXT NOT NULL UNIQUE,  -- hanya bagian depan, misal "kenz"
  full_domain TEXT NOT NULL UNIQUE, -- "kenz.wangstore.web.id"
  port INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Satu subdomain aktif per server (UI "Subdomain aktif" + tombol hapus).
create unique index if not exists server_subdomains_server_id_key
  on public.server_subdomains (server_id);

create index if not exists server_subdomains_full_domain_idx
  on public.server_subdomains (full_domain);

-- ─── Validasi format di level database ──────────────────────────────────────
-- Huruf kecil, angka, strip; 3–32 karakter; tanpa strip di awal/akhir;
-- full_domain harus di bawah base domain; blacklist subdomain sistem.
alter table public.server_subdomains
  drop constraint if exists server_subdomains_format_check;

alter table public.server_subdomains
  add constraint server_subdomains_format_check
  check (
    subdomain ~ '^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])?$'
    and length(subdomain) between 3 and 32
    and full_domain like subdomain || '.%'
    and subdomain not in (
      'panel', 'api', 'node', 'node1', 'node2', 'node3', 'www',
      'mail', 'toko', 'web', 'shield', 'status', 'tugas', 'website'
    )
  );

alter table public.server_subdomains
  drop constraint if exists server_subdomains_port_check;

alter table public.server_subdomains
  add constraint server_subdomains_port_check
  check (port between 1 and 65535);

-- ─── Trigger updated_at ─────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists server_subdomains_set_updated_at on public.server_subdomains;
create trigger server_subdomains_set_updated_at
  before update on public.server_subdomains
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Row Level Security — owner server / admin bisa kelola subdomain servernya
-- ============================================================================

alter table public.server_subdomains enable row level security;

-- Admin / Owner Panel: kelola semua subdomain (via public.is_admin()).
drop policy if exists server_subdomains_admin_all on public.server_subdomains;
create policy server_subdomains_admin_all on public.server_subdomains
  for all using (public.is_admin()) with check (public.is_admin());

-- Pemilik server boleh kelola (insert/update/delete) subdomain servernya.
drop policy if exists server_subdomains_owner_all on public.server_subdomains;
create policy server_subdomains_owner_all on public.server_subdomains
  for all
  using (
    exists (
      select 1 from public.servers s
      where s.id = server_subdomains.server_id
        and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.servers s
      where s.id = server_subdomains.server_id
        and s.owner_id = auth.uid()
    )
  );

-- Subuser/anggota server lain tetap boleh melihat (read-only).
drop policy if exists server_subdomains_select_accessible on public.server_subdomains;
create policy server_subdomains_select_accessible on public.server_subdomains
  for select
  using (
    exists (
      select 1 from public.servers s
      where s.id = server_subdomains.server_id
        and (s.owner_id = auth.uid()
             or exists (
               select 1 from public.server_users su
               where su.server_id = s.id and su.user_id = auth.uid()
             ))
    )
  );
