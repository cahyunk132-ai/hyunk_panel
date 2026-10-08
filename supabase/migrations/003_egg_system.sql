-- ============================================================================
-- HYUNK PANEL — Migration 003: Egg templates, versions, and node assignments
-- ============================================================================
-- Apply after migrations 001 and 002. The service API performs authorization;
-- RLS remains enabled as a defense-in-depth guard for direct Supabase access.

create table if not exists public.eggs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  docker_image text not null,
  startup text not null,
  config_stop text default 'stop',
  config_startup jsonb default '{}'::jsonb,
  env_variables jsonb default '[]'::jsonb,
  features text[] default '{}'::text[],
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.egg_versions (
  id uuid primary key default gen_random_uuid(),
  egg_id uuid references public.eggs(id) on delete cascade not null,
  name text not null,
  minecraft_version text,
  docker_image text,
  env_overrides jsonb default '{}'::jsonb,
  is_recommended boolean default false,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.node_eggs (
  node_id uuid references public.nodes(id) on delete cascade not null,
  egg_id uuid references public.eggs(id) on delete cascade not null,
  primary key (node_id, egg_id)
);

create index if not exists egg_versions_egg_sort_idx
  on public.egg_versions (egg_id, sort_order, name);
create index if not exists node_eggs_egg_idx
  on public.node_eggs (egg_id);

-- Persist the selected template IDs so servers using eggs with identical images
-- can still display the exact Egg/Version that was chosen. The actual runtime
-- configuration remains in the existing image/startup/env columns.
alter table public.servers
  add column if not exists egg_id uuid references public.eggs(id) on delete set null,
  add column if not exists egg_version_id uuid references public.egg_versions(id) on delete set null;

create index if not exists servers_egg_id_idx on public.servers (egg_id);
create index if not exists servers_egg_version_id_idx on public.servers (egg_version_id);

alter table public.eggs enable row level security;
alter table public.egg_versions enable row level security;
alter table public.node_eggs enable row level security;

drop policy if exists eggs_admin_all on public.eggs;
create policy eggs_admin_all on public.eggs
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists egg_versions_admin_all on public.egg_versions;
create policy egg_versions_admin_all on public.egg_versions
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists node_eggs_admin_all on public.node_eggs;
create policy node_eggs_admin_all on public.node_eggs
  for all using (public.is_admin()) with check (public.is_admin());
