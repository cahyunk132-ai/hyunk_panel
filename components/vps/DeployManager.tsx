'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Input';
import { toast } from '@/lib/utils/toast';

interface DeployEvent {
  id: number;
  text: string;
  tone?: 'error' | 'success';
}

interface DeployHistoryItem {
  id: string;
  app_name: string;
  deploy_path: string;
  status: string;
  log: string | null;
  deployed_by: string | null;
  created_at: string;
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const value = (body as { error?: unknown }).error;
    if (typeof value === 'string' && value) return value;
  }
  return fallback;
}

function defaultPath(username: string, appName: string): string {
  const home = username === 'root' ? '/root' : `/home/${username}`;
  return `${home}/apps/${appName || 'my-app'}`;
}

function statusTone(status: string): 'green' | 'red' | 'yellow' | 'gray' {
  if (status === 'success') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'running' || status === 'pending') return 'yellow';
  return 'gray';
}

const MAX_ZIP_BYTES = 100 * 1024 * 1024;

export function DeployManager({
  vpsId,
  username,
  canManage,
}: {
  vpsId: string;
  username: string;
  canManage: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [appName, setAppName] = useState('my-app');
  const [deployPath, setDeployPath] = useState(() => defaultPath(username, 'my-app'));
  const [pathTouched, setPathTouched] = useState(false);
  const [interpreter, setInterpreter] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [events, setEvents] = useState<DeployEvent[]>([]);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [history, setHistory] = useState<DeployHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [env, setEnv] = useState<Record<string, string>>({});
  const [envLoading, setEnvLoading] = useState(false);
  const [envSaving, setEnvSaving] = useState(false);
  const [envLoadedFor, setEnvLoadedFor] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const eventId = useRef(0);

  const envTarget = useMemo(() => `${appName.trim()}::${deployPath.trim()}`, [appName, deployPath]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/vps/${encodeURIComponent(vpsId)}/deploy/history`, { cache: 'no-store' });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal membaca deploy history.'));
      setHistory(Array.isArray((body as { logs?: unknown }).logs) ? (body as { logs: DeployHistoryItem[] }).logs : []);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Gagal membaca deploy history.');
    } finally {
      setHistoryLoading(false);
    }
  }, [vpsId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    void loadEnvironment();
    // Initial app/path only; changes are loaded explicitly to avoid overwriting edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, vpsId]);

  function chooseFile(candidate: File | null) {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith('.zip') && candidate.type !== 'application/zip') {
      toast.error('Pilih file ZIP.');
      return;
    }
    if (candidate.size > MAX_ZIP_BYTES) {
      toast.error('Ukuran ZIP maksimal 100 MB.');
      return;
    }
    setFile(candidate);
    setDeployError(null);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0] ?? null);
    event.target.value = '';
  }

  function updateAppName(value: string) {
    setAppName(value);
    setEnv({});
    setEnvLoadedFor(null);
    if (!pathTouched) setDeployPath(defaultPath(username, value));
  }

  function addEvent(text: string, tone?: DeployEvent['tone']) {
    setEvents((current) => [...current, { id: eventId.current++, text, tone }].slice(-250));
  }

  async function deploy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || deploying) return;
    if (!file) {
      setDeployError('Pilih file ZIP terlebih dahulu.');
      return;
    }
    if (file.size > MAX_ZIP_BYTES) {
      setDeployError('Ukuran ZIP maksimal 100 MB.');
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(appName.trim())) {
      setDeployError('Nama app hanya boleh berisi alphanumeric, dash, atau underscore.');
      return;
    }
    if (!deployPath.trim()) {
      setDeployError('Deploy path wajib diisi.');
      return;
    }

    const form = new FormData();
    form.append('file', file);
    form.append('appName', appName.trim());
    form.append('deployPath', deployPath.trim());
    form.append('interpreter', interpreter);
    form.append('autoStart', String(autoStart));
    setDeploying(true);
    setDeployError(null);
    setEvents([]);
    addEvent(`Starting deploy ${appName.trim()}…`);

    try {
      const response = await fetch(`/api/vps/${encodeURIComponent(vpsId)}/deploy`, { method: 'POST', body: form });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        throw new Error(errorMessage(body, 'Deploy gagal dimulai.'));
      }
      if (!response.body) throw new Error('Server tidak mengirim progress stream.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let doneEvent = false;
      let streamError: string | null = null;
      const readSse = (payload: string) => {
        for (const line of payload.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            const data = JSON.parse(line.slice(5).trim()) as { step?: unknown; log?: unknown; done?: boolean; error?: boolean };
            if (typeof data.step === 'string') {
              addEvent(data.step, data.error ? 'error' : data.done ? 'success' : undefined);
              if (data.error) streamError = data.step;
            }
            if (typeof data.log === 'string') addEvent(data.log);
            if (data.done) doneEvent = true;
          } catch {
            // Ignore an incomplete/malformed heartbeat frame.
          }
        }
      };

      while (true) {
        const chunk = await reader.read();
        pending += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
        const frames = pending.split('\n\n');
        pending = frames.pop() ?? '';
        frames.forEach(readSse);
        if (chunk.done) break;
      }
      if (pending.trim()) readSse(pending);
      if (!doneEvent) throw new Error('Deploy berhenti sebelum menerima status selesai.');
      if (streamError) throw new Error(streamError);
      await Promise.all([loadHistory(), loadEnvironment(true)]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Deploy gagal.';
      setDeployError(message);
      addEvent(message, 'error');
    } finally {
      setDeploying(false);
    }
  }

  async function loadEnvironment(force = false) {
    if (!appName.trim() || !deployPath.trim() || (!force && envLoadedFor === envTarget)) return;
    setEnvLoading(true);
    try {
      const query = new URLSearchParams({ app: appName.trim(), deployPath: deployPath.trim() });
      const response = await fetch(`/api/vps/${encodeURIComponent(vpsId)}/env?${query.toString()}`, { cache: 'no-store' });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal membaca environment variable.'));
      const next = (body as { env?: unknown }).env;
      setEnv(next && typeof next === 'object' && !Array.isArray(next) ? next as Record<string, string> : {});
      setEnvLoadedFor(envTarget);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Gagal membaca environment variable.');
    } finally {
      setEnvLoading(false);
    }
  }

  async function saveEnvironment() {
    if (!canManage) return;
    setEnvSaving(true);
    try {
      const response = await fetch(`/api/vps/${encodeURIComponent(vpsId)}/env`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: appName.trim(), deployPath: deployPath.trim(), env }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal menyimpan environment variable.'));
      if (body && typeof body === 'object' && 'env' in body && typeof (body as { env?: unknown }).env === 'object') {
        setEnv((body as { env: Record<string, string> }).env);
      }
      setEnvLoadedFor(envTarget);
      toast.success('Environment tersimpan dan PM2 direstart.');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Gagal menyimpan environment variable.');
    } finally {
      setEnvSaving(false);
    }
  }

  function updateEnvKey(oldKey: string, key: string, value: string) {
    setEnv((current) => {
      const next = { ...current };
      delete next[oldKey];
      if (key) next[key] = value;
      return next;
    });
  }

  function updateEnvValue(key: string, value: string) {
    setEnv((current) => ({ ...current, [key]: value }));
  }

  function removeEnv(key: string) {
    setEnv((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <Card>
          <CardHeader title="Deploy application" subtitle="Upload ZIP maksimal 100 MB ke VPS melalui SSH/SFTP." />
          <form className="space-y-5 p-5" onSubmit={(event) => void deploy(event)}>
            <div
              className={`cursor-pointer rounded-xl border border-dashed px-5 py-8 text-center transition-colors ${dragging ? 'border-accent bg-accent-soft' : 'border-line bg-base-900/40 hover:border-accent/50'}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0] ?? null); }}
            >
              <input ref={inputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={onFileChange} />
              <p className="text-sm font-medium text-ink">{file ? file.name : 'Drop ZIP di sini atau klik untuk memilih'}</p>
              <p className="mt-1 text-xs text-ink-faint">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'ZIP · maksimal 100 MB'}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="App name" hint="Dipakai sebagai nama proses PM2" required><Input value={appName} onChange={(event) => updateAppName(event.target.value)} required /></Field>
              <Field label="Deploy path" hint="Hanya path di bawah /home atau /root" required><Input value={deployPath} onChange={(event) => { setPathTouched(true); setDeployPath(event.target.value); setEnv({}); setEnvLoadedFor(null); }} required /></Field>
              <Field label="Interpreter" hint="Kosongkan untuk auto-detect Node.js/Python"><Select value={interpreter} onChange={(event) => setInterpreter(event.target.value)}><option value="">Auto-detect</option><option value="node">Node.js</option><option value="python3">Python 3</option><option value="bash">Bash</option></Select></Field>
              <label className="flex items-center gap-3 rounded-lg border border-line-soft bg-base-900/40 px-3 py-2.5 text-sm text-ink"><input type="checkbox" checked={autoStart} onChange={(event) => setAutoStart(event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" /> <span><span className="block font-medium">Auto-start via PM2</span><span className="text-xs text-ink-faint">Detect entry point dan jalankan setelah deploy</span></span></label>
            </div>
            {deployError && <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">{deployError}</div>}
            <div className="flex justify-end"><Button type="submit" loading={deploying}>{deploying ? 'Deploying…' : 'Deploy app'}</Button></div>
          </form>
        </Card>
      ) : (
        <div className="rounded-lg border border-accent/20 bg-accent-soft px-4 py-3 text-xs text-ink-muted">Kamu memiliki akses baca. Deploy dan environment manager hanya tersedia untuk pemilik VPS atau admin.</div>
      )}

      <Card>
        <CardHeader title="Deploy terminal" subtitle="Progress dan output operasi deploy ditampilkan realtime." action={deploying ? <Badge tone="yellow" spinning>Running</Badge> : undefined} />
        <div className="min-h-[220px] max-h-[420px] overflow-auto bg-black/40 p-4 font-mono text-[11px] leading-relaxed text-emerald-300">
          {events.length ? events.map((item) => <div key={item.id} className={item.tone === 'error' ? 'text-red-300' : item.tone === 'success' ? 'text-emerald-200' : undefined}>{item.text}</div>) : <span className="text-ink-faint">Belum ada operasi deploy pada sesi ini.</span>}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Environment variables"
          subtitle="Value untuk password, secret, token, dan key dimasking."
          action={<div className="flex gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => void loadEnvironment(true)} loading={envLoading}>Load .env</Button>{canManage && <Button type="button" size="sm" onClick={() => void saveEnvironment()} loading={envSaving}>Save & restart PM2</Button>}</div>}
        />
        <div className="space-y-3 p-5">
          {Object.entries(env).map(([key, value]) => (
            <div key={key} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input value={key} onChange={(event) => canManage && updateEnvKey(key, event.target.value, value)} placeholder="KEY" aria-label="Environment key" readOnly={!canManage} />
              <Input value={value} onChange={(event) => canManage && updateEnvValue(key, event.target.value)} placeholder="value" aria-label={`Value ${key}`} type={value === '***' ? 'password' : 'text'} readOnly={!canManage} />
              {canManage ? <Button type="button" size="sm" variant="danger" onClick={() => removeEnv(key)} aria-label={`Remove ${key}`}>×</Button> : <span />}
            </div>
          ))}
          {canManage && <Button type="button" size="sm" variant="ghost" onClick={() => setEnv((current) => ({ ...current, [`NEW_KEY_${Object.keys(current).length + 1}`]: '' }))}>+ Add variable</Button>}
          <p className="text-[11px] text-ink-faint">{canManage ? 'Nilai yang tampil sebagai *** akan dipertahankan saat disimpan bila tidak diubah.' : 'Kamu memiliki akses baca; value sensitif tetap dimasking.'}</p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Deploy history" subtitle="20 deploy terakhir untuk VPS ini." action={<Button type="button" size="sm" variant="secondary" onClick={() => void loadHistory()} loading={historyLoading}>Refresh</Button>} />
        {historyLoading && history.length === 0 ? <p className="px-5 py-8 text-center text-sm text-ink-muted">Memuat history…</p> : history.length === 0 ? <p className="px-5 py-8 text-center text-sm text-ink-muted">Belum ada deploy.</p> : (
          <div className="divide-y divide-line-soft">
            {history.map((item) => <details key={item.id} className="group px-5 py-3"><summary className="flex cursor-pointer list-none flex-wrap items-center gap-3"><Badge tone={statusTone(item.status)}>{item.status}</Badge><span className="font-medium text-ink">{item.app_name}</span><span className="font-mono text-[11px] text-ink-faint">{item.deploy_path}</span><time className="ml-auto text-[11px] text-ink-faint" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></summary>{item.log && <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-black/30 p-3 font-mono text-[10px] leading-relaxed text-ink-muted">{item.log}</pre>}</details>)}
          </div>
        )}
      </Card>
    </div>
  );
}
