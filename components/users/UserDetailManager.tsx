'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Input';

export interface Assignment {
  server_id: string;
  server_name: string;
  server_uuid: string;
  status: string;
  permissions: string[];
}

interface ServerOption {
  id: string;
  name: string;
}

const ALL_PERMISSIONS = [
  { value: '*', label: 'Full access (*)' },
  { value: 'console', label: 'Lihat console' },
  { value: 'console.send', label: 'Kirim command' },
  { value: 'start', label: 'Start' },
  { value: 'stop', label: 'Stop' },
  { value: 'restart', label: 'Restart' },
  { value: 'kill', label: 'Kill' },
  { value: 'files.read', label: 'Baca file' },
  { value: 'files.edit', label: 'Edit file' },
  { value: 'backups', label: 'Backup' },
  { value: 'settings', label: 'Settings' },
] as const;

export function UserDetailManager({
  userId,
  username,
  role,
  assignments,
  allServers,
  isSelf,
}: {
  userId: string;
  username: string;
  role: 'admin' | 'user';
  assignments: Assignment[];
  allServers: ServerOption[];
  isSelf: boolean;
}) {
  const router = useRouter();
  const [selectedServer, setSelectedServer] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set(['console']));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assignedIds = new Set(assignments.map((a) => a.server_id));
  const available = allServers.filter((s) => !assignedIds.has(s.id));

  function togglePerm(p: string) {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      if (next.has('*')) return new Set(['*']);
      return next;
    });
  }

  async function assign(e: FormEvent) {
    e.preventDefault();
    if (!selectedServer || selectedPerms.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server_id: selectedServer,
          permissions: Array.from(selectedPerms),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal assign');
      setSelectedServer('');
      setSelectedPerms(new Set(['console']));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setLoading(false);
    }
  }

  async function unassign(serverId: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/servers`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_id: serverId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal mencabut akses');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setLoading(false);
    }
  }

  async function changeRole(newRole: 'admin' | 'user') {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal mengubah role');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid max-w-4xl gap-4">
      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <Card>
        <CardHeader title="Role" subtitle="Role global user di panel" />
        <div className="flex items-center justify-between px-5 py-4">
          <Badge tone={role === 'admin' ? 'accent' : 'default'}>{role}</Badge>
          {!isSelf && (
            <Button
              size="sm"
              variant="secondary"
              loading={loading}
              onClick={() => changeRole(role === 'admin' ? 'user' : 'admin')}
            >
              Jadikan {role === 'admin' ? 'user' : 'admin'}
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Akses server"
          subtitle={`${assignments.length} server di-assign ke ${username}`}
        />
        <div className="space-y-3 px-5 py-4">
          {assignments.length === 0 && (
            <p className="text-sm text-ink-faint">Belum ada server yang di-assign.</p>
          )}
          {assignments.map((a) => (
            <div
              key={a.server_id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-base-800/50 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{a.server_name}</p>
                <p className="truncate font-mono text-[10px] text-ink-faint">{a.server_uuid}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {a.permissions.map((p) => (
                  <Badge key={p} tone="default">
                    {p}
                  </Badge>
                ))}
              </div>
              <Button size="sm" variant="danger" loading={loading} onClick={() => unassign(a.server_id)}>
                Cabut
              </Button>
            </div>
          ))}

          {available.length > 0 && (
            <form onSubmit={assign} className="space-y-3 border-t border-line-soft pt-4">
              <p className="text-xs font-medium text-ink-muted">Assign server baru</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Select
                  value={selectedServer}
                  onChange={(e) => setSelectedServer(e.target.value)}
                  required
                >
                  <option value="">Pilih server…</option>
                  {available.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <div className="flex flex-wrap items-center gap-1.5">
                  {ALL_PERMISSIONS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => togglePerm(p.value)}
                      className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                        selectedPerms.has(p.value)
                          ? 'border-accent/50 bg-accent-soft text-accent'
                          : 'border-line bg-base-800 text-ink-muted hover:text-ink'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm" loading={loading} disabled={!selectedServer || selectedPerms.size === 0}>
                  Assign
                </Button>
              </div>
            </form>
          )}
        </div>
      </Card>
    </div>
  );
}
