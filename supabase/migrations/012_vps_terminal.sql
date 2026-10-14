-- ============================================================================
-- HYUNK PANEL — Migration 012: VPS inventory + external terminal access
-- ============================================================================
-- Credentials are encrypted with lib/storage/crypto.ts before they are stored.
-- Keep direct table access disabled: the terminal-token API is the only code
-- path that is allowed to decrypt and forward a credential to the terminal
-- service.
--
-- Apply after migrations 001–011.
-- ============================================================================

create table if not exists public.vps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  host text not null,
  port integer not null default 22 check (port between 1 and 65535),
  username text not null,
  -- AES-256-GCM value in iv.tag.ciphertext format. Never store plaintext.
  credential text not null,
  owner_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.vps_users (
  vps_id uuid references public.vps(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  permissions text[] not null default '{}',
  primary key (vps_id, user_id)
);

create index if not exists vps_owner_idx on public.vps (owner_id);
create index if not exists vps_users_user_idx on public.vps_users (user_id);

-- The helper is intentionally separate from the API so direct Supabase access
-- can use the same ownership/assignment rule if it is ever enabled later.
create or replace function public.can_access_vps(target_vps_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(public.current_user_role() in ('owner_panel', 'admin', 'moderator'), false)
    or exists (
      select 1
      from public.vps v
      where v.id = target_vps_id
        and v.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.vps_users vu
      where vu.vps_id = target_vps_id
        and vu.user_id = auth.uid()
    );
$$;

alter table public.vps enable row level security;
alter table public.vps_users enable row level security;

-- API routes use the Supabase service role after checking the panel session.
-- Revoke ordinary client privileges because a row-level policy cannot hide a
-- sensitive credential column from a client that can SELECT the row.
revoke all on table public.vps from anon, authenticated;
revoke all on table public.vps_users from anon, authenticated;

drop policy if exists vps_accessible_select on public.vps;
create policy vps_accessible_select on public.vps
  for select using (public.can_access_vps(id));

drop policy if exists vps_users_accessible_select on public.vps_users;
create policy vps_users_accessible_select on public.vps_users
  for select using (
    user_id = auth.uid()
    or public.is_admin()
    or public.can_access_vps(vps_id)
  );

-- Inserts/updates/deletes are intentionally handled by authenticated panel
-- APIs using the service role. No browser client receives a credential-bearing
-- row, and owner_id is always taken from the server-side session.
