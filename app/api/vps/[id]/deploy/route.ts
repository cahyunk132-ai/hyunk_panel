import crypto from 'node:crypto';
import JSZip from 'jszip';
import { canManageVps } from '@/lib/vps/access';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { isAuthorizedVps, requireVpsAccess } from '@/lib/vps/http';
import {
  commandOutput,
  getDefaultDeployPath,
  isSafeArchiveEntry,
  shellQuote,
  validateAppName,
  validateDeployPath,
  validateInterpreter,
} from '@/lib/vps/commands';
import { execVpsCommand, runVpsCommand, uploadVpsDeployArchive } from '@/lib/vps/ssh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const ACCEPTED_ZIP_TYPES = new Set(['application/zip', 'application/x-zip-compressed', 'multipart/x-zip', '']);

type DeployLogStatus = 'pending' | 'running' | 'success' | 'failed';

function formText(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validateEntryPath(value: string): string {
  const entry = value.trim();
  if (!entry || entry.startsWith('/') || entry.startsWith('-') || entry.split('/').some((part) => part === '..')) {
    throw new Error('Entry point aplikasi tidak valid');
  }
  if (/[\u0000-\u001f\u007f]/.test(entry)) throw new Error('Entry point aplikasi tidak valid');
  return entry;
}

function safeZipEntries(output: string): string[] {
  const entries = output.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  if (entries.some((entry) => !isSafeArchiveEntry(entry))) {
    throw new Error('ZIP ditolak karena mengandung path traversal');
  }
  return entries;
}

async function validateZipBuffer(buffer: Buffer): Promise<void> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(buffer, { checkCRC32: true });
  } catch {
    throw new Error('File bukan ZIP yang valid');
  }
  const entries = Object.values(archive.files) as Array<JSZip.JSZipObject & { unsafeOriginalName?: string; unixPermissions?: number | string }>;
  if (entries.length === 0) throw new Error('ZIP tidak berisi file');
  for (const entry of entries) {
    const originalName = entry.unsafeOriginalName ?? entry.name;
    if (!isSafeArchiveEntry(originalName)) {
      throw new Error('ZIP ditolak karena mengandung path traversal');
    }
    const permissions = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0;
    if ((permissions & 0o170000) === 0o120000) {
      throw new Error('ZIP ditolak karena mengandung symbolic link');
    }
  }
}

function outputHandler(
  send: (payload: Record<string, unknown>) => void,
  append: (line: string) => void,
) {
  return (chunk: string, channel: 'stdout' | 'stderr') => {
    for (const line of chunk.replaceAll('\r', '').split('\n')) {
      if (!line.trim()) continue;
      const rendered = channel === 'stderr' ? `[stderr] ${line}` : line;
      append(rendered);
      send({ log: rendered, done: false });
    }
  };
}

/** POST /api/vps/{id}/deploy — upload and deploy a ZIP with SSE progress. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;
  if (!canManageVps(access.user, access.vps)) {
    return Response.json({ error: 'Hanya pemilik VPS atau admin yang dapat melakukan deploy' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Form deploy tidak valid' }, { status: 400 });
  }

  const fileValue = form.get('file');
  const appNameValue = formText(form.get('appName'));
  const deployPathValue = formText(form.get('deployPath'));
  const interpreterValue = formText(form.get('interpreter'));
  const autoStart = formText(form.get('autoStart')) !== 'false';

  if (!fileValue || typeof fileValue !== 'object' || !('arrayBuffer' in fileValue)) {
    return Response.json({ error: 'File ZIP wajib diunggah' }, { status: 400 });
  }
  const file = fileValue as File;
  if (file.size <= 0 || file.size > MAX_ZIP_BYTES) {
    return Response.json({ error: 'Ukuran ZIP harus lebih dari 0 dan maksimal 100 MB' }, { status: 400 });
  }
  if (!ACCEPTED_ZIP_TYPES.has(file.type) && !file.name.toLowerCase().endsWith('.zip')) {
    return Response.json({ error: 'File harus berupa ZIP' }, { status: 400 });
  }

  let appName: string;
  let deployPath: string;
  let interpreter: string | undefined;
  try {
    appName = validateAppName(appNameValue);
    deployPath = validateDeployPath(deployPathValue || getDefaultDeployPath(access.vps, appName));
    interpreter = validateInterpreter(interpreterValue);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Parameter deploy tidak valid' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_ZIP_BYTES) {
    return Response.json({ error: 'Ukuran ZIP maksimal 100 MB' }, { status: 400 });
  }
  try {
    await validateZipBuffer(buffer);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'ZIP tidak valid' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { data: deployLog, error: insertError } = await service
    .from('vps_deploy_logs')
    .insert({
      vps_id: access.vps.id,
      app_name: appName,
      deploy_path: deployPath,
      status: 'pending',
      log: '',
      deployed_by: access.user.id,
    })
    .select('id')
    .single();
  if (insertError || !deployLog) {
    return Response.json({ error: insertError?.message ?? 'Riwayat deploy tidak dapat dibuat' }, { status: 500 });
  }

  const tempZip = `/tmp/hyunk-${appName}-${crypto.randomUUID()}.zip`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let logLines: string[] = [];
      const send = (payload: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const append = (line: string) => {
        logLines.push(line);
        if (logLines.length > 2000) logLines = logLines.slice(-2000);
      };
      const persist = async (status: DeployLogStatus) => {
        try {
          const { error } = await service
            .from('vps_deploy_logs')
            .update({ status, log: logLines.join('\n').slice(-120_000) })
            .eq('id', deployLog.id);
          if (error) console.error('Failed to persist VPS deploy log', { deployLogId: deployLog.id, error: error.message });
        } catch (error) {
          console.error('Failed to persist VPS deploy log', {
            deployLogId: deployLog.id,
            error: error instanceof Error ? error.message : 'unknown error',
          });
        }
      };
      const emitStep = (step: string) => {
        append(step);
        send({ step, done: false });
      };
      const onOutput = outputHandler(send, append);
      const heartbeat = setInterval(() => send({ heartbeat: true }), 5_000);

      try {
        await persist('running');
        emitStep('Uploading...');
        await uploadVpsDeployArchive(access.vps, tempZip, buffer);

        emitStep('Preparing unzip...');
        const ensureUnzipCommand = [
          `if command -v unzip >/dev/null 2>&1; then :;`,
          `elif command -v apt-get >/dev/null 2>&1; then`,
          `  if [ "$(id -u)" -eq 0 ]; then apt-get update -qq && apt-get install -y -qq unzip;`,
          `  elif command -v sudo >/dev/null 2>&1; then sudo -n apt-get update -qq && sudo -n apt-get install -y -qq unzip;`,
          `  else exit 127; fi;`,
          `elif command -v yum >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then sudo -n yum install -y unzip;`,
          `else exit 127; fi`,
        ].join(' ');
        const unzipReady = await runVpsCommand(access.vps, ensureUnzipCommand, onOutput);
        if (unzipReady.code !== 0) throw new Error(commandOutput(unzipReady) || 'unzip tidak tersedia di VPS');

        emitStep('Checking ZIP contents...');
        const listing = await runVpsCommand(access.vps, `unzip -Z1 ${shellQuote(tempZip)}`);
        if (listing.code !== 0) throw new Error(commandOutput(listing) || 'ZIP tidak dapat dibaca di VPS');
        safeZipEntries(listing.stdout);

        emitStep('Extracting...');
        const extracted = await runVpsCommand(
          access.vps,
          `mkdir -p ${shellQuote(deployPath)} && unzip -o ${shellQuote(tempZip)} -d ${shellQuote(deployPath)}`,
          onOutput,
        );
        if (extracted.code !== 0) throw new Error(commandOutput(extracted) || 'Gagal mengekstrak ZIP');

        emitStep('Detecting app type...');
        const detection = await runVpsCommand(
          access.vps,
          `if [ -f ${shellQuote(`${deployPath}/package.json`)} ]; then printf node; elif [ -f ${shellQuote(`${deployPath}/requirements.txt`)} ]; then printf python; else printf other; fi`,
        );
        if (detection.code !== 0) throw new Error(commandOutput(detection) || 'Gagal mendeteksi tipe aplikasi');
        const detectedType = detection.stdout.trim();
        const appType = interpreter === 'node' || interpreter === 'nodejs'
          ? 'node'
          : interpreter === 'python' || interpreter === 'python3'
            ? 'python'
            : detectedType;

        if (appType === 'node') {
          emitStep('Installing dependencies (npm install)...');
          const install = await runVpsCommand(
            access.vps,
            `cd ${shellQuote(deployPath)} && npm install --no-audit --no-fund`,
            onOutput,
          );
          if (install.code !== 0) throw new Error(commandOutput(install) || 'npm install gagal');
        } else if (appType === 'python') {
          emitStep('Installing dependencies (pip install)...');
          const install = await runVpsCommand(
            access.vps,
            `cd ${shellQuote(deployPath)} && python3 -m pip install -r requirements.txt`,
            onOutput,
          );
          if (install.code !== 0) throw new Error(commandOutput(install) || 'pip install gagal');
        } else {
          emitStep('No dependency manifest found; skipping install.');
        }

        if (autoStart) {
          emitStep('Detecting entry point...');
          let entryResult;
          if (appType === 'node') {
            entryResult = await runVpsCommand(
              access.vps,
              [
                `if [ -f ${shellQuote(`${deployPath}/dist/index.js`)} ]; then printf '%s' 'dist/index.js';`,
                `elif [ -f ${shellQuote(`${deployPath}/index.js`)} ]; then printf '%s' 'index.js';`,
                `elif [ -f ${shellQuote(`${deployPath}/src/index.js`)} ]; then printf '%s' 'src/index.js';`,
                `elif command -v node >/dev/null 2>&1 && [ -f ${shellQuote(`${deployPath}/package.json`)} ]; then`,
                `  node -e 'const p=require(process.argv[1]); process.stdout.write(p.main || "")' ${shellQuote(`${deployPath}/package.json`)};`,
                `fi`,
              ].join(' '),
            );
          } else if (appType === 'python') {
            entryResult = await runVpsCommand(
              access.vps,
              [
                `if [ -f ${shellQuote(`${deployPath}/main.py`)} ]; then printf '%s' 'main.py';`,
                `elif [ -f ${shellQuote(`${deployPath}/app.py`)} ]; then printf '%s' 'app.py';`,
                `elif [ -f ${shellQuote(`${deployPath}/index.py`)} ]; then printf '%s' 'index.py'; fi`,
              ].join(' '),
            );
          } else {
            throw new Error('Entry point tidak dapat dideteksi; pilih auto-start hanya untuk Node.js atau Python');
          }
          if (entryResult.code !== 0) throw new Error(commandOutput(entryResult) || 'Gagal mendeteksi entry point');
          const entry = validateEntryPath(entryResult.stdout);
          const startInterpreter = interpreter || (appType === 'python' ? 'python3' : appType === 'node' ? 'node' : undefined);
          const startCommand = [
            `pm2 start ${shellQuote(entry)}`,
            `--name ${shellQuote(appName)}`,
            `--cwd ${shellQuote(deployPath)}`,
            startInterpreter ? `--interpreter ${shellQuote(startInterpreter)}` : '',
            '&& pm2 save',
          ].filter(Boolean).join(' ');
          emitStep('Starting app...');
          const started = await runVpsCommand(access.vps, startCommand, onOutput);
          if (started.code !== 0) throw new Error(commandOutput(started) || 'Gagal menjalankan app melalui PM2');
        }

        emitStep('Done!');
        await persist('success');
        send({ step: 'Done!', done: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Deploy gagal';
        append(`Error: ${message}`);
        await persist('failed');
        send({ step: `Error: ${message}`, done: true, error: true });
      } finally {
        clearInterval(heartbeat);
        try {
          await execVpsCommand(access.vps, `rm -f ${shellQuote(tempZip)}`);
        } catch {
          // Temporary archive cleanup is best-effort.
        }
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
