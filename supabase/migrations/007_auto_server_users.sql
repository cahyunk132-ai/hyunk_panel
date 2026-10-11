-- Tambahkan server_users row yang hilang untuk server yang sudah ada
INSERT INTO public.server_users (server_id, user_id, role, permissions)
SELECT
  s.id,
  s.owner_id,
  'user',
  array[
    'start', 'stop', 'restart', 'console', 'console.send', 'monitoring',
    'files.read', 'files.edit', 'backups', 'backup.restore', 'backups.delete',
    'backup.schedule', 'players', 'backups.delete'
  ]::text[]
FROM public.servers s
JOIN public.users u ON u.id = s.owner_id
WHERE u.role IN ('user', 'moderator')
  AND s.owner_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.server_users su
    WHERE su.server_id = s.id AND su.user_id = s.owner_id
  )
ON CONFLICT DO NOTHING;

-- Buat trigger: setiap server baru otomatis dapat row server_users untuk owner-nya
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
        'backup.schedule', 'players', 'backups.delete'
      ]::text[]
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_assign_server_owner ON public.servers;
CREATE TRIGGER trg_auto_assign_server_owner
  AFTER INSERT ON public.servers
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_server_owner();
