/**
 * Analisa inventory: makanan, senjata, tool, durability.
 * Semua nama item memakai format minecraft-data (snake_case), mis. `iron_sword`.
 */
const TIER = [
  ['netherite', 6], ['diamond', 5], ['iron', 4], ['stone', 3], ['golden', 3], ['gold', 3], ['wooden', 2], ['wood', 2]
]

function materialTier (name = '') {
  for (const [prefix, score] of TIER) if (name.startsWith(prefix)) return score
  return 1
}

/** Daftar item di inventory + ringkasan per nama. */
export function summarizeInventory (bot) {
  const items = bot.inventory.items().map(it => ({
    name: it.name,
    count: it.count,
    slot: it.slot,
    ...(durabilityOf(it) ? { durability: durabilityOf(it) } : {})
  }))
  const counts = {}
  for (const it of items) counts[it.name] = (counts[it.name] || 0) + it.count
  return { items, counts }
}

/** { used, max, pct } untuk item yang punya durability, kalau tidak → null */
export function durabilityOf (item) {
  const max = item?.maxDurability
  if (!max) return null
  const used = item.durabilityUsed ?? 0
  return { used, max, left: max - used, pct: (max - used) / max }
}

export function countItem (bot, name) {
  return bot.inventory.items().filter(i => i.name === name).reduce((a, i) => a + i.count, 0)
}

/** Item makanan terbaik: skor = foodPoints (data dari minecraft-data). */
export function findFood (bot, { minPoints = 1 } = {}) {
  const foods = bot.registry.foodsByName || {}
  let best = null
  for (const item of bot.inventory.items()) {
    const food = foods[item.name]
    if (!food || (food.foodPoints || 0) < minPoints) continue
    if (!best || (food.foodPoints || 0) > (best.points || 0)) best = { item, points: food.foodPoints, saturation: food.saturation }
  }
  return best
}

const WEAPON_PATTERN = /(_sword|_axe|trident|mace)$/

/** Senjata terbaik di inventory (sword > axe > lain-lain, lalu berdasarkan tier material). */
export function findBestWeapon (bot) {
  let best = null
  for (const item of bot.inventory.items()) {
    if (!WEAPON_PATTERN.test(item.name)) continue
    const kind = item.name.endsWith('_sword') ? 3 : item.name.endsWith('_axe') ? 2 : 1
    const score = kind * 10 + materialTier(item.name)
    if (!best || score > best.score) best = { item, score, kind }
  }
  return best
}

/** Tool terbaik untuk blok tertentu; pakai data harvestTools dari minecraft-data. */
export function findToolFor (bot, block) {
  const { blocksByName, items } = bot.registry
  const def = block && blocksByName[block.name]
  const allowed = def?.harvestTools
  let best = null
  for (const item of bot.inventory.items()) {
    const isTool = /_(pickaxe|axe|shovel|hoe|shears)$/.test(item.name)
    if (!isTool) continue
    if (allowed && !allowed[item.type]) continue
    const score = materialTier(item.name)
    if (!best || score > best.score) best = { item, score }
  }
  return best
}

/** Perlengkapan yang dipakai untuk "tool durability check" di prompt mining. */
export function toolStatus (bot) {
  return bot.inventory.items()
    .filter(i => /_(pickaxe|axe|shovel|hoe|sword)$/.test(i.name))
    .map(i => ({ name: i.name, ...durabilityOf(i) }))
}
