'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal, ConfirmDangerModal } from '@/components/ui/Modal';
import { Input, Field, Select } from '@/components/ui/Input';
import { RoleBadge } from '@/components/users/RoleBadge';
import { assignableRoles, ROLE_LABELS } from '@/lib/auth/roles';
import type { UserRole } from '@/types';
import { formatRelativeTime } from '@/lib/utils/format';

export interface AdminUserRow {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  created_at: string;
  server_count: number;
}

export function UsersManager({
  users,
  currentUserId,
  currentRole,
  ownerPanelCount,
}: {
  users: AdminUserRow[];
  currentUserId: string;
  currentRole: UserRole;
  ownerPanelCount: number;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<AdminUserRow | null>(null);
  const [typed, setTyped] = useState('');
  const [loading, setLoading] = useState(false);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManageAdmins = currentRole === 'owner_panel';
  const selectableRoles = assignableRoles(currentRole);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
          username: form.get('username'),
          role: form.get('role'),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal membuat user');
      setCreateOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat user');
    } finally {
      setLoading(false);
    }
  }

  async function changeRole(target: AdminUserRow, role: UserRole) {
    if (role === target.role) return;
    setUpdatingRoleId(target.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/users/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal mengubah role');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah role');
    } finally {
      setUpdatingRoleId(null);
    }
  }

  async function onDelete() {
    if (!deleting) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/users/${deleting.id}`, { method: 'DELETE' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal menghapus');
      setDeleting(null);
      setTyped('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus user');
    } finally {
      setLoading(false);
    }
  }

  function canEditTarget(target: AdminUserRow): boolean {
    if (target.id === currentUserId) return false;
    if ((target.role === 'owner_panel' || target.role === 'admin') && !canManageAdmins) return false;
    return selectableRoles.length > 0;
  }

  function canDeleteTarget(target: AdminUserRow): boolean {
    if (target.id === currentUserId) return false;
    if (target.role === 'owner_panel' || target.role === 'admin') return canManageAdmins;
    return true;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-ink-muted">
          Owner Panel: <strong className="text-ink">{ownerPanelCount}/5</strong>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          + User baru
        </Button>
      </div>

      {ownerPanelCount >= 5 && (
        <div className="rounded-lg border border-violet-500/25 bg-violet-500/5 px-3 py-2 text-xs text-violet-200">
          Batas 5 Owner Panel sudah tercapai. Promosikan akun setelah slot Owner Panel tersedia.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-base-850">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line-soft text-left text-[11px] uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5">User</th>
              <th className="w-48 px-4 py-2.5">Role</th>
              <th className="w-24 px-4 py-2.5">Servers</th>
              <th className="w-36 px-4 py-2.5">Bergabung</th>
              <th className="w-32 px-4 py-2.5 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-line-soft/60 last:border-0 hover:bg-base-800/50">
                <td className="px-4 py-3">
                  <Link href={`/users/${user.id}`} className="font-medium text-ink hover:text-accent">
                    {user.username}
                  </Link>
                  {user.id === currentUserId && <span className="ml-2 text-[10px] text-ink-faint">(Anda)</span>}
                  <p className="text-[11px] text-ink-faint">{user.email}</p>
                </td>
                <td className="px-4 py-3">
                  {canEditTarget(user) ? (
                    <div className="flex items-center gap-2">
                      <RoleBadge role={user.role} />
                      <Select
                        aria-label={`Ganti role ${user.username}`}
                        value={user.role}
                        disabled={updatingRoleId === user.id}
                        onChange={(event) => void changeRole(user, event.target.value as UserRole)}
                        className="min-w-[145px] py-1.5 text-xs"
                      >
                        {selectableRoles.map((role) => (
                          <option
                            key={role}
                            value={role}
                            disabled={role === 'owner_panel' && ownerPanelCount >= 5 && user.role !== 'owner_panel'}
                          >
                            {ROLE_LABELS[role]}
                            {role === 'owner_panel' && ownerPanelCount >= 5 && user.role !== 'owner_panel'
                              ? ' (maks. 5)'
                              : ''}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ) : (
                    <RoleBadge role={user.role} />
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-ink-muted">{user.server_count}</td>
                <td className="px-4 py-3 text-xs text-ink-muted">{formatRelativeTime(user.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Link href={`/users/${user.id}`}>
                      <Button size="sm" variant="ghost">Kelola</Button>
                    </Link>
                    {canDeleteTarget(user) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setDeleting(user);
                          setTyped('');
                        }}
                        aria-label={`Hapus ${user.username}`}
                      >
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

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="User baru">
        <form onSubmit={onCreate} className="space-y-4">
          <Field label="Email" required>
            <Input name="email" type="email" required autoComplete="off" />
          </Field>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Username" required>
              <Input name="username" required autoComplete="off" />
            </Field>
            <Field label="Role" required>
              <Select name="role" defaultValue="user">
                {selectableRoles.map((role) => (
                  <option
                    key={role}
                    value={role}
                    disabled={role === 'owner_panel' && ownerPanelCount >= 5}
                  >
                    {ROLE_LABELS[role]}
                    {role === 'owner_panel' && ownerPanelCount >= 5 ? ' (maks. 5)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {ownerPanelCount >= 5 && canManageAdmins && (
            <p className="text-[11px] text-violet-200">Role Owner Panel tidak tersedia sampai jumlahnya di bawah 5.</p>
          )}
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
