'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDangerModal, Modal } from '@/components/ui/Modal';
import { Field, Input } from '@/components/ui/Input';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
// `import type` saja — lib/minecraft/playerdata.ts membaca file server
// (node:zlib) sehingga tidak boleh ikut ke bundle browser.
import type { InventoryItem, PlayerData, PlayerSummary } from '@/lib/minecraft/playerdata';
import { loadItemList, type McItem } from '@/lib/minecraft/items';

type PlayerAction = 'kick' | 'ban' | 'unban' | 'op' | 'deop' | 'whitelist-add' | 'whitelist-remove';

/** Aksi baru (tab Players Java): dikirim ke route .../players/{uuid}/action. */
type PlayerFeatureAction = 'clear' | 'reset' | 'teleport' | 'give';

type Tone = 'default' | 'accent' | 'green' | 'yellow' | 'red' | 'gray';

interface PlayerManagerProps {
  serverId: string;
  canSendCommand: boolean;
  canEditFiles: boolean;
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

export function PlayerManager({ serverId, canSendCommand, canEditFiles }: PlayerManagerProps) {
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [notice, setNotice] = useState<{
    tone: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);
  const [busyUuid, setBusyUuid] = useState<string | null>(null);

  const [banTarget, setBanTarget] = useState<{ uuid: string; name: string | null } | null>(null);
  const [banReason, setBanReason] = useState('');
  const [banBusy, setBanBusy] = useState(false);

  // ── Aksi baru: Clear Inventory / Reset Data / Teleport / Give Item ─────────
  const [clearTarget, setClearTarget] = useState<{ uuid: string; name: string | null } | null>(null);
  const [clearBusy, setClearBusy] = useState(false);

  const [resetTarget, setResetTarget] = useState<{ uuid: string; name: string | null } | null>(
    null,
  );
  const [resetTyped, setResetTyped] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  const [tpTarget, setTpTarget] = useState<{
    uuid: string;
    name: string | null;
    x: string;
    y: string;
    z: string;
  } | null>(null);
  const [tpBusy, setTpBusy] = useState(false);

  const [giveTarget, setGiveTarget] = useState<{ uuid: string; name: string | null } | null>(null);
  const [giveBusy, setGiveBusy] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [items, setItems] = useState<McItem[] | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<McItem | null>(null);
  const [itemAmount, setItemAmount] = useState('1');

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

  /**
   * Aksi fitur baru (clear/reset/teleport/give) — POST ke route
   * /api/servers/{id}/players/{uuid}/action. Beda dengan sendAction yang
   * memakai route lama untuk kick/ban/op/whitelist.
   */
  const runPlayerAction = useCallback(
    async (
      uuid: string,
      action: PlayerFeatureAction,
      payload: Record<string, unknown>,
      options: { name?: string | null; label: string; onDone?: () => void },
    ) => {
      setBusyUuid(uuid);
      setNotice(null);
      try {
        const res = await fetch(`/api/servers/${serverId}/players/${uuid}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            payload,
            ...(options.name ? { name: options.name } : {}),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof json.error === 'string' ? json.error : 'Aksi gagal');
        }
        const command = typeof json.command === 'string' ? json.command : null;
        const deleted = typeof json.deleted === 'string' ? json.deleted : null;
        const kicked = json.kicked === true;
        const warning = typeof json.warning === 'string' ? json.warning : null;
        const detailText = [
          command ? `/${command}` : null,
          deleted ? `file ${deleted} dihapus${kicked ? ' · player di-kick' : ''}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        setNotice({
          tone: warning ? 'warning' : 'success',
          text: warning
            ? `${options.label} — ${warning}${detailText ? ` · ${detailText}` : ''}`
            : `${options.label} terkirim${detailText ? ` · ${detailText}` : ''}`,
        });
        options.onDone?.();
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
      }
    },
    [serverId, load, loadDetail, detailOpen, detail],
  );

  // Muat daftar item 1.21 saat modal Give Item pertama kali dibuka
  // (di-cache di localStorage oleh loadItemList — tidak fetch ulang tiap buka modal).
  useEffect(() => {
    if (!giveTarget || items || itemsLoading) return;
    let cancelled = false;
    setItemsLoading(true);
    loadItemList()
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        setItemsError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setItemsError(
          err instanceof Error ? err.message : 'Gagal memuat daftar item dari Minecraft Data API',
        );
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [giveTarget, items, itemsLoading]);

  const filteredItems = useMemo(() => {
    if (!items) return [];
    const query = itemSearch.trim().toLowerCase();
    const pool = query
      ? items.filter(
          (item) =>
            item.displayName.toLowerCase().includes(query) ||
            item.id.toLowerCase().includes(query),
        )
      : items;
    return pool.slice(0, 100);
  }, [items, itemSearch]);

  const amountNumber = Number(itemAmount);
  const amountValid = Number.isInteger(amountNumber) && amountNumber >= 1 && amountNumber <= 64;

  const closeGiveModal = useCallback(() => {
    setGiveTarget(null);
    setSelectedItem(null);
    setItemSearch('');
    setItemAmount('1');
    setItemsError(null);
  }, []);

  const submitClear = () => {
    if (!clearTarget) return;
    setClearBusy(true);
    void runPlayerAction(clearTarget.uuid, 'clear', {}, {
      name: clearTarget.name,
      label: 'Clear inventory',
      onDone: () => {
        setClearTarget(null);
        setClearBusy(false);
      },
    });
  };

  const submitReset = () => {
    if (!resetTarget) return;
    setResetBusy(true);
    void runPlayerAction(resetTarget.uuid, 'reset', { confirm: resetTyped.trim() }, {
      name: resetTarget.name,
      label: 'Reset data player',
      onDone: () => {
        setResetTarget(null);
        setResetTyped('');
        setResetBusy(false);
      },
    });
  };

  const submitTeleport = () => {
    if (!tpTarget) return;
    const x = Number(tpTarget.x);
    const y = Number(tpTarget.y);
    const z = Number(tpTarget.z);
    if (![x, y, z].every(Number.isFinite)) return;
    setTpBusy(true);
    void runPlayerAction(tpTarget.uuid, 'teleport', { x, y, z }, {
      name: tpTarget.name,
      label: `Teleport ${tpTarget.name ?? 'player'}`,
      onDone: () => {
        setTpTarget(null);
        setTpBusy(false);
      },
    });
  };

  const submitGive = () => {
    if (!giveTarget || !selectedItem || !amountValid) return;
    setGiveBusy(true);
    void runPlayerAction(
      giveTarget.uuid,
      'give',
      { itemId: selectedItem.id, amount: amountNumber },
      {
        name: giveTarget.name,
        label: `Give ${selectedItem.id} × ${amountNumber}`,
        onDone: () => {
          closeGiveModal();
          setGiveBusy(false);
        },
      },
    );
  };

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
                  : notice.tone === 'warning'
                    ? 'border-amber-500/25 bg-amber-500/5 text-amber-300'
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
                              canEditFiles={canEditFiles}
                              busy={busyUuid === player.uuid}
                              onAction={(action) =>
                                void sendAction(player.uuid, action, { name: player.name })
                              }
                              onBan={() => {
                                setNotice(null);
                                setBanTarget(player);
                                setBanReason('');
                              }}
                              onClear={() => {
                                setNotice(null);
                                setClearTarget({ uuid: player.uuid, name: player.name });
                              }}
                              onReset={() => {
                                setNotice(null);
                                setResetTarget({ uuid: player.uuid, name: player.name });
                                setResetTyped('');
                              }}
                              onTeleport={() => {
                                setNotice(null);
                                setTpTarget({
                                  uuid: player.uuid,
                                  name: player.name,
                                  x: coord(player.posX),
                                  y: coord(player.posY),
                                  z: coord(player.posZ),
                                });
                              }}
                              onGive={() => {
                                setNotice(null);
                                setGiveTarget({ uuid: player.uuid, name: player.name });
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

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

            <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2 lg:grid-cols-4">
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
                  canEditFiles={canEditFiles}
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
                  onClear={() => {
                    setNotice(null);
                    setClearTarget({ uuid: detail.uuid, name: detail.name });
                  }}
                  onReset={() => {
                    setNotice(null);
                    setResetTarget({ uuid: detail.uuid, name: detail.name });
                    setResetTyped('');
                  }}
                  onTeleport={() => {
                    setNotice(null);
                    setTpTarget({
                      uuid: detail.uuid,
                      name: detail.name,
                      x: coord(detail.posX),
                      y: coord(detail.posY),
                      z: coord(detail.posZ),
                    });
                  }}
                  onGive={() => {
                    setNotice(null);
                    setGiveTarget({ uuid: detail.uuid, name: detail.name });
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

      {/* Clear Inventory — konfirmasi sederhana */}
      <Modal
        open={!!clearTarget}
        onClose={() => setClearTarget(null)}
        title="Clear Inventory?"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            Hapus semua item inventory{' '}
            <strong className="text-ink">{clearTarget?.name ?? 'player ini'}</strong>? Command{' '}
            <code className="rounded bg-base-600 px-1.5 py-0.5 font-mono text-[11px]">
              /clear {clearTarget?.name ?? 'PlayerName'}
            </code>{' '}
            dikirim ke console — hanya efektif saat player online.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setClearTarget(null)}>
              Batal
            </Button>
            <Button variant="danger" size="sm" loading={clearBusy} onClick={submitClear}>
              Clear Inventory
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reset Data — konfirmasi ganda: ketik nama player */}
      <ConfirmDangerModal
        open={!!resetTarget}
        onClose={() => {
          setResetTarget(null);
          setResetTyped('');
        }}
        onConfirm={submitReset}
        title="Reset data player?"
        description={
          <>
            Semua data player akan dihapus permanen (inventory, XP, posisi, health). File{' '}
            <code className="rounded bg-base-600 px-1.5 py-0.5 font-mono text-[11px]">
              playerdata/{'{uuid}'}.dat
            </code>{' '}
            dihapus dari server. Ketik nama player untuk konfirmasi.
          </>
        }
        confirmText={resetTarget?.name ?? resetTarget?.uuid ?? ''}
        typedValue={resetTyped}
        setTypedValue={setResetTyped}
        loading={resetBusy}
        dangerLabel="Reset Data"
      />

      {/* Teleport — input koordinat X, Y, Z */}
      <Modal
        open={!!tpTarget}
        onClose={() => setTpTarget(null)}
        title={`Teleport ${tpTarget?.name ?? 'player'}`}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            Kirim command{' '}
            <code className="rounded bg-base-600 px-1.5 py-0.5 font-mono text-[11px]">
              /tp {tpTarget?.name ?? 'PlayerName'} X Y Z
            </code>{' '}
            — hanya efektif saat player online.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Field label="X">
              <Input
                type="number"
                step="any"
                value={tpTarget?.x ?? ''}
                onChange={(event) =>
                  setTpTarget((prev) => (prev ? { ...prev, x: event.target.value } : prev))
                }
                placeholder="0"
              />
            </Field>
            <Field label="Y">
              <Input
                type="number"
                step="any"
                value={tpTarget?.y ?? ''}
                onChange={(event) =>
                  setTpTarget((prev) => (prev ? { ...prev, y: event.target.value } : prev))
                }
                placeholder="64"
              />
            </Field>
            <Field label="Z">
              <Input
                type="number"
                step="any"
                value={tpTarget?.z ?? ''}
                onChange={(event) =>
                  setTpTarget((prev) => (prev ? { ...prev, z: event.target.value } : prev))
                }
                placeholder="0"
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setTpTarget(null)}>
              Batal
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={tpBusy}
              disabled={
                ![Number(tpTarget?.x), Number(tpTarget?.y), Number(tpTarget?.z)].every(
                  Number.isFinite,
                )
              }
              onClick={submitTeleport}
            >
              Teleport
            </Button>
          </div>
        </div>
      </Modal>

      {/* Give Item — item picker (search + daftar item 1.21 + jumlah) */}
      <Modal
        open={!!giveTarget}
        onClose={closeGiveModal}
        wide
        title={`Give Item — ${giveTarget?.name ?? 'player'}`}
      >
        <div className="space-y-4">
          <Field
            label="Cari item"
            hint="Data dari PrismarineJS minecraft-data (1.21) — di-cache di browser."
          >
            <Input
              value={itemSearch}
              onChange={(event) => setItemSearch(event.target.value)}
              placeholder="Cari nama atau ID item… (mis. diamond)"
              autoFocus
            />
          </Field>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
            {itemsLoading ? (
              <div className="py-6">
                <PageLoader label="Memuat daftar item…" />
              </div>
            ) : itemsError ? (
              <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-red-300">
                <p>Gagal memuat daftar item: {itemsError}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setItems(null);
                    setItemsError(null);
                    setItemsLoading(false);
                    setGiveTarget(giveTarget ? { ...giveTarget } : null);
                  }}
                >
                  Coba lagi
                </Button>
              </div>
            ) : filteredItems.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-faint">
                Item tidak ditemukan.
              </p>
            ) : (
              <div className="divide-y divide-line-soft">
                {filteredItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedItem(item)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                      selectedItem?.id === item.id
                        ? 'bg-accent/10 text-accent'
                        : 'text-ink hover:bg-base-800/60'
                    }`}
                  >
                    <span className="truncate">{item.displayName}</span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                      {item.id}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Item terpilih">
              {selectedItem ? (
                <p className="rounded-lg border border-line bg-base-900 px-3 py-2 font-mono text-xs text-ink">
                  {selectedItem.displayName} — {selectedItem.id}
                </p>
              ) : (
                <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-ink-faint">
                  Pilih item dari daftar di atas.
                </p>
              )}
            </Field>
            <Field label="Jumlah (1–64)">
              <Input
                type="number"
                min={1}
                max={64}
                step={1}
                value={itemAmount}
                onChange={(event) => setItemAmount(event.target.value)}
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={closeGiveModal}>
              Batal
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={giveBusy}
              disabled={!selectedItem || !amountValid}
              onClick={submitGive}
            >
              Give Item
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
  canEditFiles,
  busy,
  onAction,
  onBan,
  onClear,
  onReset,
  onTeleport,
  onGive,
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
  canEditFiles: boolean;
  busy: boolean;
  onAction: (action: PlayerAction) => void;
  onBan: () => void;
  onClear: () => void;
  onReset: () => void;
  onTeleport: () => void;
  onGive: () => void;
  align?: 'end' | 'start';
}) {
  if (!canSendCommand && !canEditFiles) {
    return <span className="text-[11px] text-ink-faint">Hanya lihat</span>;
  }

  const disabled = busy || !player.name;
  const nameHint = player.name
    ? null
    : 'Nama player tidak diketahui (tidak ada di usercache.json)';
  const onlineOnly =
    'Hanya efektif saat player online — server akan menolak command bila player offline';
  const cmdTitle = [nameHint, onlineOnly].filter(Boolean).join(' · ') || undefined;

  return (
    <div className={`flex flex-wrap gap-1 ${align === 'end' ? 'justify-end' : ''}`}>
      {canSendCommand && (
        <>
          <Button size="sm" variant="ghost" disabled={disabled} title={cmdTitle} onClick={() => onAction('kick')}>
            Kick
          </Button>
          {player.isBanned ? (
            <Button
              size="sm"
              variant="success"
              disabled={disabled}
              title={cmdTitle}
              onClick={() => onAction('unban')}
            >
              Unban
            </Button>
          ) : (
            <Button size="sm" variant="danger" disabled={disabled} title={cmdTitle} onClick={onBan}>
              Ban
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            title={cmdTitle}
            onClick={() => onAction(player.isOp ? 'deop' : 'op')}
          >
            {player.isOp ? 'Deop' : 'Op'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            title={cmdTitle}
            onClick={() => onAction(player.isWhitelisted ? 'whitelist-remove' : 'whitelist-add')}
          >
            {player.isWhitelisted ? 'Whitelist −' : 'Whitelist +'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            title={cmdTitle}
            onClick={onClear}
          >
            Clear Inventory
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            title={cmdTitle}
            onClick={onTeleport}
          >
            Teleport
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            title={cmdTitle}
            onClick={onGive}
          >
            Give Item
          </Button>
        </>
      )}
      {canEditFiles && (
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          title="Hapus permanen file playerdata (inventory, XP, posisi, health). Player online di-kick lebih dulu."
          onClick={onReset}
        >
          Reset Data
        </Button>
      )}
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
