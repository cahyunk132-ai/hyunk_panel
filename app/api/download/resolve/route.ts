import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import {
  isDownloadProvider,
  normalizeDownloadVariables,
  resolveEggDownload,
  type DownloadProfile,
} from '@/lib/eggs/download-providers';
import type { EggVersionRow } from '@/types';

export const runtime = 'nodejs';

/**
 * GET /api/download/resolve — resolve URL download final untuk satu profil.
 *
 * Dua mode:
 *  1. `?egg_version_id={id}` — resolve versi tersimpan (query override opsional:
 *     minecraft_version, build, filename).
 *  2. Ad-hoc (untuk tombol "Test URL" sebelum versi disimpan):
 *     `?provider={type}&minecraft_version=&build=&url_template=&variables={json}&filename=`
 *
 * Response 200: { ok: true, provider, url, filename, size, extract, chmod }
 *               { ok: false, error }  — resolusi gagal (provider down, build tidak ada, dsb.)
 */
export async function GET(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const params = request.nextUrl.searchParams;
  const eggVersionId = params.get('egg_version_id')?.trim();
  const profile: DownloadProfile = { provider: 'none' };

  if (eggVersionId) {
    const service = getSupabaseServiceClient();
    const { data: version, error } = await service
      .from('egg_versions')
      .select('*')
      .eq('id', eggVersionId)
      .maybeSingle();
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    if (!version) {
      return Response.json({ ok: false, error: 'Versi egg tidak ditemukan.' }, { status: 404 });
    }
    const row = version as EggVersionRow;
    profile.provider = row.download_provider ?? 'none';
    profile.minecraftVersion = row.minecraft_version;
    profile.urlTemplate = row.download_url_template;
    profile.variables = row.download_variables;
    profile.filename = row.download_filename;
    profile.executable = row.download_executable;
  } else {
    const providerParam = params.get('provider')?.trim();
    if (!isDownloadProvider(providerParam)) {
      return Response.json(
        { ok: false, error: 'Parameter provider tidak valid atau kosong.' },
        { status: 400 },
      );
    }
    profile.provider = providerParam;
    const variablesParam = params.get('variables');
    if (variablesParam) {
      try {
        profile.variables = normalizeDownloadVariables(JSON.parse(variablesParam));
      } catch {
        return Response.json(
          { ok: false, error: 'Parameter variables harus berupa JSON object yang valid.' },
          { status: 400 },
        );
      }
    }
    profile.urlTemplate = params.get('url_template');
    profile.executable = params.get('executable') === 'true' || params.get('executable') === '1';
  }

  // Override opsional (berlaku untuk kedua mode).
  const mcParam = params.get('minecraft_version');
  if (mcParam !== null) profile.minecraftVersion = mcParam;
  const buildParam = params.get('build');
  if (buildParam !== null && buildParam.trim()) {
    profile.variables = { ...normalizeDownloadVariables(profile.variables), BUILD: buildParam.trim() };
  }
  const filenameParam = params.get('filename');
  if (filenameParam !== null) profile.filename = filenameParam;
  const templateParam = params.get('url_template');
  if (templateParam !== null) profile.urlTemplate = templateParam;

  try {
    const resolved = await resolveEggDownload(profile);
    return Response.json({
      ok: true,
      provider: resolved.provider,
      url: resolved.url,
      filename: resolved.filename,
      size: resolved.size,
      extract: resolved.extractAfterUpload,
      chmod: resolved.chmodTargets,
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal me-resolve URL download.',
    });
  }
}
