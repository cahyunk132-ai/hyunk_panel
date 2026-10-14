'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/lib/utils/toast';
import type { PublicNotificationSettings } from '@/types';

const DEFAULT_SETTINGS: PublicNotificationSettings = {
  notify_backup_failed: true,
  notify_backup_success: false,
  notify_server_crash: true,
  notify_node_offline: true,
  email_override: null,
};

const OPTIONS: Array<{ key: keyof Omit<PublicNotificationSettings, 'email_override'>; label: string; description: string }> = [
  {
    key: 'notify_backup_failed',
    label: 'Backup gagal',
    description: 'Kirim email ketika proses backup otomatis server gagal.',
  },
  {
    key: 'notify_backup_success',
    label: 'Backup berhasil',
    description: 'Kirim email ketika backup otomatis berhasil disimpan.',
  },
  {
    key: 'notify_server_crash',
    label: 'Server crash',
    description: 'Kirim email ketika server berubah dari running menjadi offline.',
  },
  {
    key: 'notify_node_offline',
    label: 'Node offline',
    description: 'Kirim email ketika node Wings tidak dapat dihubungi.',
  },
];

export function NotificationSettings() {
  const [settings, setSettings] = useState<PublicNotificationSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/settings/notifications', { cache: 'no-store' })
      .then(async (response) => {
        const body = (await response.json()) as { settings?: PublicNotificationSettings; error?: string };
        if (!response.ok) throw new Error(body.error ?? 'Gagal memuat pengaturan');
        if (active) setSettings({ ...DEFAULT_SETTINGS, ...(body.settings ?? {}) });
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat pengaturan');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/settings/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const body = (await response.json()) as { settings?: PublicNotificationSettings; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Gagal menyimpan pengaturan');
      setSettings({ ...DEFAULT_SETTINGS, ...(body.settings ?? {}) });
      toast.success('Pengaturan notifikasi disimpan');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan');
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setError(null);
    try {
      const response = await fetch('/api/settings/notifications/test', { method: 'POST' });
      const body = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Email test gagal dikirim');
      toast.success(body.message ?? 'Email test berhasil dikirim');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email test gagal dikirim');
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <PageLoader label="Memuat pengaturan notifikasi…" />;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Email notifications"
          subtitle="Pilih event penting yang ingin dikirim ke email akun kamu."
        />
        <div className="divide-y divide-line-soft">
          {OPTIONS.map((option) => (
            <label key={option.key} className="flex cursor-pointer items-start gap-3 px-5 py-4 hover:bg-base-800/30">
              <input
                type="checkbox"
                checked={settings[option.key]}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, [option.key]: event.target.checked }))
                }
                className="mt-0.5 h-4 w-4 rounded border-line accent-accent"
              />
              <span>
                <span className="block text-sm font-medium text-ink">{option.label}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card className="px-5 py-5">
        <label className="block text-sm font-medium text-ink" htmlFor="email-override">
          Email alternatif <span className="font-normal text-ink-faint">(opsional)</span>
        </label>
        <p className="mt-1 text-xs text-ink-muted">
          Jika diisi, notifikasi event akan dikirim ke alamat ini, bukan email akun utama.
        </p>
        <Input
          id="email-override"
          type="email"
          value={settings.email_override ?? ''}
          onChange={(event) => setSettings((current) => ({ ...current, email_override: event.target.value || null }))}
          placeholder="alerts@example.com"
          className="mt-3 max-w-md"
          autoComplete="email"
        />
      </Card>

      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} loading={saving}>
          Simpan pengaturan
        </Button>
        <Button variant="secondary" onClick={() => void sendTest()} loading={testing}>
          Test — kirim email
        </Button>
      </div>
    </div>
  );
}
