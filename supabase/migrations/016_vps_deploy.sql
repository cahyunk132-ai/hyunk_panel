-- ============================================================================
-- HYUNK PANEL — Migration 016: VPS deploy history
-- ============================================================================
-- Deploy operations run over the existing server-side SSH/SFTP helpers.
-- Credentials stay in public.vps. This table only stores deploy metadata/logs.

create table if not exists public.vps_deploy_logs (
  id uuid primary key default gen_random_uuid(),
  vps_id uuid references public.vps(id) on delete cascade not null,
  app_name text not null,
  deploy_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'success', 'failed')),
  log text,
  deployed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists vps_deploy_logs_vps_idx
  on public.vps_deploy_logs (vps_id, created_at desc);

alter table public.vps_deploy_logs enable row level security;
revoke all on table public.vps_deploy_logs from anon, authenticated;

-- API routes use the service role after checking the panel session and VPS access.
