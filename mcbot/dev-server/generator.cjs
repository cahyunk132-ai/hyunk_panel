/**
 * Generator dunia untuk dev server (CommonJS karena dipanggil flying-squid
 * lewat require()).
 *
 * Bedanya dengan generator bawaan flying-squid: dunia ini punya
 *   - terrain bergelombang + deepslate + gua (dengan lava di dasar)
 *   - bijih (ore) berlapis sesuai kedalaman: coal/copper/iron/gold/redstone/
 *     lapis/diamond/emerald (+ varian deepslate)
 *   - pohon oak
 *   - area datar di sekitar spawn + ladang gandum siap panen
 *   - "dinding bijih" dekat spawn supaya task mining bisa diuji tanpa menggali
 *
 * Semua deterministik (seed) supaya debugging bisa direproduksi.
 */
const Vec3 = require('vec3').Vec3

const hash = (x, y, z, s) => {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 2147483647 + (s | 0) * 1442695041
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return ((h >>> 0) % 100000) / 100000
}
const smooth = (t) => t * t * (3 - 2 * t)
const lerp = (a, b, t) => a + (b - a) * t

function noise2 (x, z, s) {
  const x0 = Math.floor(x); const z0 = Math.floor(z)
  const tx = smooth(x - x0); const tz = smooth(z - z0)
  const a = hash(x0, 0, z0, s); const b = hash(x0 + 1, 0, z0, s)
  const c = hash(x0, 0, z0 + 1, s); const d = hash(x0 + 1, 0, z0 + 1, s)
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz)
}

function noise3 (x, y, z, s) {
  const x0 = Math.floor(x); const y0 = Math.floor(y); const z0 = Math.floor(z)
  const tx = smooth(x - x0); const ty = smooth(y - y0); const tz = smooth(z - z0)
  const c000 = hash(x0, y0, z0, s); const c100 = hash(x0 + 1, y0, z0, s)
  const c010 = hash(x0, y0 + 1, z0, s); const c110 = hash(x0 + 1, y0 + 1, z0, s)
  const c001 = hash(x0, y0, z0 + 1, s); const c101 = hash(x0 + 1, y0, z0 + 1, s)
  const c011 = hash(x0, y0 + 1, z0 + 1, s); const c111 = hash(x0 + 1, y0 + 1, z0 + 1, s)
  const x00 = lerp(c000, c100, tx); const x10 = lerp(c010, c110, tx)
  const x01 = lerp(c001, c101, tx); const x11 = lerp(c011, c111, tx)
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz)
}

const SURFACE = 48          // permukaan normal
const SPAWN_RADIUS = 30     // area datar di sekitar spawn
const BASE = 44
const DEEPSLATE_Y = 16

/** Tabel ore: nama, kedalaman min/max, probabilitas, nama varian deepslate. */
const ORES = [
  ['coal_ore', 18, 46, 0.011, 'deepslate_coal_ore'],
  ['copper_ore', 14, 46, 0.007, 'deepslate_copper_ore'],
  ['iron_ore', 6, 44, 0.007, 'deepslate_iron_ore'],
  ['gold_ore', 3, 30, 0.0028, 'deepslate_gold_ore'],
  ['redstone_ore', 2, 20, 0.0032, 'deepslate_redstone_ore'],
  ['lapis_ore', 3, 26, 0.0016, 'deepslate_lapis_ore'],
  ['diamond_ore', 1, 14, 0.0014, 'deepslate_diamond_ore'],
  ['emerald_ore', 3, 12, 0.0005, 'deepslate_emerald_ore']
]

module.exports = function generation (options) {
  const { registry } = options
  const seed = options.seed !== undefined ? options.seed : 20261013
  const Chunk = require('prismarine-chunk')(registry)
  const blocks = registry.blocksByName

  const ID = {}
  const need = [
    'air', 'bedrock', 'stone', 'deepslate', 'dirt', 'grass_block', 'gravel', 'sand',
    'water', 'lava', 'farmland', 'wheat', 'oak_log', 'oak_leaves', 'crafting_table', 'furnace', 'chest', 'torch',
    ...ORES.flatMap(([a, , , , b]) => [a, b])
  ]
  for (const name of need) {
    if (!blocks[name]) throw new Error(`generator: unknown block "${name}"`)
    ID[name] = blocks[name].id
  }

  const HEIGHT = Math.max(...Object.values(ID).map(id => id)) > -1 ? 100 : 100 // tinggi kolom yang diisi

  function surfaceHeight (wx, wz) {
    const n = noise2(wx / 38, wz / 38, seed) * 7 + noise2(wx / 12, wz / 12, seed + 7) * 3
    const distFromSpawn = Math.max(Math.abs(wx), Math.abs(wz))
    if (distFromSpawn <= SPAWN_RADIUS) return SURFACE            // plateau datar di spawn
    if (distFromSpawn <= SPAWN_RADIUS + 8) {
      const t = (distFromSpawn - SPAWN_RADIUS) / 8
      return Math.round(lerp(SURFACE, BASE + 4 + n, smooth(t)))
    }
    return Math.round(BASE + 4 + n)
  }

  function isCave (wx, wy, wz) {
    if (wy < 4 || wy > SURFACE + 2) return false
    const n = noise3(wx / 14, wy / 9, wz / 14, seed + 101)
    return n > 0.70
  }

  function oreAt (wx, wy, wz) {
    for (const [name, yMin, yMax, prob, deepName] of ORES) {
      if (wy < yMin || wy > yMax) continue
      if (hash(wx * 31, wy * 17, wz * 13, seed + name.length) < prob) {
        return wy < DEEPSLATE_Y ? deepName : name
      }
    }
    return null
  }

  /** Ladang gandum + stasiun kerja kecil di dekat spawn (selalu di chunk 0,0). */
  function buildSpawnFarm (chunk) {
    const y = SURFACE + 1
    for (let x = 2; x <= 20; x++) {
      for (let z = 2; z <= 14; z++) {
        const pos = new Vec3(x, y, z)
        if (z % 5 === 0) { // saluran air
          chunk.setBlockType(pos, ID.water)
          continue
        }
        chunk.setBlockType(pos, ID.farmland)
        chunk.setBlockData(pos, 1) // moisture = wet
        // Sebagian besar matang (age 7) supaya task farming langsung bisa jalan,
        // sisanya masih tumbuh supaya bot belajar membedakan age.
        const cropAgeValue = hash(x, 3, z, seed + 55) < 0.75 ? 7 : Math.floor(hash(x, 9, z, seed + 56) * 6)
        chunk.setBlockType(new Vec3(x, y + 1, z), ID.wheat)
        chunk.setBlockData(new Vec3(x, y + 1, z), cropAgeValue)
      }
    }
    // stasiun kerja
    chunk.setBlockType(new Vec3(22, y, 2), ID.crafting_table)
    chunk.setBlockType(new Vec3(22, y, 3), ID.furnace)
    chunk.setBlockType(new Vec3(22, y, 4), ID.chest)
    for (const [tx, tz] of [[18, 16], [0, 18], [24, 24], [-4, 10]]) {
      chunk.setBlockType(new Vec3(tx, y, tz), ID.torch)
    }
  }

  /** Dinding bijih dekat spawn: target mining yang pasti terlihat bot. */
  function buildOreWall (chunk) {
    const y0 = SURFACE + 1
    const pattern = [
      ['coal_ore', 'iron_ore', 'stone', 'iron_ore', 'coal_ore'],
      ['stone', 'iron_ore', 'stone', 'gold_ore', 'stone'],
      ['copper_ore', 'stone', 'diamond_ore', 'stone', 'redstone_ore'],
      ['stone', 'coal_ore', 'stone', 'lapis_ore', 'stone']
    ]
    for (let i = 0; i < pattern.length; i++) {
      for (let j = 0; j < pattern[i].length; j++) {
        chunk.setBlockType(new Vec3(-3 + j, y0 + i, -6), ID[pattern[i][j]])
      }
      chunk.setBlockType(new Vec3(-3 + 5, y0 + i, -6), ID.stone) // punggung dinding
    }
    // Kantong bijih dangkal (y = permukaan - 2) supaya scan permukaan langsung menemukan ore
    const pocket = [
      [4, -3, 'coal_ore'], [5, -3, 'coal_ore'], [6, -4, 'iron_ore'], [7, -4, 'iron_ore'],
      [6, -5, 'coal_ore'], [-7, 3, 'copper_ore'], [-8, 3, 'copper_ore'], [-7, 4, 'coal_ore'],
      [9, 7, 'iron_ore'], [10, 7, 'iron_ore'], [10, 8, 'coal_ore'], [-9, -7, 'gold_ore']
    ]
    for (const [x, z, name] of pocket) {
      chunk.setBlockType(new Vec3(x, SURFACE - 2, z), ID[name])
    }
  }

  function generateChunk (chunkX, chunkZ) {
    const chunk = new Chunk()
    const baseX = chunkX * 16
    const baseZ = chunkZ * 16

    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const wx = baseX + lx
        const wz = baseZ + lz
        const h = surfaceHeight(wx, wz)
        for (let y = 0; y < HEIGHT; y++) {
          const pos = new Vec3(lx, y, lz)
          if (y === 0) { chunk.setBlockType(pos, ID.bedrock); continue }
          if (y > h) {
            // udara di atas permukaan (dengan skylight penuh)
            if (y <= h + 1) chunk.setSkyLight(pos, 15)
            else chunk.setSkyLight(pos, 15)
            continue
          }
          if (isCave(wx, y, wz) && y < h - 1) {
            if (y <= 7) { chunk.setBlockType(pos, ID.lava); continue } // genangan lava di dasar
            continue // udara (gua)
          }
          if (y === h) { chunk.setBlockType(pos, ID.grass_block); continue }
          if (y > h - 4) { chunk.setBlockType(pos, ID.dirt); continue }

          const ore = oreAt(wx, y, wz)
          if (ore) { chunk.setBlockType(pos, ID[ore]); continue }

          if (y < DEEPSLATE_Y) chunk.setBlockType(pos, ID.deepslate)
          else if (hash(wx, y, wz, seed + 3) < 0.02) chunk.setBlockType(pos, ID.gravel)
          else chunk.setBlockType(pos, ID.stone)
        }
      }
    }

    // Pohon oak (deterministik per chunk)
    if (Math.max(Math.abs(chunkX), Math.abs(chunkZ)) > 3) {
      for (let t = 0; t < 3; t++) {
        if (hash(chunkX, t, chunkZ, seed + 900) > 0.35) continue
        const lx = 2 + Math.floor(hash(chunkX, t + 1, chunkZ, seed + 901) * 12)
        const lz = 2 + Math.floor(hash(chunkX, t + 2, chunkZ, seed + 902) * 12)
        const h = surfaceHeight(baseX + lx, baseZ + lz)
        const trunk = 4 + Math.floor(hash(chunkX, t + 3, chunkZ, seed + 903) * 3)
        for (let i = 1; i <= trunk; i++) chunk.setBlockType(new Vec3(lx, h + i, lz), ID.oak_log)
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            for (let dy = 0; dy <= 2; dy++) {
              if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && dy === 2) continue
              const pos = new Vec3(lx + dx, h + trunk + dy - 1, lz + dz)
              if (chunk.getBlockType(pos) === ID.air) chunk.setBlockType(pos, ID.oak_leaves)
            }
          }
        }
      }
    }

    if (chunkX === 0 && chunkZ === 0) {
      buildSpawnFarm(chunk)
      buildOreWall(chunk)
    }

    return chunk
  }

  generateChunk.meta = { name: 'hyunk-dev-world', seed }
  return generateChunk
}
