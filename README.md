# HYUNK PANEL

**One Panel. Every Node. Every Server.**

Serverless multi-node Minecraft control panel — pengganti Pterodactyl Panel — yang mengontrol
node Wings **existing** tanpa menyentuh data server di `/var/lib/pterodactyl/volumes`.

- Frontend + API: **Next.js 14** (App Router, TypeScript, Tailwind) → deploy ke **Vercel**
- Database + Auth: **Supabase** (PostgreSQL + RLS)
- Realtime: WebSocket langsung browser → Wings memakai **JWT sementara** (token node tidak pernah ke browser)
- Semua endpoint Wings diverifikasi terhadap source resmi `pterodactyl/wings` — tidak ada endpoint karangan.

---

## Arsitektur keamanan

```
Browser ──► /api/... (Next.js API route, serverless) ──► Wings API (HTTPS, Bearer token node)
   │                                                            ▲
   └──── WebSocket console langsung ke node ────────────────────┘
         HANYA memakai JWT sementara (HS256, max 5 menit) yang
         diterbitkan /api/servers/{id}/console/token
```

1. Token Wings disimpan di tabel `nodes.token_encrypted` — **AES-256-GCM** (format `iv.tag.ciphertext`).
   Key hanya di env `WINGS_TOKEN_ENCRYPTION_KEY`, tidak pernah di kode.
2. RLS aktif di semua tabel. Kolom token tidak bisa dibaca siapapun via Supabase client
   (tabel `nodes` dapat SELECT hanya untuk admin; UI memakai view `nodes_public` tanpa token).
3. JWT untuk websocket/download/upload/backup ditandatangani server-side memakai token node
   sebagai secret HMAC (persis cara Pterodactyl menandatangani), ber-`exp` ≤ 15 menit dan
   satu-kali-pakai (`unique_id`) untuk download/upload.
4. Remote API (Wings → Panel) divalidasi per-request: Bearer `{token_id}.{token}` cocok dengan
   node di database (timing-safe compare).
5. HTTPS only. Middleware menolak halaman/API tanpa session; `/api/remote/*` dikecualikan
   karena memakai auth token node sendiri.

---

## Setup (10 menit)

### 1. Supabase

1. Buat project baru di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**, jalankan isi [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql).
   Ini membuat tabel (`users`, `nodes`, `servers`, `allocations`, `server_users`,
   `activity_logs`, `backups`), trigger auto-profile, dan semua policy RLS.
3. Buat user pertama: **Authentication → Users → Add user** (email + password).
4. Jadikan admin — di SQL Editor:
   ```sql
   update public.users set role = 'admin' where email = 'email-anda@contoh.com';
   ```

### 2. Environment variables

Salin `.env.local.example` → `.env.local` (lokal) atau isi di **Vercel → Settings → Environment Variables**:

| Variabel | Keterangan |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL project Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (**rahasia — hanya server**) |
| `WINGS_TOKEN_ENCRYPTION_KEY` | hasil `openssl rand -hex 32` |
| `WINGS_SEED_NODE_TOKEN` | token Wings node existing (dari `/etc/pterodactyl/config.yml` di node, field `token`) |
| `NEXT_PUBLIC_APP_URL` | `https://panel.wangstore.web.id` |

> `WINGS_SEED_NODE_TOKEN` hanya dibaca sekali oleh endpoint seed (dienkripsi lalu disimpan).
> Setelah seed sukses, boleh dikosongkan/dihapus dari env.

### 3. Deploy

```bash
npm install
npm run build      # verifikasi lokal
vercel deploy      # atau connect repo di dashboard Vercel
```

Set domain `panel.wangstore.web.id` ke project Vercel.

### 4. Seed data existing (Fase 0)

Setelah login sebagai admin:

```bash
curl -X POST https://panel.wangstore.web.id/api/admin/seed \
  -H "Cookie: <session-cookie-anda>"
```

Response: `{ node: "inserted", servers_inserted: 5, servers_skipped: 0, ... }`.
Endpoint ini **idempotent** — panggilan ulang akan skip data yang sudah ada.
Yang diimpor: node `node2.wangstore.web.id:8080` + 5 server (NodeJS App, Bedrock 1/2, Java MC 1/2)
lengkap dengan port allocation, startup command, dan environment aslinya.

### 5. Verifikasi Fase 1a

- Dashboard menampilkan 1 node + 5 server.
- Buka server **Java MC 1** → lihat **Console**: log live harus mengalir (websocket via JWT).
- Test **Power** stop/start di server uji (bukan produksi dulu).
- Buka **Files**: browse direktori, edit `server.properties`, simpan.

> Jika node menolak JWT console (`jwt error`): pastikan token yang disimpan saat seed
> persis sama dengan `token` di `config.yml` Wings saat ini. JWT ditandatangani dengan
> secret itu — salah token = signature tidak cocok.

---

## Fase 1b — Remote API (membuat panel jadi sumber kebenaran)

Remote API **sudah terimplementasi** di repo ini:

| Endpoint | Fungsi |
|---|---|
| `GET /api/remote/servers` | Daftar server node (pagination, dipakai wings saat boot) |
| `GET /api/remote/servers/{uuid}` | Konfigurasi penuh server (settings + process_configuration) |
| `GET /api/remote/servers/{uuid}/install` | Install script (no-op aman, data volume tidak disentuh) |
| `POST /api/remote/servers/{uuid}/install` | Lapor status instalasi |
| `POST /api/remote/activity` | Terima activity log dari wings |
| `POST /api/remote/sftp` | Validasi kredensial SFTP (`{username}.{prefix-uuid}`) |
| `GET /api/remote/credentials` | Info endpoint SFTP node |
| `POST /api/remote/backups/{uuid}` | Lapor ukuran/checksum/hasil backup |

### API allocation (panel internal)

| Endpoint | Fungsi |
|---|---|
| `GET /api/nodes/{id}/allocations` | Daftar semua port node + status & server pemakainya (`?status=available` untuk port bebas saja) |
| `POST /api/nodes/{id}/allocations` | Tambah allocation batch — body `{ ip: "0.0.0.0", ports: "25565-25600" }` (duplikat dilewati) |
| `DELETE /api/nodes/{id}/allocations?allocation_id=…` | Hapus allocation — **hanya** bila `assigned_to IS NULL` |
| `GET/POST/DELETE /api/servers/{id}/allocations` | Assign / unassign port tambahan ke satu server (node yang sama) |

Alur: node → tambah range port → tersimpan di `allocations` → create/edit server memilih
port yang tersedia (`assigned_to IS NULL`) → port ter-assign dan tidak bisa dipakai server lain.
Membuat server lewat API tanpa `allocation_id` masih didukung (field `port` lama) dengan
membuat allocation otomatis, berguna untuk impor/seed.

**Aktivasi** (hanya setelah Fase 1a terbukti stabil!):

1. Di node, edit `/etc/pterodactyl/config.yml`:
   ```yaml
   remote: 'https://panel.wangstore.web.id'
   ```
2. **JANGAN restart Wings** sebelum memverifikasi panel sehat — test dulu dari node:
   ```bash
   curl -s https://panel.wangstore.web.id/api/remote/servers/45cf343c-f0f6-441a-a0fe-616a975c764a \
     -H "Authorization: Bearer 2ZSqe7LfqTEqHAWN.<token-dari-config.yml>" | jq .
   ```
   Harus dapat JSON `settings` + `process_configuration`.
3. `systemctl restart wings`, pantau `wings diagnostics` / log. Server akan sync konfigurasi
   dari panel Hyunk, bukan panel lama.

> Sampai langkah ini dilakukan, wings tetap "tertawa sendiri" memakai cache konfigurasi
> terakhir — semua fitur panel (power, console, files) tetap jalan karena panel memanggil
> wings langsung memakai token node.

---

## Fitur

- **Auth & RBAC** — login Supabase Auth (email+password), role `admin`/`user`,
  permission granular per server (`server_users.permissions`: `console`, `console.send`,
  `start/stop/restart/kill`, `files.read/edit`, `backups`, `settings`).
- **Resource monitoring** — grafik realtime (SVG, tanpa dependency) untuk CPU, RAM,
  network RX/TX per detik, plus disk & uptime, di-tab Overview server. Sumber: stream
  event `stats` lewat WebSocket Wings (window ±2 menit); koneksi diputus saat tab tidak aktif.
- **Console realtime** — WebSocket ke wings dengan renderer ANSI, auto-scroll, history command
  (arrow up/down), stats strip (CPU/RAM/uptime/network) dari event `stats`,
  token auto-refresh saat `token expiring`.
- **File manager** — browse, edit (≤ 2 MB), rename, delete multi-select, compress/extract,
  folder baru, upload langsung ke wings (multipart via signed URL — melewati limit 4.5 MB Vercel),
  download via signed URL satu-kali-pakai.
- **Power control** — start/stop/restart/kill (kill dengan konfirmasi modal), juga `/start` dll
  dari input console.
- **Backups** — buat, download (signed URL), restore (dengan/tanpa truncate), hapus. Status
  diperbarui saat remote API aktif.
- **Nodes** — kartu node, statistik live (RAM/CPU/versi wings + daftar server live), edit node
  lengkap dengan **rotasi token** via UI, mode maintenance, hapus-dari-panel (tidak menyentuh mesin).
- **Allocation / Port (per node)** — section **Allocations/Port** di halaman detail node:
  tambah port atau range port (mis. `25565-25600`) ke tabel `allocations`, lihat status
  **Tersedia** / **Dipakai oleh: [nama server]**, dan hapus port (hanya yang belum dipakai).
  Form *Create Server* hanya menampilkan port `assigned_to IS NULL` milik node terpilih —
  begitu server dibuat, `assigned_to` di-set ke server itu sehingga port tidak bisa dipakai
  server lain. Menghapus server otomatis melepas semua port-nya (`assigned_to = NULL`).
- **Users (admin)** — buat user, ubah role, assign server + permission granular, cabut akses,
  hapus akun.
- **Audit log** — halaman khusus admin (`/activity`) dengan filter aksi/server + pagination,
  dan tab **Activity** per server. Semua aksi penting dicatat (power, file edit, admin ops,
  event dari wings) lengkap dengan IP.

## Batasan yang disengaja (mengikuti brief)

- ❌ Tidak ada billing/payment. ❌ Tidak ada auto-provisioning massal.
- ❌ Panel tidak pernah menyentuh `/var/lib/pterodactyl/volumes` kecuali perintah eksplisit
  user lewat UI (file manager/backup).
- ❌ "Hapus permanen server + data" selalu butuh konfirmasi ganda (ketik nama server).
  Mode default hanya menghapus record panel.
- Live stats per server bergantung pada `GET /api/servers/{uuid}` Wings (polling ringan) dan
  stream WebSocket; Vercel serverless **tidak** menjaga koneksi WS persistent — itu sebabnya
  browser yang memegang socket.

## Struktur

```
app/            → halaman (App Router) + API routes (panel + remote)
components/     → UI, layout, console (websocket), file manager, power, backup, users
hooks/          → useWingsConsole (websocket), useServerStatus (polling)
lib/
  wings/        → client.ts (SATU-SATUNYA pintu ke Wings), crypto.ts (AES-256-GCM),
                  jwt.ts (HS256 token kompatibel wings), types.ts, resolve.ts
  remote/       → auth.ts (validasi wings→panel), config.ts (settings/process builder)
  supabase/     → client browser/server/service
  auth/         → session.ts, rbac.ts (checkPermission)
supabase/migrations/001_initial.sql
```

## Catatan operasional

- **Timeout Vercel**: request API route harus < 60 s (Pro). Semua panggilan wings di repo ini
  cepat; backup berjalan async di node dan statusnya dilaporkan wings via remote API.
- **Rotasi token node**: update di UI (Nodes → edit) atau `PATCH /api/nodes/{id}` dengan
  `{ token }` — langsung dienkripsi ulang.
- **Server baru**: port wajib dipilih dari allocation node (dropdown hanya berisi port
  `assigned_to IS NULL`); tambah range port dulu di halaman node bila daftar kosong.
  Checkbox "Buat container di node" hanya efektif setelah Remote API aktif
  (wings mengambil konfigurasi dari panel saat create).
