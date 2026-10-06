'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { formatAllocation, formatPortRanges, parsePortSpec } from '@/lib/utils/allocations';
import type { NodeAllocation, NodeAllocationStats } from '@/types';

/** Batas baris yang dirender sekaligus — node bisa punya ribuan port. */
const MAX_VISIBLE = 300;

type StatusFilter = 'all' | 'available' | 'assigned';

export function NodeAllocations({ nodeId, canManage }: { nodeId: string; canManage: boolean }) {
  const [allocations, setAllocations] = useState<NodeAllocation[]>([]);
  const [stats, setStats] = useState<NodeAllocationStats>({ total: 0, available: 0, assigned: 0 });
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [ip, setIp] = useState('0.0.0.0');
  const [portsInput, setPortsInput] = useState('');
  const [busy, setBusy] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<NodeAllocation | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/nodes/${nodeId}/allocations`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal memuat daftar port node');
      setAllocations(Array.isArray(json.allocations) ? (json.allocations as NodeAllocation[]) : []);
      setTruncated(json.truncated === true);
      setStats(
        json.stats && typeof json.stats.total === 'number'
          ? (json.stats as NodeAllocationStats)
          : { total: 0, available: 0, assigned: 0 },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar port node');
    } finally {
      setLoading(false);
    }
  }, [nodeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const preview = useMemo(() => parsePortSpec(portsInput), [portsInput]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allocations.filter((allocation) => {
      if (statusFilter === 'available' && allocation.server) return false;
      if (statusFilter === 'assigned' && !allocation.server) return false;
      if (!needle) return true;
      return (
        formatAllocation(allocation.ip, allocation.port).toLowerCase().includes(needle) ||
        String(allocation.port).includes(needle) ||
        allocation.ip.toLowerCase().includes(needle) ||
        (allocation.server?.name.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [allocations, search, statusFilter]);

  const visible = filtered.slice(0, MAX_VISIBLE);
  const hiddenCount = filtered.length - visible.length;

  async function submitAdd() {
    if (preview.error) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/nodes/${nodeId}/allocations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: ip.trim() || '0.0.0.0', ports: portsInput }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal menambah allocation');
      const inserted = Number(json.inserted ?? 0);
      const skipped = Number(json.skipped ?? 0);
      setMessage(
        `${inserted} port ditambahkan${skipped > 0 ? `, ${skipped} dilewati karena sudah terdaftar` : ''}.`,
      );
      setAddOpen(false);
      setPortsInput('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambah allocation');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/nodes/${nodeId}/allocations?allocation_id=${encodeURIComponent(deleteTarget.id)}`,
        { method: 'DELETE' },
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal menghapus allocation');
      setMessage(`Port ${formatAllocation(deleteTarget.ip, deleteTarget.port)} dihapus dari node.`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus allocation');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Allocations / Port"
        subtitle="Port yang terdaftar di node ini. Satu port hanya bisa dipakai satu server."
        action={
          canManage ? (
            <Button size="sm" variant="secondary" onClick={() => { setError(null); setAddOpen(true); }}>
              + Tambah Allocation
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-md border border-line bg-base-800 px-2.5 py-1 text-[11px] text-ink-muted">
            Total: <strong className="text-ink">{stats.total}</strong>
          </span>
          <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300">
            Tersedia: <strong>{stats.available}</strong>
          </span>
          <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300">
            Dipakai: <strong>{stats.assigned}</strong>
          </span>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>
        )}
        {message && (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
            {message}
          </div>
        )}

        <div className="flex flex-col gap-2 md:flex-row">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="md:max-w-[200px]"
            aria-label="Filter status port"
          >
            <option value="all">Semua port</option>
            <option value="available">Tersedia</option>
            <option value="assigned">Dipakai</option>
          </Select>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari port, IP, atau nama server…"
            aria-label="Cari allocation"
          />
        </div>

        <div className="overflow-hidden rounded-lg border border-line-soft">
          {loading ? (
            <p className="px-4 py-6 text-center text-xs text-ink-faint">Memuat port…</p>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-ink-faint">
              {allocations.length === 0
                ? 'Belum ada port terdaftar di node ini. Tambahkan range port (contoh 25565-25600).'
                : 'Tidak ada port yang cocok dengan filter.'}
            </p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {visible.map((allocation) => (
                <li
                  key={allocation.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-base-900/40 px-4 py-2.5 md:px-5"
                >
                  <span className="font-mono text-xs text-ink">{formatAllocation(allocation.ip, allocation.port)}</span>
                  {allocation.server ? (
                    <Badge tone="yellow">Dipakai</Badge>
                  ) : (
                    <Badge tone="green">Tersedia</Badge>
                  )}
                  {allocation.server && (
                    <Link
                      href={`/servers/${allocation.server.id}`}
                      className="min-w-0 truncate text-xs text-accent transition-colors hover:text-accent-dim"
                    >
                      {allocation.server.name}
                    </Link>
                  )}
                  {canManage && !allocation.server && (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setDeleteTarget(allocation);
                      }}
                      className="ml-auto rounded-md border border-red-500/25 px-2.5 py-1 text-xs text-red-300 transition-colors hover:bg-red-500/10"
                      title="Hapus port dari node"
                    >
                      Hapus
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {truncated && (
          <p className="text-[11px] text-amber-300">
            Node ini punya lebih dari 1000 port — hanya 1000 pertama yang dimuat. Persempit dengan filter atau
            pencarian.
          </p>
        )}
        {hiddenCount > 0 && (
          <p className="text-[11px] text-ink-faint">
            Menampilkan {MAX_VISIBLE} dari {filtered.length} port — persempit dengan filter/pencarian.
          </p>
        )}
        <p className="text-[11px] text-ink-faint">
          Port yang sudah dipakai server lain tidak muncul di form pembuatan server. Port hanya bisa dihapus saat
          berstatus <em>Tersedia</em>.
        </p>
      </div>

      <Modal open={addOpen} onClose={() => { if (!busy) setAddOpen(false); }} title="Tambah allocation">
        <div className="space-y-4">
          <Field label="IP" hint="0.0.0.0 berarti semua interface node. Boleh IPv6 atau hostname." required>
            <Input value={ip} onChange={(e) => setIp(e.target.value)} className="font-mono text-xs" placeholder="0.0.0.0" />
          </Field>
          <Field
            label="Port / range port"
            hint="Contoh: 25565 · 25565-25600 · 25565-25570, 25700. Maksimal 2000 port per permintaan."
            required
          >
            <Input
              value={portsInput}
              onChange={(e) => setPortsInput(e.target.value)}
              className="font-mono text-xs"
              placeholder="25565-25600"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </Field>

          {portsInput.trim() !== '' && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                preview.error
                  ? 'border-red-500/25 bg-red-500/5 text-red-300'
                  : 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300'
              }`}
            >
              {preview.error
                ? preview.error
                : `${preview.ports.length} port akan ditambahkan: ${formatPortRanges(preview.ports)}`}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={busy}>
              Batal
            </Button>
            <Button onClick={() => void submitAdd()} loading={busy} disabled={portsInput.trim() === '' || Boolean(preview.error)}>
              Tambah Allocation
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteTarget !== null} onClose={() => { if (!busy) setDeleteTarget(null); }} title="Hapus allocation?">
        <div className="space-y-4">
          <p className="rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            Port <strong className="font-mono">{deleteTarget ? formatAllocation(deleteTarget.ip, deleteTarget.port) : ''}</strong>{' '}
            akan dihapus dari daftar node. Port yang dihapus tidak bisa dipilih saat membuat server sampai ditambahkan
            kembali.
          </p>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={busy}>
              Batal
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} loading={busy}>
              Hapus port
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
