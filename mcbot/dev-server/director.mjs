#!/usr/bin/env node
/**
 * DIRECTOR — bot kedua yang bertugas menyutradarai skenario uji di dev server.
 *
 * Kenapa? Supaya debugging tidak perlu manual: director masuk sebagai pemain
 * biasa (punya OP di dev server), lalu menyiapkan kondisi — spawn zombie,
 * menanam bijih, membangun ladang, memukul admin_gabut — sambil mencatat
 * respons bot dari log/chat.
 *
 * Pakai:
 *   node dev-server/director.mjs attack        # spawn 2 zombie + biarkan bot bereaksi
 *   node dev-server/director.mjs mine          # tanam bijih di depan bot
 *   node dev-server/director.mjs farm          # bangun ladang di dekat bot
 *   node dev-server/director.mjs pvp           # director memukul bot (uji ancaman pemain)
 *   node dev-server/director.mjs stress        # semua skenario berurutan
 */
import mineflayer from 'mineflayer'

const argv = process.argv.slice(2)
const scenario = argv.find(a => !a.startsWith('--')) || 'stress'
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}
const SERVER = flag('server', process.env.MC_SERVER || '127.0.0.1:25565')
const [host, portRaw] = SERVER.split(':')
const port = Number(portRaw || 25565)
const TARGET = flag('target', process.env.BOT_USERNAME || 'admin_gabut')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log('[director]', ...a)

const bot = mineflayer.createBot({
  host,
  port,
  username: 'director',
  auth: 'offline',
  version: false,
  hideErrors: true
})

const chatLog = []
bot.on('chat', (username, message) => {
  chatLog.push({ username, message, at: Date.now() })
  if (username !== 'director') log(`[chat] ${username}: ${message}`)
})
bot.on('kicked', r => log('kicked:', JSON.stringify(r).slice(0, 200)))
bot.on('error', e => log('error:', e.message))
bot.on('end', () => log('disconnected'))

const send = (cmd) => { log(`/ ${cmd}`); bot.chat(cmd.startsWith('/') ? cmd : `/${cmd}`) }

function targetEntity () {
  return Object.values(bot.entities).find(e => e.username === TARGET && e !== bot.entity)
}

function distanceToTarget () {
  const t = targetEntity()
  if (!t) return Infinity
  return bot.entity.position.distanceTo(t.position)
}

async function walkToTarget (range = 2) {
  const pkg = (await import('mineflayer-pathfinder')).default
  const { pathfinder, goals } = pkg
  if (!bot.pathfinder) bot.loadPlugin(pathfinder)
  const t = targetEntity()
  if (!t) return false
  await bot.pathfinder.goto(new goals.GoalNear(t.position.x, t.position.y, t.position.z, range)).catch(() => {})
  return true
}

const scenarios = {
  async attack () {
    log('SKENARIO: 2 zombie menyerang bot (uji attack/flee/eat)')
    send('mob zombie 2 6')
    await sleep(30000)
    send('clearmobs')
  },
  async mine () {
    log('SKENARIO: bijih ditempatkan di depan bot (uji mine + tool durability)')
    const t = targetEntity()
    if (!t) return log(`bot ${TARGET} tidak terlihat`)
    // director tidak bisa memerintah di sekitar bot langsung → pakai koordinat bot via /tp
    send(`tp director ${Math.floor(t.position.x + 3)} ${Math.floor(t.position.y)} ${Math.floor(t.position.z)}`)
    await sleep(1500)
    send(`kit miner ${TARGET}`)
    for (const ore of ['iron_ore', 'coal_ore', 'diamond_ore']) {
      send(`ore ${ore} 3`)
      await sleep(500)
    }
    await sleep(25000)
  },
  async farm () {
    log('SKENARIO: ladang dibangun di dekat bot (uji harvest + replant)')
    const t = targetEntity()
    if (!t) return log('bot tidak terlihat')
    send(`tp director ${Math.floor(t.position.x + 3)} ${Math.floor(t.position.y)} ${Math.floor(t.position.z)}`)
    await sleep(1200)
    send(`kit farmer ${TARGET}`)
    send('farmhere')
    await sleep(30000)
  },
  async pvp () {
    log('SKENARIO: director menyerang bot (uji threat pemain; butuh PVP_MODE=1 di bot)')
    const t = targetEntity()
    if (!t) return log('bot tidak terlihat')
    for (let i = 0; i < 40; i++) {
      const target = targetEntity()
      if (!target) break
      const d = bot.entity.position.distanceTo(target.position)
      if (d > 2.6) {
        try { await walkToTarget(2) } catch { /* ignore */ }
      } else {
        try { bot.attack(target) } catch { /* ignore */ }
      }
      await sleep(700)
    }
    log('selesai memukul bot')
  },
  async stress () {
    log('SKENARIO: stress — spawn mob + bijih + ladang')
    send('mob zombie 1 4')
    await sleep(2000)
    send(`kit warrior ${TARGET}`)
    await sleep(1000)
    for (const ore of ['coal_ore', 'iron_ore']) { send(`ore ${ore} 2`); await sleep(400) }
    await sleep(15000)
    send('mob zombie 2 4')
    await sleep(20000)
    send('clearmobs')
  }
}

bot.once('spawn', async () => {
  log(`director masuk ke ${host}:${port} sebagai "director"`)
  await sleep(2500)
  const fn = scenarios[scenario]
  if (!fn) {
    log(`skenario tidak dikenal: ${scenario}. Pilihan: ${Object.keys(scenarios).join(', ')}`)
  } else {
    try { await fn() } catch (err) { log('scenario error:', err.message) }
  }
  log('selesai — keluar')
  bot.quit()
  setTimeout(() => process.exit(0), 500)
})

setTimeout(() => { log('timeout, keluar'); process.exit(1) }, 180000)
