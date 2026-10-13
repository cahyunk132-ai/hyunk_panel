#!/usr/bin/env node
/**
 * DEV SERVER — server Minecraft lokal (cracked / offline-mode) untuk debugging
 * admin_gabut tanpa menyentuh server produksi.
 *
 * Kenapa flying-squid?
 *   Node murni, tanpa Java, jalan di container mana pun, dan bisa ditanam
 *   langsung di repo. Protokol yang dipakai sama dengan server Java asli
 *   (1.8–1.21.4) sehingga Mineflayer tidak tahu bedanya. Dunia, mob, ladang,
 *   dan perintah debug di bawah ini cukup untuk menguji seluruh OODA loop.
 *
 * Perintah in-game (semua player otomatis OP di dev server):
 *   /kit [warrior|miner|farmer|naked]  beri item
 *   /mob <nama> [jumlah] [hp]          spawn mob (zombie, skeleton, creeper, ...)
 *   /mobs                              daftar mob aktif
 *   /clearmobs                         hapus semua mob
 *   /ore <blok> [jumlah]               tanam bijih di depan player (uji mining)
 *   /farmhere                          bangun ladang kecil di sebelah player
 *   /heal  /feed  /where  /status  /devhelp
 */
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const fsSquid = require('flying-squid')
const { Vec3 } = require('vec3')
const Item = null // dibuat setelah registry ada (prismarine-item butuh registry)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_MCBOT = path.resolve(__dirname, '..')

// ── konfigurasi ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return fallback
}
const has = (name) => argv.includes(`--${name}`)

const PORT = Number(flag('port', process.env.DEV_PORT || 25565))
const SEED = Number(flag('seed', process.env.DEV_SEED || 20261013))
const VERSION = String(flag('version', process.env.DEV_VERSION || '1.21.4'))
const MELEE_DAMAGE = Number(flag('damage', process.env.DEV_DAMAGE || 2))
const ANDA = has('verbose') || process.env.DEV_VERBOSE === '1'
const AUTO_MOB_MS = Number(flag('auto-mob', process.env.DEV_AUTO_MOB_MS || 0)) // 0 = mati
const DEBUG_PACKETS = has('debug-packets') || process.env.DEV_DEBUG_PACKETS === '1'
// --kit-on-join [preset]  (tanpa preset = warrior) — mis. `--kit-on-join farmer`
const KIT_PRESET = (() => {
  const i = argv.indexOf('--kit-on-join')
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  if (i !== -1) return 'warrior'
  return process.env.DEV_KIT_ON_JOIN || null // bisa berisi nama preset juga
})()
const KIT_ON_JOIN = !!KIT_PRESET
const WORLD_DIR = flag('world', process.env.DEV_WORLD_DIR)
  ? path.resolve(ROOT_MCBOT, flag('world', process.env.DEV_WORLD_DIR), VERSION)
  : path.join(__dirname, 'world', VERSION)

const HOSTILE_QUICK = {
  warrior: ['iron_sword', 'iron_pickaxe', 'iron_axe', 'bread:8', 'torch:32', 'oak_planks:16'],
  miner: ['iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe', 'torch:64', 'bread:6', 'stone_shovel'],
  farmer: ['iron_hoe', 'wheat_seeds:24', 'bread:4', 'bucket', 'iron_sword'],
  naked: []
}

// ── server ───────────────────────────────────────────────────────────────────
const serv = fsSquid.createMCServer({
  motd: '§aHYUNK DEV§r §7· cracked/offline §8· admin_gabut playground',
  port: PORT,
  'max-players': 20,
  'online-mode': false, // ← cracked/offline: siapa pun bisa masuk dengan nama apa pun
  version: VERSION,
  logging: false,
  gameMode: 0, // 0 = survival (penting: uji makan, HP, tool durability)
  difficulty: 1,
  worldFolder: WORLD_DIR,
  'view-distance': 8,
  'max-entities': 300,
  'everybody-op': true, // biar bot & director bisa kirim perintah debug lewat chat
  generation: {
    name: path.join(__dirname, 'generator.cjs'), // generator kustom (ore, gua, ladang, pohon)
    options: { seed: SEED }
  },
  'player-list-text': { header: { text: '§aHYUNK DEV' }, footer: { text: '§7admin_gabut sandbox' } },
  plugins: {}
})

const log = (...args) => console.log('[dev-server]', ...args)
const warn = (...args) => console.warn('[dev-server]', ...args)

const PrismarineItem = require('prismarine-item')

function itemByName (name) {
  const def = serv.registry.itemsByName[name] || serv.registry.blocksByName[name]
  if (!def) return null
  const ItemClass = PrismarineItem(serv.registry)
  return new ItemClass(def.id, 1)
}

// ── helpers ──────────────────────────────────────────────────────────────────
function nearestPlayer (entity, maxDistance = 64) {
  let best = null
  let bestDistance = maxDistance
  for (const player of serv.players) {
    if (!player.position || player.gameMode === 1) continue // kreatif = kebal di dev server
    const d = player.position.distanceTo(entity.position)
    if (d < bestDistance) { best = player; bestDistance = d }
  }
  return best
}

function spawnDevMob (name, world, position, { health = 20, velocity = null } = {}) {
  const def = serv.registry.entitiesByName[name]
  if (!def) return null
  // Catatan: serv.spawnMob() bawaan mengandalkan registry.mobs yang kosong untuk
  // versi modern, jadi kita bentuk entity mob sendiri (persis field-nya).
  const mob = serv.initEntity('mob', def.id, world, position)
  mob.uuid = randomUUID()
  mob.name = name
  mob.spawnPacketName = 'spawn_entity'
  mob.velocity = velocity || new Vec3(0, 0, 0)
  mob.pitch = 0
  mob.headPitch = 0
  mob.yaw = Math.random() * Math.PI * 2
  mob.gravity = new Vec3(0, -20, 0)
  mob.terminalvelocity = new Vec3(27, 27, 27)
  mob.friction = new Vec3(15, 0, 15)
  mob.size = new Vec3(def.width || 0.75, def.height || 1.75, def.width || 0.75)
  mob.health = health
  mob.metadata = []
  patchEntityNetworking(mob)
  mob.updateAndSpawn()
  return mob
}

function giveKit (player, preset = 'warrior') {
  const list = HOSTILE_QUICK[preset]
  if (!list) return `Unknown kit "${preset}" (warrior|miner|farmer|naked)`
  let slot = 36 // hotbar pertama (9 slot)
  for (const entry of list) {
    const [name, countRaw] = entry.split(':')
    const count = Number(countRaw || 1)
    const def = serv.registry.itemsByName[name] || serv.registry.blocksByName[name]
    if (!def) { player.chat(`§cunknown item: ${name}`); continue }
    const ItemClass = PrismarineItem(serv.registry)
    player.inventory.updateSlot(slot, new ItemClass(def.id, count))
    slot = slot < 44 ? slot + 1 : 9
  }
  return `Kit "${preset}" diberikan (${list.length} jenis item)`
}

function buildFarmAt (player, { width = 6, length = 4 } = {}) {
  const origin = player.position.floored().offset(2, 0, 0)
  const y = origin.y
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < length; z++) {
      const pos = new Vec3(origin.x + x, y - 1, z + origin.z)
      serv.setBlock(serv.overworld, pos, serv.registry.blocksByName.farmland.minStateId + 1) // moisture=1
      const crop = serv.registry.blocksByName.wheat
      const age = (x + z) % 2 === 0 ? 7 : 3
      serv.setBlock(serv.overworld, new Vec3(pos.x, y, pos.z), crop.minStateId + age)
    }
  }
  return `Ladang ${width}x${length} dibangun di ${origin.x},${y},${origin.z}`
}

function placeOres (player, name, count = 5) {
  const def = serv.registry.blocksByName[name]
  if (!def) return `Blok "${name}" tidak dikenal`
  const yaw = player.yaw
  const dirX = Math.round(-Math.sin(yaw))
  const dirZ = Math.round(-Math.cos(yaw))
  const base = player.position.floored().offset(dirX * 4, 0, dirZ * 4)
  for (let i = 0; i < count; i++) {
    const pos = new Vec3(base.x + dirX * i, base.y + (i % 3), base.z + dirZ * i)
    serv.setBlock(serv.overworld, pos, def.minStateId)
  }
  return `${count}x ${name} ditempatkan di arah hadap player`
}

// ── perintah debug ───────────────────────────────────────────────────────────
function installCommands () {
  const add = (params) => serv.commands.add({
    onlyPlayer: true, op: true, parse: (str) => (str || '').trim(), ...params
  })

  add({
    base: 'devhelp',
    info: 'Daftar perintah dev server',
    action () {
      return '§ePerintah dev: §f/kit [warrior|miner|farmer|naked] · /mob <nama> [jml] [hp] · /mobs · /clearmobs · /ore <blok> [jml] · /farmhere · /heal · /feed · /where · /status'
    }
  })

  add({
    base: 'kit',
    info: 'Beri item untuk debugging',
    usage: '/kit [warrior|miner|farmer|naked]',
    action (str, ctx) {
      const [preset = 'warrior', playerName] = (str || '').split(/\s+/)
      if (playerName) {
        const target = serv.players.find(p => p.username === playerName)
        if (!target) return `Pemain "${playerName}" tidak ada`
        const res = giveKit(target, preset || 'warrior')
        target.chat(`§7[dev] kit dari ${ctx.player.username}`)
        return `${res} → ${playerName}`
      }
      return giveKit(ctx.player, preset || 'warrior')
    }
  })

  add({
    base: 'mob',
    info: 'Spawn mob di dekat player',
    usage: '/mob <nama> [jumlah] [hp]',
    action (str, ctx) {
      const [name = 'zombie', countRaw = '1', hpRaw = '6'] = (str || '').split(/\s+/)
      const count = Math.max(1, Math.min(20, Number(countRaw) || 1))
      const hp = Math.max(1, Math.min(40, Number(hpRaw) || 6))
      const spawned = []
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const r = 5 + Math.random() * 3
        const pos = ctx.player.position.offset(Math.cos(angle) * r, 1, Math.sin(angle) * r)
        const mob = spawnDevMob(name, ctx.player.world, pos, { health: hp })
        if (mob) spawned.push(mob.id)
      }
      return spawned.length ? `Spawn ${spawned.length}x ${name} (hp ${hp}) di sekitar ${ctx.player.username} — ids ${spawned.join(',')}` : `Gagal spawn "${name}"`
    }
  })

  add({
    base: 'mobs',
    info: 'Daftar mob aktif',
    action (_str, ctx) {
      const mobs = Object.values(serv.entities).filter(e => e.type === 'mob')
      if (!mobs.length) return 'Tidak ada mob aktif'
      return mobs.map(m => `${m.name}#${m.id} @${m.position.x.toFixed(0)},${m.position.y.toFixed(0)},${m.position.z.toFixed(0)} hp ${m.health} d=${m.position.distanceTo(ctx.player.position).toFixed(1)}`).join(' | ')
    }
  })

  add({
    base: 'clearmobs',
    info: 'Hapus semua mob',
    action () {
      const mobs = Object.values(serv.entities).filter(e => e.type === 'mob')
      for (const m of mobs) removeEntityForEveryone(m)
      return `Menghapus ${mobs.length} mob`
    }
  })

  add({
    base: 'ore',
    info: 'Tanam bijih di depan player',
    usage: '/ore <blok> [jumlah]',
    action (str, ctx) {
      const [name = 'diamond_ore', count = '5'] = (str || '').split(/\s+/)
      return placeOres(ctx.player, name, Number(count) || 5)
    }
  })

  add({
    base: 'farmhere',
    info: 'Bangun ladang di sebelah player',
    action (_str, ctx) { return buildFarmAt(ctx.player) }
  })

  add({
    base: 'tp',
    info: 'Teleport player ke koordinat',
    usage: '/tp <player|me> <x> <y> <z>',
    action (str, ctx) {
      const [who = 'me', x, y, z] = (str || '').split(/\s+/)
      const target = who === 'me' ? ctx.player : serv.players.find(p => p.username === who)
      if (!target) return `Pemain "${who}" tidak ada`
      const pos = new Vec3(Number(x) || 0, Number(y) || 64, Number(z) || 0)
      target.position = pos
      target.knownPosition = pos.clone() // hindari delta besar → entity_teleport rusak
      target.sendSelfPosition?.()
      return `Teleport ${who} → ${x},${y},${z}`
    }
  })

  add({
    base: 'heal',
    action (_str, ctx) { ctx.player.updateHealth(20); ctx.player.updateFood(20); return `HP & hunger ${ctx.player.username} penuh` }
  })

  add({
    base: 'feed',
    action (_str, ctx) { ctx.player.updateFood(20); ctx.player.updateFoodSaturation(5); return 'Hunger penuh' }
  })

  add({
    base: 'where',
    action (_str, ctx) {
      const p = ctx.player.position
      return `${ctx.player.username} @ ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} hp ${ctx.player.health} food ${ctx.player.food}`
    }
  })

  add({
    base: 'status',
    action () {
      const mobs = Object.values(serv.entities).filter(e => e.type === 'mob').length
      return `players ${serv.players.length} · mobs ${mobs} · entities ${Object.keys(serv.entities).length} · seed ${SEED}`
    }
  })
}

// ── Perbaikan jaringan entity (kompatibilitas 1.21.4) ────────────────────────
// Paket `entity_teleport` versi 1.21.4 memerlukan dx, dy, dz, dan `flags`
// (bitfield PositionUpdateRelatives). flying-squid tidak mengirimnya sehingga
// protodef melempar "SizeOf error for undefined" DAN KONEKSI KLIEN DIPUTUS —
// terjadi setiap kali ada teleportasi jauh (mis. /tp, world change).
const netPatched = new WeakSet()
function patchEntityNetworking (entity) {
  if (!entity || netPatched.has(entity)) return
  netPatched.add(entity)
  for (const fn of ['_writeOthersNearby', '_writeOthers', '_writeNearby']) {
    const orig = entity[fn]
    if (typeof orig !== 'function') continue
    entity[fn] = (packetName, fields) => {
      if (packetName === 'entity_teleport') {
        fields = { dx: 0, dy: 0, dz: 0, flags: 0, ...fields }
      }
      return orig(packetName, fields)
    }
  }
}

// ── Respawn (kompatibilitas 1.21.4) ──────────────────────────────────────────
// Plugin respawn bawaan menulis paket `respawn` dengan bentuk LAMA (previousGameMode,
// worldName, difficulty, ...). Untuk 1.21.4 bentuknya { worldState: SpawnInfo,
// copyMetadata } sehingga protodef melempar error dan pemain TIDAK PERNAH
// di-respawn — bot tersangkut di hp 0 selamanya. Kita timpa _sendRespawn.
function writeRespawnPacket (player) {
  player._client.write('respawn', {
    worldState: {
      dimension: 0,
      name: serv.dimensionNames?.[0] || 'minecraft:overworld',
      hashedSeed: serv.hashedSeed || [0, 0],
      gamemode: player.gameMode,
      previousGamemode: 255, // u8, 255 = tidak ada
      isDebug: false,
      isFlat: false,
      death: undefined,
      portalCooldown: 0,
      seaLevel: 63
    },
    copyMetadata: 0
  })
}

function installRespawn (player) {
  // 1) Timpa cara server mengirim paket respawn
  player._sendRespawn = () => writeRespawnPacket(player)
  // 2) Jaring pengaman: tangani sendiri client_command (bawaan bergantung pada
  //    feature flag yang tidak selalu cocok untuk versi modern).
  player._client.on('client_command', (data) => {
    const raw = data?.actionId ?? data?.payload
    if (DEBUG_PACKETS) log(`packet ← ${player.username}: client_command ${JSON.stringify(data)}`)
    // protodef menerjemahkan mapper 0 → "perform_respawn" (STRING), bukan angka.
    // Perbandingan `=== 0` ala plugin bawaan karena itu tidak pernah cocok.
    const isRespawn = raw === 0 || raw === 'perform_respawn'
    if (!isRespawn) return
    revivePlayer(player, 'client_command')
  })

  // Playerdata menyimpan HP 0 kalau pemain keluar saat mati → saat login lagi
  // server "menghidupkan" pemain dalam keadaan mati dan klien tidak pernah
  // menerima event death (tidak ada yang dikirim). Jadi hidupkan di sisi server.
  const reviveIfDead = () => {
    if (player.health !== undefined && player.health <= 0) revivePlayer(player, 'login-while-dead')
  }
  setTimeout(reviveIfDead, 1200)
  setTimeout(reviveIfDead, 3000)
}

function revivePlayer (player, why) {
  try { writeRespawnPacket(player) } catch (err) { warn(`respawn packet gagal: ${err.message}`) }
  player.updateHealth(20)
  player.sendSelfPosition?.()
  player.nearbyEntities = []
  player.updateAndSpawn?.()
  log(`respawn: ${player.username} hidup kembali (hp 20, alasan: ${why})`)
}

// ── PvE: serangan pemain → mob ───────────────────────────────────────────────
// Sejak 1.9 klien mengirim paket `attack` (bukan `use_entity`), dan flying-squid
// hanya menangani `use_entity` → tanpa patch ini bot memukul mob tanpa hasil
// apa pun ("attacked 8 times, target still alive").
const WEAPON_DAMAGE = {
  wooden_sword: 4, golden_sword: 4, stone_sword: 5, iron_sword: 6, diamond_sword: 7, netherite_sword: 8,
  wooden_axe: 7, golden_axe: 7, stone_axe: 9, iron_axe: 9, diamond_axe: 9, netherite_axe: 10,
  trident: 9, iron_pickaxe: 4, diamond_pickaxe: 5, iron_shovel: 4, diamond_shovel: 5
}
const ATTACK_COOLDOWN_MS = 450 // ≈ cooldown serangan 1.9+
const lastAttack = new WeakMap()
const combatHooked = new WeakSet()

function heldDamage (player) {
  const held = player.inventory?.slots?.[36 + (player.heldItemSlot || 0)]
  if (!held) return 1
  const name = serv.registry.items?.[held.type]?.name
  return WEAPON_DAMAGE[name] ?? 1
}

/**
 * Hapus entity untuk SEMUA pemain (termasuk si penyerang).
 * serv.destroyEntity() bawaan hanya menulis ke "nearby players" dan pada praktiknya
 * si penyerang tidak menerima paket entity_destroy → klien menyimpan "mob hantu"
 * yang membuat bot terus memukul target yang sebenarnya sudah mati.
 */
function removeEntityForEveryone (entity) {
  for (const p of serv.players) {
    try { p._client?.write('entity_destroy', { entityIds: [entity.id] }) } catch { /* lewati */ }
  }
  delete serv.entities[entity.id]
}

function handlePlayerAttack (player, entityId) {
  const target = serv.entities[entityId]
  if (!target || target === player || target.type === 'player' && target.gameMode !== 0) return
  const now = Date.now()
  const prev = lastAttack.get(player)
  const cooldown = target.type === 'mob' ? ATTACK_COOLDOWN_MS : 1000
  if (prev && prev.id === entityId && now - prev.at < cooldown) return // dedupe attack vs use_entity
  lastAttack.set(player, { id: entityId, at: now })

  const damage = heldDamage(player)
  const before = target.health ?? 20
  const after = Math.max(0, before - damage)
  if (typeof target.updateHealth === 'function') target.updateHealth(after)
  else target.health = after
  target.health = after

  try {
    for (const p of serv.players) {
      if (p.position && p.position.distanceTo(target.position) < 48) {
        p._client.write('entity_status', { entityId: target.id, entityStatus: 2 }) // hurt
      }
    }
  } catch { /* paket animasi opsional */ }

  log(`combat: ${player.username} hit ${target.name || target.username}#${target.id} for ${damage} (hp ${before} → ${after})`)
  if (after <= 0) {
    log(`combat: ${target.name || target.username}#${target.id} killed by ${player.username}`)
    removeEntityForEveryone(target)
  }
}

function installCombat (player) {
  if (combatHooked.has(player)) return
  combatHooked.add(player)
  if (DEBUG_PACKETS) {
    // --debug-packets: lihat paket mentah yang benar-benar diterima server
    player._client.on('packet', (data, meta) => {
      const name = typeof meta === 'string' ? meta : meta?.name
      if (name && /attack|use_entity|interact|block_place|use_item/i.test(name)) {
        log(`packet ← ${player.username}: ${name} ${JSON.stringify(data).slice(0, 120)}`)
      }
    })
  }
  player._client.on('attack', ({ entityId } = {}) => handlePlayerAttack(player, entityId))
  player._client.on('use_entity', ({ mouse, target } = {}) => { if (mouse === 1) handlePlayerAttack(player, target) })
}

// ── AI mob sederhana (kejar + serang) ────────────────────────────────────────
const MOB_ATTACK_INTERVAL = 1000
const MOB_SPEED = 2.4
const HOSTILE = new Set(['zombie', 'husk', 'drowned', 'skeleton', 'stray', 'creeper', 'spider', 'cave_spider', 'witch', 'pillager', 'vindicator', 'enderman', 'slime'])

function installMobAI () {
  serv.on('tick', () => {
    for (const entity of Object.values(serv.entities)) patchEntityNetworking(entity)
    for (const mob of Object.values(serv.entities)) {
      if (mob.type !== 'mob' || !HOSTILE.has(mob.name)) continue
      const target = nearestPlayer(mob, 24)
      if (!target) continue
      const dir = target.position.minus(mob.position)
      dir.y = 0
      const distance = dir.norm()
      if (target.health <= 0) continue // player sedang mati, jangan dipukul lagi
      if (distance < 1.6) {
        mob.velocity.x = 0
        mob.velocity.z = 0
        const now = Date.now()
        if (now - (mob.lastAttack || 0) > MOB_ATTACK_INTERVAL) {
          mob.lastAttack = now
          const health = Math.max(0, target.health - MELEE_DAMAGE)
          target.updateHealth(health)
          try { target.playSoundAtSelf?.('game.player.hurt') } catch { /* suara dimatikan */ }
          log(`mob ${mob.name}#${mob.id} hit ${target.username} for ${MELEE_DAMAGE} (hp → ${health})`)
          if (health <= 0) log(`${target.username} mati (menunggu respawn dari client)`)
        }
      } else {
        const v = dir.scaled(MOB_SPEED / distance)
        mob.velocity.x = v.x
        mob.velocity.z = v.z
      }
    }
  })
}

// ── event server ─────────────────────────────────────────────────────────────
serv.on('ready', () => {
  // flying-squid 1.21 mengirim paket sound dengan format lama → klien spam
  // "Chunk size is 49 but only 32 was read". Untuk dev server, suara tidak perlu.
  serv.playSound = () => {}

  // Benih adalah ITEM (bukan blok) sehingga placeItem() bawaan mengembalikan {}
  // dan penanaman gagal tanpa pesan. Daftarkan handler: benih → crop age 0.
  const SEED_BLOCKS = [
    ['wheat_seeds', 'wheat'], ['beetroot_seeds', 'beetroots'], ['carrot', 'carrots'],
    ['potato', 'potatoes'], ['melon_seeds', 'melon_stem'], ['pumpkin_seeds', 'pumpkin_stem']
  ]
  for (const [itemName, blockName] of SEED_BLOCKS) {
    const item = serv.registry.itemsByName[itemName]
    const block = serv.registry.blocksByName[blockName]
    if (item && block) serv.onItemPlace(itemName, () => ({ id: block.id, data: 0 }))
  }
  log(`seed planting handlers: ${SEED_BLOCKS.map(([i]) => i).join(', ')}`)
  try { serv.color = { red: '§c' } } catch { /* ignore */ }
  installCommands()
  installMobAI()
  log('===========================================================')
  log(`DEV SERVER siap · ${VERSION} · offline-mode (cracked) · 0.0.0.0:${PORT}`)
  log(`world : ${WORLD_DIR} (seed ${SEED})`)
  log(`mode  : survival · mob melee ${MELEE_DAMAGE} dmg/1s · auto-mob ${AUTO_MOB_MS || 'off'}ms`)
  log('connect bot: npm run dev:bot -- --server 127.0.0.1:' + PORT)
  log('perintah   : /devhelp  /kit  /mob zombie 3  /ore diamond_ore 6  /farmhere')
  log('===========================================================')
})

serv.on('listening', (port) => log(`listening on ${port}`))

// flying-squid tidak memancarkan event join standar → pantau array players
let knownPlayers = new Set()
setInterval(() => {
  const now = new Set(serv.players.map(p => p.username))
  for (const p of serv.players) {
    if (!knownPlayers.has(p.username)) {
      log(`player join: ${p.username} (${p.uuid})`)
      patchEntityNetworking(p)
      installCombat(p)
      installRespawn(p)
      if (KIT_ON_JOIN) {
        giveKit(p, KIT_PRESET)
        p.chat(`§7[dev] kit "${KIT_PRESET}" otomatis diberikan (--kit-on-join)`)
      }
    }
  }
  for (const name of knownPlayers) if (!now.has(name)) log(`player leave: ${name}`)
  knownPlayers = now
}, 1000)

// mob otomatis biar dunia terasa hidup (opsional)
if (AUTO_MOB_MS > 0) {
  setInterval(() => {
    for (const player of serv.players) {
      const hostiles = Object.values(serv.entities).filter(e => e.type === 'mob' && HOSTILE.has(e.name) && e.position.distanceTo(player.position) < 32)
      if (hostiles.length >= 3) continue
      const angle = Math.random() * Math.PI * 2
      const r = 12 + Math.random() * 8
      const pos = player.position.offset(Math.cos(angle) * r, 1, Math.sin(angle) * r)
      const mob = spawnDevMob('zombie', player.world, pos, { health: 6 })
      if (mob) log(`auto-mob: zombie#${mob.id} spawn ${r.toFixed(0)} blok dari ${player.username}`)
    }
  }, AUTO_MOB_MS)
}

if (ANDA) {
  setInterval(() => {
    for (const p of serv.players) {
      const held = p.inventory?.slots?.[36 + (p.heldItemSlot || 0)]
      log(`[state] ${p.username} hp=${p.health} food=${p.food} pos=${p.position.floored()} held=${held?.name || '-'} mobs=${Object.values(serv.entities).filter(e => e.type === 'mob').length}`)
    }
  }, 5000)
}

serv.on('error', (err) => warn('server error:', err.message))

const shutdown = async () => {
  log('shutting down…')
  try { await serv.destroy() } catch { /* ignore */ }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

export { serv, spawnDevMob, giveKit }
