/**
 * Brain: heuristic (rule-based).
 *
 * Dua fungsi:
 *  1. Otak utama saat `BRAIN=heuristic` — supaya seluruh loop OODA bisa
 *     didebug tanpa API key / tanpa internet.
 *  2. Fallback otomatis kalau Groq error (timeout, rate limit, JSON rusak),
 *     jadi bot tidak pernah "beku" hanya karena API.
 *
 * Rule-nya sengaja mencerminkan aturan yang ada di SYSTEM_PROMPT supaya
 * tingkah laku kedua otak bisa dibandingkan.
 */
const ORE_VALUE = [
  ['diamond', 100], ['emerald', 95], ['ancient_debris', 92], ['gold', 80], ['iron', 70],
  ['copper', 55], ['redstone', 45], ['lapis', 42], ['quartz', 35], ['coal', 30]
]
const ALLY_SEEDS = ['wheat_seeds', 'beetroot_seeds', 'carrot', 'potato', 'melon_seeds', 'pumpkin_seeds']

function oreScore (name) {
  for (const [key, score] of ORE_VALUE) if (name.includes(key)) return score
  return 10
}

function decision (thought, action, extra = {}) {
  return { thought, action, target: null, item_to_use: null, ...extra }
}

export function decideHeuristic (state, { safety } = {}) {
  const hpPct = state.health.pct / 100
  const lowHp = hpPct <= (safety?.fleeHealthPct ?? 0.3)
  const midHp = hpPct <= (safety?.lowHealthPct ?? 0.5)
  const hasFood = !!state.bestFood
  const hungry = state.food.value <= (safety?.lowFood ?? 14)
  const threat = state.threats.nearest
  const creeper = state.threats.creeperClose
  const task = state.task?.current || 'auto'

  // 1. Survival dulu
  if (state.hazards?.nearby) {
    return decision(`standing in ${state.hazards.nearby.type}, getting out`, 'flee', {
      target: null, reason: 'hazard'
    })
  }
  if (lowHp) {
    if (hasFood && state.food.value < 20) {
      return decision(`health ${state.health.value}/20 — eat ${state.bestFood.name}`, 'eat', { item_to_use: state.bestFood.name })
    } // kalau hunger penuh, makan tidak mungkin: biarkan regen alami (idle)
    if (threat) return decision(`health ${state.health.value}/20 and ${threat.name} at ${threat.distance}b — retreat`, 'flee')
    return decision(`health ${state.health.value}/20 — waiting for natural regeneration`, 'idle')
  }
  // 2. Creeper terlalu dekat → menjauh
  if (creeper && creeper.distance <= 3) {
    return decision(`creeper at ${creeper.distance} blocks — back off before it explodes`, 'flee')
  }
  // 3. Bertarung
  if (threat && threat.distance <= (safety?.hostileRadius ?? 10)) {
    if (midHp && !state.bestWeapon) {
      return decision(`threat ${threat.name} nearby but no weapon and hp ${state.health.value}/20 — retreat`, 'flee')
    }
    return decision(`attacking ${threat.name} (id ${threat.id}, ${threat.distance}b)`, 'attack', { target: threat.id, item_to_use: state.bestWeapon?.name || null })
  }
  // 4. Makan sebelum lapar parah
  if (hungry && hasFood) {
    return decision(`hunger ${state.food.value}/20 — eat ${state.bestFood.name}`, 'eat', { item_to_use: state.bestFood.name })
  }

  // 5. Tugas sesuai prioritas
  if (task === 'fight' || (task === 'auto' && state.threats.count > 0 && state.threats.nearest.distance <= 6)) {
    const t = state.threats.nearest
    if (t) return decision(`hunting ${t.name} (id ${t.id})`, 'attack', { target: t.id })
  }

  if (task === 'mine' || task === 'auto') {
    const wanted = state.task?.objective?.target
    const ores = [...state.blocks.ores].sort((a, b) => {
      if (wanted) {
        const aw = a.name.includes(wanted.replace('deepslate_', '')) ? 1 : 0
        const bw = b.name.includes(wanted.replace('deepslate_', '')) ? 1 : 0
        if (aw !== bw) return bw - aw
      }
      return oreScore(b.name) - oreScore(a.name) || a.distance - b.distance
    })
    const pick = ores[0]
    if (pick) return decision(`mining ${pick.name} at ${pick.pos.join(',')} (${pick.distance}b)`, 'mine', { target: pick.pos })
    if (state.blocks.logs.length && state.task?.objective?.target === 'log') {
      const log = state.blocks.logs[0]
      return decision(`chopping ${log.name} at ${log.pos.join(',')}`, 'mine', { target: log.pos })
    }
    if (task === 'mine' && !ores.length) {
      return decision('no ore visible — scouting for resources', 'explore')
    }
  }

  if (task === 'farm' || task === 'auto') {
    const ready = state.blocks.crops.filter(c => c.ready)
    if (ready.length) {
      const c = ready[0]
      return decision(`harvesting ${c.name} (age ${c.age}/${c.maxAge}) at ${c.pos.join(',')}`, 'farm', { target: c.pos })
    }
    const empty = state.blocks.farmland.filter(f => f.empty)
    const seeds = ALLY_SEEDS.find(s => state.inventory.counts[s] > 0)
    if (empty.length && seeds) {
      return decision(`planting ${seeds} on empty farmland at ${empty[0].pos.join(',')}`, 'farm', { target: empty[0].pos, item_to_use: seeds })
    }
  }

  // 6. Default: jelajah
  return decision('nothing urgent — exploring for resources', 'explore')
}
