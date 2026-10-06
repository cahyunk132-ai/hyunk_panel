'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Field, Select } from '@/components/ui/Input';
import { ConfirmDangerModal } from '@/components/ui/Modal';
import { formatRelativeTime } from '@/lib/utils/format';

export interface AdminUserRow {
  id: string;
  username: string;
  email: string | null;
  role: 'admin' | 'user';
  created_at: string;
  server_count: number;
}

export function UsersManager({
  users,
  currentUserId,
}: {
  users: AdminUserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<AdminUserRow | null>(null);
  const [typed, setTyped] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
          username: form.get('username'),
          role: form.get('role'),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal membuat user');
      setCreateOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setLoading(false);
    }
  }

  async function onDelete() {
    if (!deleting) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${deleting.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menghapus');
      setDeleting(null);
      setTyped('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          + User baru
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-base-850">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line-soft text-left text-[11px] uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5">User</th>
              <th className="w-28 px-4 py-2.5">Role</th>
              <th className="w-28 px-4 py-2.5">Servers</th>
              <th className="w-36 px-4 py-2.5">Bergabung</th>
              <th className="w-24 px-4 py-2.5 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-line-soft/60 last:border-0 hover:bg-base-800/50">
                <td className="px-4 py-3">
                  <Link href={`/users/${u.id}`} className="font-medium text-ink hover:text-accent">
                    {u.username}
                  </Link>
                  {u.id === currentUserId && <span className="ml-2 text-[10px] text-ink-faint">(Anda)</span>}
                  <p className="text-[11px] text-ink-faint">{u.email}</p>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={u.role === 'admin' ? 'accent' : 'default'}>{u.role}</Badge>
                </td>
                <td className="px-4 py-3 text-xs text-ink-muted">{u.server_count}</td>
                <td className="px-4 py-3 text-xs text-ink-muted">{formatRelativeTime(u.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Link href={`/users/${u.id}`}>
                      <Button size="sm" variant="ghost">
                        Kelola
                      </Button>
                    </Link>
                    {u.id !== currentUserId && (
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(u)}>
                        🗑
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="User baru">
        <form onSubmit={onCreate} className="space-y-4">
          <Field label="Email" required>
            <Input name="email" type="email" required autoComplete="off" />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Username" required>
              <Input name="username" required autoComplete="off" />
            </Field>
            <Field label="Role" required>
              <Select name="role" defaultValue="user">
                <option value="user">user</option>
                <option value="admin">admin</option>
              </Select>
            </Field>
          </div>
          <Field label="Password" hint="Minimal 8 karakter" required>
            <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setCreateOpen(false)}>
              Batal
            </Button>
            <Button type="submit" loading={loading}>
              Buat user
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete */}
      <ConfirmDangerModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={onDelete}
        title={`Hapus user "${deleting?.username}"?`}
        description="Akun Supabase Auth user ikut terhapus. Server milik user tetap ada (owner menjadi kosong)."
        confirmText={deleting?.username ?? ''}
        typedValue={typed}
        setTypedValue={setTyped}
        loading={loading}
        dangerLabel="Hapus user"
      />
    </div>
  );
}
