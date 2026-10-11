'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { formatRelativeTime } from '@/lib/utils/format';
import type { AdminSubdomainRow } from '@/types';

function OwnerCell({ row }: { row: AdminSubdomainRow }) {
  const label = row.owner_username ?? row.owner_email;
  if (!label) return <span className="text-ink-faint">—</span>;
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-ink">{row.owner_username ?? '—'}</p>
      {row.owner_email && <p className="truncate text-[10px] text-ink-faint">{row.owner_email}</p>}
    </div>
  );
}

/**
 * /admin/subdomains — tabel semua subdomain yang terdaftar di panel
 * (subdomain, server, owner, port, tanggal dibuat) + hapus per row.
 */
export function SubdomainsAdmin() {
  const [rows, setRows] = useState<AdminSubdomainRow[]>([]);
  const [baseDomain, setBaseDomain] = useState('wangstore.web.id');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/subdomains');
      const data = (await res.json()) as {
        subdomains: AdminSubdomainRow[];
        base_domain?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Gagal memuat subdomain');
      setRows(data.subdomains);
      if (data.base_domain) setBaseDomain(data.base_domain);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat subdomain');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: AdminSubdomainRow) {
    if (!window.confirm(`Hapus subdomain "${row.full_domain}"? Domain tidak akan lagi mengarah ke server tersebut.`)) {
      return;
    }
    setDeletingId(row.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/subdomains/${row.id}`, { method: 'DELETE' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Gagal menghapus subdomain');
      setRows((prev) => prev.filter((item) => item.id !== row.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal menghapus subdomain');
    } finally {
      setDeletingId(null);
    }
  }

  const query = q.trim().toLowerCase();
  const filtered = query
    ? rows.filter((row) =>
        [row.subdomain, row.full_domain, row.server_name, row.owner_username, row.owner_email]
          .filter(Boolean)
          .some((value) => (value as string).toLowerCase().includes(query)),
      )
    : rows;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Subdomain Manager</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Semua subdomain terdaftar di <span className="font-mono text-ink">{baseDomain}</span> beserta
            tujuan IP:port servernya.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-56">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari subdomain / server / owner…"
              autoComplete="off"
            />
          </div>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Semua subdomain"
          subtitle={`${filtered.length} subdomain terdaftar`}
          action={<Badge tone="accent">{rows.length} total</Badge>}
        />
        <div className="overflow-x-auto">
          {loading ? (
            <PageLoader label="Memuat subdomain…" />
          ) : error ? (
            <p className="px-5 py-6 text-sm text-red-400">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">
              {query ? 'Tidak ada subdomain yang cocok dengan pencarian.' : 'Belum ada subdomain terdaftar.'}
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line-soft text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-5 py-3 font-medium">Subdomain</th>
                  <th className="px-5 py-3 font-medium">Server</th>
                  <th className="px-5 py-3 font-medium">Owner</th>
                  <th className="px-5 py-3 font-medium">Port</th>
                  <th className="px-5 py-3 font-medium">Dibuat</th>
                  <th className="px-5 py-3 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="border-b border-line-soft/60 last:border-0 hover:bg-base-800/40">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" title="Aktif" />
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs text-ink">{row.full_domain}</p>
                            <p className="truncate text-[10px] text-ink-faint">→ port {row.port}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        {row.server_id ? (
                          <Link
                            href={`/servers/${row.server_id}`}
                            className="text-xs text-accent hover:underline"
                            title={row.server_uuid ?? undefined}
                          >
                            {row.server_name ?? row.server_uuid ?? row.server_id}
                          </Link>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <OwnerCell row={row} />
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs text-ink">{row.port}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-xs text-ink-muted" title={new Date(row.created_at).toLocaleString('id-ID')}>
                          {formatRelativeTime(row.created_at)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          variant="danger"
                          size="sm"
                          loading={deletingId === row.id}
                          onClick={() => void remove(row)}
                        >
                          {deletingId === row.id ? 'Menghapus…' : 'Hapus'}
                        </Button>
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {actionError && <p className="border-t border-line-soft px-5 py-3 text-xs text-red-400">{actionError}</p>}
      </Card>
    </div>
  );
}
