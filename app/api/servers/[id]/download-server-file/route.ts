import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity, resolveServerWings } from '@/lib/wings/resolve';
import { isJsonObject } from '@/lib/eggs/validation';
import { resolveEggDownload } from '@/lib/eggs/download-providers';
import type { EggVersionRow } from '@/types';

export const runtime = 'nodejs';
// Batas Vercel Hobby 60 detik. Naikkan (maks 300 di Pro) bila panel di-deploy
// pada plan/server yang mengizinkan request lebih panjang — file besar (>100 MB
// di koneksi lambat) bisa melebihi 60 detik.
export const maxDuration = 60;

const TRANSFER_TIMEOUT_MS = 300_000;
const PROGRESS_STEP_BYTES = 256 * 1024;
const DOWNLOAD_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 HyunkPanel/0.1';

/**
 * POST /api/servers/{id}/download-server-file — { egg_version_id }
 *
 * Resolve URL dari konfigurasi auto-download versi → download streaming di
 * server-side → stream LANGSUNG ke Wings (tanpa buffer di memory) → ekstrak
 * bila arsip zip (bedrock) → chmod +x bila download_executable.
 *
 * Response adalah stream NDJSON (application/x-ndjson) agar UI dapat
 * menampilkan progress realtime. Event terakhir:
 *   { stage: 'done', success: true, filename, size }
 *   { stage: 'error', success: false, error }
 * Error validasi/auth (sebelum stream dimulai) tetap JSON biasa + status 4xx.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  if (user.role !== 'owner_panel' && user.role !== 'admin' && user.role !== 'moderator') {
    return Response.json(
      { error: 'Hanya Owner Panel, Admin, atau Moderator yang dapat men-download file server.' },
      { status: 403 },
    );
  }
  const checked = await checkPermission(user, 'server.read', params.id);
  if (checked instanceof Response) return checked;

  const body = await request.json().catch(() => null);
  if (!isJsonObject(body)) return Response.json({ error: 'Body harus berupa object JSON.' }, { status: 400 });
  if (typeof body.egg_version_id !== 'string' || !body.egg_version_id.trim()) {
    return Response.json({ error: 'egg_version_id wajib diisi.' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { data: version, error: versionError } = await service
    .from('egg_versions')
    .select('*')
    .eq('id', body.egg_version_id.trim())
    .maybeSingle();
  if (versionError) return Response.json({ error: versionError.message }, { status: 500 });
  if (!version) return Response.json({ error: 'Versi egg tidak ditemukan.' }, { status: 404 });
  const row = version as EggVersionRow;
  if (!row.download_provider || row.download_provider === 'none') {
    return Response.json(
      { error: 'Versi ini memakai upload manual (download_provider: none).' },
      { status: 400 },
    );
  }

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;
  const client = resolved.client;
  const serverUuid = resolved.server.uuid;

  const encoder = new TextEncoder();
  const transferAbort = new AbortController();
  const transferTimeout = setTimeout(() => transferAbort.abort(), TRANSFER_TIMEOUT_MS);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };

      try {
        // ── 1. Resolve URL ──────────────────────────────────────────────────
        send({ stage: 'resolving', message: 'Resolving download URL…' });
        const plan = await resolveEggDownload({
          provider: row.download_provider,
          minecraftVersion: row.minecraft_version,
          urlTemplate: row.download_url_template,
          variables: row.download_variables,
          filename: row.download_filename,
          executable: row.download_executable,
        });
        send({
          stage: 'resolved',
          provider: plan.provider,
          url: plan.url,
          filename: plan.filename,
          size: plan.size,
        });

        // ── 2. Download (streaming) → 3. Upload ke Wings (streaming) ────────
        let downloaded = 0;
        let total: number | null = plan.size;
        try {
          const downloadResponse = await fetch(plan.url, {
            headers: { 'User-Agent': DOWNLOAD_USER_AGENT },
            cache: 'no-store',
            redirect: 'follow',
            signal: transferAbort.signal,
          });
          if (!downloadResponse.ok || !downloadResponse.body) {
            throw new Error(
              `Sumber download merespons HTTP ${downloadResponse.status}${downloadResponse.status === 404 ? ' — URL mungkin salah atau build sudah dihapus' : ''}.`,
            );
          }
          const lengthHeader = Number(downloadResponse.headers.get('content-length'));
          if (Number.isFinite(lengthHeader) && lengthHeader > 0) total = lengthHeader;

          send({ stage: 'downloading', bytes: 0, total });
          const reader = downloadResponse.body.getReader();
          let lastProgressSent = 0;
          const uploadBody = new ReadableStream<Uint8Array>({
            async pull(pullController) {
              try {
                const { done, value } = await reader.read();
                if (done) {
                  pullController.close();
                  return;
                }
                downloaded += value.byteLength;
                if (downloaded - lastProgressSent >= PROGRESS_STEP_BYTES) {
                  lastProgressSent = downloaded;
                  send({ stage: 'downloading', bytes: downloaded, total });
                }
                pullController.enqueue(value);
              } catch (err) {
                pullController.error(err);
              }
            },
            async cancel(reason) {
              await reader.cancel(reason).catch(() => undefined);
            },
          });

          await client.writeFileStream(serverUuid, plan.filename, uploadBody, total ?? undefined);
          send({ stage: 'uploading', bytes: downloaded, total, message: 'Upload ke Wings selesai.' });
        } catch (err) {
          // Bersihkan file parsial agar tidak ada jar/zip korup di root server.
          await client.deleteFiles(serverUuid, '/', [plan.filename]).catch(() => undefined);
          throw err;
        }

        // ── 4a. Ekstrak arsip (bedrock zip) ─────────────────────────────────
        if (plan.extractAfterUpload) {
          send({ stage: 'extracting', filename: plan.filename });
          await client.decompressFile(serverUuid, '/', plan.filename);
          await client.deleteFiles(serverUuid, '/', [plan.filename]).catch(() => undefined);
        }

        // ── 4b. chmod +x untuk binary non-jar ───────────────────────────────
        if (plan.chmodTargets.length > 0) {
          send({ stage: 'chmod', files: plan.chmodTargets });
          await client.chmodFiles(
            serverUuid,
            '/',
            plan.chmodTargets.map((file) => ({ file, mode: '0755' })),
          );
        }

        send({ stage: 'done', success: true, filename: plan.filename, size: downloaded });
        await logActivity({
          userId: user.id,
          serverId: checked.server.id,
          action: 'server:download-server-file',
          metadata: {
            egg_version_id: row.id,
            provider: plan.provider,
            filename: plan.filename,
            size_bytes: downloaded,
            url: plan.url,
          },
        });
      } catch (err) {
        const aborted =
          err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
        const message = aborted
          ? `Download melebihi batas waktu. File terlalu besar untuk timeout platform (Vercel 60 detik) — upload manual via File Manager.`
          : err instanceof Error
            ? err.message
            : 'Download gagal.';
        send({ stage: 'error', success: false, error: message });
        await logActivity({
          userId: user.id,
          serverId: checked.server.id,
          action: 'server:download-server-file-failed',
          metadata: { egg_version_id: row.id, provider: row.download_provider, error: message },
        });
      } finally {
        clearTimeout(transferTimeout);
        if (!closed) {
          try {
            controller.close();
          } catch {
            // stream sudah ditutup/dibatalkan client
          }
        }
      }
    },
    cancel() {
      clearTimeout(transferTimeout);
      transferAbort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
