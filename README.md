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
2. Buka **SQL Editor**, jalankan [`001_initial.sql`](supabase/migrations/001_initial.sql), [`002_role_management.sql`](supabase/migrations/002_role_management.sql), [`003_egg_system.sql`](supabase/migrations/003_egg_system.sql), [`004_auto_download.sql`](supabase/migrations/004_auto_download.sql), lalu [`005_auto_backup.sql`](supabase/migrations/005_auto_backup.sql).
   Migration kedua menambahkan role hierarchy, subuser assignment, batas lima Owner Panel, dan policy RLS berbasis role. Migration ketiga menambahkan Egg, versi, assignment Egg ke node, serta referensi Egg/versi aktif pada server. Migration keempat menambahkan kolom auto-download pada versi Egg (provider, URL template custom, variabel, filename, flag executable). Migration kelima menambahkan **Auto Backup System**: tabel `storage_providers`, `backup_schedules`, dan `backup_logs` beserta RLS-nya.
3. Buat user pertama: **Authentication → Users → Add user** (email + password).
4. Jadikan Owner Panel pertama — di SQL Editor:
   ```sql
   update public.users set role = 'owner_panel' where email = 'email-anda@contoh.com';
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
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth Google Drive (auto backup) — lihat [Auto Backup](#auto-backup-system-cloud-storage) |
| `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` | OAuth Dropbox (auto backup) |
| `ONEDRIVE_CLIENT_ID` / `ONEDRIVE_CLIENT_SECRET` | OneDrive — **coming soon** (UI sudah ada, tombol disabled) |
| `STORAGE_TOKEN_ENCRYPTION_KEY` | enkripsi kredensial cloud storage (AES-256-GCM), `openssl rand -hex 32` |
| `CRON_SECRET` | secret Vercel Cron (`Authorization: Bearer`), `openssl rand -hex 32` |

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

### API player Bedrock (panel internal)

Tab **Players** di server Bedrock (`image` mengandung `debian` ATAU `startup`/env `STARTUP`
mengandung `bedrock_server`) memakai sumber data file server, bukan playerdata Java:

| File | Isi |
|---|---|
| `allowlist.json` | `[{ name, xuid, ignoresPlayerLimit }]` — daftar player yang boleh join |
| `permissions.json` | `[{ permission, xuid }]` — `operator` / `member` / `visitor` |

| Endpoint | Fungsi |
|---|---|
| `GET /api/servers/{id}/bedrock/players` | Baca **kedua** file lalu gabungkan per xuid (permission `console`) |
| `POST /api/servers/{id}/bedrock/players` | Tambah player — body `{ name, xuid, permission?, ignoresPlayerLimit? }` (nama & xuid wajib) |
| `PUT /api/servers/{id}/bedrock/players/{xuid}` | Ubah `permission` (permissions.json) dan/atau `ignoresPlayerLimit` (allowlist.json) |
| `DELETE /api/servers/{id}/bedrock/players/{xuid}` | Hapus dari **kedua** file sekaligus |

Alur tulis konsisten untuk setiap operasi: baca file via `GET .../files/contents?file=/allowlist.json`
→ modifikasi di server-side → tulis balik via `POST .../files/write?file=/allowlist.json`
(hal yang sama untuk `permissions.json` bila perlu). Field/urutan entri yang tidak dikenal
dipertahankan; file yang ada tapi bukan array JSON valid **tidak** ditimpa (dibalas error 502).

Catatan: Bedrock tidak punya `usercache.json`, jadi nama player diinput manual dan XUID adalah
ID Xbox Live (angka panjang) sebagai kunci. Bila server sedang **running** dan user punya
permission `console.send`, perubahan langsung dikirim ke console: `allowlist reload` setelah
`allowlist.json` berubah, `op <name>` / `deop <name>` setelah `permissions.json` berubah
(best-effort — server offline bukan error, perubahan file berlaku saat start berikutnya).
Dropdown permission & checkbox Ignore Player Limit di tabel auto-save (PUT) setiap kali diubah.

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
- **Players (Bedrock Edition)** — tab **Players** untuk server Bedrock (image `debian` /
  startup `bedrock_server`) membaca & menulis `allowlist.json` + `permissions.json` lewat Wings
  File API: tabel gabungan per XUID (nama, xuid, permission, ignore player limit), tambah player
  manual (nama + XUID, karena Bedrock tidak punya usercache), dropdown permission & checkbox
  ignore-limit auto-save, dan hapus dengan konfirmasi (dari kedua file). Server yang online
  langsung menerima `allowlist reload` / `op` / `deop` via console. Tab Players server Java
  tetap memakai playerdata (usercache/playerdata `.dat`, kick/ban/op) — tidak berubah.
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
- **Egg Manager + Generic Auto Download** — setiap versi Egg dapat memiliki `download_provider`:
  built-in (**Paper, Purpur, Vanilla, Fabric, Forge, NeoForge, Quilt, Bedrock**) yang URL-nya
  di-resolve otomatis dari API publik masing-masing (build `latest` atau versi pin via variabel
  `BUILD`/`MC_VERSION`), atau **Custom URL Template** — owner mendefinisikan URL bebas dengan
  placeholder `{KEY}` (mis. `https://…/download/{VERSION}/{FILE}`) + tabel key-value variabel,
  sehingga game/software apapun bisa didukung tanpa mengubah kode. Tombol **Test URL** di Egg
  Manager me-resolve (tanpa download) via `GET /api/download/resolve` /
  `GET /api/admin/eggs/{id}/versions/{vid}/test-download`. Di tab **Startup** server muncul info
  provider + tombol **Download & Install** dengan progress realtime (NDJSON stream:
  resolving → downloading → uploading → ekstrak/chmod → done); flow **Simpan & Reinstall** juga
  menjalankan auto download dulu sebelum reinstall Wings. File di-stream langsung dari sumber ke
  Wings **tanpa buffer di memory** (`POST /api/servers/{id}/download-server-file`), arsip zip
  Bedrock otomatis diekstrak, dan binary dapat di-chmod +x (`download_executable`). Provider
  `none` tetap upload manual via File Manager.
- **Audit log** — halaman khusus admin (`/activity`) dengan filter aksi/server + pagination,
  dan tab **Activity** per server. Semua aksi penting dicatat (power, file edit, admin ops,
  event dari wings) lengkap dengan IP.
- **Auto Backup + Cloud Storage** — jadwal backup per server (hourly/daily/weekly) yang
  dieksekusi Vercel Cron: Wings membuat backup di node → panel men-download secara streaming →
  upload ke cloud storage user (Google Drive, Dropbox, S3-compatible, SFTP, WebDAV) → retention
  otomatis. Lihat [Auto Backup System](#auto-backup-system-cloud-storage).

## Auto Backup System (Cloud Storage)

Fitur backup otomatis terjadwal yang mengirim backup server ke **cloud storage milik user**.

### Alur

```
Admin/Moderator set jadwal backup per server (tab Backups → Auto Backup Schedule)
        ↓
Vercel Cron (hourly, lihat vercel.json) → GET /api/cron/backup (Bearer CRON_SECRET)
        ↓
Wings membuat file backup di node (adapter "wings")
        ↓
Panel menunggu laporan hasil dari Wings (POST /api/remote/backups/{uuid})
        ↓
Panel download backup dari Wings — STREAMING (signed JWT, file bisa >1GB)
        ↓
Upload ke cloud storage user — STREAMING (tidak ada buffer penuh di memory)
        ↓
Backup di node dihapus (sudah aman di cloud) + dicatat di backup_logs
        ↓
Retention: backup cloud terlama dihapus otomatis bila melebihi limit
```

### Setup

1. **Migration** — jalankan [`005_auto_backup.sql`](supabase/migrations/005_auto_backup.sql)
   (tabel `storage_providers`, `backup_schedules`, `backup_logs` + RLS).
2. **Environment variables** (Vercel → Settings → Environment Variables):
   - `STORAGE_TOKEN_ENCRYPTION_KEY` — `openssl rand -hex 32`. Dipakai mengenkripsi AES-256-GCM
     access token / refresh token OAuth serta secret di config (S3 `secret_key`, SFTP/WebDAV
     `password`). **Token tidak pernah tersimpan plaintext dan tidak pernah tampil di UI/API.**
   - `CRON_SECRET` — `openssl rand -hex 32`. Vercel Cron mengirimnya sebagai
     `Authorization: Bearer {CRON_SECRET}`; handler memverifikasi dengan timing-safe compare.
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google Cloud Console → Credentials →
     OAuth Client (Web). **Authorized redirect URI**:
     `{NEXT_PUBLIC_APP_URL}/api/auth/storage/callback/google`
   - `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` — Dropbox App Console. **Redirect URI**:
     `{NEXT_PUBLIC_APP_URL}/api/auth/storage/callback/dropbox`
   - `ONEDRIVE_CLIENT_ID` / `ONEDRIVE_CLIENT_SECRET` — placeholder; fitur OneDrive **coming soon**
     (tombol di UI sudah ada tapi disabled sampai kredensial tersedia).
3. **Vercel Cron** — sudah terdaftar di [`vercel.json`](vercel.json):
   `GET /api/cron/backup` setiap jam (`0 * * * *`). **Catatan:** Vercel Cron dengan interval
   **< 1 hari butuh Vercel Pro**; jadwal hourly seperti ini jalan di semua plan, tetapi
   proses backup (download + upload file besar) bisa melebihi limit durasi function Hobby —
   gunakan **Vercel Pro** (`maxDuration = 300` sudah di-set di route terkait).

### Pemakaian

- **Hubungkan storage** — halaman **Storage** di sidebar (semua role; storage selalu milik
  user yang menghubungkan): tombol **+ Connect Storage** →
  - **Google Drive** / **Dropbox** → OAuth (redirect, token tersimpan terenkripsi).
  - **OneDrive** → coming soon (disabled).
  - **S3 Compatible** → form endpoint/bucket/region/access key/secret key
    (AWS S3, Cloudflare R2, Backblaze B2, MinIO — SigV4 path-style, tanpa AWS SDK).
  - **SFTP** → form host/port/username/password/remote path (`ssh2-sftp-client`).
  - **WebDAV** → form URL/username/password.
  - Per provider: tombol **Test** (cek koneksi; token OAuth yang expired di-refresh otomatis)
    dan **Disconnect** (ditolak bila masih dipakai jadwal — badge "Used by N servers").
- **Atur jadwal** — tab **Backups** di server → section **Auto Backup Schedule**:
  toggle aktif, interval (Hourly/Daily/Weekly), jam eksekusi, hari (weekly), storage provider,
  retention (1–20), ignore files. Tombol **Run now** menjalankan pipeline langsung.
- **Riwayat** — section **Backup History** di tab Backups: waktu, ukuran, provider, status,
  dan link file di cloud.
- **Admin** — halaman **Auto Backups** (`/admin/backups`, Owner Panel & Admin): overview semua
  jadwal + status terakhir + tombol **Force run**.

### Konvensi penyimpanan di cloud

- Folder tujuan: `Hyunk Panel Backups/{server_name}/` (dibuat otomatis bila belum ada).
- Nama file: `{server_name}-{YYYY-MM-DD_HH-mm}.tar.gz` (waktu server/UTC).
- **Retention**: setelah upload sukses, backup cloud terlama dihapus otomatis bila jumlah
  backup `done` melebihi nilai retention jadwal.
- **Pembersihan node**: setelah upload ke cloud sukses, backup di node dihapus
  (`DELETE /api/servers/{uuid}/backup/{uuid}`) agar disk node tidak penuh. Bila upload gagal,
  backup di node **dipertahankan** dan bisa didownload manual dari tab Backups.
- **Streaming**: download Wings → upload cloud dialirkan langsung (web `ReadableStream`);
  tidak ada buffer file penuh di memory. Dropbox memakai upload session (chunk 48MB) untuk
  file >150MB; S3 memakai `UNSIGNED-PAYLOAD` (HTTPS); GDrive upload media via PATCH.
- **Token refresh**: sebelum upload, `token_expires_at` dicek; bila expired, refresh token
  dipakai menukar access token baru (Google: `oauth2.googleapis.com/token`,
  Dropbox: `api.dropboxapi.com/oauth2/token`) dan token baru disimpan kembali (terenkripsi).

### Permission

| Aksi | Role |
|---|---|
| Connect/disconnect storage, test koneksi | semua role (storage milik sendiri) |
| Set/ubah/hapus jadwal backup, Run now | `owner_panel`, `admin`, `moderator` (permission `backup.schedule`) |
| Lihat jadwal & backup logs | sesuai akses server (permission `backups`) |
| Admin overview + force run | `owner_panel`, `admin` |

### API routes

| Endpoint | Fungsi |
|---|---|
| `GET /api/auth/storage/connect?provider=gdrive\|dropbox\|onedrive` | mulai OAuth flow (redirect ke provider) |
| `GET /api/auth/storage/callback/google` | callback Google → simpan token terenkripsi |
| `GET /api/auth/storage/callback/dropbox` | callback Dropbox → simpan token terenkripsi |
| `GET /api/auth/storage/callback/onedrive` | placeholder 501 (coming soon) |
| `GET /api/storage/providers` | list provider user (+ "Used by N servers") |
| `POST /api/storage/providers/s3` | tambah S3-compatible manual |
| `POST /api/storage/providers/sftp` | tambah SFTP manual |
| `POST /api/storage/providers/webdav` | tambah WebDAV manual |
| `DELETE /api/storage/providers/[id]` | disconnect provider (409 bila masih dipakai) |
| `GET /api/storage/providers/[id]/test` | test koneksi provider |
| `GET /api/servers/[id]/backup-schedule` | jadwal + daftar provider user |
| `POST /api/servers/[id]/backup-schedule` | set/ubah jadwal (upsert, 1 per server) |
| `DELETE /api/servers/[id]/backup-schedule` | hapus jadwal |
| `GET /api/servers/[id]/backup-logs` | history auto backup (maks 50) |
| `POST /api/servers/[id]/backup-now` | jalankan pipeline backup sekarang |
| `GET /api/cron/backup` | handler Vercel Cron (Bearer `CRON_SECRET`) |
| `GET /api/admin/backups` | overview semua jadwal (Owner Panel & Admin) |
| `POST /api/admin/backups/run` | force run satu jadwal (body `{ schedule_id }`) |

> Bergantung pada Remote API aktif: Wings melaporkan hasil backup ke
> `POST /api/remote/backups/{uuid}` (sudah ada). Tanpa itu, job menunggu sampai timeout
> (240 d) lalu tercatat `failed` di backup_logs.

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
  storage/      → auto backup: crypto.ts (enkripsi kredensial), schedule.ts (next_run_at),
                  tokens.ts (refresh OAuth), gdrive/dropbox/s3/sftp/webdav.ts (upload
                  streaming), backupJob.ts (pipeline cron/manual/admin)
supabase/migrations/001_initial.sql
supabase/migrations/002_role_management.sql
supabase/migrations/003_egg_system.sql
supabase/migrations/004_auto_download.sql
supabase/migrations/005_auto_backup.sql
```

## Catatan operasional

- **Timeout Vercel**: request API route harus < 60 s (Pro). Semua panggilan wings di repo ini
  cepat; backup berjalan async di node dan statusnya dilaporkan wings via remote API. Endpoint
  `download-server-file` me-stream file langsung ke Wings (memory aman), tetapi file yang sangat
  besar di koneksi lambat bisa melebihi 60 detik di Hobby plan — gunakan upload manual via File
  Manager sebagai fallback untuk kasus itu.
- **Rotasi token node**: update di UI (Nodes → edit) atau `PATCH /api/nodes/{id}` dengan
  `{ token }` — langsung dienkripsi ulang.
- **Server baru**: port wajib dipilih dari allocation node (dropdown hanya berisi port
  `assigned_to IS NULL`); tambah range port dulu di halaman node bila daftar kosong.
  Checkbox "Buat container di node" hanya efektif setelah Remote API aktif
  (wings mengambil konfigurasi dari panel saat create).
