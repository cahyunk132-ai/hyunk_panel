'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Input';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function dateInputValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function displayDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' }).format(date);
}

export function ServerBilling({
  serverId,
  initialExpiresAt,
  initialSuspended,
  initialDeleteAfterAt,
  canEdit,
}: {
  serverId: string;
  initialExpiresAt: string | null;
  initialSuspended: boolean;
  initialDeleteAfterAt: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt);
  const [dateValue, setDateValue] = useState(dateInputValue(initialExpiresAt));
  const [suspended, setSuspended] = useState(initialSuspended);
  const [deleteAfterAt, setDeleteAfterAt] = useState(initialDeleteAfterAt);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const status = useMemo(() => {
    if (suspended) return { label: '🔴 Tersuspend', tone: 'red' as const };
    if (!expiresAt) return { label: 'Aktif tanpa jatuh tempo', tone: 'green' as const };
    const timestamp = new Date(expiresAt).getTime();
    if (timestamp <= Date.now() + THREE_DAYS_MS) {
      return { label: '⚠️ Akan disuspend', tone: 'yellow' as const };
    }
    return { label: `Aktif hingga ${displayDate(expiresAt)}`, tone: 'green' as const };
  }, [expiresAt, suspended]);

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/servers/${encodeURIComponent(serverId)}/billing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expires_at: dateValue || null }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        server?: { expires_at?: string | null; is_suspended?: boolean; delete_after_at?: string | null };
      };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);

      const nextExpiresAt = body.server?.expires_at ?? null;
      setExpiresAt(nextExpiresAt);
      setDateValue(dateInputValue(nextExpiresAt));
      setSuspended(Boolean(body.server?.is_suspended));
      setDeleteAfterAt(body.server?.delete_after_at ?? null);
      setMessage('Billing server berhasil disimpan.');
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Billing server gagal disimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Billing & auto-suspend"
        subtitle="Server expired akan dihentikan, disuspend 7 hari, lalu dihapus otomatis oleh cron backup harian."
        action={<Badge tone={status.tone}>{status.label}</Badge>}
      />
      <div className="space-y-3 px-5 pb-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,240px)_auto] sm:items-end">
          <Field
            label="Tanggal jatuh tempo"
            hint={canEdit ? 'Kosongkan untuk menonaktifkan auto-suspend.' : 'Tanggal dikelola Owner Panel/Admin.'}
          >
            <Input
              type="date"
              value={dateValue}
              onChange={(event) => setDateValue(event.target.value)}
              disabled={!canEdit || saving}
            />
          </Field>
          {canEdit && (
            <Button type="button" size="sm" onClick={() => void save()} loading={saving}>
              Simpan
            </Button>
          )}
        </div>

        {suspended && deleteAfterAt && (
          <p className="text-xs text-amber-300">
            Masa tenggang berakhir {displayDate(deleteAfterAt)}. Perpanjang tanggal sebelum cron menghapus server.
          </p>
        )}
        {message && <p className="text-xs text-emerald-300">{message}</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
      </div>
    </Card>
  );
}
