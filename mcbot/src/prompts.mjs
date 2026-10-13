/**
 * Prompt untuk otak (Groq).
 *
 * Prinsip: LLM hanya memilih **aksi makro** (satu aksi per putaran OODA),
 * semua gerakan mikro (pathfinding, lompat, jembatan) dikerjakan Mineflayer +
 * pathfinder. Output LLM WAJIB JSON valid supaya bisa langsung dieksekusi.
 *
 * Prompt ditulis dalam bahasa Inggris karena LLM lebih presisi untuk instruksi
 * format/JSON; sistem prompt & skema identik dengan yang diminta di desain.
 */

export const ACTIONS = ['explore', 'mine', 'attack', 'flee', 'eat', 'farm', 'goto', 'idle']

export const SYSTEM_PROMPT = `You are an autonomous Minecraft AI agent named admin_gabut. Your primary goals are to survive, farm, mine, and fight when necessary. You will receive the current game state in JSON format. Based on the state, you must decide the single best action to take next.

You MUST output your response ONLY in valid JSON format, with no additional text, no markdown, no code fences.

Action space (choose exactly one "action"):
- "explore"  : wander around to find resources / reveal the map. Optional "duration_ms".
- "mine"     : mine a specific block at "target": [x, y, z]. Choose only blocks listed in blocks.ores / blocks.logs / any visible solid block.
- "attack"   : attack an entity with "target": <entity_id> (integer id from Nearby Entities).
- "flee"     : run away from the current threat. Optional "target": [x, y, z] as the escape destination.
- "eat"      : consume food from the inventory (use "item_to_use" if you want a specific food).
- "farm"     : harvest a fully grown crop OR plant seeds on empty farmland. "target": [x, y, z] of the crop/farmland block.
- "goto"     : walk to "target": [x, y, z] (use when you want to reach a known location).
- "idle"     : do nothing this turn (only when nothing useful can be done).

Decision rules:
1. Survival beats everything. If health <= 30% (6/20), prefer "eat" (when food is available) or "flee". If a creeper is within 3 blocks, move away instead of attacking.
2. If an aggressive entity is within 10 blocks and health > 30%, prefer "attack" the closest one.
3. Never attack passive mobs unless the state says food is needed and no food is in the inventory.
4. When the current task is mining, pick the most valuable ore (diamond > emerald > gold > iron > copper > coal > redstone) that is reachable, and only mine when a suitable pickaxe is in the inventory. Warn (in "thought") when the pickaxe is nearly broken.
5. When the current task is farming, harvest crops whose age equals maxAge first, then plant seeds on empty farmland when "wheat_seeds" (or another seed) is in the inventory.
6. Do not repeat an action that has failed in the last turns ("Recent actions"). Try a different target or a different action instead.
7. Never invent coordinates or entity ids. Use only values from the current state.

JSON Output format (all keys allowed, only "thought" and "action" are required):
{
  "thought": "Brief explanation of your logic (max 25 words)",
  "action": "action_name",
  "target": [x, y, z] or <entity_id> or null,
  "item_to_use": "item_name" or null,
  "duration_ms": 5000
}`

export const TASK_PROMPTS = {
  fight: `Current Task Priority: Fighting.
Focus: defend yourself. Prefer attacking the closest aggressive entity; if health is critically low or a creeper is adjacent, flee or eat instead. Keep ~2-3 blocks distance from the target.`,
  mine: `Current Task Priority: Mining.
Focus: collect resources. Choose ONE ore/log block from the state as "target". Do not worry about walking there — the pathfinder handles movement. If your pickaxe durability is low, mention it in "thought" and prefer a different tool or a different block.`,
  farm: `Current Task Priority: Farming.
Focus: harvest fully grown crops (age == maxAge) first, then plant seeds on empty farmland (blocks.farmland entries with "empty": true) when seeds are in the inventory. Work one block at a time.`,
  survive: `Current Task Priority: Surviving.
Focus: stay alive. Only eat, flee, or move to a safe place. Do not start long tasks.`,
  explore: `Current Task Priority: Exploring.
Focus: reveal the map and find resources. Wander in one direction for a few seconds, then re-evaluate.`
}

const fmtPos = (p) => `[${p.x}, ${p.y}, ${p.z}]`
const fmtDura = (d) => (d ? `durability ${d.max - (d.used ?? 0)}/${d.max}` : null)
const itemLine = (it) => [
  `${it.name} x${it.count} (slot ${it.slot}${it.durability ? `, durability ${it.durability.left}/${it.durability.max}` : ''})`
].join('')

/**
 * Susun user prompt: state dalam bahasa manusia (mudah dibaca LLM) + blok JSON
 * mentah (mesin) — persis pola "Current State: ... Decide next action.".
 */
export function buildUserPrompt (state) {
  const lines = []
  const s = state

  lines.push('Current State:')
  lines.push(`Position: ${fmtPos(s.position)} · dimension ${s.dimension} · ${s.time.label} (timeOfDay ${s.time.timeOfDay}) · gameMode ${s.gameMode}`)
  lines.push(`Health: ${s.health.value}/20 (${s.health.pct}%). Hunger: ${s.food.value}/20 (${s.food.pct}%). Oxygen: ${s.oxygen.value}/20.`)
  if (s.heldItem) lines.push(`Held item: ${s.heldItem.name} x${s.heldItem.count}`)

  lines.push(`Inventory: [${s.inventory.items.length ? s.inventory.items.map(itemLine).join(', ') : 'empty'}]`)
  if (s.tools.length) lines.push(`Tool durability: [${s.tools.map(t => `${t.name} ${t.pct !== undefined ? `${t.left}/${t.max}` : 'n/a'}`).join(', ')}]`)

  if (s.entities.length) {
    lines.push('Nearby Entities:')
    for (const e of s.entities.slice(0, 8)) {
      lines.push(`  - id ${e.id} · ${e.name} · ${e.distance} blocks · Intent: ${e.intent}${e.hostile ? ' · THREAT' : ''}${e.heldItem ? ` · holding ${e.heldItem}` : ''}`)
    }
  } else {
    lines.push('Nearby Entities: none')
  }

  const blockList = [...s.blocks.ores, ...s.blocks.logs, ...s.blocks.crops, ...s.blocks.farmland].slice(0, 10)
  if (blockList.length) {
    lines.push('Nearby Blocks of Interest:')
    for (const b of blockList) {
      const extra = b.age !== undefined
        ? ` (age: ${b.age}/${b.maxAge}${b.ready ? ' - ready to harvest' : ' - growing'})`
        : b.name === 'farmland' ? (b.empty ? ' (empty - ready to plant)' : ' (occupied)') : ''
      lines.push(`  - ${b.name} at [${b.pos.join(', ')}] (distance: ${b.distance} blocks)${extra}`)
    }
  } else {
    lines.push('Nearby Blocks of Interest: none detected')
  }

  if (s.notes.length) lines.push(`Notes: ${s.notes.join(' | ')}`)

  if (s.history.length) {
    lines.push('Recent actions:')
    for (const h of s.history) {
      lines.push(`  - ${h.action}${h.target ? ` → ${JSON.stringify(h.target)}` : ''} ⇒ ${h.result}`)
    }
  }

  if (s.task?.objective) {
    lines.push(`Current objective: ${s.task.objective.kind}${s.task.objective.target ? ` ${s.task.objective.target}` : ''} (progress ${s.task.objective.progress ?? 0}/${s.task.objective.count ?? '?'})`)
  }
  lines.push(TASK_PROMPTS[s.task?.current] || `Current Task Priority: ${s.task?.current || 'Auto'}.`)

  lines.push('')
  lines.push('Decide the next action.')
  lines.push(`STATE_JSON: ${JSON.stringify(compactState(s))}`)
  lines.push('Respond with JSON only.')

  return lines.join('\n')
}

/** Versi state yang dipadatkan supaya tidak memakan token berlebihan. */
export function compactState (s) {
  return {
    position: [s.position.x, s.position.y, s.position.z],
    health: s.health.value,
    food: s.food.value,
    oxygen: s.oxygen.value,
    time: s.time.label,
    dimension: s.dimension,
    held: s.heldItem?.name ?? null,
    inventory: Object.entries(s.inventory.counts).map(([name, count]) => `${name}x${count}`),
    tools: s.tools.map(t => (t.pct !== undefined ? `${t.name}:${t.left}/${t.max}` : t.name)),
    weapon: s.bestWeapon?.name ?? null,
    food_item: s.bestFood?.name ?? null,
    entities: s.entities.slice(0, 8).map(e => ({ id: e.id, name: e.name, d: e.distance, intent: e.intent })),
    ores: s.blocks.ores.slice(0, 6).map(b => ({ name: b.name, pos: b.pos, d: b.distance })),
    crops: s.blocks.crops.slice(0, 6).map(b => ({ name: b.name, pos: b.pos, age: b.age, max: b.maxAge })),
    farmland_empty: s.blocks.farmland.filter(b => b.empty).slice(0, 4).map(b => b.pos),
    logs: s.blocks.logs.slice(0, 3).map(b => b.pos),
    task: s.task.current,
    objective: s.task.objective ? `${s.task.objective.kind}${s.task.objective.target ? ':' + s.task.objective.target : ''} ${s.task.objective.progress || 0}/${s.task.objective.count || 0}` : null,
    notes: s.notes
  }
}

/** Prompt khusus untuk "reaksi cepat" ketika bot diserang (opsional, hemat token). */
export function buildReactivePrompt (state) {
  return [
    'THREAT REACTION — decide immediately.',
    `Health ${state.health.value}/20, hunger ${state.food.value}/20.`,
    `Threats: ${state.threats.hostiles.slice(0, 3).map(e => `${e.name}(id ${e.id}, ${e.distance}b)`).join(', ') || 'none'}`,
    `Weapon: ${state.bestWeapon?.name || 'none'}. Food: ${state.bestFood?.name || 'none'}.`,
    'Respond with JSON only.'
  ].join('\n')
}
