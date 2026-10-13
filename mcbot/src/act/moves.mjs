/**
 * Aksi bergerak: goto, explore, flee.
 *
 * Semua pathfinding diserahkan ke mineflayer-pathfinder (ini "Baritone"-nya
 * ekosistem JS). LLM hanya bilang "ke mana", pathfinder yang menghitung
 * lompat/gali/jembatan.
 */
import { Vec3 } from 'vec3'
import pathfinderPkg from 'mineflayer-pathfinder'

const { Movements, goals } = pathfinderPkg
import { ActionAborted, checkAbort, fmtPos, sleep, withTimeout } from './helpers.mjs'

/** Setup movements sekali per bot (boleh ngegali, boleh parkour, no 1x1 tower). */
export function setupMovements (bot, { canDig = true, allowParkour = true, allowSprint = true } = {}) {
  const movements = new Movements(bot)
  movements.canDig = canDig
  movements.allowParkour = allowParkour
  movements.allowSprinting = allowSprint
  movements.allow1by1towers = false // jangan bikin menara 1x1 (bisa melayang ke langit)
  movements.allowFreeMotion = false
  movements.scafoldingBlocks = []
  bot.pathfinder.setMovements(movements)
  return movements
}

/** Pathfinding sampai tujuan; error kalau gagal (biar loop bisa pilih aksi lain). */
export async function goto (bot, pos, { timeoutMs = 12000, range = 2, signal, label = 'goto' } = {}) {
  checkAbort(signal, label)
  const target = new Vec3(Math.floor(pos[0]), Math.floor(pos[1]), Math.floor(pos[2]))
  const goal = new goals.GoalNear(target.x, target.y, target.z, range)
  try {
    bot.pathfinder.setGoal(goal, true)
    await withTimeout(
      bot.pathfinder.goto(goal).catch(err => { throw new Error(`pathfinder: ${err.message}`) }),
      timeoutMs, label, signal
    )
    return { ok: true, detail: `reached ${fmtPos(bot.entity.position)}` }
  } finally {
    try { bot.pathfinder.setGoal(null) } catch { /* ignore */ }
  }
}

/** Jelajah: pilih titik acak yang bisa dijangkau; gagal 3x → jalan lurus. */
export async function explore (bot, { distance = 18, timeoutMs = 9000, signal } = {}) {
  const origin = bot.entity.position.clone()
  for (let attempt = 0; attempt < 3; attempt++) {
    checkAbort(signal, 'explore')
    const angle = Math.random() * Math.PI * 2
    const r = distance * (0.6 + Math.random() * 0.6)
    const target = new Vec3(
      Math.floor(origin.x + Math.cos(angle) * r),
      Math.floor(origin.y),
      Math.floor(origin.z + Math.sin(angle) * r)
    )
    try {
      await goto(bot, [target.x, target.y, target.z], {
        timeoutMs: Math.max(2500, timeoutMs / (attempt + 1)), range: 2, signal, label: 'explore'
      })
      if (bot.entity.position.distanceTo(origin) > 3) {
        return { ok: true, detail: `wandered to ${fmtPos(bot.entity.position)}` }
      }
    } catch (err) {
      if (err instanceof ActionAborted) throw err
      // arah ini tidak bisa dijangkau → coba arah lain
    }
  }
  return walkForward(bot, 1500, signal)
}

/** Berjalan lurus sebentar (fallback terakhir + dipakai saat panik). */
export async function walkForward (bot, ms = 1500, signal, { jump = true } = {}) {
  checkAbort(signal, 'walk')
  bot.setControlState('forward', true)
  const started = Date.now()
  try {
    while (Date.now() - started < ms) {
      checkAbort(signal, 'walk')
      if (jump && bot.entity.onGround) {
        bot.setControlState('jump', true)
        await sleep(150)
        bot.setControlState('jump', false)
      }
      await sleep(100)
    }
    return { ok: true, detail: `walked forward ${ms}ms` }
  } finally {
    bot.setControlState('forward', false)
    bot.setControlState('jump', false)
  }
}

/** Titik pendaratan yang layak (ada blok solid di bawah, udara di atas). */
function findSafeSpotNear (bot, direction, distance) {
  const pos = bot.entity.position
  const offsets = [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [6, 6], [-6, -6], [6, -6], [-6, 6], [8, 0], [0, 8]]
  for (const [dx, dz] of offsets) {
    const candidate = new Vec3(
      Math.floor(pos.x + direction.x + dx),
      Math.floor(pos.y),
      Math.floor(pos.z + direction.z + dz)
    )
    const below = bot.blockAt(candidate.offset(0, -1, 0))
    const at = bot.blockAt(candidate)
    const up = bot.blockAt(candidate.offset(0, 1, 0))
    if (!below || !at || !up) continue
    const solid = !['air', 'cave_air', 'water', 'lava', 'void_air'].includes(below.name)
    const free = ['air', 'cave_air'].includes(at.name) && ['air', 'cave_air', 'water'].includes(up.name)
    if (solid && free) return candidate
  }
  return null
}

/** Kabur dari ancaman (atau dari hazard). */
export async function flee (bot, { threat = null, escapeTarget = null, timeoutMs = 8000, signal, distance = 16 } = {}) {
  const pos = bot.entity.position.clone()
  let direction
  if (escapeTarget) {
    const t = new Vec3(escapeTarget[0], escapeTarget[1], escapeTarget[2])
    direction = t.minus(pos)
  } else if (threat?.position) {
    direction = pos.minus(threat.position)
  } else {
    direction = new Vec3(Math.random() - 0.5, 0, Math.random() - 0.5)
  }
  if (direction.norm() < 0.1) direction = new Vec3(1, 0, 0)
  direction.y = 0
  direction = direction.normalize().scaled(distance)

  const spot = findSafeSpotNear(bot, direction, distance)
  if (spot) {
    try {
      const res = await goto(bot, [spot.x, spot.y, spot.z], { timeoutMs, range: 3, signal, label: 'flee' })
      return { ok: true, detail: `escaped to ${fmtPos(bot.entity.position)}`, ...res }
    } catch (err) {
      if (err instanceof ActionAborted) throw err
    }
  }
  try { await bot.look(Math.atan2(-direction.x, -direction.z), 0, true) } catch { /* ignore */ }
  const res = await walkForward(bot, Math.min(timeoutMs, 2500), signal)
  return { ok: true, detail: 'ran in reverse direction', ...res }
}
