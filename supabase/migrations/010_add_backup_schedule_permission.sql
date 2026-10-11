-- 010: Tambahkan permission `backup.schedule` ke server_users yang sudah ada
-- dan perbarui trigger auto_assign_server_owner agar server baru juga mendapatkannya.
-- (Nama 008 sudah dipakai oleh 008_count_user_subdomains.sql.)

-- Fix 1: backfill row existing yang punya 'backups' tapi belum punya 'backup.schedule'
UPDATE public.server_users
SET permissions = array_append(permissions, 'backup.schedule')
WHERE 'backups' = ANY(permissions)
  AND NOT ('backup.schedule' = ANY(permissions));

-- Fix 2: update trigger default permissions (dedupe 'backups.delete')
CREATE OR REPLACE FUNCTION public.auto_assign_server_owner()
RETURNS TRIGGER AS $$
DECLARE
  owner_role TEXT;
BEGIN
  SELECT role INTO owner_role FROM public.users WHERE id = NEW.owner_id;
  IF owner_role IN ('user', 'moderator') THEN
    INSERT INTO public.server_users (server_id, user_id, role, permissions)
    VALUES (
      NEW.id,
      NEW.owner_id,
      'user',
      array[
        'start', 'stop', 'restart', 'console', 'console.send', 'monitoring',
        'files.read', 'files.edit', 'backups', 'backup.restore', 'backups.delete',
        'backup.schedule', 'players'
      ]::text[]
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
