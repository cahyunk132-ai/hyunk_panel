'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { PROVIDER_META, PROVIDER_ORDER } from '@/lib/storage/provider-meta';
import { formatBytes, formatRelativeTime, formatUptime } from '@/lib/utils/format';
import type {
  AdminBackupLogRow,
  AdminBackupLogsResponse,
  AdminBackupStats,
  BackupLogStatus,
  BackupStatusFilter,
  StorageProviderType,
} from '@/types';

const REFRESH_INTERVAL_MS = 30_000;

const STATUS_TONES: Record<BackupLogStatus, 'yellow' | 'green' | 'red'> = {
  pending: 'yellow',
  creating: 'yellow',
  uploading: 'yellow',
  done: 'green',
  failed: 'red',
};

const STATUS_LABELS: Record<BackupLogStatus, string> = {
  pending: 'Pending',
  creating: 'Creating…',
  uploading: 'Uploading…',
  done: 'Done',
  failed: 'Failed',
};

const STATUS_FILTERS: Array<{ value: BackupStatusFilter; label: string }> = [
  { value: 'all', label: 'Semua status' },
  { value: 'pending', label: 'Pending' },
  { value: 'running', label: 'Running' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed' },
];

const RUNNING_STATUSES: BackupLogStatus[] = ['pending', 'creating', 'uploading'];

const iconProps = {
  className: 'h-4 w-4',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
};

function isRunning(status: BackupLogStatus | null, completedAt: string | null): boolean {
  if (!status) return false;
  return !completedAt && RUNNING_STATUSES.includes(status);
}

function durationMs(log: AdminBackupLogRow): number {
  const start = new Date(log.started_at).getTime();
  const end = log.completed_at ? new Date(log.completed_at).getTime() : Date.now();
  return Math.max(end - start, 0);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDayRange(stats: AdminBackupStats | null): string {
  if (!stats) return 'hari ini';
  const from = new Date(stats.range_from);
  const to = new Date(stats.range_to);
  const sameDay = from.toDateString() === to.toDateString();
  const day = from.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
  return sameDay ? `${day} · hari ini` : `${day} s/d ${to.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}`;
}

function ProviderCell({ type, name }: { type: StorageProviderType | null; name: string | null }) {
  if (!type) return <span className="text-ink-faint">—</span>;
  const meta = PROVIDER_META[type];
  return (
    <div className="flex items-center gap-2">
      <span
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border text-[10px] font-bold ${meta.color}`}
      >
        {meta.icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-ink">{name ?? meta.label}</p>
        <p className="text-[10px] text-ink-faint">{meta.label}</p>
      </div>
    </div>
  );
}

export function BackupMonitor() {
  const [logs, setLogs] = useState<AdminBackupLogRow[]>([]);
  const [stats, setStats] = useState<AdminBackupStats | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // ── Filter / sort / pagination ──
  const [status, setStatus] = useState<BackupStatusFilter>('all');
  const [provider, setProvider] = useState<StorageProviderType | 'all'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Debounce search supaya tidak nembak API tiap ketikan.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    if (provider !== 'all') params.set('provider', provider);
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    if (search) params.set('q', search);
    params.set('sort', sort);
    params.set('page', String(page));
    // Rentang "hari ini" mengikuti zona waktu browser admin.
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    params.set('statsFrom', start.toISOString());
    params.set('statsTo', end.toISOString());
    return params.toString();
  }, [status, provider, dateFrom, dateTo, search, sort, page]);

  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = requestId.current + 1;
    requestId.current = id;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/admin/backup-logs?${buildQuery()}`, { cache: 'no-store' });
      const json = (await res.json()) as AdminBackupLogsResponse & { error?: string };
      if (id !== requestId.current) return;
      if (!res.ok) throw new Error(json.error || 'Gagal memuat backup log');
      setLogs(json.logs ?? []);
      setStats(json.stats ?? null);
      setTotal(json.total ?? 0);
      setTotalPages(json.total_pages ?? 1);
      setLastUpdated(new Date());
      setError(null);
      // Halaman bisa melebihi total setelah filter berubah.
      if ((json.total_pages ?? 1) < page) setPage(json.total_pages ?? 1);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : 'Gagal memuat backup log');
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [buildQuery, page]);

  useEffect(() => {
    load();
  }, [load, tick]);

  // Auto refresh tiap 30 detik.
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => setTick((value) => value + 1), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  function resetFilters() {
    setStatus('all');
    setProvider('all');
    setDateFrom('');
    setDateTo('');
    setSearchInput('');
    setSearch('');
    setSort('desc');
    setPage(1);
    setExpanded(null);
  }

  const hasFilters =
    status !== 'all' || provider !== 'all' || dateFrom !== '' || dateTo !== '' || search !== '';

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Backup Monitor</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            Semua backup log dari seluruh server &amp; user di panel. Data dibaca dengan service role
            (bypass RLS) — hanya Owner Panel &amp; Admin.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-ink-faint">
            {lastUpdated
              ? `Diperbarui ${lastUpdated.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
              : 'Belum dimuat'}
          </span>
          <button
            type="button"
            onClick={() => setAutoRefresh((value) => !value)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
              autoRefresh
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-line bg-base-600 text-ink-muted hover:text-ink'
            }`}
            title={autoRefresh ? 'Auto refresh aktif (30 detik)' : 'Auto refresh nonaktif'}
          >
            <span className={autoRefresh ? 'dot-pulse text-emerald-400' : 'text-ink-faint'}>●</span>
            Auto 30s
          </button>
          <Button size="sm" variant="secondary" onClick={() => setTick((v) => v + 1)} disabled={refreshing}>
            {refreshing ? 'Memuat…' : '⟳ Refresh'}
          </Button>
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Backup hari ini"
          value={stats ? stats.total_today : '—'}
          hint={`${formatDayRange(stats)}${total ? ` · ${total} entri sesuai filter` : ''}`}
          icon={
            <svg {...iconProps}>
              <path d="M4 5h16v11H4z" />
              <path d="M4 9h16M8 3v4M16 3v4" />
              <path d="M9 14.5 11 16l4-4" />
            </svg>
          }
        />
        <StatCard
          label="Total storage terpakai"
          value={stats ? formatBytes(stats.total_storage_bytes) : '—'}
          hint={
            stats
              ? `seluruh waktu${stats.storage_approximate ? ' (perkiraan)' : ''} · akumulasi semua backup`
              : 'seluruh waktu'
          }
          icon={
            <svg {...iconProps}>
              <path d="M7 18a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 18.3 10.6 3.75 3.75 0 0 1 17.75 18H7Z" />
            </svg>
          }
        />
        <StatCard
          label="Sukses vs gagal"
          value={
            stats ? (
              <span>
                <span className="text-emerald-400">{stats.success_today}</span>
                <span className="mx-1 text-ink-faint">/</span>
                <span className={stats.failed_today > 0 ? 'text-red-400' : 'text-ink-faint'}>
                  {stats.failed_today}
                </span>
              </span>
            ) : (
              '—'
            )
          }
          hint={`sukses / gagal · ${formatDayRange(stats)}`}
          icon={
            <svg {...iconProps}>
              <path d="M20 6 9 17l-5-5" />
            </svg>
          }
        />
        <StatCard
          label="Jadwal aktif"
          value={stats ? stats.active_schedules : '—'}
          hint="server dengan auto backup menyala"
          icon={
            <svg {...iconProps}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          }
        />
      </div>

      {/* ── Filter ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-base-850 p-4">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-[11px] text-ink-faint">Cari server / owner</label>
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="nama server atau email owner…"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-ink-faint">Status</label>
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as BackupStatusFilter);
              setPage(1);
            }}
            className="w-40"
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-ink-faint">Provider</label>
          <Select
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value as StorageProviderType | 'all');
              setPage(1);
            }}
            className="w-44"
          >
            <option value="all">Semua provider</option>
            {PROVIDER_ORDER.map((type) => (
              <option key={type} value={type}>
                {PROVIDER_META[type].label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-ink-faint">Dari tanggal</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setDateFrom(event.target.value);
              setPage(1);
            }}
            className="w-40"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-ink-faint">Sampai tanggal</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(event) => {
              setDateTo(event.target.value);
              setPage(1);
            }}
            className="w-40"
          />
        </div>
        {hasFilters && (
          <Button size="sm" variant="ghost" onClick={resetFilters}>
            Reset filter
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* ── Tabel ──────────────────────────────────────────────────────────── */}
      {loading ? (
        <PageLoader label="Memuat backup log…" />
      ) : logs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-base-850/50 px-6 py-14 text-center text-sm text-ink-faint">
          {hasFilters
            ? 'Tidak ada backup log yang cocok dengan filter ini.'
            : 'Belum ada backup log di panel ini.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-base-850">
          <table className="w-full min-w-[1020px] text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="w-44 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => setSort((value) => (value === 'desc' ? 'asc' : 'desc'))}
                    className="inline-flex items-center gap-1 uppercase transition-colors hover:text-ink"
                    title="Urutkan berdasarkan waktu"
                  >
                    Waktu
                    <span className="text-accent">{sort === 'desc' ? '↓' : '↑'}</span>
                  </button>
                </th>
                <th className="px-4 py-2.5">Server</th>
                <th className="w-56 px-4 py-2.5">Owner</th>
                <th className="w-44 px-4 py-2.5">Provider</th>
                <th className="w-28 px-4 py-2.5">Ukuran</th>
                <th className="w-32 px-4 py-2.5">Status</th>
                <th className="w-28 px-4 py-2.5">Durasi</th>
                <th className="w-10 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const statusKey = (log.status ?? 'pending') as BackupLogStatus;
                const running = isRunning(statusKey, log.completed_at);
                const hasError = statusKey === 'failed' && Boolean(log.error_message);
                const isOpen = expanded === log.id;
                return (
                  <Fragment key={log.id}>
                    <tr
                      className={`border-b border-line-soft/60 hover:bg-base-800/50 ${
                        isOpen ? 'bg-base-800/40' : ''
                      } ${hasError ? 'cursor-pointer' : ''}`}
                      onClick={() =>
                        setExpanded((current) => (current === log.id ? null : log.id))
                      }
                    >
                      <td className="px-4 py-3">
                        <p className="font-mono text-[11px] text-ink-muted">
                          {formatDateTime(log.started_at)}
                        </p>
                        <p className="text-[10px] text-ink-faint">
                          {formatRelativeTime(log.started_at)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {log.server_name ? (
                          <Link
                            href={`/servers/${log.server_id}/backups`}
                            onClick={(event) => event.stopPropagation()}
                            className="font-medium text-ink transition-colors hover:text-accent"
                          >
                            {log.server_name}
                          </Link>
                        ) : (
                          <span className="text-ink-faint">server dihapus</span>
                        )}
                        {log.server_uuid && (
                          <p className="font-mono text-[10px] text-ink-faint">{log.server_uuid}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {log.owner_id ? (
                          <Link
                            href={`/users/${log.owner_id}`}
                            onClick={(event) => event.stopPropagation()}
                            className="block truncate text-xs text-ink transition-colors hover:text-accent"
                            title={log.owner_email ?? undefined}
                          >
                            {log.owner_email ?? '(tanpa email)'}
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-faint">—</span>
                        )}
                        {log.owner_username && (
                          <p className="truncate text-[10px] text-ink-faint">@{log.owner_username}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ProviderCell type={log.provider_type} name={log.provider_name} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                        {formatBytes(log.size_bytes)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONES[statusKey]}>
                          {running && <span className="dot-pulse">●</span>}
                          {STATUS_LABELS[statusKey]}
                        </Badge>
                        {hasError && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpanded(log.id);
                            }}
                            className="mt-1 block text-[10px] text-red-400 hover:underline"
                          >
                            lihat error
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                        {running ? (
                          <span className="text-amber-400">{formatUptime(durationMs(log))}</span>
                        ) : (
                          formatUptime(durationMs(log))
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-ink-faint">
                        <span
                          className={`inline-block transition-transform ${isOpen ? 'rotate-90' : ''}`}
                        >
                          ›
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-line-soft/60 bg-base-900/60">
                        <td colSpan={8} className="px-4 py-3">
                          {hasError && (
                            <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2">
                              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-red-400">
                                Error message
                              </p>
                              <p className="whitespace-pre-wrap break-all font-mono text-[11px] text-red-300">
                                {log.error_message}
                              </p>
                            </div>
                          )}
                          <div className="grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
                            <Detail label="File" value={log.storage_file_name ?? '—'} mono />
                            <Detail label="Backup UUID" value={log.backup_uuid ?? '—'} mono />
                            <Detail label="Schedule ID" value={log.schedule_id ?? '—'} mono />
                            <Detail label="File ID di cloud" value={log.storage_file_id ?? '—'} mono />
                            <Detail
                              label="Mulai"
                              value={formatDateTime(log.started_at)}
                              mono
                            />
                            <Detail
                              label="Selesai"
                              value={log.completed_at ? formatDateTime(log.completed_at) : '—'}
                              mono
                            />
                            <Detail
                              label="Durasi"
                              value={formatUptime(durationMs(log))}
                              mono
                            />
                            <Detail label="Ukuran" value={formatBytes(log.size_bytes)} mono />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ─────────────────────────────────────────────────────── */}
      {!loading && logs.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-xs text-ink-faint">
            {total} entri · halaman {page} / {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(value - 1, 1))}
            >
              ← Sebelumnya
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Berikutnya →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={`truncate text-ink-muted ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </p>
    </div>
  );
}
