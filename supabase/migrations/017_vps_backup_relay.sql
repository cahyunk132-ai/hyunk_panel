-- ============================================================================
-- HYUNK PANEL — Migration 017: VPS backup relay
-- ============================================================================
-- A user's relay VPS is preferred for server-side large backup transfers.
-- The partial unique index keeps the one-relay-per-owner invariant enforced at
-- the database level in addition to the relay API's unset-then-set operation.
-- ============================================================================

alter table public.vps
  add column if not exists is_backup_relay boolean not null default false;

create unique index if not exists vps_one_backup_relay_per_owner_idx
  on public.vps (owner_id)
  where is_backup_relay = true and owner_id is not null;
