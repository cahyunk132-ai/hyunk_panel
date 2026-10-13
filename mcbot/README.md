# admin_gabut — AI Minecraft Bot (OODA + Groq)

Bot Minecraft yang **keputusan makronya diambil AI** (Groq), sedangkan **gerakan mikronya**
dijalankan script (Mineflayer + mineflayer-pathfinder). Termasuk **dev server Minecraft
cracked/offline** di folder ini supaya seluruh sistem bisa didebug end-to-end tanpa
menyentuh server produksi.

```
        ┌──────────────┐   state (JSON)   ┌──────────────┐   keputusan JSON   ┌──────────────┐
        │   OBSERVE    │ ───────────────► │  ORIENT +    │ ─────────────────► │     ACT      │
        │ observe.mjs  │                  │  DECIDE      │                    │ act/*.mjs    │
        │ hp, food,    │                  │ prompts.mjs  │                    │ bot.dig()    │
        │ inventory,   │                  │ brain/groq   │                    │ bot.attack() │
        │ blok, mob    │ ◄─────────────── │ brain/heur.  │ ◄───────────────── │ pathfinder   │
        └──────────────┘   hasil aksi     └──────────────┘   {ok, detail}     └──────────────┘
               ▲                                                                       │
               └────────────────────── server Minecraft (offline/cracked) ◄─────────────┘
```

Pembagian tugasnya sengaja tegas:

| Urusan | Siapa yang mengerjakan |
|---|---|
| "Sekarang menyerang, makan, atau menambang?" | **Groq** (LLM) |
| Hitung jalan ke koordinat, lompat, gali jembatan | **pathfinder** |
| Pilih pickaxe, cek durability, hitung cooldown serangan | **script** (`src/act/*`) |
| Nyawa kritis saat LLM salah pilih | **safety guard** (`src/loop.mjs`) |

---

## 1. Mulai cepat

```bash
cd mcbot
npm install

# A) Debug offline total (tanpa API key, tanpa internet) — semua jalan di laptop/sandbox
npm run dev:all                     # dev server (cracked) + bot + dashboard http://127.0.0.1:8090

# B) Uji jalur HTTP Groq tanpa internet/kuota (mock OpenAI-compatible)
npm run dev:all -- --mock

# C) Pakai Groq sungguhan
cp .env.example .env                # isi GROQ_API_KEY
npm run dev:all -- --brain groq --key gsk_xxx

# D) Serang server asli (mis. server panel Anda sendiri)
npm start -- --server play.wangstore.web.id:25565 --task auto
```

Dashboard live (juga tampil sebagai *live preview* di sandbox) ada di **http://127.0.0.1:8090**:
status HP/hunger/posisi, keputusan terakhir + `thought` dari AI, hasil aksinya, dan tombol
skenario uji (`attack`, `mine`, `farm`, `pvp`, `stress`).

> Perintah interaktif bot: tulis di console-nya (`task mine`, `state`, `stop`, `objectives`, `quit`)
> atau kirim di chat in-game dengan prefix: `!bot task farm`, `!bot where`, `!bot stop`.

---

## 2. Struktur

```
mcbot/
├── src/
│   ├── index.mjs          # entrypoint: connect, event, console, reconnect, auto-respawn
│   ├── loop.mjs           # OODA loop + safety guard + objective/task scheduler
│   ├── observe.mjs        # OBSERVE: dunia → state ringkas (JSON)
│   ├── prompts.mjs        # ORIENT: system prompt + user prompt per task
│   ├── config.mjs         # CLI flag + env + .env
│   ├── logger.mjs         # console enak dibaca + trace JSONL (buat dashboard)
│   ├── brain/
│   │   ├── index.mjs      # validasi/normalisasi JSON LLM + fallback
│   │   ├── groq.mjs       # klien Groq (JSON mode, retry, timeout, auto-pilih model)
│   │   └── heuristic.mjs  # otak rule-based (debug offline + fallback)
│   ├── act/
│   │   ├── index.mjs      # dispatcher 1 keputusan → 1 aksi
│   │   ├── moves.mjs      # goto / explore / flee (pathfinder)
│   │   ├── mine.mjs       # ambil 1 blok (tool + durability + pathfinding)
│   │   ├── fight.mjs      # attack (kejar + pukul) & eat
│   │   └── farm.mjs       # panen (age==maxAge) / tanam / garap tanah
│   └── util/              # items, blocks, entities (klasifikasi ancaman)
├── dev-server/
│   ├── server.mjs         # server MC lokal: cracked/offline, mob AI, perintah debug
│   ├── generator.cjs      # generator dunia: ore berlapis, gua+lava, pohon, ladang siap panen
│   ├── mock-groq.mjs      # mock endpoint OpenAI-compatible (uji HTTP + JSON rusak)
│   ├── director.mjs       # bot kedua: sutradara skenario (spawn zombie, tanam bijih, PvP)
│   ├── dashboard.mjs      # dashboard web (status + trace + tombol skenario)
│   └── stack.mjs          # jalankan semuanya dengan satu perintah
└── scripts/
    ├── selftest.mjs       # 23 asersi: otak, normalisasi JSON, prompt (tanpa server)
    └── smoke.mjs          # end-to-end: server + bot + loop + trace (opsional mock Groq)
```

---

## 3. Action space & kontrak JSON

LLM hanya boleh menjawab JSON (JSON mode Groq + validasi ulang di sisi script):

```json
{
  "thought": "Health is 10/20 and a zombie is 3 blocks away — drink/eat first",
  "action": "eat",
  "target": null,
  "item_to_use": "baked_potato",
  "duration_ms": 2000
}
```

| action | target | artinya |
|---|---|---|
| `mine` | `[x, y, z]` | ambil satu blok (script yang pilih tool et cek durability) |
| `attack` | `entity_id` (integer) | kejar + pukul entity sampai mati/lewat timeout |
| `farm` | `[x, y, z]` | panen crop matang, atau tanam benih di farmland kosong |
| `eat` | – | makan dari inventory |
| `flee` | `[x, y, z]` (opsional) | kabur dari ancaman/hazard |
| `goto` | `[x, y, z]` | jalan ke koordinat (pathfinding) |
| `explore` | – | jelajah untuk cari resource |
| `idle` | – | tidak melakukan apa-apa |

Alias umum tetap diterima (`kill`→`attack`, `harvest`/`plant`→`farm`, `mine_block`→`mine`,
`run`→`flee`, `walk`→`goto`, …). Output yang rusak **tidak pernah** membuat bot macet:

| Masalah dari LLM | Yang dilakukan bot |
|---|---|
| JSON dibungkus ``` atau ada teks tambahan | di-parse dengan ekstraktor toleran |
| `action` tidak dikenal | fallback ke otak heuristic (rule-based) |
| `target` entity tidak ada di state | ditolak → fallback |
| `mine`/`farm` tanpa koordinat | ditolak → fallback |
| timeout / 429 / 5xx | retry (backoff) → fallback heuristic |
| nama model tidak ada di Groq | `GET /models` lalu pilih model yang tersedia |

Semua kejadian itu tercatat di `logs/trace.jsonl` (`llm-rejected`, `warn`, `error`) sehingga
bisa diperiksa di dashboard.

### Safety guard (nyawa di atas tugas)

`src/loop.mjs` memeriksa kondisi **sebelum** otak dipanggil:

* HP ≤ 30% → `eat` (kalau ada makanan & hunger belum penuh) atau `flee`
* creeper ≤ 3 blok → `flee`
* berdiri di lava/api → `flee`
* oksigen ≤ 8 (tenggelam) → naik ke atas
* saat aksi panjang (mine/farm/explore/goto) berjalan dan musuh masuk radius 2,5 blok →
  aksi dibatalkan (`AbortController`) supaya loop bisa merespons

---

## 4. Dev server lokal (cracked / offline-mode)

`dev-server/server.mjs` memakai **flying-squid** (server Minecraft yang jalan di Node, tanpa
Java) sehingga bisa dijalankan di sandbox/container mana pun:

* `online-mode: false` → siapa pun bisa masuk dengan username apa saja (cracked/offline)
* versi default **1.21.4** (bisa diganti `--version`, mis. `1.20.2`)
* survival (bukan creative) supaya uji makan, HP, dan durability tool realistis
* generator dunia sendiri: ore berlapis kedalaman (coal→diamond + varian deepslate), gua
  dengan lava di dasar, pohon, **ladang gandum siap panen** dan **dinding bijih** dekat spawn
* mob sungguhan (zombie/skeleton/creeper/…) dengan AI sederhana: mengejar dalam 24 blok dan
  memukul 2 HP per detik — cukup untuk menguji `attack` / `flee` / `eat`

Perintah in-game (semua pemain otomatis OP di dev server):

| Perintah | Fungsi |
|---|---|
| `/kit [warrior\|miner\|farmer\|naked]` | beri item (palu, pedang, roti, benih, obor) |
| `/mob <nama> [jumlah] [hp]` | spawn mob di sekitar pemain |
| `/mobs`, `/clearmobs` | daftar / hapus mob |
| `/ore <blok> [jumlah]` | tanam bijih di depan pemain (target latihan mining) |
| `/farmhere` | bangun ladang kecil di sebelah pemain |
| `/heal`, `/feed`, `/where`, `/status`, `/devhelp` | utilitas debug |

Catatan: `--auto-mob <ms>` memunculkan zombie otomatis tiap N ms (default: mati),
`--kit-on-join` memberi kit otomatis saat pemain masuk, `--damage <n>` mengubah damage mob.

Direktor skenario (bot kedua yang menyiapkan kondisi uji):

```bash
npm run dev:director -- attack     # spawn zombie lalu biarkan bot bereaksi
npm run dev:director -- mine       # tanam bijih di dekat bot
npm run dev:director -- farm       # bangun ladang di dekat bot
npm run dev:director -- pvp        # director memukul bot (butuh PVP_MODE=1 di bot)
```

---

## 5. Testing

```bash
npm run selftest          # 23 asersi: logika otak, normalisasi JSON LLM, prompt (tanpa server)
npm run smoke             # end-to-end: dev server + bot + OODA loop + trace
npm run smoke -- --brain mock   # sekaligus menguji jalur HTTP + JSON Groq (mock lokal)
```

Hasil nyata dari smoke test di sandbox ini (otak heuristic):

```
  ✔ bot admin_gabut berhasil spawn di server cracked
  ✔ OODA loop menghasilkan ≥ 4 keputusan — 8 keputusan
  ✔ aksi benar-benar dieksekusi — 8 aksi
  ✔ ada aksi sukses (mine/explore/farm/attack) — 8 sukses: explore, mine
  ✔ bot benar-benar bergerak — 37 posisi berbeda
  ✔ otak heuristic aktif — sources: heuristic
  ✔ tidak ada error fatal di loop
  ✔ trace JSONL ditulis — 33 event
```

Contoh jejak asli bot di dev server (pilih ore → jalan → gali):

```
[state] pos(15,49,14) · hp 20/20 · food 20/20 · items 6 · ores[coal_ore@7.4 copper_ore@10.0] · task=mine
[brain] mine "mining coal_ore at -5,43,-12 (7.37b)"
[ act ] mine → [-5,43,-12]
[result] mined coal_ore at -5,43,-12 in 3751ms (tool 250/250)
[state] pos(18,44,35) · hp 20/20 · food 20/20 · items 9 · task=mine
[result] mined coal_ore at 19,45,36 in 752ms (tool 250/250)
```

---

## 6. Konfigurasi penting

| Env / flag | Default | Keterangan |
|---|---|---|
| `MC_SERVER` / `--server` | `127.0.0.1:25565` | host:port server tujuan |
| `MC_USERNAME` / `--username` | `admin_gabut` | nama bot |
| `MC_AUTH` | `offline` | `offline` untuk server cracked, `microsoft` untuk premium |
| `BRAIN` / `--brain` | `groq` bila ada API key | `groq` / `heuristic` |
| `GROQ_API_KEY`, `GROQ_MODEL` | `openai/gpt-oss-120b` | kredensial & model Groq |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | bisa diarahkan ke mock/proxy |
| `TASK` / `--task` | `auto` | `auto`\|`mine`\|`farm`\|`fight`\|`survive`\|`explore` |
| `OBJECTIVES` | mine coal→iron, farm, explore | daftar objective JSON saat `TASK=auto` |
| `LOOP_INTERVAL_MS` | `2000` | jeda antar keputusan (loop utama) |
| `LOOP_URGENT_MS` | `400` | jeda saat darurat (ada musuh / HP rendah) |
| `ACTION_TIMEOUT_MS` | `12000` | batas satu aksi (dig/attack/goto) |
| `SAFE_*` | lihat `.env.example` | ambang keselamatan (HP, hunger, radius musuh) |
| `PATHFINDER_CAN_DIG` | `true` | pathfinder boleh menggali jalan (bot tambang) |
| `PVP_MODE` | `0` | anggap pemain lain sebagai ancaman (server anarki) |
| `DRY_RUN` | `0` | hanya observe + decide (aksi tidak dijalankan) |

Contoh objective kustom:

```bash
OBJECTIVES='[{"kind":"mine","target":"diamond_ore","count":3},{"kind":"farm","count":16}]' npm start -- --task auto
```

---

## 7. Menjalankan di server asli

1. **Server cracked/offline**: `MC_AUTH=offline` (default) — cukup nama.
2. **Server premium**: `MC_AUTH=microsoft`, lalu login device-code sekali
   (`MC_PASSWORD` bila ingin login dengan password).
3. Jalankan bot di **host yang sama** dengan server (atau VPS dengan latency rendah) supaya
   reaksi makin cepat; konsumsi CPU/RAM kecil (satu proses Node).
4. Di panel (HYUNK PANEL / Pterodactyl) bot bisa dijalankan sebagai *server* biasa dengan egg
   Node.js: start command `npm start`, environment `GROQ_API_KEY`, `MC_SERVER`, `TASK`.
   Jangan menaruh API key di file yang ikut ter-commit.
5. `npm start` sudah menangani: reconnect otomatis saat putus (bukan dev server),
   auto-respawn setelah mati, dan fallback heuristic saat Groq error.

### Troubleshooting

| Gejala | Penyebab / solusi |
|---|---|
| `ECONNREFUSED` | dev server belum jalan → `npm run dev:server` dulu |
| Bot tidak bisa menambang | inventory tanpa pickaxe (di dev server: `/kit miner`) |
| `diamond_ore needs a proper tool` | memang butuh pickaxe besi+; bot akan lapor & pilih blok lain |
| Bot diam saja (`idle`) | HP rendah tapi hunger penuh → menunggu regen (bukan bug) |
| `Groq HTTP 401` | API key salah/kosong → set `GROQ_API_KEY`, atau pakai `BRAIN=heuristic` |
| `Groq model ... not offered` | nama model berubah → bot otomatis memilih dari `GET /models` |
| Chat in-game tidak merespons | prefix default `!bot`, contoh: `!bot task mine` |
| Suara/format paket aneh di log dev server | flying-squid 1.21 — suara sudah dimatikan di dev server |

---

## 8. Catatan keamanan & etika

* Bot ini melakukan aksi nyata di server tujuan (menambang, menyerang mob, memakan item).
  Gunakan di server Anda sendiri atau yang mengizinkan bot/AFK-farm.
* `PATHFINDER_CAN_DIG=true` membuat pathfinder boleh menggali blok bila perlu — matikan bila
  bot tidak boleh merusak terrain.
* API key Groq hanya dibaca dari env/.env (tidak pernah ditulis ke trace/log).
