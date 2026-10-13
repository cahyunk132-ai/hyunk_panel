#!/usr/bin/env node
/**
 * MOCK GROQ — server HTTP yang meniru endpoint OpenAI-compatible milik Groq.
 *
 * Gunanya: menguji/mendebug jalur HTTP+JSON bot tanpa internet dan tanpa
 * membakar kuota Groq. Policy-nya deterministik (cermin dari brain/heuristic)
 * sehingga hasilnya bisa diprediksi, dan bisa sengaja dibuat rusak untuk
 * menguji retry / fallback / normalisasi JSON.
 *
 * Jalankan:
 *   node dev-server/mock-groq.mjs --port 8787 [--fail-rate 0.2] [--bad-json 0.1] [--latency 120]
 * Lalu arahkan bot ke sini:
 *   GROQ_BASE_URL=http://127.0.0.1:8787/openai/v1 GROQ_API_KEY=mock BRAIN=groq npm run dev:bot
 */
import http from 'node:http'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}
const PORT = Number(flag('port', process.env.MOCK_PORT || 8787))
const FAIL_RATE = Number(flag('fail-rate', process.env.MOCK_FAIL_RATE || 0))
const BAD_JSON = Number(flag('bad-json', process.env.MOCK_BAD_JSON || 0))
const LATENCY = Number(flag('latency', process.env.MOCK_LATENCY || 120))
const MODEL = flag('model', 'mock-groq-1')

const ORE_VALUE = [['diamond', 100], ['emerald', 95], ['gold', 80], ['iron', 70], ['copper', 55], ['redstone', 45], ['lapis', 42], ['coal', 30]]
const oreScore = (name) => (ORE_VALUE.find(([k]) => name.includes(k))?.[1] ?? 10)

/** Policy deterministik: aturan yang sama dengan heuristic brain. */
function policy (state, taskPriority) {
  const hp = state.health?.value ?? 20
  const food = state.food?.value ?? 20
  const ents = state.entities || []
  const threat = ents.filter(e => e.intent === 'aggressive').sort((a, b) => a.distance - b.distance)[0]
  const hasFood = !!state.food_item
  const ores = (state.ores || []).slice().sort((a, b) => oreScore(b.name) - oreScore(a.name) || a.d - b.d)
  const crops = state.crops || []
  const ready = crops.filter(c => c.age >= c.max)
  const emptyFarmland = state.farmland_empty || []
  const seeds = (state.inventory || []).find(i => /seeds|carrot|potato/.test(i))
  const hasPickaxe = (state.tools || []).some(t => /pickaxe/.test(t))
  const task = String(taskPriority || '').toLowerCase()

  if (hp <= 6 && hasFood) return { thought: `mock: hp ${hp} low, eating`, action: 'eat', target: null, item_to_use: state.food_item }
  if (hp <= 6 && threat) return { thought: `mock: hp ${hp} and ${threat.name} near, fleeing`, action: 'flee', target: null }
  if (threat && threat.distance <= 10) return { thought: `mock: ${threat.name} within ${threat.distance} blocks — attacking`, action: 'attack', target: threat.id }
  if (food <= 14 && hasFood) return { thought: `mock: hunger ${food}, eating`, action: 'eat', target: null, item_to_use: state.food_item }

  // Prioritas pertanian: panen yang siap, lalu tanam di lahan kosong.
  if (task === 'farm' || task === 'farming') {
    if (ready.length) return { thought: 'mock: harvesting ready crop', action: 'farm', target: ready[0].pos }
    if (emptyFarmland.length && seeds) {
      return { thought: 'mock: planting seeds on empty farmland', action: 'farm', target: emptyFarmland[0], item_to_use: seeds.replace(/x\d+$/, '') }
    }
    return { thought: 'mock: farm task but nothing ripe here — scouting', action: 'explore', target: null, duration_ms: 6000 }
  }
  // Panen selalu layak dilakukan kalau ada yang matang (tugas apa pun).
  if (ready.length && task !== 'fight') return { thought: 'mock: taking ripe crop on the way', action: 'farm', target: ready[0].pos }
  // Menambang hanya kalau ada pickaxe — kalau tidak, jangan buang waktu.
  if (ores.length && hasPickaxe) return { thought: `mock: mining ${ores[0].name}`, action: 'mine', target: ores[0].pos }
  return { thought: 'mock: nothing visible, exploring', action: 'explore', target: null, duration_ms: 6000 }
}

function extractState (body) {
  const user = [...(body.messages || [])].reverse().find(m => m.role === 'user')?.content || ''
  const match = user.match(/STATE_JSON: (\{.*\})/s)
  if (match) {
    try { return JSON.parse(match[1]) } catch { /* fallthrough */ }
  }
  // Prompt reaktif (tanpa STATE_JSON): ambil angka sederhana
  const hp = Number(user.match(/Health (\d+)\/20/)?.[1] ?? 20)
  const food = Number(user.match(/hunger (\d+)\/20/)?.[1] ?? 20)
  const threatMatch = user.match(/Threats: (.+)/)?.[1]
  const id = threatMatch?.match(/id (\d+)/)?.[1]
  return {
    health: { value: hp },
    food: { value: food },
    task: 'Survive',
    entities: id ? [{ id: Number(id), name: 'threat', distance: 3, intent: 'aggressive' }] : [],
    inventory: [], ores: [], crops: [], farmland_empty: []
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const send = (code, obj) => {
    const payload = JSON.stringify(obj)
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
    res.end(payload)
  }

  if (req.method === 'GET' && url.pathname.endsWith('/models')) {
    return send(200, { object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'mock' }, { id: 'mock-groq-2', object: 'model', owned_by: 'mock' }] })
  }

  if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
    let raw = ''
    for await (const chunk of req) raw += chunk
    let body
    try { body = JSON.parse(raw) } catch { return send(400, { error: { message: 'invalid JSON body' } }) }

    if (Math.random() < FAIL_RATE) {
      console.log(`[mock-groq] injected 503 for ${body.model}`)
      return send(503, { error: { message: 'simulated upstream failure' } })
    }

    const state = extractState(body)
    // Tugas dibaca dari STATE_JSON (paling andal). Regex hanya cadangan dan
    // harus mengambil kecocokan TERAKHIR — system prompt juga memuat contoh
    // kalimat "Task Priority: ..." sehingga match pertama bisa menyesatkan.
    const allText = body.messages?.map(m => m.content).join('\n') || ''
    const matches = [...allText.matchAll(/Task Priority: (\w+)/g)]
    const taskPriority = state.task || matches[matches.length - 1]?.[1] || 'Auto'
    const decision = policy(state, taskPriority)

    await new Promise(r => setTimeout(r, LATENCY))

    let content = JSON.stringify(decision)
    if (Math.random() < BAD_JSON) {
      content = '```json\n' + content.slice(0, 20) + ', broken json\n```' // JSON rusak → uji fallback/normalisasi
      console.log('[mock-groq] injected malformed JSON')
    }

    console.log(`[mock-groq] ${body.model} → ${decision.action}${decision.target ? ' ' + JSON.stringify(decision.target) : ''}`)
    return send(200, {
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model || MODEL,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: Math.round(raw.length / 4), completion_tokens: Math.round(content.length / 4), total_tokens: Math.round((raw.length + content.length) / 4) }
    })
  }

  send(404, { error: { message: `mock-groq: no route ${req.method} ${url.pathname}` } })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mock-groq] listening on http://0.0.0.0:${PORT}/openai/v1 (fail-rate ${FAIL_RATE}, bad-json ${BAD_JSON}, latency ${LATENCY}ms)`)
  console.log('[mock-groq] pakai: GROQ_BASE_URL=http://127.0.0.1:%d/openai/v1 GROQ_API_KEY=mock BRAIN=groq', PORT)
})
