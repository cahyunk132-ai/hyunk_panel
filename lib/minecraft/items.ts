/**
 * Daftar item Minecraft Java 1.21 untuk item picker (aksi "Give Item").
 *
 * Client-side only — tidak boleh meng-import modul node (playerdata.ts, status.ts).
 *
 * Sumber data (PrismarineJS minecraft-data):
 * 1. https://minecraft-data-api.vercel.app/1.21/items
 * 2. https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc/1.21.4/items.json
 *    (fallback; folder `data/pc/1.21/` di master hanya berisi version.json)
 *
 * Hasil di-cache di localStorage (TTL 24 jam) supaya tidak fetch ulang setiap
 * kali modal Give Item dibuka.
 */

export interface McItem {
  /** ID lengkap dengan namespace, contoh: `minecraft:diamond`. */
  id: string;
  /** Nama tampilan, contoh: `Diamond`. */
  displayName: string;
  stackSize: number;
}

const ITEM_SOURCES = [
  'https://minecraft-data-api.vercel.app/1.21/items',
  'https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc/1.21.4/items.json',
];

const ITEM_CACHE_KEY = 'hyunk:mc-items:1.21';
const ITEM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Cache in-memory — localStorage dibaca sekali per sesi browser. */
let itemsMemoryCache: McItem[] | null = null;

interface RawItemEntry {
  name?: unknown;
  displayName?: unknown;
  stackSize?: unknown;
}

function normalizeItems(list: unknown[]): McItem[] {
  const items: McItem[] = [];
  for (const entry of list) {
    const raw = entry as RawItemEntry | null;
    if (!raw || typeof raw.name !== 'string' || raw.name.length === 0) continue;
    // PrismarineJS memakai nama tanpa namespace (`diamond`) → tambah `minecraft:`.
    const id = raw.name.includes(':') ? raw.name : `minecraft:${raw.name}`;
    items.push({
      id,
      displayName:
        typeof raw.displayName === 'string' && raw.displayName.length > 0
          ? raw.displayName
          : id,
      stackSize: typeof raw.stackSize === 'number' ? raw.stackSize : 64,
    });
  }
  return items
    .filter((item) => item.id !== 'minecraft:air')
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'en'));
}

/**
 * Muat daftar item 1.21. Urutan: cache memory → localStorage → fetch HTTP.
 * Lempar Error bila semua sumber gagal.
 */
export async function loadItemList(): Promise<McItem[]> {
  if (itemsMemoryCache) return itemsMemoryCache;

  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(ITEM_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as { ts?: unknown; items?: unknown };
        if (
          typeof cached?.ts === 'number' &&
          Array.isArray(cached.items) &&
          Date.now() - cached.ts < ITEM_CACHE_TTL_MS
        ) {
          const items = normalizeItems(cached.items);
          if (items.length > 0) {
            itemsMemoryCache = items;
            return items;
          }
        }
      }
    } catch {
      // cache rusak → fetch ulang
    }
  }

  let lastError: unknown = null;
  for (const source of ITEM_SOURCES) {
    try {
      const res = await fetch(source, { cache: 'no-store' });
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      const json: unknown = await res.json();
      const list = Array.isArray(json)
        ? json
        : ((json as { items?: unknown } | null)?.items ?? null);
      if (!Array.isArray(list)) {
        lastError = new Error('Format respons tidak dikenal');
        continue;
      }
      const items = normalizeItems(list);
      if (items.length === 0) {
        lastError = new Error('Daftar item kosong');
        continue;
      }
      itemsMemoryCache = items;
      try {
        window.localStorage.setItem(ITEM_CACHE_KEY, JSON.stringify({ ts: Date.now(), items }));
      } catch {
        // quota penuh → cache memory tetap dipakai
      }
      return items;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Gagal memuat daftar item dari Minecraft Data API');
}
