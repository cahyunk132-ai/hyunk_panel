'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Input';
import { ConfirmDangerModal } from '@/components/ui/Modal';
import { RoleBadge } from '@/components/users/RoleBadge';

interface SubuserRow {
  user_id: string;
  username: string;
  email: string;
  permissions: string[];
}

const PERMISSION_GROUPS = [
  { id: 'power', title: 'Start / Stop / Restart', details: 'Mengontrol daya server.' },
  { id: 'console', title: 'Console', details: 'Membaca console dan mengirim command.' },
  { id: 'files', title: 'File Manager', details: 'Melihat, mengunggah, dan mengedit file server.' },
  { id: 'backups', title: 'Backup', details: 'Melihat, membuat, dan restore backup; tidak dapat menghapusnya.' },
  { id: 'players', title: 'Player Management', details: 'Mengelola player melalui fitur Players.' },
] as const;

const PERMISSION_LABELS: Record<string, string> = {
  start: 'Start',
  stop: 'Stop',
  restart: 'Restart',
  console: 'Console',
  'console.send': 'Kirim command',
  monitoring: 'Monitoring',
  'files.read': 'Lihat file',
  'files.edit': 'Edit file',
  backups: 'Backup',
  'backup.restore': 'Restore backup',
  players: 'Player Management',
};

export function SubuserManagement({ serverId }: { serverId: string }) {
  const router = useRouter();
  const [subusers, setSubusers] = useState<SubuserRow[]>([]);
  const [email, setEmail] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(['power', 'console']));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<SubuserRow | null>(null);
  const [typed, setTyped] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/servers/${serverId}/subusers`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal memuat daftar subuser');
      setSubusers(Array.isArray(json.subusers) ? json.subusers : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar subuser');
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  function togglePermission(permission: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/servers/${serverId}/subusers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, permissions: Array.from(selected) }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal menambahkan subuser');
      setEmail('');
      setMessage(json.invited ? 'Undangan dikirim ke email tersebut.' : 'Subuser berhasil ditambahkan ke server.');
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambahkan subuser');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/servers/${serverId}/subusers/${removing.user_id}`, {
        method: 'DELETE',
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal menghapus subuser');
      setRemoving(null);
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus subuser');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Subuser"
        subtitle="Berikan akses terbatas ke server ini menggunakan alamat email."
      />
      <div className="space-y-5 px-5 py-4">
        {message && (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
            {message}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={invite} className="space-y-4">
          <Field label="Email subuser" hint="Jika akun belum ada, Supabase akan mengirimkan undangan email." required>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nama@example.com"
              required
              autoComplete="email"
            />
          </Field>

          <fieldset>
            <legend className="mb-2 text-xs font-medium text-ink-muted">Permission</legend>
            <div className="grid gap-2 md:grid-cols-2">
              {PERMISSION_GROUPS.map((permission) => (
                <label
                  key={permission.id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-base-800/50 px-3 py-2.5 transition-colors hover:border-accent/40"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(permission.id)}
                    onChange={() => togglePermission(permission.id)}
                    className="mt-0.5 accent-cyan-400"
                  />
                  <span>
                    <span className="block text-xs font-medium text-ink">{permission.title}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-faint">{permission.details}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={busy} disabled={!email.trim() || selected.size === 0}>
              + Tambah Subuser
            </Button>
          </div>
        </form>

        <div className="border-t border-line-soft pt-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-ink">Subuser yang di-assign</h3>
            <span className="text-[11px] text-ink-faint">{subusers.length} akun</span>
          </div>
          {loading ? (
            <p className="py-4 text-center text-xs text-ink-faint">Memuat…</p>
          ) : subusers.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-faint">Belum ada subuser.</p>
          ) : (
            <div className="space-y-2">
              {subusers.map((subuser) => (
                <div
                  key={subuser.user_id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-base-800/50 px-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{subuser.username}</span>
                      <RoleBadge role="subuser" />
                    </div>
                    <p className="truncate text-[11px] text-ink-faint">{subuser.email}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {subuser.permissions.map((permission) => (
                        <Badge key={permission} tone="gray">
                          {PERMISSION_LABELS[permission] ?? permission}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy}
                    onClick={() => {
                      setTyped('');
                      setRemoving(subuser);
                    }}
                  >
                    Hapus
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDangerModal
        open={!!removing}
        onClose={() => {
          setRemoving(null);
          setTyped('');
        }}
        onConfirm={() => void remove()}
        title={`Hapus akses ${removing?.username ?? 'subuser'}?`}
        description="Akun tidak dihapus dari panel; hanya aksesnya ke server ini yang dicabut."
        confirmText={removing?.username ?? ''}
        typedValue={typed}
        setTypedValue={setTyped}
        loading={busy}
        dangerLabel="Cabut akses"
      />
    </Card>
  );
}
