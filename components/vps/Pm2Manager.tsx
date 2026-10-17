'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/lib/utils/toast';

interface Pm2Process {
  id: string;
  name: string;
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  pid: number | null;
  restarts: number;
  pm_id: number | null;
}

type Action = 'start' | 'stop' | 'restart' | 'delete' | 'flush';

interface CreateForm {
  name: string;
  script: string;
  interpreter: string;
  cwd: string;
}

const EMPTY_CREATE: CreateForm = { name: '', script: 'index.js', interpreter: 'node', cwd: '' };

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const value = (body as { error?: unknown }).error;
    if (typeof value === 'string' && value) return value;
  }
  return fallback;
}

function statusTone(status: string): 'green' | 'red' | 'yellow' | 'gray' {
  if (status === 'online') return 'green';
  if (status === 'stopped' || status === 'errored') return 'red';
  if (status === 'launching' || status === 'waiting restart') return 'yellow';
  return 'gray';
}

function formatUptime(milliseconds: number): string {
  if (!milliseconds || milliseconds < 1000) return '—';
  const seconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds % 60}s`;
}

function formatMemory(value: number): string {
  if (value < 1024) return `${Math.round(value)} MB`;
  return `${(value / 1024).toFixed(1)} GB`;
}

export function Pm2Manager({ vpsId, canManage }: { vpsId: string; canManage: boolean }) {
  const [processes, setProcesses] = useState<Pm2Process[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [flushing, setFlushing] = useState(false);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  const [createLoading, setCreateLoading] = useState(false);
  const [ecosystemOpen, setEcosystemOpen] = useState(false);
  const [ecosystem, setEcosystem] = useState('');
  const [ecosystemLoading, setEcosystemLoading] = useState(false);
  const [ecosystemSaving, setEcosystemSaving] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`/api/vps/${encodeURIComponent(vpsId)}/pm2`, { cache: 'no-store' });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal membaca proses PM2.'));
      const next = (body as { processes?: unknown }).processes;
      if (!Array.isArray(next)) throw new Error('Response API PM2 tidak valid.');
      setProcesses(next as Pm2Process[]);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal membaca proses PM2.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [vpsId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!logsFor) return;
    let active = true;
    const load = async () => {
      setLogsLoading(true);
      try {
        const response = await fetch(
          `/api/vps/${encodeURIComponent(vpsId)}/pm2/logs?name=${encodeURIComponent(logsFor)}&lines=200`,
          { cache: 'no-store' },
        );
        const body: unknown = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(errorMessage(body, 'Gagal membaca log.'));
        if (active) {
          setLogs(Array.isArray((body as { logs?: unknown }).logs) ? (body as { logs: string[] }).logs : []);
          setLogsError(null);
        }
      } catch (caught) {
        if (active) setLogsError(caught instanceof Error ? caught.message : 'Gagal membaca log.');
      } finally {
        if (active) setLogsLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [logsFor, vpsId]);

  const onlineCount = useMemo(() => processes.filter((process) => process.status === 'online').length, [processes]);

  async function runAction(process: Pm2Process, action: Action) {
    if (!canManage) return;
    if (action === 'delete' && !window.confirm(`Hapus proses PM2 “${process.name}”?`)) return;
    const key = `${action}:${process.name}`;
    setActionKey(key);
    try {
      const response = await fetch(`/api/vps/${encodeURIComponent(vpsId)}/pm2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, name: process.name }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(body, `PM2 ${action} gagal.`));
      toast.success(`PM2 ${action} berhasil untuk ${process.name}.`);
      await refresh(true);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : `PM2 ${action} gagal.`);
    } finally {
      setActionKey(null);
    }
  }

  async function flushAll() {
    if (!canManage || flushing) return;
    if (!window.confirm('Flush semua log PM2?')) return;
    setFlushing(true);
    try {
      const response = await fetch(`/api/vps/${encodeURIComponent(vpsId)}/pm2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'flush' }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(body, 'Flush log PM2 gagal.'));
      toast.success('Semua log PM2 berhasil di-flush.');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Flush log PM2 gagal.');
    } finally {
      setFlushing(false);
    }
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    setCreateLoading(true);
    try {
      const response = await fetch(`/api/vps/${encodeURIComponent(vpsId)}/pm2/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal membuat proses PM2.'));
      toast.success(`Proses ${createForm.name} berhasil dibuat.`);
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE);
      await refresh(true);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Gagal membuat proses PM2.');
    } finally {
      setCreateLoading(false);
    }
  }

  async function openEcosystem() {
    setEcosystemOpen(true);
    if (ecosystem) return;
    setEcosystemLoading(true);
    try {
      const response = await fetch(`/api/vps/${encodeURIComponent(vpsId)}/pm2/ecosystem`, { cache: 'no-store' });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal membaca ecosystem config.'));
      setEcosystem(typeof (body as { content?: unknown }).content === 'string' ? (body as { content: string }).content : '');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Gagal membaca ecosystem config.');
    } finally {
      setEcosystemLoading(false);
    }
  }

  async function saveEcosystem() {
    setEcosystemSaving(true);
    try {
      const response = await fetch(`/api/vps/${encodeURIComponent(vpsId)}/pm2/ecosystem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: ecosystem }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal menyimpan ecosystem config.'));
      toast.success('ecosystem.config.js berhasil disimpan.');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Gagal menyimpan ecosystem config.');
    } finally {
      setEcosystemSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="PM2 processes"
          subtitle={`${onlineCount} online · refresh otomatis setiap 5 detik`}
          action={
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => void refresh()} loading={loading}>
                Refresh
              </Button>
              {canManage && (
                <>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void flushAll()} loading={flushing}>
                    Flush logs
                  </Button>
                  <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                    + Create process
                  </Button>
                </>
              )}
            </div>
          }
        />
        {error && (
          <div className="mx-5 mt-4 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
        {loading && processes.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-ink-muted">Memuat proses PM2…</div>
        ) : processes.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-ink-muted">
            Tidak ada proses PM2 atau PM2 belum terpasang di VPS.
          </div>
        ) : (
          <div className="grid gap-3 p-5 md:grid-cols-2">
            {processes.map((process) => (
              <div key={`${process.id}-${process.name}`} className="rounded-xl border border-line-soft bg-base-900/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="truncate font-semibold text-ink">{process.name}</h4>
                    <p className="mt-1 font-mono text-[11px] text-ink-faint">pm_id {process.pm_id ?? '—'} · PID {process.pid ?? '—'}</p>
                  </div>
                  <Badge tone={statusTone(process.status)}>{process.status}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div><p className="text-ink-faint">CPU</p><p className="mt-1 font-mono text-ink">{process.cpu.toFixed(1)}%</p></div>
                  <div><p className="text-ink-faint">RAM</p><p className="mt-1 font-mono text-ink">{formatMemory(process.memory)}</p></div>
                  <div><p className="text-ink-faint">Uptime</p><p className="mt-1 font-mono text-ink">{formatUptime(process.uptime)}</p></div>
                  <div><p className="text-ink-faint">Restarts</p><p className="mt-1 font-mono text-ink">{process.restarts}</p></div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-line-soft pt-3">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setLogsFor(process.name)}>
                    Logs
                  </Button>
                  {canManage && (
                    <>
                      <Button type="button" size="sm" variant="success" disabled={actionKey !== null} loading={actionKey === `start:${process.name}`} onClick={() => void runAction(process, 'start')}>Start</Button>
                      <Button type="button" size="sm" variant="secondary" disabled={actionKey !== null} loading={actionKey === `restart:${process.name}`} onClick={() => void runAction(process, 'restart')}>Restart</Button>
                      <Button type="button" size="sm" variant="danger" disabled={actionKey !== null} loading={actionKey === `stop:${process.name}`} onClick={() => void runAction(process, 'stop')}>Stop</Button>
                      <Button type="button" size="sm" variant="ghost" disabled={actionKey !== null} loading={actionKey === `flush:${process.name}`} onClick={() => void runAction(process, 'flush')}>Flush logs</Button>
                      <Button type="button" size="sm" variant="danger" disabled={actionKey !== null} loading={actionKey === `delete:${process.name}`} onClick={() => void runAction(process, 'delete')}>Delete</Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Ecosystem config"
          subtitle="Baca atau simpan ecosystem.config.js di home directory VPS."
          action={<Button type="button" size="sm" variant="secondary" onClick={() => void openEcosystem()}>{ecosystemOpen ? 'Reload' : 'Open editor'}</Button>}
        />
        {ecosystemOpen && (
          <div className="space-y-3 p-5">
            {ecosystemLoading ? <p className="text-sm text-ink-muted">Memuat ecosystem.config.js…</p> : (
              <>
                <Textarea value={ecosystem} onChange={(event) => setEcosystem(event.target.value)} rows={14} className="font-mono text-xs" readOnly={!canManage} />
                {canManage && <div className="flex justify-end"><Button type="button" size="sm" onClick={() => void saveEcosystem()} loading={ecosystemSaving}>Save ecosystem</Button></div>}
              </>
            )}
          </div>
        )}
      </Card>

      <Modal open={Boolean(logsFor)} onClose={() => setLogsFor(null)} title={logsFor ? `Logs · ${logsFor}` : 'Logs'} wide>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-ink-muted"><span>Polling setiap 2 detik</span>{logsLoading && <span>Memuat…</span>}</div>
          {logsError && <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">{logsError}</div>}
          <pre className="min-h-[360px] max-h-[60vh] overflow-auto rounded-lg border border-line bg-black/40 p-4 font-mono text-[11px] leading-relaxed text-emerald-300">{logs.length ? logs.join('\n') : 'Belum ada log.'}</pre>
        </div>
      </Modal>

      <Modal open={createOpen} onClose={() => !createLoading && setCreateOpen(false)} title="Create PM2 process">
        <form className="space-y-4" onSubmit={(event) => void submitCreate(event)}>
          <Field label="Process name" required><Input value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} placeholder="my-app" required /></Field>
          <Field label="Script / entry point" hint="Contoh: index.js atau /home/user/apps/my-app/server.js" required><Input value={createForm.script} onChange={(event) => setCreateForm((current) => ({ ...current, script: event.target.value }))} required /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Interpreter"><Select value={createForm.interpreter} onChange={(event) => setCreateForm((current) => ({ ...current, interpreter: event.target.value }))}><option value="node">node</option><option value="python3">python3</option><option value="bash">bash</option><option value="">PM2 default</option></Select></Field>
            <Field label="Working directory" hint="Opsional; hanya /home atau /root"><Input value={createForm.cwd} onChange={(event) => setCreateForm((current) => ({ ...current, cwd: event.target.value }))} placeholder="/home/user/apps/my-app" /></Field>
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setCreateOpen(false)} disabled={createLoading}>Cancel</Button><Button type="submit" loading={createLoading}>Create process</Button></div>
        </form>
      </Modal>
    </div>
  );
}
