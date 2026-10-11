-- ============================================================================
-- HYUNK PANEL — Migration 011: Announcement System (broadcast pengumuman)
-- ============================================================================
-- Apply setelah 010_add_backup_schedule_permission.sql.
--
-- Catatan penomoran: brief menyebut "009_announcements.sql", tetapi nomor 009
-- sudah dipakai oleh 009_drop_subdomain_quota.sql dan 010 oleh
-- 010_add_backup_schedule_permission.sql — jadi migration ini memakai nomor
-- urut berikutnya (011) supaya riwayat tetap konsisten.
--
-- Admin (Owner Panel & Admin) membuat pengumuman yang tampil sebagai banner di
-- dashboard/servers semua user. expires_at NULL = permanen sampai dinonaktifkan.
-- Aman dijalankan ulang (idempotent).
-- ============================================================================

-- ─── Tabel: announcements ───────────────────────────────────────────────────
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  type text not null default 'info',   -- 'info' | 'warning' | 'danger' | 'success'
  is_active boolean not null default true,
  -- on delete set null: akun admin boleh dihapus tanpa menyeret pengumumannya.
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now(),
  expires_at timestamptz               -- null = permanen sampai dinonaktifkan
);

alter table public.announcements
  drop constraint if exists announcements_type_check;

alter table public.announcements
  add constraint announcements_type_check
  check (type in ('info', 'warning', 'danger', 'success'));

-- Batas panjang dijaga di database juga (API memvalidasi dengan angka yang sama).
alter table public.announcements
  drop constraint if exists announcements_title_check;

alter table public.announcements
  add constraint announcements_title_check
  check (length(btrim(title)) between 1 and 200);

alter table public.announcements
  drop constraint if exists announcements_content_check;

alter table public.announcements
  add constraint announcements_content_check
  check (length(btrim(content)) between 1 and 5000);

-- ─── Index ──────────────────────────────────────────────────────────────────
-- Query banner: is_active = true, urut created_at desc, tanpa yang kedaluwarsa.
create index if not exists announcements_active_created_idx
  on public.announcements (is_active, created_at desc);

create index if not exists announcements_expires_at_idx
  on public.announcements (expires_at);

-- ============================================================================
-- Row Level Security
-- ============================================================================
-- Sumber kebenaran tetap API panel:
--   GET   /api/announcements            → publik (hanya yang aktif & belum expired)
--   GET   /api/admin/announcements      → Owner Panel & Admin (semua baris)
--   POST  /api/admin/announcements      → Owner Panel & Admin
--   PATCH /api/admin/announcements/{id} → Owner Panel & Admin (edit / toggle aktif)
--   DELETE/api/admin/announcements/{id} → Owner Panel & Admin
-- Policy di bawah ini lapisan pertahanan untuk akses Supabase langsung.
-- ============================================================================

alter table public.announcements enable row level security;

-- Semua orang (termasuk anon) boleh membaca pengumuman yang masih tayang;
-- admin boleh membaca semuanya (termasuk nonaktif & kedaluwarsa).
drop policy if exists announcements_select_live on public.announcements;
create policy announcements_select_live on public.announcements
  for select
  using (
    public.is_admin()
    or (is_active and (expires_at is null or expires_at > now()))
  );

-- Hanya Owner Panel & Admin yang boleh membuat/mengubah/menghapus.
drop policy if exists announcements_admin_all on public.announcements;
create policy announcements_admin_all on public.announcements
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- Helper opsional: bersihkan pengumuman nonaktif yang sudah lama kedaluwarsa.
-- Dijalankan manual bila diperlukan (tidak ada cron untuk ini):
--   delete from public.announcements
--   where is_active = false and expires_at is not null and expires_at < now() - interval '90 days';
-- ============================================================================
