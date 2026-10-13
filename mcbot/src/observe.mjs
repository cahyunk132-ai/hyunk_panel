/**
 * OBSERVE — ubah dunia Minecraft yang berantakan menjadi state ringkas + JSON
 * yang bisa dibaca LLM.
 *
 * Ini tahap pertama OODA loop:
 *   Observe (file ini) → Orient (prompts.mjs) → Decide (brain/) → Act (act/)
 */
import { scanBlocks, hazardAround } from './util/blocks.mjs'
import { nearbyEntities } from './util/entities.mjs'
import { summarizeInventory, findBestWeapon, findFood, toolStatus } from './util/items.mjs'

const round = (v, d = 1) => Number(Number(v).toFixed(d))
const vec = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) })

const lastScan = { at: 0, blocks: [] }

/**
 * Bangun state lengkap.
 * @param {object} bot mineflayer bot
 * @param {object} opts { config, task, history, notes }
 */
export function observe (bot, { config, task, history = [], notes = [] } = {}) {
  const inv = summarizeInventory(bot)
  const weapon = findBestWeapon(bot)
  const food = findFood(bot)
  const entities = nearbyEntities(bot, {
    radius: config?.scan?.entityRadius ?? 16,
    hostileRadius: config?.safety?.hostileRadius ?? 10,
    pvpMode: config?.server?.pvpMode ?? false
  })

  // Cache scan blok: bagian termahal dari observe().
  const cacheMs = config?.scan?.cacheMs ?? 1200
  let blocks = lastScan.blocks
  if (Date.now() - lastScan.at > cacheMs || !blocks.length) {
    blocks = scanBlocks(bot, {
      radius: config?.scan?.blockRadius ?? 20,
      yBelow: config?.scan?.blockYBelow ?? 12,
      yAbove: config?.scan?.blockYAbove ?? 4,
      max: config?.scan?.maxBlocks ?? 40
    })
    lastScan.at = Date.now()
    lastScan.blocks = blocks
  }

  // Sebelum paket health pertama tiba, bot.health/ bot.food bisa undefined → anggap penuh
  const health = Number.isFinite(bot.health) ? bot.health : 20
  const foodValue = Number.isFinite(bot.food) ? bot.food : 20

  const hostileList = entities.filter(e => e.hostile)
  const creeper = entities.find(e => e.explosive && e.distance <= (config?.safety?.creeperRadius ?? 3) + 2 && e.distance <= 6)
  const oxygen = bot.oxygenLevel ?? 20

  const state = {
    ts: new Date().toISOString(),
    bot: { name: bot.username, version: bot.version, alive: !!bot.entity },
    position: vec(bot.entity.position),
    health: { value: round(health), max: 20, pct: round(health / 20 * 100, 0) },
    food: { value: round(foodValue), max: 20, pct: round(foodValue / 20 * 100, 0) },
    oxygen: { value: oxygen, max: 20, pct: round(oxygen / 20 * 100, 0) },
    time: {
      timeOfDay: bot.time?.timeOfDay ?? 0,
      isDay: (bot.time?.timeOfDay ?? 0) < 12000,
      label: (bot.time?.timeOfDay ?? 0) < 12000 ? 'day' : 'night'
    },
    dimension: bot.game?.dimension || 'overworld',
    gameMode: bot.game?.gameMode || 'survival',
    onGround: !!bot.entity.onGround,
    inWater: !!bot.entity.isInWater,
    heldItem: bot.heldItem ? { name: bot.heldItem.name, count: bot.heldItem.count } : null,
    inventory: inv,
    tools: toolStatus(bot),
    bestWeapon: weapon ? { name: weapon.item.name, slot: weapon.item.slot, durability: weapon.item.maxDurability ? { used: weapon.item.durabilityUsed ?? 0, max: weapon.item.maxDurability } : null } : null,
    bestFood: food ? { name: food.item.name, count: food.item.count, points: food.points } : null,
    entities: entities.map(({ _entity, ...e }) => e),
    threats: {
      hostiles: hostileList.map(({ _entity, ...e }) => e),
      nearest: hostileList[0] || null,
      count: hostileList.length,
      creeperClose: creeper ? { id: creeper.id, name: creeper.name, distance: creeper.distance } : null
    },
    blocks: {
      ores: blocks.filter(b => /_ore$/.test(b.name)),
      crops: blocks.filter(b => b.age !== undefined),
      farmland: blocks.filter(b => b.name === 'farmland'),
      logs: blocks.filter(b => /(_log|_wood)$/.test(b.name)),
      stations: blocks.filter(b => b.name === 'crafting_table' || b.name === 'furnace' || b.name === 'chest')
    },
    hazards: { nearby: hazardAround(bot, 1) },
    task,
    history: history.slice(-4),
    notes: [...notes]
  }

  // Catatan otomatis yang membantu LLM (dan manusia yang membaca trace)
  if (state.hazards.nearby) state.notes.push(`Lava/fire nearby at ${state.hazards.nearby.pos.join(',')}`)
  if (inv.items.length >= 36) state.notes.push('Inventory is almost full')
  const wornTool = state.tools.find(t => t.pct !== undefined && t.pct < 0.15)
  if (wornTool) state.notes.push(`Tool ${wornTool.name} is about to break (${wornTool.used}/${wornTool.max})`)
  if (!state.bestWeapon && hostileList.length) state.notes.push('No weapon in inventory')
  if (!state.bestFood && state.food.value < 14) state.notes.push('No food in inventory')

  return state
}

/** Satu baris ringkasan buat console/log. */
export function summarize (state) {
  const ores = state.blocks.ores.slice(0, 3).map(o => `${o.name}@${o.distance}`).join(' ')
  const ent = state.entities.slice(0, 3).map(e => `${e.name}:${e.distance}${e.hostile ? '!' : ''}`).join(' ')
  return [
    `pos(${state.position.x},${state.position.y},${state.position.z})`,
    `hp ${state.health.value}/20`,
    `food ${state.food.value}/20`,
    `items ${state.inventory.items.length}`,
    ores ? `ores[${ores}]` : 'ores[]',
    ent ? `ents[${ent}]` : 'ents[]',
    `task=${state.task.current}`
  ].join(' · ')
}
