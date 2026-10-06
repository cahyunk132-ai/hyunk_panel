'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Field, Input } from '@/components/ui/Input';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
// `import type` saja — lib/minecraft/playerdata.ts membaca file server
// (node:zlib) sehingga tidak boleh ikut ke bundle browser.
import type { InventoryItem, PlayerData, PlayerSummary } from '@/lib/minecraft/playerdata';

type PlayerAction = 'kick' | 'ban' | 'unban' | 'op' | 'deop' | 'whitelist-add' | 'whitelist-remove';

type Tone = 'default' | 'accent' | 'green' | 'yellow' | 'red' | 'gray';

interface PlayerManagerProps {
  serverId: string;
  canSendCommand: boolean;
}

const ACTION_LABELS: Record<PlayerAction, string> = {
  kick: 'Kick',
  ban: 'Ban',
  unban: 'Unban',
  op: 'Op',
  deop: 'Deop',
  'whitelist-add': 'Whitelist add',
  'whitelist-remove': 'Whitelist remove',
};

// Mirror `gamemodeLabel()` di lib/minecraft/playerdata.ts (tidak bisa di-import
// sebagai value di client karena modul itu memakai node:zlib).
const GAMEMODE_LABELS: Record<number, string> = {
  0: 'Survival',
  1: 'Creative',
  2: 'Adventure',
  3: 'Spectator',
};

function gamemodeText(gamemode: number): string {
  return GAMEMODE_LABELS[gamemode] ?? 'Unknown';
}

function gamemodeTone(gamemode: number): Tone {
  if (gamemode === 0) return 'green';
  if (gamemode === 1) return 'accent';
  if (gamemode === 2) return 'yellow';
  return 'gray';
}

function dimensionTone(dimension: string): Tone {
  if (dimension.includes('nether')) return 'red';
  if (dimension.includes('end')) return 'yellow';
  return 'default';
}

function shortDimension(dimension: string): string {
  return dimension.replace(/^minecraft:/, '') || 'overworld';
}

function itemLabel(id: string): string {
  return id.replace(/^minecraft:/, '').replace(/_/g, ' ');
}

/** Angka rapi: 19.5 → "19.5", 20 → "20". */
function amount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function coord(value: number): string {
  return value.toFixed(1);
}

function avatarUrl(uuid: string, size: number): string {
  return `https://mc-heads.net/avatar/${encodeURIComponent(uuid)}/${size}`;
}

const INVENTORY_SLOTS = Array.from({ length: 36 }, (_, index) => index);

export function PlayerManager({ serverId, canSendCommand }: PlayerManagerProps) {
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busyUuid, setBusyUuid] = useState<string | null>(null);

  const [banTarget, setBanTarget] = useState<{ uuid: string; name: string | null } | null>(null);
  const [banReason, setBanReason] = useState('');
  const [banBusy, setBanBusy] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<PlayerData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (options?.silent) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetch(`/api/servers/${serverId}/players`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError({
            message:
              typeof json.error === 'string'
                ? json.error
                : 'Server harus dalam keadaan online dan playerdata harus tersedia',
            detail: typeof json.detail === 'string' ? json.detail : undefined,
          });
          setPlayers([]);
          return;
        }
        // Bedrock Edition → server sengaja tidak menyediakan playerdata.
        // Tampilkan pesan info, bukan error.
        if (json.supported === false) {
          setUnsupported(
            typeof json.message === 'string'
              ? json.message
              : 'Player data tidak tersedia untuk Bedrock Edition server.',
          );
          setPlayers([]);
          setError(null);
          return;
        }
        setUnsupported(null);
        setPlayers(Array.isArray(json.players) ? (json.players as PlayerSummary[]) : []);
        setTotalFiles(typeof json.total === 'number' ? json.total : 0);
        setError(null);
      } catch (err) {
        setError({
          message: 'Server harus dalam keadaan online dan playerdata harus tersedia',
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
    // Segarkan berkala supaya health/posisi tidak basi. Dipanggil hanya saat tab
    // terlihat — tiap refresh membaca semua file playerdata di node. Server
    // Bedrock tidak punya playerdata → tidak perlu di-refresh berkala.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !unsupported) void load({ silent: true });
    }, 60_000);
    return () => clearInterval(timer);
  }, [load, unsupported]);

  const loadDetail = useCallback(
    async (uuid: string) => {
      setDetailOpen(true);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/servers/${serverId}/players/${uuid}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof json.error === 'string' ? json.error : 'Gagal memuat detail player',
          );
        }
        setDetail(json.player as PlayerData);
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : 'Gagal memuat detail player');
      } finally {
        setDetailLoading(false);
      }
    },
    [serverId],
  );

  const sendAction = useCallback(
    async (
      uuid: string,
      action: PlayerAction,
      options?: { reason?: string; name?: string | null; silentBusy?: boolean },
    ) => {
      if (!options?.silentBusy) setBusyUuid(uuid);
      setNotice(null);
      try {
        const res = await fetch(`/api/servers/${serverId}/players/${uuid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            ...(options?.reason ? { reason: options.reason } : {}),
            ...(options?.name ? { name: options.name } : {}),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof json.error === 'string' ? json.error : 'Aksi gagal');
        }
        setNotice({
          tone: 'success',
          text: `${ACTION_LABELS[action]} terkirim${json.command ? ` · /${json.command}` : ''}`,
        });
        setBanTarget(null);
        setBanReason('');
        await load({ silent: true });
        if (detailOpen && detail?.uuid.toLowerCase() === uuid.toLowerCase()) {
          await loadDetail(uuid);
        }
      } catch (err) {
        setNotice({
          tone: 'error',
          text: err instanceof Error ? err.message : 'Aksi gagal dijalankan',
        });
      } finally {
        setBusyUuid(null);
        setBanBusy(false);
      }
    },
    [serverId, load, loadDetail, detailOpen, detail],
  );

  const inventoryBySlot = useMemo(() => {
    const map = new Map<number, InventoryItem>();
    for (const item of detail?.inventory ?? []) map.set(item.slot, item);
    return map;
  }, [detail]);

  const hasBanned = players.some((player) => player.isBanned);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Player Manager"
          subtitle="Data dibaca langsung dari playerdata server (tanpa plugin)."
          action={
            <div className="flex items-center gap-2">
              {!loading && !error && !unsupported && (
                <span className="text-xs text-ink-faint">
                  {players.length}
                  {totalFiles > players.length ? `/${totalFiles}` : ''} player
                  {hasBanned ? ' · ada ban aktif' : ''}
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

          {unsupported && (
            // Info (bukan error) — server ini memang tidak punya playerdata
            // yang bisa dibaca (mis. Bedrock Edition).
            <div className="rounded-lg border border-accent/25 bg-accent-soft px-4 py-3">
              <p className="text-sm font-medium text-accent">{unsupported}</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3">
              <p className="text-sm font-medium text-red-300">{error.message}</p>
              {error.detail && (
                <p className="mt-1 break-words font-mono text-[11px] text-red-300/70">
                  {error.detail}
                </p>
              )}
            </div>
          )}

          {loading ? (
            <PageLoader label="Memuat data player…" />
          ) : unsupported ? null : error ? null : players.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-base-850/50 px-6 py-14 text-center text-sm text-ink-faint">
              Belum ada player yang pernah bergabung.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[880px] text-sm">
                  <thead>
                    <tr className="border-b border-line-soft bg-base-900/40 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                      <th className="w-12 px-3 py-2.5">Av</th>
                      <th className="px-3 py-2.5">Nama</th>
                      <th className="w-24 px-3 py-2.5">Health</th>
                      <th className="w-24 px-3 py-2.5">Food</th>
                      <th className="w-28 px-3 py-2.5">Gamemode</th>
                      <th className="w-40 px-3 py-2.5">Posisi</th>
                      <th className="w-32 px-3 py-2.5">Dimension</th>
                      <th className="w-40 px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {players.map((player) => (
                      <tr
                        key={player.uuid}
                        className="border-b border-line-soft/60 last:border-0 hover:bg-base-800/40"
                      >
                        <td className="px-3 py-2.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={avatarUrl(player.uuid, 24)}
                            alt=""
                            width={24}
                            height={24}
                            loading="lazy"
                            className="h-6 w-6 rounded border border-line-soft bg-base-900"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => void loadDetail(player.uuid)}
                            className="text-left font-medium text-ink transition-colors hover:text-accent"
                            title="Lihat detail player"
                          >
                            {player.name ?? `${player.uuid.slice(0, 8)}…`}
                          </button>
                          <p className="font-mono text-[10px] text-ink-faint">{player.uuid}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-xs text-red-400">
                            ❤ {amount(player.health)}/20
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-xs text-amber-400">
                            🍖 {player.foodLevel}/20
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={gamemodeTone(player.gamemode)}>
                            {gamemodeText(player.gamemode)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-ink-muted">
                          {coord(player.posX)} {coord(player.posY)} {coord(player.posZ)}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={dimensionTone(player.dimension)}>
                            {shortDimension(player.dimension)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {player.isOp && <Badge tone="accent">Op</Badge>}
                            {player.isBanned && <Badge tone="red">Banned</Badge>}
                            {player.isWhitelisted && <Badge tone="green">Whitelisted</Badge>}
                            {!player.isOp && !player.isBanned && !player.isWhitelisted && (
                              <span className="text-xs text-ink-faint">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            {busyUuid === player.uuid && <Spinner size="sm" />}
                            <PlayerActions
                              player={player}
                              canSendCommand={canSendCommand}
                              busy={busyUuid === player.uuid}
                              onAction={(action) =>
                                void sendAction(player.uuid, action, { name: player.name })
                              }
                              onBan={() => {
                                setNotice(null);
                                setBanTarget(player);
                                setBanReason('');
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalFiles > players.length && (
                <p className="text-[11px] text-ink-faint">
                  Menampilkan {players.length} dari {totalFiles} file playerdata — sisanya tidak
                  terbaca atau dilewati.
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Detail player — disembunyikan sementara saat dialog ban terbuka */}
      <Modal
        open={detailOpen && !banTarget}
        onClose={() => setDetailOpen(false)}
        wide
        title={detail?.name ?? 'Detail player'}
      >
        {detailLoading ? (
          <PageLoader label="Memuat detail player…" />
        ) : detailError ? (
          <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            <p className="font-medium">Server harus dalam keadaan online dan playerdata harus tersedia</p>
            <p className="mt-1 break-words font-mono text-[11px] text-red-300/70">{detailError}</p>
          </div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarUrl(detail.uuid, 64)}
                alt=""
                width={64}
                height={64}
                className="h-16 w-16 rounded-lg border border-line bg-base-900"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-ink">
                    {detail.name ?? 'Nama tidak diketahui'}
                  </p>
                  {detail.isOp && <Badge tone="accent">Op</Badge>}
                  {detail.isBanned && <Badge tone="red">Banned</Badge>}
                  {detail.isWhitelisted && <Badge tone="green">Whitelisted</Badge>}
                </div>
                <p className="mt-0.5 break-all font-mono text-[11px] text-ink-faint">{detail.uuid}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void loadDetail(detail.uuid)}
                loading={detailLoading}
              >
                ↻ Muat ulang
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <StatBar
                label="Health"
                icon="❤"
                value={detail.health}
                max={20}
                color="bg-red-500"
                textClass="text-red-400"
              />
              <StatBar
                label="Food"
                icon="🍖"
                value={detail.foodLevel}
                max={20}
                color="bg-amber-400"
                textClass="text-amber-400"
              />
            </div>

            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <InfoBox label="XP Level" value={String(detail.xpLevel)} />
              <InfoBox
                label="Gamemode"
                value={gamemodeText(detail.gamemode)}
                tone={gamemodeTone(detail.gamemode)}
              />
              <InfoBox
                label="Dimension"
                value={shortDimension(detail.dimension)}
                tone={dimensionTone(detail.dimension)}
              />
              <InfoBox
                label="Koordinat"
                value={`${coord(detail.posX)} ${coord(detail.posY)} ${coord(detail.posZ)}`}
                mono
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Inventory (slot 0–35)
              </p>
              <div className="overflow-x-auto">
                <div className="grid min-w-[560px] grid-cols-9 gap-1">
                  {INVENTORY_SLOTS.map((slot) => {
                    const item = inventoryBySlot.get(slot);
                    if (!item) {
                      return (
                        <div
                          key={slot}
                          className="aspect-square rounded border border-line-soft bg-base-900/40"
                          title={`Slot ${slot} — kosong`}
                        />
                      );
                    }
                    return (
                      <div
                        key={slot}
                        title={`${item.id} × ${item.count} (slot ${item.slot})`}
                        className="relative aspect-square overflow-hidden rounded border border-line bg-base-800 p-1"
                      >
                        <p className="text-[9px] leading-tight break-words text-ink">
                          {itemLabel(item.id)}
                        </p>
                        <span className="absolute bottom-0.5 right-1 font-mono text-[9px] font-semibold text-accent">
                          {item.count > 1 ? item.count : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
              <p className="text-[11px] text-ink-faint">
                Aksi dikirim sebagai command ke console server.
              </p>
              <div className="flex items-center gap-2">
                {busyUuid === detail.uuid && <Spinner size="sm" />}
                <PlayerActions
                  player={detail}
                  canSendCommand={canSendCommand}
                  busy={busyUuid === detail.uuid}
                  align="start"
                  onAction={(action) =>
                    void sendAction(detail.uuid, action, { name: detail.name })
                  }
                  onBan={() => {
                    setNotice(null);
                    setBanTarget({ uuid: detail.uuid, name: detail.name });
                    setBanReason('');
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
      {/* Konfirmasi ban + alasan (boleh dikosongkan) */}
      <Modal
        open={!!banTarget}
        onClose={() => {
          setBanTarget(null);
          setBanReason('');
        }}
        title="Ban player?"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            <strong className="text-ink">{banTarget?.name ?? 'Player ini'}</strong> akan ditambahkan ke
            <code className="mx-1 rounded bg-base-600 px-1.5 py-0.5 font-mono text-[11px]">
              banned-players.json
            </code>
            dan tidak bisa join server. Alasan boleh dikosongkan.
          </p>
          <Field label="Alasan ban" hint="Dikosongkan → memakai alasan default server.">
            <Input
              value={banReason}
              onChange={(event) => setBanReason(event.target.value)}
              placeholder="Banned by admin"
              maxLength={200}
              autoFocus
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setBanTarget(null);
                setBanReason('');
              }}
            >
              Batal
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={banBusy}
              onClick={() => {
                if (!banTarget) return;
                setBanBusy(true);
                void sendAction(banTarget.uuid, 'ban', {
                  reason: banReason,
                  name: banTarget.name,
                  silentBusy: true,
                });
              }}
            >
              Ban player
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}

/** Tombol aksi player — dipakai di tabel & modal detail. */
function PlayerActions({
  player,
  canSendCommand,
  busy,
  onAction,
  onBan,
  align = 'end',
}: {
  player: {
    uuid: string;
    name: string | null;
    isBanned: boolean;
    isOp: boolean;
    isWhitelisted: boolean;
  };
  canSendCommand: boolean;
  busy: boolean;
  onAction: (action: PlayerAction) => void;
  onBan: () => void;
  align?: 'end' | 'start';
}) {
  if (!canSendCommand) {
    return <span className="text-[11px] text-ink-faint">Hanya lihat</span>;
  }

  const disabled = busy || !player.name;
  const title = player.name ? undefined : 'Nama player tidak diketahui (tidak ada di usercache.json)';

  return (
    <div className={`flex flex-wrap gap-1 ${align === 'end' ? 'justify-end' : ''}`}>
      <Button size="sm" variant="ghost" disabled={disabled} title={title} onClick={() => onAction('kick')}>
        Kick
      </Button>
      {player.isBanned ? (
        <Button
          size="sm"
          variant="success"
          disabled={disabled}
          title={title}
          onClick={() => onAction('unban')}
        >
          Unban
        </Button>
      ) : (
        <Button size="sm" variant="danger" disabled={disabled} title={title} onClick={onBan}>
          Ban
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        title={title}
        onClick={() => onAction(player.isOp ? 'deop' : 'op')}
      >
        {player.isOp ? 'Deop' : 'Op'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        title={title}
        onClick={() => onAction(player.isWhitelisted ? 'whitelist-remove' : 'whitelist-add')}
      >
        {player.isWhitelisted ? 'Whitelist −' : 'Whitelist +'}
      </Button>
    </div>
  );
}

function StatBar({
  label,
  icon,
  value,
  max,
  color,
  textClass,
}: {
  label: string;
  icon: string;
  value: number;
  max: number;
  color: string;
  textClass: string;
}) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-muted">{label}</span>
        <span className={`font-mono ${textClass}`}>
          {icon} {amount(value)}/{max}
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-base-700">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function InfoBox({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: Tone;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line-soft bg-base-900/40 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</p>
      {tone ? (
        <div className="mt-1">
          <Badge tone={tone}>{value}</Badge>
        </div>
      ) : (
        <p className={`mt-1 text-sm text-ink ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
      )}
    </div>
  );
}
