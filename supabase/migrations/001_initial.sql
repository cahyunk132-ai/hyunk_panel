-- ============================================================================
-- HYUNK PANEL — Migration 001: skema awal + RLS
-- ============================================================================
-- Jalankan di Supabase SQL Editor (atau `supabase db push`).
-- Aman dijalankan ulang (idempotent lewat IF NOT EXISTS / OR REPLACE).
-- ============================================================================

-- ─── Tabel: users (extends auth.users) ──────────────────────────────────────
create table if not exists public.users (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  email text,
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz default now()
);

-- ─── Tabel: nodes ───────────────────────────────────────────────────────────
create table if not exists public.nodes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  fqdn text not null,               -- node2.wangstore.web.id
  port integer not null default 8080,
  token_id text not null,
  token_encrypted text not null,    -- AES-256-GCM ("iv.tag.ciphertext" base64)
  uuid text not null unique,        -- Wings node UUID
  location text default 'ID',
  memory_total_mb integer,
  disk_total_mb integer,
  is_maintenance boolean default false,
  created_at timestamptz default now()
);

-- ─── Tabel: servers ─────────────────────────────────────────────────────────
create table if not exists public.servers (
  id uuid primary key default gen_random_uuid(),
  uuid text not null unique,        -- Wings container UUID = folder di volumes
  name text not null,
  node_id uuid references public.nodes on delete cascade not null,
  owner_id uuid references public.users on delete set null,
  allocation_id uuid,               -- FK ke allocations ditambah setelah tabel ada
  memory_mb integer not null,
  cpu_limit integer not null,       -- CpuQuota / 1000 = persen
  disk_mb integer,
  image text not null,
  startup text not null,
  env jsonb default '{}'::jsonb,
  status text default 'offline'
    check (status in ('running','starting','stopping','offline','installing','error')),
  is_suspended boolean default false,
  created_at timestamptz default now()
);

-- ─── Tabel: allocations ─────────────────────────────────────────────────────
create table if not exists public.allocations (
  id uuid primary key default gen_random_uuid(),
  node_id uuid references public.nodes on delete cascade not null,
  ip text not null,
  port integer not null,
  assigned_to uuid references public.servers(id) on delete set null,
  created_at timestamptz default now(),
  unique(node_id, ip, port)
);

alter table public.servers
  drop constraint if exists servers_allocation_id_fkey,
  add constraint servers_allocation_id_fkey
    foreign key (allocation_id) references public.allocations(id) on delete set null;

-- ─── Tabel: server_users ────────────────────────────────────────────────────
create table if not exists public.server_users (
  server_id uuid references public.servers on delete cascade not null,
  user_id uuid references public.users on delete cascade not null,
  permissions text[] default '{}',
  primary key (server_id, user_id)
);

-- ─── Tabel: activity_logs ───────────────────────────────────────────────────
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users on delete set null,
  server_id uuid references public.servers on delete set null,
  action text not null,
  metadata jsonb default '{}'::jsonb,
  ip text,
  created_at timestamptz default now()
);

create index if not exists activity_logs_created_at_idx on public.activity_logs (created_at desc);
create index if not exists activity_logs_server_idx on public.activity_logs (server_id, created_at desc);

-- ─── Tabel: backups ─────────────────────────────────────────────────────────
create table if not exists public.backups (
  id uuid primary key default gen_random_uuid(),
  server_id uuid references public.servers on delete cascade not null,
  uuid text unique,                 -- Wings backup UUID
  name text,
  size_bytes bigint,
  is_successful boolean,
  checksum text,
  created_at timestamptz default now()
);

-- ============================================================================
-- Helper functions
-- ============================================================================

-- Apakah user saat ini admin? Dipakai di semua policy.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Buat baris public.users otomatis saat user baru daftar di Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, username, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(coalesce(new.email,'user'), '@', 1)) || '-' || substr(new.id::text, 1, 4),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.users enable row level security;
alter table public.nodes enable row level security;
alter table public.allocations enable row level security;
alter table public.servers enable row level security;
alter table public.server_users enable row level security;
alter table public.activity_logs enable row level security;
alter table public.backups enable row level security;

-- ── users ────────────────────────────────────────────────────────────────────
drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists users_admin_all on public.users;
create policy users_admin_all on public.users
  for all using (public.is_admin()) with check (public.is_admin());

-- User biasa boleh update username sendiri (bukan role).
drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id and role = (select role from public.users where id = auth.uid()));

-- ── nodes ────────────────────────────────────────────────────────────────────
-- Token Wings TIDAK BOLEH terbaca oleh user biasa. Tabel nodes hanya admin.
drop policy if exists nodes_admin_all on public.nodes;
create policy nodes_admin_all on public.nodes
  for all using (public.is_admin()) with check (public.is_admin());

-- View aman untuk UI user: node TANPA kolom token.
create or replace view public.nodes_public
with (security_invoker = false) as
  select id, name, fqdn, port, uuid, location, memory_total_mb, disk_total_mb,
         is_maintenance, created_at
  from public.nodes;

grant select on public.nodes_public to authenticated;

-- ── servers ──────────────────────────────────────────────────────────────────
drop policy if exists servers_admin_all on public.servers;
create policy servers_admin_all on public.servers
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists servers_select_assigned on public.servers;
create policy servers_select_assigned on public.servers
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.server_users su
      where su.server_id = servers.id and su.user_id = auth.uid()
    )
  );

-- ── allocations ──────────────────────────────────────────────────────────────
drop policy if exists allocations_admin_all on public.allocations;
create policy allocations_admin_all on public.allocations
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists allocations_select_own_servers on public.allocations;
create policy allocations_select_own_servers on public.allocations
  for select using (
    exists (
      select 1 from public.servers s
      where s.allocation_id = allocations.id
        and (s.owner_id = auth.uid()
             or exists (select 1 from public.server_users su
                        where su.server_id = s.id and su.user_id = auth.uid()))
    )
  );

-- ── server_users ─────────────────────────────────────────────────────────────
drop policy if exists server_users_admin_all on public.server_users;
create policy server_users_admin_all on public.server_users
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists server_users_select_self on public.server_users;
create policy server_users_select_self on public.server_users
  for select using (user_id = auth.uid());

-- ── activity_logs ────────────────────────────────────────────────────────────
drop policy if exists activity_admin_all on public.activity_logs;
create policy activity_admin_all on public.activity_logs
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists activity_select_own on public.activity_logs;
create policy activity_select_own on public.activity_logs
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.servers s
      where s.id = activity_logs.server_id
        and (s.owner_id = auth.uid()
             or exists (select 1 from public.server_users su
                        where su.server_id = s.id and su.user_id = auth.uid()))
    )
  );

-- ── backups ──────────────────────────────────────────────────────────────────
drop policy if exists backups_admin_all on public.backups;
create policy backups_admin_all on public.backups
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists backups_select_own_servers on public.backups;
create policy backups_select_own_servers on public.backups
  for select using (
    exists (
      select 1 from public.servers s
      where s.id = backups.server_id
        and (s.owner_id = auth.uid()
             or exists (select 1 from public.server_users su
                        where su.server_id = s.id and su.user_id = auth.uid()))
    )
  );
