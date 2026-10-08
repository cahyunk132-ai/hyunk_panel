import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity, resolveServerWings } from '@/lib/wings/resolve';
import { getEggEnvDefaults, isJsonObject, normalizeEnvOverrides } from '@/lib/eggs/validation';
import type { ServerRow } from '@/types';

export const runtime = 'nodejs';

/**
 * POST /api/servers/{id}/startup — persist an Egg/Version configuration and
 * ask Wings to sync it before starting a reinstall.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  if (user.role !== 'owner_panel' && user.role !== 'admin' && user.role !== 'moderator') {
    return Response.json({ error: 'Hanya Owner Panel, Admin, atau Moderator yang dapat mengganti Egg dan versi.' }, { status: 403 });
  }
  const checked = await checkPermission(user, 'server.read', params.id);
  if (checked instanceof Response) return checked;

  const body = await request.json().catch(() => null);
  if (!isJsonObject(body)) return Response.json({ error: 'Body harus berupa object JSON.' }, { status: 400 });
  if (body.confirm !== true) {
    return Response.json({ error: 'Konfirmasi perubahan Egg dan reinstall diperlukan.' }, { status: 400 });
  }
  if (typeof body.egg_id !== 'string' || !body.egg_id.trim()) {
    return Response.json({ error: 'egg_id wajib diisi.' }, { status: 400 });
  }
  if (body.version_id !== undefined && body.version_id !== null && typeof body.version_id !== 'string') {
    return Response.json({ error: 'version_id harus berupa ID versi atau null.' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { data: assignment, error: assignmentError } = await service
    .from('node_eggs')
    .select('egg_id')
    .eq('node_id', checked.server.node_id)
    .eq('egg_id', body.egg_id)
    .maybeSingle();
  if (assignmentError) return Response.json({ error: assignmentError.message }, { status: 500 });
  if (!assignment) {
    return Response.json({ error: 'Egg ini belum tersedia pada node server tersebut.' }, { status: 400 });
  }

  const { data: egg, error: eggError } = await service
    .from('eggs')
    .select('id, name, docker_image, startup, env_variables')
    .eq('id', body.egg_id)
    .maybeSingle();
  if (eggError) return Response.json({ error: eggError.message }, { status: 500 });
  if (!egg) return Response.json({ error: 'Egg tidak ditemukan.' }, { status: 404 });

  let version: {
    id: string;
    name: string;
    minecraft_version: string | null;
    docker_image: string | null;
    env_overrides: unknown;
  } | null = null;
  if (typeof body.version_id === 'string' && body.version_id.trim()) {
    const { data, error } = await service
      .from('egg_versions')
      .select('id, name, minecraft_version, docker_image, env_overrides')
      .eq('id', body.version_id)
      .eq('egg_id', egg.id)
      .maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data) return Response.json({ error: 'Versi tidak ditemukan pada Egg yang dipilih.' }, { status: 400 });
    version = data;
  }

  const image = version?.docker_image || (egg.docker_image as string);
  const startup = egg.startup as string;
  if (!image?.trim() || !startup?.trim()) {
    return Response.json({ error: 'Egg tidak memiliki Docker image atau startup command yang valid.' }, { status: 400 });
  }

  const environment = getEggEnvDefaults(egg.env_variables);
  // Keep a server's existing values only for variables supported by the target Egg.
  for (const key of Object.keys(environment)) {
    const existingValue = checked.server.env?.[key];
    if (typeof existingValue === 'string') environment[key] = existingValue;
  }
  Object.assign(environment, normalizeEnvOverrides(version?.env_overrides));
  if (version?.minecraft_version && Object.prototype.hasOwnProperty.call(environment, 'MINECRAFT_VERSION')) {
    environment.MINECRAFT_VERSION = version.minecraft_version;
  }

  // Resolve the node before writing so a missing node/token never leaves a
  // partially changed server configuration.
  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const { data: updated, error: updateError } = await service
    .from('servers')
    .update({
      image,
      startup,
      env: environment,
      egg_id: egg.id,
      egg_version_id: version?.id ?? null,
    })
    .eq('id', checked.server.id)
    .select('*')
    .single();
  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

  try {
    await resolved.client.syncServer(checked.server.uuid);
    await resolved.client.reinstallServer(checked.server.uuid);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal menyinkronkan konfigurasi atau memulai reinstall.';
    await logActivity({
      userId: user.id,
      serverId: checked.server.id,
      action: 'server:startup-change-failed',
      metadata: {
        egg_id: egg.id,
        egg_version_id: version?.id ?? null,
        configuration_saved: true,
        wings_error: message,
      },
    });
    return Response.json(
      { error: `Konfigurasi tersimpan, tetapi Wings gagal menjalankan reinstall: ${message}`, configuration_saved: true },
      { status: 502 },
    );
  }

  const { error: statusError } = await service
    .from('servers')
    .update({ status: 'installing' })
    .eq('id', checked.server.id);
  if (statusError) {
    return Response.json(
      { error: `Wings menerima reinstall, tetapi status panel gagal diperbarui: ${statusError.message}` },
      { status: 500 },
    );
  }

  await logActivity({
    userId: user.id,
    serverId: checked.server.id,
    action: 'server:startup-change',
    metadata: {
      egg_id: egg.id,
      egg_name: egg.name,
      egg_version_id: version?.id ?? null,
      egg_version_name: version?.name ?? null,
      image,
    },
  });

  return Response.json(
    { ok: true, status: 'installing', server: updated as ServerRow, egg: { id: egg.id, name: egg.name }, version },
    { status: 202 },
  );
}
