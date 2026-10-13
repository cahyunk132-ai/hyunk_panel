/**
 * Klasifikasi entity: agresif / pasif / pemain.
 *
 * Dipakai untuk mengisi field `intent` di state yang dikirim ke Groq
 * ("Intent: Aggressive") dan untuk safety guard di loop OODA.
 */
const HOSTILE = new Set([
  'zombie', 'zombie_villager', 'husk', 'drowned', 'skeleton', 'stray', 'bogged', 'wither_skeleton',
  'creeper', 'spider', 'cave_spider', 'witch', 'enderman', 'endermite', 'silverfish', 'slime', 'magma_cube',
  'blaze', 'ghast', 'piglin', 'piglin_brute', 'hoglin', 'zoglin', 'guardian', 'elder_guardian', 'shulker',
  'phantom', 'pillager', 'vindicator', 'evoker', 'ravager', 'vex', 'wither', 'ender_dragon', 'warden',
  'breeze', 'bogged', 'zombified_piglin', 'illusioner', 'killer_bunny', 'wolf'
])
const PASSIVE = new Set([
  'cow', 'pig', 'sheep', 'chicken', 'rabbit', 'horse', 'donkey', 'mule', 'llama', 'cat', 'ocelot', 'fox',
  'bee', 'turtle', 'panda', 'goat', 'frog', 'axolotl', 'camel', 'armadillo', 'sniffer', 'strider', 'villager',
  'wandering_trader', 'squid', 'glow_squid', 'cod', 'salmon', 'tropical_fish', 'pufferfish', 'bat', 'mooshroom',
  'parrot', 'dolphin', 'allay', 'tadpole', 'snow_golem', 'iron_golem', 'trader_llama', 'happy_ghast'
])
/** Mob yang meledak: jangan didekati kalau HP rendah. */
export const EXPLOSIVE = new Set(['creeper', 'tnt', 'tnt_minecart', 'end_crystal', 'respawn_anchor'])

export function isHostileName (name) {
  if (!name) return false
  return HOSTILE.has(name)
}

export function intentOf (name, kind) {
  if (HOSTILE.has(name)) return 'aggressive'
  if (PASSIVE.has(name)) return 'passive'
  if (kind === 'Hostile mobs') return 'aggressive'
  if (kind === 'Passive mobs' || kind === 'Water creatures') return 'passive'
  return 'neutral'
}

/**
 * Ringkas entity di sekitar bot.
 * @param {object} bot
 * @param {{radius?:number, hostileRadius?:number}} opts
 */
export function nearbyEntities (bot, { radius = 16, hostileRadius = 10, pvpMode = false } = {}) {
  const me = bot.entity
  const out = []
  for (const e of Object.values(bot.entities)) {
    if (!e || e === me || e.id === me.id) continue
    const pos = e.position
    if (!pos) continue
    const distance = me.position.distanceTo(pos)
    if (distance > radius) continue
    const isPlayer = e.type === 'player'
    const name = isPlayer ? `player:${e.username || e.name || 'unknown'}` : (e.name || e.displayName || e.entityType)
    // Di mode PvP, pemain lain diperlakukan sebagai ancaman agresif
    const intent = isPlayer ? (pvpMode ? 'aggressive' : 'player') : intentOf(e.name, e.kind)
    out.push({
      id: e.id,
      name,
      rawName: isPlayer ? null : e.name,
      type: e.type,
      isPlayer,
      username: e.username,
      distance: Number(distance.toFixed(1)),
      intent,
      hostile: intent === 'aggressive' && distance <= hostileRadius,
      explosive: EXPLOSIVE.has(e.name),
      heldItem: isPlayer ? (e.heldItem?.name || null) : null,
      health: isPlayer ? e.health : undefined,
      _entity: e
    })
  }
  out.sort((a, b) => a.distance - b.distance)
  return out
}

/** Musuh terdekat yang aktif mengancam. */
export function nearestHostile (bot, radius = 10) {
  return nearbyEntities(bot, { radius, hostileRadius: radius }).find(e => e.hostile) || null
}

/** Threshold “sedang diserang”: ada musuh sangat dekat. */
export function underAttack (bot, radius = 4) {
  return nearbyEntities(bot, { radius, hostileRadius: radius }).some(e => e.hostile)
}
