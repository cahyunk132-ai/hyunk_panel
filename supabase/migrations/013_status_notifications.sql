-- ============================================================================
-- HYUNK PANEL — Migration 013: public node status + email notifications
-- ============================================================================
-- Apply after 012_vps_terminal.sql.
-- Status checks are written by the protected Vercel Cron route. Notification
-- sends are written by the server-side SMTP helper.
-- ============================================================================

-- ─── Public node status history ─────────────────────────────────────────────
create table if not exists public.node_status_logs (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  status text not null check (status in ('online', 'offline', 'degraded')),
  latency_ms integer,
  checked_at timestamptz not null default now()
);

create index if not exists node_status_logs_node_checked_idx
  on public.node_status_logs (node_id, checked_at desc);

alter table public.node_status_logs enable row level security;

drop policy if exists node_status_logs_admin_read on public.node_status_logs;
create policy node_status_logs_admin_read on public.node_status_logs
  for select using (public.is_admin());

-- ─── Per-user notification preferences ──────────────────────────────────────
create table if not exists public.notification_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade unique,
  notify_backup_failed boolean not null default true,
  notify_backup_success boolean not null default false,
  notify_server_crash boolean not null default true,
  notify_node_offline boolean not null default true,
  email_override text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_settings_user_idx
  on public.notification_settings (user_id);

alter table public.notification_settings enable row level security;

drop policy if exists notification_settings_admin_all on public.notification_settings;
create policy notification_settings_admin_all on public.notification_settings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists notification_settings_own_select on public.notification_settings;
create policy notification_settings_own_select on public.notification_settings
  for select using (auth.uid() = user_id);

drop policy if exists notification_settings_own_insert on public.notification_settings;
create policy notification_settings_own_insert on public.notification_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists notification_settings_own_update on public.notification_settings;
create policy notification_settings_own_update on public.notification_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── Audit trail email ──────────────────────────────────────────────────────
create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  notification_type text not null,
  recipient_email text,
  subject text not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notification_logs_user_created_idx
  on public.notification_logs (user_id, created_at desc);
create index if not exists notification_logs_type_created_idx
  on public.notification_logs (notification_type, created_at desc);

alter table public.notification_logs enable row level security;

drop policy if exists notification_logs_admin_read on public.notification_logs;
create policy notification_logs_admin_read on public.notification_logs
  for select using (public.is_admin());

drop policy if exists notification_logs_own_read on public.notification_logs;
create policy notification_logs_own_read on public.notification_logs
  for select using (auth.uid() = user_id);

-- ─── Announcement email delivery state ──────────────────────────────────────
-- send_email is the per-announcement toggle shown in the admin form.
-- email_sent only becomes true after every verified active recipient succeeds.
alter table public.announcements
  add column if not exists send_email boolean not null default true;

alter table public.announcements
  add column if not exists email_sent boolean not null default false;

create index if not exists announcements_email_delivery_idx
  on public.announcements (send_email, email_sent, is_active, created_at desc);

-- Keep updated_at current when a preference is changed directly through
-- Supabase (the API also supplies the value explicitly).
create or replace function public.touch_notification_settings_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notification_settings_touch_updated_at on public.notification_settings;
create trigger notification_settings_touch_updated_at
  before update on public.notification_settings
  for each row execute function public.touch_notification_settings_updated_at();
