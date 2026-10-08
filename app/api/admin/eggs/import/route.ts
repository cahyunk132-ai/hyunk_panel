import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';
import { isJsonObject } from '@/lib/eggs/validation';

export const runtime = 'nodejs';

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** POST /api/admin/eggs/import — import a Pterodactyl egg export (.json). */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Request harus berisi multipart form dengan file JSON.' }, { status: 400 });
  }
  const upload = form.get('file');
  if (!upload || typeof upload === 'string') {
    return Response.json({ error: 'File egg .json wajib dipilih.' }, { status: 400 });
  }
  const file = upload as File;
  if (!file.name.toLowerCase().endsWith('.json')) {
    return Response.json({ error: 'Format file harus .json.' }, { status: 400 });
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return Response.json({ error: 'Ukuran file maksimal 2 MB.' }, { status: 413 });
  }

  let source: unknown;
  try {
    source = JSON.parse(await file.text());
  } catch {
    return Response.json({ error: 'File bukan JSON valid.' }, { status: 400 });
  }
  if (!isJsonObject(source)) {
    return Response.json({ error: 'File JSON harus berisi object egg Pterodactyl.' }, { status: 400 });
  }

  const meta = isJsonObject(source.meta) ? source.meta : {};
  const config = isJsonObject(source.config) ? source.config : {};
  const nameValue =
    (typeof source.name === 'string' && source.name.trim()) ||
    (typeof meta.name === 'string' && meta.name.trim()) ||
    file.name.replace(/\.json$/i, '');
  const name = nameValue.trim();
  const description =
    (typeof source.description === 'string' && source.description) ||
    (typeof meta.description === 'string' && meta.description) ||
    null;
  const startup = typeof source.startup === 'string' ? source.startup : '';
  const dockerImages = isJsonObject(source.docker_images) ? source.docker_images : {};
  const imageEntries = Object.entries(dockerImages)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()))
    .map(([label, image]) => ({ label: label.trim() || 'Default', image: image.trim() }));
  if (imageEntries.length === 0 && typeof source.docker_image === 'string' && source.docker_image.trim()) {
    imageEntries.push({ label: 'Default', image: source.docker_image.trim() });
  }

  if (!startup.trim()) return Response.json({ error: 'Field startup tidak ditemukan di egg JSON.' }, { status: 400 });
  if (imageEntries.length === 0) {
    return Response.json({ error: 'Field docker_images tidak berisi Docker image yang valid.' }, { status: 400 });
  }

  const variables = Array.isArray(source.variables) ? source.variables : [];
  const features = Array.isArray(source.features)
    ? source.features.filter((feature): feature is string => typeof feature === 'string')
    : [];
  const configStartup = isJsonObject(config.startup) ? config.startup : {};
  const configStop = typeof config.stop === 'string' ? config.stop : 'stop';
  if (!name) return Response.json({ error: 'Nama Egg tidak ditemukan di file JSON.' }, { status: 400 });

  const service = getSupabaseServiceClient();
  const { data: egg, error } = await service
    .from('eggs')
    .insert({
      name,
      description,
      docker_image: imageEntries[0].image,
      startup,
      config_stop: configStop,
      config_startup: configStartup,
      env_variables: variables,
      features,
      created_by: admin.id,
    })
    .select('*')
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const versions = imageEntries.map((entry, index) => {
    const mcVersion = entry.label.match(/\b(?:minecraft\s*)?v?(\d+\.\d+(?:\.\d+)?)\b/i)?.[1] ?? null;
    return {
      egg_id: egg.id,
      name: entry.label,
      minecraft_version: mcVersion,
      docker_image: entry.image,
      env_overrides: {},
      is_recommended: index === 0,
      sort_order: index,
    };
  });
  const { data: insertedVersions, error: versionsError } = await service
    .from('egg_versions')
    .insert(versions)
    .select('*');
  if (versionsError) {
    await service.from('eggs').delete().eq('id', egg.id);
    return Response.json({ error: `Egg dibuat tetapi versi gagal disimpan: ${versionsError.message}` }, { status: 500 });
  }

  await logActivity({
    userId: admin.id,
    action: 'egg:import',
    metadata: { egg_id: egg.id, name: egg.name, filename: file.name, version_count: versions.length },
  });
  return Response.json({ egg: { ...egg, versions: insertedVersions ?? [] } }, { status: 201 });
}
