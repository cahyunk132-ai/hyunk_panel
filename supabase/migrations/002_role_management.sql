-- ============================================================================
-- HYUNK PANEL — Migration 002: role hierarchy, subusers, and role-aware RLS
-- ============================================================================
-- Safe to run after 001_initial.sql. The SQL role checks are authoritative;
-- API/UI validation is an additional usability layer.

-- ─── Global roles ────────────────────────────────────────────────────────────
alter table public.users
  alter column role set default 'user';

alter table public.users
  drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check
  check (role in ('owner_panel', 'admin', 'moderator', 'user', 'subuser'));

-- ─── Per-server user/subuser assignments ────────────────────────────────────
do $$
declare
  assignment_role_existed boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'server_users'
      and column_name = 'role'
  ) into assignment_role_existed;

  if not assignment_role_existed then
    alter table public.server_users
      add column role text not null default 'subuser';

    -- Existing assignments belonged to normal users in the original schema;
    -- preserve those as user-level assignments. Future invites are explicit.
    update public.server_users su
    set role = case when u.role = 'user' then 'user' else 'subuser' end
    from public.users u
    where u.id = su.user_id;
  end if;
end;
$$;

alter table public.server_users
  drop constraint if exists server_users_role_check;

alter table public.server_users
  add constraint server_users_role_check
  check (role in ('user', 'subuser'));

-- Preserve existing server owners as the server's user-level manager.
update public.server_users su
set role = 'user'
from public.servers s
join public.users u on u.id = s.owner_id
where su.server_id = s.id
  and su.user_id = s.owner_id
  and u.role = 'user';

-- Existing user-owned servers may not yet have an explicit server_users row.
-- Create one so user access is always assignment-based (never owner_id-only).
insert into public.server_users (server_id, user_id, role, permissions)
select
  s.id,
  s.owner_id,
  'user',
  array[
    'start', 'stop', 'restart', 'console', 'console.send', 'monitoring',
    'files.read', 'files.edit', 'backups', 'backup.restore', 'backups.delete', 'players'
  ]::text[]
from public.servers s
join public.users u on u.id = s.owner_id
where u.role = 'user'
  and s.owner_id is not null
on conflict (server_id, user_id) do nothing;

-- ─── Maximum five Owner Panel accounts ──────────────────────────────────────
create or replace function public.check_owner_panel_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_count integer;
begin
  if new.role = 'owner_panel' then
    -- Serialize role promotions so concurrent requests cannot exceed the cap.
    perform pg_advisory_xact_lock(hashtext('hyunk_panel_owner_panel_limit')::bigint);

    select count(*)
      into owner_count
      from public.users
      where role = 'owner_panel'
        and id <> new.id;

    if owner_count >= 5 then
      raise exception using
        errcode = '23514',
        message = 'Maksimal 5 Owner Panel';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_owner_panel_limit on public.users;
create trigger enforce_owner_panel_limit
  before insert or update of role on public.users
  for each row execute function public.check_owner_panel_limit();

-- ─── Role lookup helpers for RLS ────────────────────────────────────────────
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

-- Kept under the existing name so the initial migration's policies and any
-- downstream SQL continue to mean panel administrators (Owner Panel + Admin).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('owner_panel', 'admin'), false);
$$;

create or replace function public.can_access_server(target_server_id uuid)
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
      from public.server_users su
      where su.server_id = target_server_id
        and su.user_id = auth.uid()
    );
$$;

create or replace function public.can_assign_subusers(target_server_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or (
      public.current_user_role() = 'user'
      and exists (
        select 1
        from public.server_users su
        where su.server_id = target_server_id
          and su.user_id = auth.uid()
          and su.role = 'user'
      )
    );
$$;

-- ─── Role-aware RLS policies ────────────────────────────────────────────────

-- users: only Owner Panel/Admin may list or manage accounts; users can still
-- read their own profile and update non-role profile fields.
drop policy if exists users_select_own on public.users;
drop policy if exists users_admin_all on public.users;
drop policy if exists users_update_own on public.users;
create policy users_select_own on public.users
  for select using (auth.uid() = id or public.is_admin());
create policy users_admin_all on public.users
  for all using (public.is_admin()) with check (public.is_admin());
create policy users_update_own on public.users
  for update using (auth.uid() = id)
  with check (auth.uid() = id and role = public.current_user_role());

-- Nodes are infrastructure-management resources (Owner Panel/Admin only).
drop policy if exists nodes_admin_all on public.nodes;
create policy nodes_admin_all on public.nodes
  for all using (public.is_admin()) with check (public.is_admin());
revoke select on public.nodes_public from anon, authenticated;

-- Servers: administrators manage, moderators read all, and users read only
-- servers explicitly assigned through server_users.
drop policy if exists servers_admin_all on public.servers;
drop policy if exists servers_select_assigned on public.servers;
create policy servers_admin_all on public.servers
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists servers_moderator_read_all on public.servers;
create policy servers_moderator_read_all on public.servers
  for select using (public.current_user_role() = 'moderator');
create policy servers_select_assigned on public.servers
  for select using (
    exists (
      select 1 from public.server_users su
      where su.server_id = servers.id and su.user_id = auth.uid()
    )
  );

-- Allocations are visible to users who can access the corresponding server.
drop policy if exists allocations_admin_all on public.allocations;
drop policy if exists allocations_select_own_servers on public.allocations;
create policy allocations_admin_all on public.allocations
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists allocations_select_accessible_servers on public.allocations;
create policy allocations_select_accessible_servers on public.allocations
  for select using (
    exists (
      select 1 from public.servers s
      where s.allocation_id = allocations.id
        and public.can_access_server(s.id)
    )
    or exists (
      select 1 from public.servers s
      where s.id = allocations.assigned_to
        and public.can_access_server(s.id)
    )
  );

-- server_users: users may see their own assignments. Server users with role
-- 'user' can manage subuser rows for that server; panel admins can manage all.
drop policy if exists server_users_admin_all on public.server_users;
drop policy if exists server_users_select_self on public.server_users;
drop policy if exists server_users_select_accessible on public.server_users;
drop policy if exists server_users_manage_subusers on public.server_users;
create policy server_users_select_accessible on public.server_users
  for select using (
    user_id = auth.uid()
    or public.is_admin()
    or public.can_assign_subusers(server_id)
  );
create policy server_users_manage_subusers on public.server_users
  for all
  using (
    public.is_admin()
    or (public.can_assign_subusers(server_id) and role = 'subuser')
  )
  with check (
    public.is_admin()
    or (public.can_assign_subusers(server_id) and role = 'subuser')
  );

-- Audit logs are visible only to Owner Panel, Admin, and Moderator.
drop policy if exists activity_admin_all on public.activity_logs;
drop policy if exists activity_select_own on public.activity_logs;
create policy activity_admin_all on public.activity_logs
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists activity_moderator_read_all on public.activity_logs;
create policy activity_moderator_read_all on public.activity_logs
  for select using (public.current_user_role() = 'moderator');

-- Backups: staff can read; moderators and assigned users can create; only
-- Owner Panel/Admin and assigned role='user' can delete. Subusers cannot delete.
drop policy if exists backups_admin_all on public.backups;
drop policy if exists backups_select_own_servers on public.backups;
create policy backups_admin_all on public.backups
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists backups_staff_read on public.backups;
drop policy if exists backups_assigned_read on public.backups;
drop policy if exists backups_moderator_create on public.backups;
drop policy if exists backups_assigned_create on public.backups;
drop policy if exists backups_user_delete on public.backups;
create policy backups_staff_read on public.backups
  for select using (public.current_user_role() in ('owner_panel', 'admin', 'moderator'));
create policy backups_assigned_read on public.backups
  for select using (
    exists (
      select 1 from public.server_users su
      where su.server_id = backups.server_id
        and su.user_id = auth.uid()
        and (
          (su.role = 'user' and public.current_user_role() = 'user')
          or su.permissions @> array['backups']::text[]
          or su.permissions @> array['*']::text[]
        )
    )
  );
create policy backups_moderator_create on public.backups
  for insert with check (public.current_user_role() = 'moderator');
create policy backups_assigned_create on public.backups
  for insert with check (
    exists (
      select 1 from public.server_users su
      where su.server_id = backups.server_id
        and su.user_id = auth.uid()
        and (
          (su.role = 'user' and public.current_user_role() = 'user')
          or su.permissions @> array['backups']::text[]
          or su.permissions @> array['*']::text[]
        )
    )
  );
create policy backups_user_delete on public.backups
  for delete using (
    public.current_user_role() = 'user'
    and exists (
      select 1 from public.server_users su
      where su.server_id = backups.server_id
        and su.user_id = auth.uid()
        and su.role = 'user'
    )
  );
