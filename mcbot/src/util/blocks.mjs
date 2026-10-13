/**
 * Scan blok di sekitar bot: ore, kayu, tanaman (age), farmland, air, chest.
 *
 * Ini "mata" bot. Mineflayer hanya memberi kita data chunk yang sudah dimuat
 * klien, jadi scan dibatasi radius + rentang Y dan di-cache sebentar supaya
 * loop OODA tetap ringan (default 2 detik sekali).
 */
import { Vec3 } from 'vec3'

export const isOre = name => /_ore$/.test(name)
export const isLog = name => /(_log|_wood|_stem|_hyphae)$/.test(name)
export const isLeaves = name => /_leaves$/.test(name)
const CROP_MAX_AGE = {
  wheat: 7, carrots: 7, potatoes: 7, beetroots: 3, nether_wart: 3, torchflower_crop: 2, pitcher_crop: 4
}
export const isCrop = name => Object.hasOwn(CROP_MAX_AGE, name)
export const cropMaxAge = name => CROP_MAX_AGE[name] ?? 7

const AIR = new Set(['air', 'cave_air', 'void_air'])

/** Usia tanaman: pakai block properties (1.13+) dengan fallback metadata (<=1.12). */
export function cropAge (block) {
  if (!block) return null
  let age
  try {
    const props = typeof block.getProperties === 'function' ? block.getProperties() : null
    if (props && props.age !== undefined) age = Number(props.age)
  } catch { /* abaikan */ }
  if (age === undefined && typeof block.metadata === 'number') age = block.metadata & 0x7
  if (age === undefined) return null
  const maxAge = cropMaxAge(block.name)
  return { age, maxAge, ready: age >= maxAge }
}

export function isInteractable (name) {
  return name === 'farmland' || name === 'water' || name === 'crafting_table' || name === 'furnace' || name === 'chest'
}

function cursorOf (bot) {
  const p = bot.entity.position
  return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }
}

/**
 * Scan blok menarik di sekitar bot.
 * @returns {Array<{name,pos:[number,number,number],distance,age?,ready?,empty?}>}
 */
export function scanBlocks (bot, {
  radius = 16, yBelow = 8, yAbove = 3, max = 40, includeInteractable = true, onlyReady = false
} = {}) {
  const c = cursorOf(bot)
  const found = []
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dy = -yBelow; dy <= yAbove; dy++) {
        const pos = new Vec3(c.x + dx, c.y + dy, c.z + dz)
        if (pos.y < -64 || pos.y > 320) continue
        const block = bot.blockAt(pos)
        if (!block || AIR.has(block.name)) continue
        const interesting = isOre(block.name) || isLog(block.name) || isCrop(block.name) || (includeInteractable && isInteractable(block.name))
        if (!interesting) continue
        const distance = bot.entity.position.distanceTo(pos)
        if (distance > radius + 1) continue
        const entry = {
          name: block.name,
          pos: [pos.x, pos.y, pos.z],
          distance: Number(distance.toFixed(2))
        }
        if (isCrop(block.name)) {
          const a = cropAge(block)
          if (a) { entry.age = a.age; entry.maxAge = a.maxAge; entry.ready = a.ready }
          const above = bot.blockAt(pos.offset(0, 1, 0))
          entry.plantable = false
          if (above && AIR.has(above.name)) entry.hasAirAbove = true
        }
        if (block.name === 'farmland') {
          const above = bot.blockAt(pos.offset(0, 1, 0))
          entry.empty = !!above && AIR.has(above.name)
          if (onlyReady && !entry.empty) continue
        }
        if (entry.age !== undefined && onlyReady && !entry.ready) continue
        found.push(entry)
      }
    }
  }
  found.sort((a, b) => a.distance - b.distance)
  return found.slice(0, max)
}

/** Cari blok terdekat dari daftar nama/kriteria. */
export function nearestBlock (bot, { matching, maxDistance = 24 }) {
  const names = Array.isArray(matching) ? new Set(matching) : null
  const pred = typeof matching === 'function' ? matching : (b) => names.has(b.name)
  return bot.findBlock({ matching: pred, maxDistance })
}

/** Blok di bawah bot / pengecekan apakah bot sedang menginjak air/lava. */
export function blockUnder (bot) {
  return bot.blockAt(bot.entity.position.offset(0, -1, 0))
}

/** Apakah ada air/lava di sekitar (untuk guard keselamatan). */
export function hazardAround (bot, radius = 1) {
  const pos = bot.entity.position.floored()
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const b = bot.blockAt(pos.offset(dx, dy, dz))
        if (b && (b.name === 'lava' || b.name === 'fire' || b.name === 'magma_block')) {
          return { type: b.name, pos: [b.position.x, b.position.y, b.position.z] }
        }
      }
    }
  }
  return null
}
