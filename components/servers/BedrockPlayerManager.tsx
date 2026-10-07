'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Field, Input, Select } from '@/components/ui/Input';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
// `import type` saja — lib/minecraft/bedrock.ts adalah modul server (menulis file
// lewat Wings) sehingga tidak boleh ikut ke bundle browser.
import type { BedrockPermission, BedrockPlayer } from '@/lib/minecraft/bedrock';

type Tone = 'default' | 'accent' | 'green' | 'yellow' | 'red' | 'gray';

interface BedrockPlayerManagerProps {
  serverId: string;
  /** Permission `files.edit` — boleh menulis allowlist.json / permissions.json. */
  canEdit: boolean;
  /** Permission `console.send` — perubahan bisa langsung dikirim ke console. */
  canSendCommand: boolean;
}

// Mirror BEDROCK_PERMISSIONS di lib/minecraft/bedrock.ts (tidak bisa di-import
// sebagai value di client karena modul itu khusus server).
const PERMISSIONS: BedrockPermission[] = ['operator', 'member', 'visitor'];

const PERMISSION_META: Record<BedrockPermission, { label: string; tone: Tone }> = {
  operator: { label: 'Operator', tone: 'accent' },
  member: { label: 'Member', tone: 'green' },
  visitor: { label: 'Visitor', tone: 'gray' },
};

/** XUID = ID Xbox Live berupa angka panjang. */
const XUID_RE = /^[0-9]{1,20}$/;

interface Notice {
  tone: 'success' | 'error';
  text: string;
}

/** Baca pesan error dari response API (fallback: pesan generik). */
async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorMessage(json: Record<string, unknown>, fallback: string): string {
  return typeof json.error === 'string' ? json.error : fallback;
}

/**
 * Keterangan command console dari response API: `commands` = command terkait
 * (allowlist reload / op / deop), `consoleSynced` = benar-benar terkirim ke
 * server yang sedang running.
 */
function commandNote(json: Record<string, unknown>): string {
  const commands = Array.isArray(json.commands)
    ? json.commands.filter((command): command is string => typeof command === 'string')
    : [];
  if (commands.length === 0) return '';
  const list = commands.map((command) => `/${command}`).join(', ');
  return json.consoleSynced === true
    ? ` · terkirim ke console: ${list}`
    : ` · ${list} berlaku saat server start / reload berikutnya`;
}

export function BedrockPlayerManager({
  serverId,
  canEdit,
  canSendCommand,
}: BedrockPlayerManagerProps) {
  const [players, setPlayers] = useState<BedrockPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyXuid, setBusyXuid] = useState<string | null>(null);

  // Form tambah player
  const [addOpen, setAddOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formXuid, setFormXuid] = useState('');
  const [formPermission, setFormPermission] = useState<BedrockPermission>('member');
  const [formIgnoreLimit, setFormIgnoreLimit] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  // Konfirmasi hapus
  const [deleteTarget, setDeleteTarget] = useState<BedrockPlayer | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (options?.silent) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetch(`/api/servers/${serverId}/bedrock/players`, { cache: 'no-store' });
        const json = await readJson(res);
        if (!res.ok) {
          setError({
            message: errorMessage(json, 'Gagal membaca allowlist.json / permissions.json'),
            detail: typeof json.detail === 'string' ? json.detail : undefined,
          });
          setPlayers([]);
          return;
        }
        setPlayers(Array.isArray(json.players) ? (json.players as BedrockPlayer[]) : []);
        setError(null);
      } catch (err) {
        setError({
          message: 'Gagal membaca allowlist.json / permissions.json dari node',
          detail: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [serverId],
  );

  useEffect(() => {
    void load();
    // Ringan (dua file kecil), tapi cukup disegarkan berkala saat tab terlihat —
    // player bisa ditambah lewat console/panel lain.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    }, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  /** PUT/DELETE ke API route; melempar Error berisi pesan dari server. */
  const mutate = useCallback(
    async (
      url: string,
      method: 'PUT' | 'DELETE',
      body?: unknown,
    ): Promise<Record<string, unknown>> => {
      const res = await fetch(url, {
        method,
        ...(body !== undefined
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(errorMessage(json, 'Operasi gagal dijalankan'));
      return json;
    },
    [],
  );

  const changePermission = useCallback(
    async (player: BedrockPlayer, permission: BedrockPermission) => {
      if (permission === player.permission) return;
      const previous = player.permission;
      setNotice(null);
      setBusyXuid(player.xuid);
      // Optimistik: dropdown langsung menampilkan pilihan baru, dibatalkan bila gagal.
      setPlayers((rows) =>
        rows.map((row) => (row.xuid === player.xuid ? { ...row, permission } : row)),
      );
      try {
        const json = await mutate(
          `/api/servers/${serverId}/bedrock/players/${player.xuid}`,
          'PUT',
          { permission },
        );
        setNotice({
          tone: 'success',
          text: `Permission ${player.name ?? player.xuid} → ${PERMISSION_META[permission].label}${commandNote(json)}`,
        });
        await load({ silent: true });
      } catch (err) {
        setPlayers((rows) =>
          rows.map((row) => (row.xuid === player.xuid ? { ...row, permission: previous } : row)),
        );
        setNotice({
          tone: 'error',
          text: err instanceof Error ? err.message : 'Gagal mengubah permission',
        });
      } finally {
        setBusyXuid(null);
      }
    },
    [serverId, mutate, load],
  );

  const changeIgnoreLimit = useCallback(
    async (player: BedrockPlayer, ignoresPlayerLimit: boolean) => {
      if (ignoresPlayerLimit === player.ignoresPlayerLimit) return;
      const previous = player.ignoresPlayerLimit;
      setNotice(null);
      setBusyXuid(player.xuid);
      setPlayers((rows) =>
        rows.map((row) => (row.xuid === player.xuid ? { ...row, ignoresPlayerLimit } : row)),
      );
      try {
        const json = await mutate(
          `/api/servers/${serverId}/bedrock/players/${player.xuid}`,
          'PUT',
          { ignoresPlayerLimit },
        );
        setNotice({
          tone: 'success',
          text: `Ignore Player Limit ${player.name ?? player.xuid} → ${ignoresPlayerLimit ? 'aktif' : 'nonaktif'}${commandNote(json)}`,
        });
        await load({ silent: true });
      } catch (err) {
        setPlayers((rows) =>
          rows.map((row) =>
            row.xuid === player.xuid ? { ...row, ignoresPlayerLimit: previous } : row,
          ),
        );
        setNotice({
          tone: 'error',
          text: err instanceof Error ? err.message : 'Gagal mengubah Ignore Player Limit',
        });
      } finally {
        setBusyXuid(null);
      }
    },
    [serverId, mutate, load],
  );

  const resetForm = useCallback(() => {
    setFormName('');
    setFormXuid('');
    setFormPermission('member');
    setFormIgnoreLimit(false);
    setFormError(null);
  }, []);

  const submitAdd = useCallback(async () => {
    const name = formName.trim();
    const xuid = formXuid.trim();
    if (name.length === 0) {
      setFormError('Nama player wajib diisi (Bedrock tidak punya usercache, nama diinput manual)');
      return;
    }
    if (!XUID_RE.test(xuid)) {
      setFormError('XUID wajib berupa angka — ID Xbox Live player');
      return;
    }
    setAddBusy(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/bedrock/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, xuid, permission: formPermission, ignoresPlayerLimit: formIgnoreLimit }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(errorMessage(json, 'Gagal menambah player'));
      setAddOpen(false);
      resetForm();
      setNotice({
        tone: 'success',
        text: `${name} ditambahkan ke allowlist.json & permissions.json — ${PERMISSION_META[formPermission].label}${commandNote(json)}`,
      });
      await load({ silent: true });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menambah player');
    } finally {
      setAddBusy(false);
    }
  }, [serverId, formName, formXuid, formPermission, formIgnoreLimit, resetForm, load]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setNotice(null);
    try {
      const json = await mutate(
        `/api/servers/${serverId}/bedrock/players/${deleteTarget.xuid}`,
        'DELETE',
      );
      setNotice({
        tone: 'success',
        text: `${deleteTarget.name ?? deleteTarget.xuid} dihapus dari allowlist.json & permissions.json${commandNote(json)}`,
      });
      setDeleteTarget(null);
      await load({ silent: true });
    } catch (err) {
      setNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Gagal menghapus player',
      });
    } finally {
      setDeleteBusy(false);
    }
  }, [serverId, deleteTarget, mutate, load]);

  const operatorCount = useMemo(
    () => players.filter((player) => player.permission === 'operator').length,
    [players],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Bedrock Player Manager"
          subtitle="Dibaca & ditulis langsung ke allowlist.json + permissions.json (Wings Files API)."
          action={
            <div className="flex flex-wrap items-center gap-2">
              {!loading && !error && (
                <span className="text-xs text-ink-faint">
                  {players.length} player
                  {operatorCount > 0 ? ` · ${operatorCount} operator` : ''}
                </span>
              )}
              <Button
                size="sm"
                variant="secondary"
                loading={refreshing}
                onClick={() => void load({ silent: true })}
              >
                ↻ Refresh
              </Button>
              {canEdit && (
                <Button
                  size="sm"
                  onClick={() => {
                    resetForm();
                    setAddOpen(true);
                  }}
                >
                  + Tambah player
                </Button>
              )}
            </div>
          }
        />

        <div className="space-y-4 px-5 py-4">
          {notice && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                notice.tone === 'success'
                  ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300'
                  : 'border-red-500/25 bg-red-500/5 text-red-300'
              }`}
            >
              {notice.text}
            </div>
          )}

          <div className="rounded-lg border border-line-soft bg-base-900/40 px-4 py-3 text-[11px] text-ink-muted">
            <p>
              Daftar player digabung dari dua file berdasarkan <strong className="text-ink">XUID</strong>{' '}
              (ID Xbox Live). Player di <code className="font-mono text-ink-faint">allowlist.json</code> tanpa
              entri di <code className="font-mono text-ink-faint">permissions.json</code> otomatis dianggap{' '}
              <strong className="text-ink">member</strong>.
            </p>
            <p className="mt-1">
              Bedrock tidak punya <code className="font-mono text-ink-faint">usercache.json</code>, jadi nama
              player diinput manual. {canSendCommand
                ? 'Setiap perubahan mengirim command ke console bila server sedang online (allowlist reload / op / deop).'
                : 'Butuh permission console.send agar perubahan langsung dikirim ke console server yang online.'}
            </p>
            {!canEdit && (
              <p className="mt-1 text-ink-faint">
                Kamu hanya bisa melihat daftar — tambah/ubah/hapus butuh permission{' '}
                <code className="font-mono">files.edit</code>.
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3">
              <p className="text-sm font-medium text-red-300">{error.message}</p>
              {error.detail && (
                <p className="mt-1 break-words font-mono text-[11px] text-red-300/70">{error.detail}</p>
              )}
            </div>
          )}

          {loading ? (
            <PageLoader label="Membaca allowlist.json & permissions.json…" />
          ) : error ? null : players.length === 0 ? (
            <div className="rounded-lg border border-line-soft bg-base-900/40 px-4 py-8 text-center">
              <p className="text-sm text-ink-muted">Belum ada player di allowlist.json.</p>
              {canEdit && (
                <p className="mt-1 text-xs text-ink-faint">
                  Tambahkan player dengan nama + XUID (angka) agar bisa join server.
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-line-soft bg-base-900/40 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2.5">Nama</th>
                    <th className="w-52 px-3 py-2.5">XUID</th>
                    <th className="w-44 px-3 py-2.5">Permission</th>
                    <th className="w-44 px-3 py-2.5">Ignore Player Limit</th>
                    <th className="w-40 px-3 py-2.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((player) => {
                    const busy = busyXuid === player.xuid;
                    return (
                      <tr
                        key={player.xuid}
                        className="border-b border-line-soft/60 last:border-0 hover:bg-base-800/40"
                      >
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-ink">
                            {player.name ?? 'Nama tidak diketahui'}
                          </p>
                          {!player.inAllowlist && (
                            <p className="text-[10px] text-ink-faint">
                              hanya ada di permissions.json — tambahkan lewat “+ Tambah player”
                            </p>
                          )}
                          {player.inAllowlist && !player.inPermissions && (
                            <p className="text-[10px] text-ink-faint">permission default (member)</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-ink-muted">{player.xuid}</td>
                        <td className="px-3 py-2.5">
                          {canEdit ? (
                            <Select
                              className="!py-1.5 text-xs"
                              value={player.permission}
                              disabled={busy}
                              aria-label={`Permission ${player.name ?? player.xuid}`}
                              onChange={(event) =>
                                void changePermission(player, event.target.value as BedrockPermission)
                              }
                            >
                              {PERMISSIONS.map((permission) => (
                                <option key={permission} value={permission}>
                                  {PERMISSION_META[permission].label}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <Badge tone={PERMISSION_META[player.permission].tone}>
                              {PERMISSION_META[player.permission].label}
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <label
                            className={`inline-flex items-center gap-2 text-xs ${
                              canEdit && player.inAllowlist
                                ? 'cursor-pointer text-ink-muted'
                                : 'cursor-not-allowed text-ink-faint'
                            }`}
                            title={
                              player.inAllowlist
                                ? 'Player ini diizinkan join walau server penuh'
                                : 'Player belum ada di allowlist.json'
                            }
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-[#3ecfcf]"
                              checked={player.ignoresPlayerLimit}
                              disabled={!canEdit || !player.inAllowlist || busy}
                              onChange={(event) =>
                                void changeIgnoreLimit(player, event.target.checked)
                              }
                            />
                            {player.ignoresPlayerLimit ? 'Aktif' : 'Nonaktif'}
                          </label>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-2">
                            {busy && <Spinner size="sm" />}
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={!canEdit || busy}
                              onClick={() => {
                                setNotice(null);
                                setDeleteTarget(player);
                              }}
                            >
                              Hapus
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* Form tambah player — nama & xuid wajib, permission default member. */}
      <Modal
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          resetForm();
        }}
        title="Tambah player Bedrock"
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
              {formError}
            </div>
          )}

          <Field
            label="Nama player"
            required
            hint="Harus sama persis dengan gamertag player — BDS tidak menyimpan usercache."
          >
            <Input
              value={formName}
              onChange={(event) => setFormName(event.target.value)}
              placeholder="PlayerName"
              maxLength={32}
              autoFocus
            />
          </Field>

          <Field
            label="XUID"
            required
            hint="Angka panjang ID Xbox Live player (mis. 2535423456789012). Bisa dilihat di log server saat player join."
          >
            <Input
              value={formXuid}
              onChange={(event) => setFormXuid(event.target.value.replace(/[^0-9]/g, ''))}
              placeholder="123456789"
              inputMode="numeric"
              maxLength={20}
              className="font-mono"
            />
          </Field>

          <Field label="Permission" hint="Operator bisa memakai command di server.">
            <Select
              value={formPermission}
              onChange={(event) => setFormPermission(event.target.value as BedrockPermission)}
            >
              {PERMISSIONS.map((permission) => (
                <option key={permission} value={permission}>
                  {PERMISSION_META[permission].label}
                </option>
              ))}
            </Select>
          </Field>

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line-soft bg-base-900/40 px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[#3ecfcf]"
              checked={formIgnoreLimit}
              onChange={(event) => setFormIgnoreLimit(event.target.checked)}
            />
            <span className="text-xs text-ink-muted">
              <strong className="text-ink">Ignore Player Limit</strong> — player tetap bisa join saat server
              penuh.
            </span>
          </label>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setAddOpen(false);
                resetForm();
              }}
            >
              Batal
            </Button>
            <Button size="sm" loading={addBusy} onClick={() => void submitAdd()}>
              Tambah player
            </Button>
          </div>
        </div>
      </Modal>

      {/* Konfirmasi hapus — menghapus entri dari allowlist.json & permissions.json. */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Hapus player?"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            <strong className="text-red-200">{deleteTarget?.name ?? deleteTarget?.xuid}</strong> akan
            dihapus dari
            <code className="mx-1 rounded bg-base-600 px-1.5 py-0.5 font-mono text-[11px]">
              allowlist.json
            </code>
            dan
            <code className="mx-1 rounded bg-base-600 px-1.5 py-0.5 font-mono text-[11px]">
              permissions.json
            </code>
            — player tidak bisa join lagi dan kehilangan status operator.
          </div>
          <p className="text-xs text-ink-faint">
            XUID <span className="font-mono text-ink-muted">{deleteTarget?.xuid}</span>
            {canSendCommand
              ? ' · server yang sedang online akan menerima /allowlist reload.'
              : ' · perubahan berlaku saat server start berikutnya.'}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
              Batal
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={deleteBusy}
              onClick={() => void confirmDelete()}
            >
              Hapus player
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
