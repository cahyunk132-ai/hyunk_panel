#!/usr/bin/env node
/**
 * SELFTEST — uji otak & kontrak JSON tanpa server dan tanpa internet.
 *
 *   npm run selftest
 *
 * Yang diuji:
 *   1. heuristic brain memberi aksi yang benar untuk 4 situasi klasik
 *      (bertarung, menambang, bertani, darurat)
 *   2. normalisasi output LLM: JSON rusak / action tidak dikenal / target
 *      hilang → selalu jatuh ke aksi yang aman, bukan crash
 *   3. prompt benar-benar memuat konteks yang dibutuhkan Groq
 */
import assert from 'node:assert/strict'
import { decideHeuristic } from '../src/brain/heuristic.mjs'
import { normalizeDecision } from '../src/brain/index.mjs'
import { buildUserPrompt, compactState, SYSTEM_PROMPT, ACTIONS } from '../src/prompts.mjs'
import { summarize } from '../src/observe.mjs'

let passed = 0
const failures = []

function test (name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✔ ${name}`)
  } catch (err) {
    failures.push({ name, error: err.message })
    console.log(`  ✘ ${name}\n      ${err.message}`)
  }
}

/** State tiruan; bentuknya persis seperti hasil observe(). */
function makeState (overrides = {}) {
  const base = {
    ts: new Date().toISOString(),
    bot: { name: 'admin_gabut', version: '1.21.4', alive: true },
    position: { x: 120, y: -54, z: 88 },
    health: { value: 20, max: 20, pct: 100 },
    food: { value: 20, max: 20, pct: 100 },
    oxygen: { value: 20, max: 20, pct: 100 },
    time: { timeOfDay: 6000, isDay: true, label: 'day' },
    dimension: 'overworld',
    gameMode: 'survival',
    onGround: true,
    inWater: false,
    heldItem: { name: 'iron_pickaxe', count: 1 },
    inventory: {
      items: [
        { name: 'iron_sword', count: 1, slot: 36 },
        { name: 'baked_potato', count: 2, slot: 37 },
        { name: 'iron_pickaxe', count: 1, slot: 38, durability: { used: 30, max: 250, left: 220, pct: 0.88, } },
        { name: 'wheat_seeds', count: 14, slot: 39 }
      ],
      counts: { iron_sword: 1, baked_potato: 2, iron_pickaxe: 1, wheat_seeds: 14 }
    },
    tools: [{ name: 'iron_pickaxe', used: 30, max: 250, left: 220, pct: 0.88 }],
    bestWeapon: { name: 'iron_sword', slot: 36, durability: null },
    bestFood: { name: 'baked_potato', count: 2, points: 5 },
    entities: [],
    threats: { hostiles: [], nearest: null, count: 0, creeperClose: null },
    blocks: { ores: [], crops: [], farmland: [], logs: [], stations: [] },
    hazards: { nearby: null },
    task: { current: 'mine', objective: { kind: 'mine', target: 'diamond_ore', count: 4, progress: 0 } },
    history: [],
    notes: []
  }
  const merged = { ...base, ...overrides }
  if (overrides.threats) merged.threats = { ...base.threats, ...overrides.threats }
  if (overrides.blocks) merged.blocks = { ...base.blocks, ...overrides.blocks }
  if (overrides.task) merged.task = { ...base.task, ...overrides.task }
  return merged
}

console.log('\n1) heuristic brain — aturan sesuai desain')
test('HP rendah + lapar + ada makanan → eat', () => {
  const d = decideHeuristic(makeState({
    health: { value: 5, max: 20, pct: 25 },
    food: { value: 14, max: 20, pct: 70 }
  }))
  assert.equal(d.action, 'eat')
  assert.equal(d.item_to_use, 'baked_potato')
})
test('HP rendah + hunger penuh → idle (regen alami, makan tidak mungkin)', () => {
  const d = decideHeuristic(makeState({ health: { value: 5, max: 20, pct: 25 } }))
  assert.equal(d.action, 'idle')
})
test('HP rendah + musuh dekat + tidak ada makanan → flee', () => {
  const state = makeState({
    health: { value: 4, max: 20, pct: 20 },
    bestFood: null,
    inventory: { items: [], counts: {} },
    entities: [{ id: 45, name: 'zombie', type: 'mob', intent: 'aggressive', hostile: true, distance: 3 }],
    threats: { nearest: { id: 45, name: 'zombie', distance: 3, intent: 'aggressive' }, hostiles: [{ id: 45, name: 'zombie', distance: 3 }], count: 1, creeperClose: null }
  })
  assert.equal(decideHeuristic(state).action, 'flee')
})
test('musuh agresif dalam 10 blok + HP aman → attack (target = entity id)', () => {
  const state = makeState({
    task: { current: 'fight', objective: null },
    entities: [{ id: 45, name: 'zombie', type: 'mob', intent: 'aggressive', hostile: true, distance: 3 }],
    threats: { nearest: { id: 45, name: 'zombie', distance: 3, intent: 'aggressive' }, hostiles: [{ id: 45, name: 'zombie', distance: 3 }], count: 1, creeperClose: null }
  })
  const d = decideHeuristic(state)
  assert.equal(d.action, 'attack')
  assert.equal(d.target, 45)
})
test('creeper ≤3 blok → flee (jangan mendekat)', () => {
  const state = makeState({
    entities: [{ id: 48, name: 'creeper', type: 'mob', intent: 'aggressive', hostile: true, distance: 2.5 }],
    threats: {
      nearest: { id: 48, name: 'creeper', distance: 2.5, intent: 'aggressive' },
      hostiles: [{ id: 48, name: 'creeper', distance: 2.5 }],
      count: 1,
      creeperClose: { id: 48, name: 'creeper', distance: 2.5 }
    }
  })
  assert.equal(decideHeuristic(state).action, 'flee')
})
test('task mining + ada diamond → mine diamond (bukan coal)', () => {
  const state = makeState({
    blocks: {
      ores: [
        { name: 'coal_ore', pos: [121, -55, 90], distance: 2 },
        { name: 'diamond_ore', pos: [120, -54, 88], distance: 4 }
      ],
      crops: [], farmland: [], logs: [], stations: []
    }
  })
  const d = decideHeuristic(state)
  assert.equal(d.action, 'mine')
  assert.deepEqual(d.target, [120, -54, 88])
})
test('task farming + ada gandum age 7 → farm (harvest)', () => {
  const state = makeState({
    task: { current: 'farm', objective: { kind: 'farm', count: 8, progress: 0 } },
    blocks: {
      ores: [], logs: [], farmland: [], stations: [],
      crops: [
        { name: 'wheat', pos: [10, 64, 10], distance: 2, age: 7, maxAge: 7, ready: true },
        { name: 'wheat', pos: [11, 64, 10], distance: 3, age: 3, maxAge: 7, ready: false }
      ]
    }
  })
  const d = decideHeuristic(state)
  assert.equal(d.action, 'farm')
  assert.deepEqual(d.target, [10, 64, 10])
})
test('task farming + tidak ada tanaman matang + ada benih → plant di farmland kosong', () => {
  const state = makeState({
    task: { current: 'farm', objective: { kind: 'farm', count: 8, progress: 0 } },
    blocks: {
      ores: [], logs: [], crops: [], stations: [],
      farmland: [{ name: 'farmland', pos: [12, 64, 10], distance: 2, empty: true }]
    }
  })
  const d = decideHeuristic(state)
  assert.equal(d.action, 'farm')
  assert.deepEqual(d.target, [12, 64, 10])
  assert.equal(d.item_to_use, 'wheat_seeds')
})
test('lava di sekitar → flee (darurat lingkungan)', () => {
  const state = makeState({ hazards: { nearby: { type: 'lava', pos: [120, -55, 88] } } })
  assert.equal(decideHeuristic(state).action, 'flee')
})
test('lapar (food ≤ lowFood) + ada makanan → eat', () => {
  const state = makeState({ food: { value: 12, max: 20, pct: 60 } })
  const d = decideHeuristic(state)
  assert.equal(d.action, 'eat')
})

console.log('\n2) normalisasi output LLM — tidak boleh membuat bot macet')
const actionSet = new Set(ACTIONS)
test('JSON valid diteruskan apa adanya', () => {
  const state = makeState()
  const { decision, problems } = normalizeDecision({
    thought: 'mine the diamond', action: 'mine', target: [120, -54, 88], item_to_use: 'iron_pickaxe'
  }, state)
  assert.equal(decision.action, 'mine')
  assert.deepEqual(decision.target, [120, -54, 88])
  assert.equal(problems.length, 0)
})
test('action alias (mine_block, kill, harvest) dipetakan', () => {
  const state = makeState()
  assert.equal(normalizeDecision({ action: 'mine_block', target: [1, 2, 3] }, state).decision.action, 'mine')
  assert.equal(normalizeDecision({ action: 'harvest', target: [1, 2, 3] }, state).decision.action, 'farm')
  const withEntity = makeState({ entities: [{ id: 7, name: 'zombie', distance: 2, intent: 'aggressive' }] })
  assert.equal(normalizeDecision({ action: 'kill', target: 7 }, withEntity).decision.action, 'attack')
})
test('action tidak dikenal → decision null (fallback ke heuristic)', () => {
  const { decision, problems } = normalizeDecision({ action: 'dance', target: [1, 2, 3] }, makeState())
  assert.equal(decision, null)
  assert.match(problems.join(' '), /unknown action/)
})
test('attack ke entity yang tidak ada di state → ditolak', () => {
  const { decision, problems } = normalizeDecision({ action: 'attack', target: 999 }, makeState())
  assert.equal(decision, null)
  assert.match(problems.join(' '), /not in the current state/)
})
test('mine tanpa target → ditolak', () => {
  const { decision } = normalizeDecision({ action: 'mine' }, makeState())
  assert.equal(decision, null)
})
test('target string "[120, -54, 88]" tetap bisa diparse', () => {
  const { decision } = normalizeDecision({ action: 'goto', target: '[120, -54, 88]' }, makeState())
  assert.deepEqual(decision.target, [120, -54, 88])
})
test('eat item yang tidak ada → ganti ke makanan yang dimiliki', () => {
  const { decision, problems } = normalizeDecision({ action: 'eat', item_to_use: 'golden_apple' }, makeState())
  assert.equal(decision.item_to_use, 'baked_potato')
  assert.match(problems.join(' '), /golden_apple/)
})
test('duration_ms dijepit ke rentang aman', () => {
  const { decision } = normalizeDecision({ action: 'explore', duration_ms: 999999 }, makeState())
  assert.equal(decision.duration_ms, 20000)
})
test('response bukan objek → ditolak', () => {
  assert.equal(normalizeDecision('mine please', makeState()).decision, null)
  assert.equal(normalizeDecision(null, makeState()).decision, null)
})

console.log('\n3) prompt — konteks yang diterima Groq')
test('system prompt memuat seluruh action space + aturan JSON', () => {
  for (const action of ACTIONS) assert.ok(SYSTEM_PROMPT.includes(`"${action}"`), `aksi ${action} tidak ada di system prompt`)
  assert.match(SYSTEM_PROMPT, /ONLY in valid JSON/)
})
test('user prompt memuat health, inventory, entity, blok, task', () => {
  const state = makeState({
    task: { current: 'fight', objective: null },
    entities: [{ id: 45, name: 'zombie', type: 'mob', intent: 'aggressive', hostile: true, distance: 3 }],
    blocks: {
      ores: [{ name: 'diamond_ore', pos: [120, -54, 88], distance: 4 }],
      crops: [], farmland: [], logs: [], stations: []
    }
  })
  const prompt = buildUserPrompt(state)
  for (const needle of ['Health: 20/20', 'Hunger: 20/20', 'zombie', 'diamond_ore', 'Fighting', 'STATE_JSON', 'Respond with JSON only']) {
    assert.ok(prompt.includes(needle), `prompt tidak memuat "${needle}"`)
  }
})
test('compactState tidak membocorkan object besar & tetap informatif', () => {
  const state = makeState()
  const compact = compactState(state)
  assert.ok(Array.isArray(compact.position))
  assert.ok(compact.inventory.includes('iron_swordx1'))
  assert.ok(JSON.stringify(compact).length < 2000)
})
test('summarize() menghasilkan satu baris ringkas', () => {
  const line = summarize(makeState())
  assert.match(line, /pos\(120,-54,88\)/)
  assert.match(line, /hp 20\/20/)
})

console.log(`\n${failures.length ? '✘' : '✔'} selftest: ${passed} lulus, ${failures.length} gagal`)
if (failures.length) {
  for (const f of failures) console.log(`   - ${f.name}: ${f.error}`)
  process.exit(1)
}
