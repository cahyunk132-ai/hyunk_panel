#!/usr/bin/env node
/**
 * DASHBOARD — halaman web kecil untuk memantau admin_gabut secara live.
 *
 * Membaca `mcbot/logs/trace.jsonl` (yang ditulis bot) dan menyajikannya sebagai:
 *   - status bot (HP, hunger, posisi, task, objective)
 *   - aliran keputusan otak + aksi + hasilnya
 *   - tombol skenario uji (spawn zombie, tanam bijih, ladang, PvP)
 *
 * Tujuannya: "debugging langsung dari sistem" tanpa harus menempel di console.
 *
 *   node dev-server/dashboard.mjs --port 8090
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}
const PORT = Number(flag('port', process.env.DASH_PORT || 8090))
const TRACE = flag('trace', process.env.TRACE_FILE || path.join(ROOT, 'logs', 'trace.jsonl'))
const MC_PORT = Number(flag('mc-port', process.env.DEV_PORT || 25565))

const SCENARIOS = ['attack', 'mine', 'farm', 'pvp', 'stress']

/** Baca N baris terakhir file trace (tanpa membaca seluruh file). */
function tailTrace (lines = 400) {
  try {
    const stat = fs.statSync(TRACE)
    const size = Math.min(stat.size, 512 * 1024)
    const fd = fs.openSync(TRACE, 'r')
    const buf = Buffer.alloc(size)
    fs.readSync(fd, buf, 0, size, stat.size - size)
    fs.closeSync(fd)
    const text = buf.toString('utf8')
    const parts = text.split('\n')
    if (size < stat.size) parts.shift() // baris pertama mungkin terpotong
    return parts.filter(Boolean).slice(-lines).map(l => { try { return JSON.parse(l) } catch { return { type: 'raw', line: l } } })
  } catch {
    return []
  }
}

function summarize () {
  const events = tailTrace(600)
  const lastObserve = [...events].reverse().find(e => e.type === 'observe')
  const lastDecision = [...events].reverse().find(e => e.type === 'decision')
  const lastCycle = [...events].reverse().find(e => e.type === 'cycle')
  const lastDeath = [...events].reverse().find(e => e.type === 'death')
  const lastStart = [...events].reverse().find(e => e.type === 'loop-start')
  const last = events[events.length - 1]
  const ageMs = last ? Date.now() - Date.parse(last.t) : null
  return {
    alive: ageMs !== null && ageMs < 20000,
    lastEventAgoMs: ageMs,
    observe: lastObserve?.summary || null,
    decision: lastDecision?.decision || null,
    decisionMeta: lastDecision ? { source: lastDecision.source, latencyMs: lastDecision.latencyMs, model: lastDecision.model } : null,
    cycle: lastCycle ? { task: lastCycle.task, objective: lastCycle.objective, result: lastCycle.result } : null,
    deaths: events.filter(e => e.type === 'death').length,
    startedAt: lastStart?.t || null,
    actions: events.filter(e => e.type === 'action').length,
    recent: events.filter(e => ['decision', 'result', 'warn', 'error', 'guard', 'objective-done'].includes(e.type)).slice(-25).reverse()
  }
}

const page = (state) => `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>admin_gabut · HYUNK DEV</title>
<style>
 :root { color-scheme: dark }
 body { margin:0; background:#0b0f14; color:#d7e2ea; font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace }
 header { padding:14px 18px; border-bottom:1px solid #1b2733; display:flex; gap:14px; align-items:center; flex-wrap:wrap }
 h1 { font-size:15px; margin:0; letter-spacing:.5px }
 .dot { width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:6px }
 .on { background:#39d353; box-shadow:0 0 8px #39d35388 } .off { background:#f85149 }
 .muted { color:#7d8f9c } .grid { display:grid; grid-template-columns:minmax(280px,1fr) 2fr; gap:0 }
 .col { padding:14px 18px; border-right:1px solid #1b2733 } .col:last-child { border-right:0 }
 .k { color:#7d8f9c } .v { color:#e6f1ff }
 .card { background:#111823; border:1px solid #1b2733; border-radius:8px; padding:10px 12px; margin-bottom:10px }
 .act { color:#7ee787 } .th { color:#a5d6ff } .warn { color:#e3b341 } .err { color:#ff7b72 } .task { color:#d2a8ff }
 button { background:#1f6feb; border:0; color:#fff; padding:7px 11px; border-radius:6px; margin:0 6px 6px 0; cursor:pointer; font:inherit }
 button.alt { background:#21262d } button:hover { filter:brightness(1.15) }
 pre { white-space:pre-wrap; word-break:break-word; margin:0 }
 .row { display:flex; justify-content:space-between; gap:12px; padding:3px 0; border-bottom:1px dashed #1b2733 }
 code { color:#79c0ff }
</style></head>
<body>
<header>
  <h1>admin_gabut<span class="muted"> · HYUNK AI bot (OODA)</span></h1>
  <span><span class="dot ${state.alive ? 'on' : 'off'}"></span>${state.alive ? 'loop hidup' : 'tidak ada aktivitas'}</span>
  <span class="muted">event terakhir ${state.lastEventAgoMs !== null ? (state.lastEventAgoMs / 1000).toFixed(1) + 's lalu' : '-'}</span>
  <span class="muted">MC server 127.0.0.1:${MC_PORT} (cracked/offline)</span>
</header>
<div class="grid">
  <div class="col">
    <div class="card">
      <div class="row"><span class="k">state</span><span class="v">${state.observe || 'belum ada observasi'}</span></div>
      <div class="row"><span class="k">objective</span><span class="v">${state.cycle?.objective ? `${state.cycle.objective.kind} ${state.cycle.objective.target || ''} ${state.cycle.objective.progress || 0}/${state.cycle.objective.count || 0}` : '-'}</span></div>
      <div class="row"><span class="k">keputusan terakhir</span><span class="task">${state.decision?.action || '-'}</span></div>
      <div class="row"><span class="k">thought</span><span class="th">${state.decision?.thought || '-'}</span></div>
      <div class="row"><span class="k">otak</span><span class="v">${state.decisionMeta?.source || '-'}${state.decisionMeta?.model ? ' · ' + state.decisionMeta.model : ''}${state.decisionMeta?.latencyMs ? ' · ' + state.decisionMeta.latencyMs + 'ms' : ''}</span></div>
      <div class="row"><span class="k">hasil</span><span class="v">${state.cycle?.result?.detail || '-'}</span></div>
      <div class="row"><span class="k">total aksi / mati</span><span class="v">${state.actions} / ${state.deaths}</span></div>
      <div class="row"><span class="k">mulai</span><span class="v">${state.startedAt || '-'}</span></div>
    </div>
    <div class="card">
      <b>Skenario uji</b><div class="muted" style="margin:6px 0">kirim ke dev server (director masuk sebagai pemain kedua)</div>
      ${SCENARIOS.map(s => `<button onclick="run('${s}')">${s}</button>`).join('')}
      <div id="scenarioOut" class="muted" style="margin-top:8px"></div>
    </div>
    <div class="card">
      <b>Alur terbaru</b>
      <pre>${state.recent.map(e => {
        const t = (e.t || '').slice(11, 19)
        if (e.type === 'decision') return `${t} <span class="task">decide</span> ${e.decision?.action} <span class="th">${(e.decision?.thought || '').replace(/</g, '&lt;')}</span>`
        if (e.type === 'result') return `${t} <span class="act">result</span> ${(e.desc || '').replace(/</g, '&lt;')}`
        if (e.type === 'warn') return `${t} <span class="warn">warn  </span> ${(e.msg || '').replace(/</g, '&lt;')}`
        if (e.type === 'error') return `${t} <span class="err">error </span> ${(e.msg || '').replace(/</g, '&lt;')}`
        if (e.type === 'objective-done') return `${t} <span class="act">goal  </span> ${JSON.stringify(e.objective)}`
        return `${t} ${e.type}`
      }).join('\n')}</pre>
    </div>
  </div>
  <div class="col">
    <div class="card">
      <b>Trace mentah</b> <span class="muted">logs/trace.jsonl · auto-refresh 3s</span>
      <div id="trace" style="max-height:70vh;overflow:auto;margin-top:8px"></div>
    </div>
  </div>
</div>
<script>
async function refresh () {
  const r = await fetch('/api/trace?n=120'); const data = await r.json()
  document.getElementById('trace').innerHTML = data.events.map(e => {
    const t = (e.t || '').slice(11, 23)
    const color = e.type === 'decision' ? 'task' : e.type === 'action' ? 'act' : e.type === 'error' ? 'err' : e.type === 'warn' ? 'warn' : 'k'
    const body = JSON.stringify(e).slice(0, 400).replace(/</g, '&lt;')
    return '<div class="row"><span class="muted">' + t + '</span><span class="' + color + '">' + body + '</span></div>'
  }).join('')
}
async function run (name) {
  const out = document.getElementById('scenarioOut')
  out.textContent = 'menjalankan skenario ' + name + '…'
  const r = await fetch('/api/scenario?name=' + name, { method: 'POST' })
  const data = await r.json()
  out.textContent = data.message
}
refresh(); setInterval(() => location.reload(), 6000); setInterval(refresh, 3000)
</script>
</body></html>`

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const json = (code, obj) => {
    const body = JSON.stringify(obj)
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(body)
  }

  if (url.pathname === '/') {
    const html = page(summarize())
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(html)
  }
  if (url.pathname === '/api/state') return json(200, summarize())
  if (url.pathname === '/api/trace') {
    const n = Math.min(Number(url.searchParams.get('n') || 100), 1000)
    return json(200, { trace: TRACE, events: tailTrace(n) })
  }
  if (url.pathname === '/api/scenario' && req.method === 'POST') {
    const name = url.searchParams.get('name') || ''
    if (!SCENARIOS.includes(name)) return json(400, { message: `skenario tidak dikenal: ${name}` })
    const child = spawn(process.execPath, [path.join(ROOT, 'dev-server', 'director.mjs'), name], {
      cwd: ROOT,
      env: { ...process.env, MC_SERVER: `127.0.0.1:${MC_PORT}` },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    child.on('exit', (code) => console.log(`[dashboard] scenario ${name} selesai (exit ${code})\n${out.slice(-2000)}`))
    return json(200, { message: `skenario "${name}" dijalankan (director masuk ke server)… lihat alur di panel kiri` })
  }
  json(404, { message: 'not found' })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[dashboard] http://0.0.0.0:${PORT}  (trace: ${TRACE})`)
})
