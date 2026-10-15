-- ============================================================================
-- HYUNK PANEL — Migration 015: billing expiry + automatic suspension
-- ============================================================================
-- Apply after migrations 001–013. Vercel Hobby runs the billing maintenance
-- from the existing daily backup cron; no additional cron is required.

alter table public.servers
  add column if not exists expires_at      timestamptz default null,
  add column if not exists suspended_at    timestamptz default null,
  add column if not exists delete_after_at timestamptz default null;

create index if not exists servers_expires_at_idx
  on public.servers (expires_at)
  where expires_at is not null;

create index if not exists servers_delete_after_idx
  on public.servers (delete_after_at)
  where delete_after_at is not null;
