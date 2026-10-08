import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
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
 * GET /api/admin/eggs/{id}/versions/{vid}/test-download
 *
 * Test resolve URL dari konfigurasi versi TERSIMPAN — tanpa men-download file.
 * Query override opsional (provider, minecraft_version, build, url_template,
 * variables, filename) memungkinkan owner menguji perubahan sebelum di-save.
 *
 * Response 200: { resolvable: true, url, filename, size }
 *               { resolvable: false, error }
 */
export async function GET(request: NextRequest, { params }: { params: { id: string; vid: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const service = getSupabaseServiceClient();
  const { data: version, error } = await service
    .from('egg_versions')
    .select('*')
    .eq('id', params.vid)
    .eq('egg_id', params.id)
    .maybeSingle();
  if (error) return Response.json({ resolvable: false, error: error.message }, { status: 500 });
  if (!version) {
    return Response.json({ resolvable: false, error: 'Versi egg tidak ditemukan.' }, { status: 404 });
  }
  const row = version as EggVersionRow;

  const search = request.nextUrl.searchParams;
  const profile: DownloadProfile = {
    provider: row.download_provider ?? 'none',
    minecraftVersion: row.minecraft_version,
    urlTemplate: row.download_url_template,
    variables: row.download_variables,
    filename: row.download_filename,
    executable: row.download_executable,
  };

  const providerParam = search.get('provider');
  if (providerParam !== null) {
    if (!isDownloadProvider(providerParam)) {
      return Response.json({ resolvable: false, error: 'Parameter provider tidak valid.' });
    }
    profile.provider = providerParam;
  }
  const mcParam = search.get('minecraft_version');
  if (mcParam !== null) profile.minecraftVersion = mcParam;
  const buildParam = search.get('build');
  if (buildParam !== null && buildParam.trim()) {
    profile.variables = { ...normalizeDownloadVariables(profile.variables), BUILD: buildParam.trim() };
  }
  const templateParam = search.get('url_template');
  if (templateParam !== null) profile.urlTemplate = templateParam;
  const filenameParam = search.get('filename');
  if (filenameParam !== null) profile.filename = filenameParam;
  const variablesParam = search.get('variables');
  if (variablesParam !== null) {
    try {
      profile.variables = normalizeDownloadVariables(JSON.parse(variablesParam));
    } catch {
      return Response.json({ resolvable: false, error: 'Parameter variables bukan JSON valid.' });
    }
  }

  try {
    const resolved = await resolveEggDownload(profile);
    return Response.json({
      resolvable: true,
      provider: resolved.provider,
      url: resolved.url,
      filename: resolved.filename,
      size: resolved.size,
      extract: resolved.extractAfterUpload,
      chmod: resolved.chmodTargets,
    });
  } catch (err) {
    return Response.json({
      resolvable: false,
      error: err instanceof Error ? err.message : 'Gagal me-resolve URL download.',
    });
  }
}
