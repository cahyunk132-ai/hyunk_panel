'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Field, Select, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { formatRelativeTime } from '@/lib/utils/format';
import type { BackupInterval, BackupScheduleRow, PublicStorageProvider } from '@/types';

const DAY_OPTIONS = [
  { value: '0', label: 'Minggu' },
  { value: '1', label: 'Senin' },
  { value: '2', label: 'Selasa' },
  { value: '3', label: 'Rabu' },
  { value: '4', label: 'Kamis' },
  { value: '5', label: 'Jumat' },
  { value: '6', label: 'Sabtu' },
];

const INTERVAL_LABELS: Record<BackupInterval, string> = {
  hourly: 'Hourly (tiap jam)',
  daily: 'Daily (tiap hari)',
  weekly: 'Weekly (tiap minggu)',
};

export function AutoBackupSchedule({
  serverId,
  canManage,
}: {
  serverId: string;
  canManage: boolean;
}) {
  const [schedule, setSchedule] = useState<BackupScheduleRow | null>(null);
  const [providers, setProviders] = useState<PublicStorageProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Form state
  const [enabled, setEnabled] = useState(true);
  const [interval, setIntervalValue] = useState<BackupInterval>('daily');
  const [timeOfDay, setTimeOfDay] = useState('03:00');
  const [dayOfWeek, setDayOfWeek] = useState('0');
  const [providerId, setProviderId] = useState('');
  const [retention, setRetention] = useState('5');
  const [ignoreFiles, setIgnoreFiles] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/servers/${serverId}/backup-schedule`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal memuat jadwal');
      const sched = (json.schedule ?? null) as BackupScheduleRow | null;
      setSchedule(sched);
      setProviders(json.providers ?? []);
      if (sched) {
        setEnabled(sched.is_enabled);
        setIntervalValue(sched.interval);
        setTimeOfDay(sched.time_of_day ?? '03:00');
        setDayOfWeek(String(sched.day_of_week ?? 0));
        setProviderId(sched.storage_provider_id);
        setRetention(String(sched.retention ?? 5));
        setIgnoreFiles(sched.ignore_files ?? '');
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/backup-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storage_provider_id: providerId,
          is_enabled: enabled,
          interval,
          time_of_day: timeOfDay,
          day_of_week: interval === 'weekly' ? Number(dayOfWeek) : null,
          retention: Number(retention),
          ignore_files: ignoreFiles,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan jadwal');
      setSchedule(json.schedule);
      setNotice('Jadwal auto backup tersimpan.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/backup-schedule`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menghapus jadwal');
      setSchedule(null);
      setNotice('Jadwal auto backup dihapus.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/backup-now`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menjalankan backup');
      setNotice('Backup berjalan — hasilnya muncul di Backup History di bawah.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <PageLoader label="Memuat jadwal backup…" />;

  // Read-only untuk role tanpa permission `backup.schedule`.
  if (!canManage) {
    if (!schedule) return null;
    return (
      <div className="rounded-xl border border-line bg-base-850 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Auto Backup Schedule</h3>
          <Badge tone={schedule.is_enabled ? 'green' : 'gray'}>
            {schedule.is_enabled ? 'Aktif' : 'Nonaktif'}
          </Badge>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          {INTERVAL_LABELS[schedule.interval]}
          {schedule.interval !== 'hourly' && ` · jam ${schedule.time_of_day ?? '03:00'}`}
          {schedule.interval === 'weekly' &&
            ` · ${DAY_OPTIONS.find((d) => d.value === String(schedule.day_of_week))?.label ?? ''}`}
          {' · retention '}
          {schedule.retention}
        </p>
        {schedule.next_run_at && (
          <p className="mt-1 text-xs text-ink-faint">
            Next run: {new Date(schedule.next_run_at).toLocaleString('id-ID')}
            {schedule.last_run_at && ` · last run ${formatRelativeTime(schedule.last_run_at)}`}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-base-850 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Auto Backup Schedule</h3>
          <p className="text-xs text-ink-muted">
            Backup otomatis diupload ke cloud storage — folder{' '}
            <code className="font-mono text-[11px]">Hyunk Panel Backups/{'{server}'}/</code>
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-[#3ecfcf]"
          />
          Jadwal aktif
        </label>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
          {notice}
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field label="Interval">
          <Select value={interval} onChange={(e) => setIntervalValue(e.target.value as BackupInterval)}>
            <option value="hourly">Hourly — tiap jam (menit 0)</option>
            <option value="daily">Daily — tiap hari</option>
            <option value="weekly">Weekly — hari tertentu</option>
          </Select>
        </Field>

        {interval !== 'hourly' && (
          <Field label="Jam eksekusi (UTC)">
            <Input type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
          </Field>
        )}

        {interval === 'weekly' && (
          <Field label="Hari">
            <Select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
              {DAY_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Storage provider" required>
          <Select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            <option value="">— Pilih storage —</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Retention (maks backup tersimpan)" hint="1–20. Backup cloud terlama dihapus otomatis.">
          <Input
            type="number"
            min={1}
            max={20}
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
          />
        </Field>
      </div>

      {providers.length === 0 && (
        <p className="mt-3 text-xs text-amber-400">
          Belum ada storage terhubung —{' '}
          <Link href="/storage" className="text-accent hover:underline">
            hubungkan di halaman Storage
          </Link>{' '}
          lebih dulu.
        </p>
      )}

      <div className="mt-4">
        <Field label="Ignore files" hint="Pola file/folder yang di-skip saat backup (diteruskan ke Wings)">
          <Textarea rows={2} value={ignoreFiles} onChange={(e) => setIgnoreFiles(e.target.value)} />
        </Field>
      </div>

      {schedule?.next_run_at && (
        <p className="mt-3 text-[11px] text-ink-faint">
          Next run: {new Date(schedule.next_run_at).toLocaleString('id-ID')}
          {schedule.last_run_at && ` · last run ${formatRelativeTime(schedule.last_run_at)}`}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={save} loading={saving} disabled={!providerId}>
          Save Schedule
        </Button>
        {schedule && (
          <>
            <Button size="sm" variant="success" onClick={runNow} loading={running}>
              ▶ Run now
            </Button>
            <Button size="sm" variant="danger" onClick={remove} loading={saving}>
              Hapus jadwal
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
