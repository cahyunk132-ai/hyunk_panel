-- ============================================================================
-- HYUNK PANEL — Migration 005: Auto Backup System dengan Cloud Storage
-- ============================================================================
-- Apply after migrations 001–004.
--
-- Tiga tabel baru:
--   storage_providers  → koneksi cloud storage milik user (OAuth / kredensial manual)
--   backup_schedules   → jadwal backup otomatis per server (1 jadwal per server)
--   backup_logs        → history eksekusi backup (dari cron / manual / admin)
--
-- Access token & refresh token OAuth disimpan TERENKRIPSI (AES-256-GCM,
-- key di env STORAGE_TOKEN_ENCRYPTION_KEY — lihat lib/storage/crypto.ts).
-- Secret di dalam config jsonb (S3 secret_key, SFTP/WebDAV password) juga
-- terenkripsi dengan key yang sama.
--
-- API route memakai service role (otorisasi eksplisit di kode); RLS di sini
-- adalah defense-in-depth untuk akses langsung via Supabase client.

-- ─── Tabel: storage_providers ───────────────────────────────────────────────
create table if not exists public.storage_providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users on delete cascade not null,
  provider text not null check (provider in ('gdrive','dropbox','onedrive','s3','sftp','webdav')),
  name text not null,
  access_token text,                 -- terenkripsi (OAuth)
  refresh_token text,                -- terenkripsi (OAuth)
  token_expires_at timestamptz,
  config jsonb default '{}'::jsonb,
  -- s3:    { bucket, region, access_key, secret_key(enc), endpoint }
  -- sftp:  { host, port, username, password(enc), path }
  -- webdav:{ url, username, password(enc) }
  is_active boolean default true,
  created_at timestamptz default now()
);

create index if not exists storage_providers_user_idx on public.storage_providers (user_id);

-- ─── Tabel: backup_schedules ────────────────────────────────────────────────
create table if not exists public.backup_schedules (
  id uuid primary key default gen_random_uuid(),
  server_id uuid references public.servers on delete cascade not null,
  storage_provider_id uuid references public.storage_providers on delete cascade not null,
  is_enabled boolean default true,
  interval text not null check (interval in ('hourly','daily','weekly')),
  time_of_day text default '03:00',   -- jam eksekusi (HH:MM), dipakai daily/weekly
  day_of_week integer,                -- 0-6 untuk weekly (0 = Minggu)
  retention integer default 5,        -- maksimal backup tersimpan di cloud
  ignore_files text default '',       -- pola file/folder yang di-skip (diteruskan ke Wings)
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by uuid references public.users on delete set null,
  created_at timestamptz default now(),
  unique(server_id)                   -- 1 jadwal per server
);

create index if not exists backup_schedules_next_run_idx
  on public.backup_schedules (is_enabled, next_run_at);
create index if not exists backup_schedules_provider_idx
  on public.backup_schedules (storage_provider_id);

-- ─── Tabel: backup_logs ─────────────────────────────────────────────────────
create table if not exists public.backup_logs (
  id uuid primary key default gen_random_uuid(),
  server_id uuid references public.servers on delete cascade not null,
  schedule_id uuid references public.backup_schedules on delete set null,
  backup_uuid text,                   -- UUID backup dari Wings
  storage_provider_id uuid references public.storage_providers on delete set null,
  storage_file_id text,               -- file ID/path di cloud storage
  storage_file_name text,
  size_bytes bigint,
  status text check (status in ('pending','creating','uploading','done','failed')),
  error_message text,
  started_at timestamptz default now(),
  completed_at timestamptz
);

create index if not exists backup_logs_server_idx
  on public.backup_logs (server_id, started_at desc);
create index if not exists backup_logs_schedule_idx
  on public.backup_logs (schedule_id, started_at desc);

-- ============================================================================
-- Row Level Security (defense-in-depth; API memakai service role)
-- ============================================================================
alter table public.storage_providers enable row level security;
alter table public.backup_schedules enable row level security;
alter table public.backup_logs enable row level security;

-- ── storage_providers: user mengelola miliknya sendiri, admin semua ─────────
drop policy if exists storage_providers_admin_all on public.storage_providers;
create policy storage_providers_admin_all on public.storage_providers
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists storage_providers_own_all on public.storage_providers;
create policy storage_providers_own_all on public.storage_providers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── backup_schedules: baca = akses server; tulis = staff (owner/admin/moderator)
drop policy if exists backup_schedules_admin_all on public.backup_schedules;
create policy backup_schedules_admin_all on public.backup_schedules
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists backup_schedules_moderator_all on public.backup_schedules;
create policy backup_schedules_moderator_all on public.backup_schedules
  for all using (public.current_user_role() = 'moderator')
  with check (public.current_user_role() = 'moderator');

drop policy if exists backup_schedules_select_accessible on public.backup_schedules;
create policy backup_schedules_select_accessible on public.backup_schedules
  for select using (public.can_access_server(server_id));

-- ── backup_logs: baca = akses server, admin semua ───────────────────────────
drop policy if exists backup_logs_admin_all on public.backup_logs;
create policy backup_logs_admin_all on public.backup_logs
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists backup_logs_select_accessible on public.backup_logs;
create policy backup_logs_select_accessible on public.backup_logs
  for select using (public.can_access_server(server_id));
