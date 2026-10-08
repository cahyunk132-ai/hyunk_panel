import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { normalizeEnvOverrides } from '@/lib/eggs/validation';
import type { DownloadProvider } from '@/types';

export const runtime = 'nodejs';

interface EggVersionRecord {
  id: string;
  egg_id: string;
  name: string;
  minecraft_version: string | null;
  docker_image: string | null;
  env_overrides: unknown;
  is_recommended: boolean;
  sort_order: number;
  download_provider: DownloadProvider | null;
  download_filename: string | null;
  download_executable: boolean | null;
}

interface EggRecord {
  id: string;
  name: string;
  description: string | null;
  docker_image: string;
  startup: string;
  config_stop: string | null;
  config_startup: Record<string, unknown> | null;
  env_variables: unknown;
  features: string[] | null;
  egg_versions: EggVersionRecord[] | null;
}

function envOverridesMatch(overrides: unknown, currentEnv: Record<string, string>): boolean {
  return Object.entries(normalizeEnvOverrides(overrides)).every(([key, value]) => currentEnv[key] === value);
}

function eggMatchesServer(egg: EggRecord, server: { image: string; startup: string }): boolean {
  if (egg.startup !== server.startup) return false;
  return (
    egg.docker_image === server.image ||
    (egg.egg_versions ?? []).some((version) => (version.docker_image || egg.docker_image) === server.image)
  );
}

/** GET /api/servers/{id}/eggs — node-specific Egg choices + current Egg/Version. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const checked = await checkPermission(user, 'server.read', params.id);
  if (checked instanceof Response) return checked;

  const canChange = user.role === 'owner_panel' || user.role === 'admin' || user.role === 'moderator';
  const service = getSupabaseServiceClient();
  const [{ data: assignments, error: assignmentError }, { data: rows, error: eggError }] = await Promise.all([
    service.from('node_eggs').select('egg_id').eq('node_id', checked.server.node_id),
    service
      .from('eggs')
      .select(
        'id, name, description, docker_image, startup, config_stop, config_startup, env_variables, features, egg_versions(id, egg_id, name, minecraft_version, docker_image, env_overrides, is_recommended, sort_order, download_provider, download_filename, download_executable)',
      )
      .order('name', { ascending: true }),
  ]);
  if (assignmentError || eggError) {
    return Response.json({ error: assignmentError?.message ?? eggError?.message }, { status: 500 });
  }

  const availableIds = new Set((assignments ?? []).map((row) => row.egg_id as string));
  const eggs = ((rows ?? []) as unknown as EggRecord[]).map((egg) => ({
    ...egg,
    egg_versions: [...(egg.egg_versions ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
    ),
  }));
  const currentEnv = checked.server.env ?? {};

  let currentEgg: EggRecord | undefined = checked.server.egg_id
    ? eggs.find((egg) => egg.id === checked.server.egg_id)
    : undefined;
  let currentVersion: EggVersionRecord | undefined;

  // The generic server settings form can still edit image/startup directly;
  // don't report stale Egg metadata if that runtime configuration no longer matches.
  if (currentEgg && !eggMatchesServer(currentEgg, checked.server)) currentEgg = undefined;
  if (currentEgg && checked.server.egg_version_id) {
    currentVersion = currentEgg.egg_versions?.find((version) => version.id === checked.server.egg_version_id);
    if (currentVersion && (currentVersion.docker_image || currentEgg.docker_image) !== checked.server.image) {
      currentVersion = undefined;
    }
  }

  if (!currentEgg) {
    currentEgg = eggs.find((egg) => eggMatchesServer(egg, checked.server));
  }

  if (currentEgg && !currentVersion) {
    const matchingVersions = (currentEgg.egg_versions ?? []).filter(
      (version) => (version.docker_image || currentEgg!.docker_image) === checked.server.image,
    );
    currentVersion =
      matchingVersions.find((version) => envOverridesMatch(version.env_overrides, currentEnv)) ??
      (matchingVersions.length === 1 ? matchingVersions[0] : undefined);
  }

  const current = {
    egg_id: currentEgg?.id ?? null,
    version_id: currentVersion?.id ?? null,
    egg_name: currentEgg?.name ?? null,
    version_name: currentVersion?.name ?? null,
    image: checked.server.image,
    startup: checked.server.startup,
  };
  const { data: allocation } = checked.server.allocation_id
    ? await service.from('allocations').select('ip, port').eq('id', checked.server.allocation_id).maybeSingle()
    : { data: null };
  const previewContext = {
    SERVER_MEMORY: String(checked.server.memory_mb),
    SERVER_IP: (allocation?.ip as string | undefined) ?? '0.0.0.0',
    SERVER_PORT: String(allocation?.port ?? 0),
  };

  if (!canChange) {
    // Viewer roles receive only the selected template, never the node's other Eggs.
    return Response.json({ can_change: false, eggs: [], current, preview_context: previewContext });
  }

  const visibleEggs = eggs
    .filter((egg) => availableIds.has(egg.id) || egg.id === currentEgg?.id)
    .map((egg) => ({
      id: egg.id,
      name: egg.name,
      description: egg.description,
      docker_image: egg.docker_image,
      startup: egg.startup,
      config_stop: egg.config_stop,
      config_startup: egg.config_startup ?? {},
      env_variables: Array.isArray(egg.env_variables) ? egg.env_variables : [],
      features: egg.features ?? [],
      versions: egg.egg_versions ?? [],
      available: availableIds.has(egg.id),
    }));

  return Response.json({ can_change: true, eggs: visibleEggs, current, preview_context: previewContext });
}
