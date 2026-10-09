'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Field } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import type { PublicStorageProvider, StorageProviderType } from '@/types';

const PROVIDER_META: Record<StorageProviderType, { label: string; icon: string; color: string }> = {
  gdrive: { label: 'Google Drive', icon: 'G', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  dropbox: { label: 'Dropbox', icon: 'D', color: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  onedrive: { label: 'OneDrive', icon: 'O', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  s3: { label: 'S3 Compatible', icon: 'S3', color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  sftp: { label: 'SFTP', icon: 'SF', color: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  webdav: { label: 'WebDAV', icon: 'WD', color: 'bg-teal-500/15 text-teal-400 border-teal-500/30' },
};

type ManualProvider = 's3' | 'sftp' | 'webdav';

interface TestState {
  [providerId: string]: { ok: boolean; message: string } | undefined;
}

export function StorageManager({
  initialConnected,
  initialError,
}: {
  initialConnected?: string;
  initialError?: string;
}) {
  const [providers, setProviders] = useState<PublicStorageProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [notice, setNotice] = useState<string | null>(
    initialConnected
      ? `Storage ${PROVIDER_META[initialConnected as StorageProviderType]?.label ?? initialConnected} berhasil terhubung.`
      : null,
  );
  const [connectOpen, setConnectOpen] = useState(false);
  const [manual, setManual] = useState<ManualProvider | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<TestState>({});
  const [disconnecting, setDisconnecting] = useState<PublicStorageProvider | null>(null);

  // Form manual provider
  const [formName, setFormName] = useState('');
  const [form, setForm] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/storage/providers', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal memuat storage');
      setProviders(json.providers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setFormName('');
    setForm({});
    setManual(null);
  }

  function connectOAuth(provider: 'gdrive' | 'dropbox') {
    window.location.href = `/api/auth/storage/connect?provider=${provider}`;
  }

  async function saveManual() {
    if (!manual) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { name: formName || undefined };
      if (manual === 's3') {
        payload.bucket = form.bucket;
        payload.region = form.region;
        payload.access_key = form.access_key;
        payload.secret_key = form.secret_key;
        payload.endpoint = form.endpoint || undefined;
      } else if (manual === 'sftp') {
        payload.host = form.host;
        payload.port = form.port ? Number(form.port) : undefined;
        payload.username = form.username;
        payload.password = form.password;
        payload.path = form.path || undefined;
      } else {
        payload.url = form.url;
        payload.username = form.username;
        payload.password = form.password;
      }
      const res = await fetch(`/api/storage/providers/${manual}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan provider');
      setConnectOpen(false);
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setSaving(false);
    }
  }

  async function testProvider(provider: PublicStorageProvider) {
    setTesting((t) => ({ ...t, [provider.id]: undefined }));
    try {
      const res = await fetch(`/api/storage/providers/${provider.id}/test`, { cache: 'no-store' });
      const json = await res.json();
      setTesting((t) => ({ ...t, [provider.id]: { ok: res.ok, message: json.message ?? json.error ?? 'Tidak ada respons' } }));
    } catch (err) {
      setTesting((t) => ({
        ...t,
        [provider.id]: { ok: false, message: err instanceof Error ? err.message : 'Error' },
      }));
    }
  }

  async function disconnect(provider: PublicStorageProvider) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/storage/providers/${provider.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal disconnect');
      setDisconnecting(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
      setDisconnecting(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">Cloud Storage</h1>
          <p className="text-sm text-ink-muted">
            Hubungkan storage untuk auto backup — file backup server diupload ke{' '}
            <code className="font-mono text-xs">Hyunk Panel Backups/{'{server}'}/</code>.
          </p>
        </div>
        <Button size="sm" onClick={() => setConnectOpen(true)}>
          + Connect Storage
        </Button>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <PageLoader label="Memuat storage…" />
      ) : providers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-base-850/50 px-6 py-14 text-center text-sm text-ink-faint">
          Belum ada storage terhubung. Klik <strong>+ Connect Storage</strong> untuk mulai auto backup ke cloud.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {providers.map((p) => {
            const meta = PROVIDER_META[p.provider];
            const test = testing[p.id];
            const endpoint = p.config_public.endpoint != null ? String(p.config_public.endpoint) : null;
            const bucket = p.config_public.bucket != null ? String(p.config_public.bucket) : null;
            const host = p.config_public.host != null ? String(p.config_public.host) : null;
            return (
              <div key={p.id} className="rounded-xl border border-line bg-base-850 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-xs font-bold ${meta.color}`}
                    >
                      {meta.icon}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                      <p className="text-[11px] text-ink-faint">{meta.label}</p>
                    </div>
                  </div>
                  <Badge tone={p.is_active ? 'green' : 'gray'}>{p.is_active ? 'Connected' : 'Nonaktif'}</Badge>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {p.schedules_count > 0 && (
                    <Badge tone="accent">Used by {p.schedules_count} server{p.schedules_count > 1 ? 's' : ''}</Badge>
                  )}
                  {endpoint && <Badge tone="gray">{endpoint}</Badge>}
                  {bucket && <Badge tone="gray">{bucket}</Badge>}
                  {host && <Badge tone="gray">{host}</Badge>}
                </div>

                {test && (
                  <p className={`mt-2 text-[11px] ${test.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {test.ok ? '✓ ' : '✗ '}
                    {test.message}
                  </p>
                )}

                <div className="mt-3 flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => testProvider(p)}>
                    {test ? 'Test lagi' : 'Test'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDisconnecting(p)}>
                    Disconnect
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-ink-faint">
        Storage dipakai untuk jadwal auto backup di tiap server. Lihat atau atur jadwal di tab{' '}
        <Link href="/servers" className="text-accent hover:underline">
          Servers → Backups
        </Link>
        . Kredensial disimpan terenkripsi (AES-256-GCM) dan tidak pernah tampil di halaman ini.
      </p>

      {/* Connect modal */}
      <Modal
        open={connectOpen}
        onClose={() => {
          setConnectOpen(false);
          resetForm();
        }}
        title="Connect Storage"
        wide
      >
        {!manual ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => connectOAuth('gdrive')}
                className="flex items-center gap-3 rounded-lg border border-line bg-base-900 px-4 py-3 text-left transition-colors hover:border-emerald-500/40"
              >
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-bold ${PROVIDER_META.gdrive.color}`}>
                  {PROVIDER_META.gdrive.icon}
                </span>
                <span>
                  <span className="block text-sm font-medium text-ink">Connect with Google</span>
                  <span className="block text-[11px] text-ink-faint">Google Drive (OAuth)</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => connectOAuth('dropbox')}
                className="flex items-center gap-3 rounded-lg border border-line bg-base-900 px-4 py-3 text-left transition-colors hover:border-sky-500/40"
              >
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-bold ${PROVIDER_META.dropbox.color}`}>
                  {PROVIDER_META.dropbox.icon}
                </span>
                <span>
                  <span className="block text-sm font-medium text-ink">Connect with Dropbox</span>
                  <span className="block text-[11px] text-ink-faint">Dropbox (OAuth)</span>
                </span>
              </button>
              <button
                type="button"
                disabled
                className="flex cursor-not-allowed items-center gap-3 rounded-lg border border-line bg-base-900 px-4 py-3 text-left opacity-50"
              >
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-bold ${PROVIDER_META.onedrive.color}`}>
                  {PROVIDER_META.onedrive.icon}
                </span>
                <span>
                  <span className="block text-sm font-medium text-ink">OneDrive</span>
                  <span className="block text-[11px] text-ink-faint">Coming soon</span>
                </span>
              </button>
              {(['s3', 'sftp', 'webdav'] as ManualProvider[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setManual(kind)}
                  className="flex items-center gap-3 rounded-lg border border-line bg-base-900 px-4 py-3 text-left transition-colors hover:border-accent/40"
                >
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-bold ${PROVIDER_META[kind].color}`}>
                    {PROVIDER_META[kind].icon}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-ink">{PROVIDER_META[kind].label}</span>
                    <span className="block text-[11px] text-ink-faint">Isi kredensial manual</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setManual(null)}
              className="text-xs text-ink-faint transition-colors hover:text-ink"
            >
              ← Kembali pilih provider
            </button>
            <Field label="Nama (opsional)">
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={PROVIDER_META[manual].label}
              />
            </Field>
            {manual === 's3' && (
              <>
                <Field label="Bucket" required>
                  <Input value={form.bucket ?? ''} onChange={(e) => setForm({ ...form, bucket: e.target.value })} placeholder="nama-bucket" />
                </Field>
                <Field label="Region" hint="Contoh: us-east-1, auto (R2), atau region B2/MinIO">
                  <Input value={form.region ?? ''} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="us-east-1" />
                </Field>
                <Field label="Access Key" required>
                  <Input value={form.access_key ?? ''} onChange={(e) => setForm({ ...form, access_key: e.target.value })} autoComplete="off" />
                </Field>
                <Field label="Secret Key" required>
                  <Input
                    type="password"
                    value={form.secret_key ?? ''}
                    onChange={(e) => setForm({ ...form, secret_key: e.target.value })}
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Endpoint (opsional)" hint="Kosongkan untuk AWS S3. Isi untuk R2/B2/MinIO, mis. https://<account>.r2.cloudflarestorage.com">
                  <Input
                    value={form.endpoint ?? ''}
                    onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                    placeholder="https://…"
                  />
                </Field>
              </>
            )}
            {manual === 'sftp' && (
              <>
                <Field label="Host" required>
                  <Input value={form.host ?? ''} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="storage.example.com" />
                </Field>
                <Field label="Port">
                  <Input value={form.port ?? ''} onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder="22" />
                </Field>
                <Field label="Username" required>
                  <Input value={form.username ?? ''} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
                </Field>
                <Field label="Password" required>
                  <Input
                    type="password"
                    value={form.password ?? ''}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Remote path" hint="Folder dasar di server SFTP (default /)">
                  <Input value={form.path ?? ''} onChange={(e) => setForm({ ...form, path: e.target.value })} placeholder="/" />
                </Field>
              </>
            )}
            {manual === 'webdav' && (
              <>
                <Field label="URL" required hint="Contoh: https://dav.example.com/remote.php/dav/files/user">
                  <Input value={form.url ?? ''} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
                </Field>
                <Field label="Username" required>
                  <Input value={form.username ?? ''} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
                </Field>
                <Field label="Password" required>
                  <Input
                    type="password"
                    value={form.password ?? ''}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    autoComplete="new-password"
                  />
                </Field>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setConnectOpen(false);
                  resetForm();
                }}
              >
                Batal
              </Button>
              <Button size="sm" onClick={saveManual} loading={saving}>
                Simpan
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Disconnect confirm */}
      <Modal open={!!disconnecting} onClose={() => setDisconnecting(null)} title="Disconnect storage?">
        <p className="text-sm text-ink-muted">
          Putuskan <strong>{disconnecting?.name}</strong>? Jadwal backup yang memakai storage ini akan berhenti
          sampai provider diganti. File backup yang sudah terupload di cloud tidak dihapus.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDisconnecting(null)}>
            Batal
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => disconnecting && disconnect(disconnecting)}
            loading={saving}
          >
            Disconnect
          </Button>
        </div>
      </Modal>
    </div>
  );
}
