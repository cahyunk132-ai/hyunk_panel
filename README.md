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
2. Buka **SQL Editor**, jalankan [`001_initial.sql`](supabase/migrations/001_initial.sql), [`002_role_management.sql`](supabase/migrations/002_role_management.sql), [`003_egg_system.sql`](supabase/migrations/003_egg_system.sql), [`004_auto_download.sql`](supabase/migrations/004_auto_download.sql), [`005_auto_backup.sql`](supabase/migrations/005_auto_backup.sql), [`006_server_subdomains.sql`](supabase/migrations/006_server_subdomains.sql), [`007_auto_server_users.sql`](supabase/migrations/007_auto_server_users.sql), dan [`008_count_user_subdomains.sql`](supabase/migrations/008_count_user_subdomains.sql), lalu [`009_drop_subdomain_quota.sql`](supabase/migrations/009_drop_subdomain_quota.sql), [`010_add_backup_schedule_permission.sql`](supabase/migrations/010_add_backup_schedule_permission.sql), dan [`011_announcements.sql`](supabase/migrations/011_announcements.sql), lalu [`012_vps_terminal.sql`](supabase/migrations/012_vps_terminal.sql), dan [`013_status_notifications.sql`](supabase/migrations/013_status_notifications.sql) untuk public status page serta notifikasi email.
   Migration kedua menambahkan role hierarchy, subuser assignment, batas lima Owner Panel, dan policy RLS berbasis role. Migration ketiga menambahkan Egg, versi, assignment Egg ke node, serta referensi Egg/versi aktif pada server. Migration keempat menambahkan kolom auto-download pada versi Egg (provider, URL template custom, variabel, filename, flag executable). Migration kelima menambahkan **Auto Backup System**: tabel `storage_providers`, `backup_schedules`, dan `backup_logs` beserta RLS-nya. Migration keenam menambahkan **Subdomain Manager**: tabel `server_subdomains` (subdomain per server → IP:port via reverse proxy Wings) beserta RLS-nya. Migration ketujuh mengisi baris `server_users` yang hilang untuk server yang sudah ada plus trigger auto-assign owner. Migration kedelapan sempat menambahkan function `count_user_subdomains(uuid)` untuk kuota subdomain per user, dan migration kesembilan **menghapusnya** — sistem subdomain sekarang **satu subdomain aktif per server tanpa kuota per user**, jadi function kuota itu tidak dipakai lagi. Migration kesepuluh menambahkan permission `backup.schedule` pada assignment yang sudah ada. Migration kesebelas menambahkan **Announcement System**: tabel `announcements` (broadcast pengumuman admin → banner di panel user) beserta RLS-nya. Migration kedua belas menambahkan tabel `vps`/`vps_users` untuk **VPS Terminal**; credential VPS wajib disimpan terenkripsi dengan `STORAGE_TOKEN_ENCRYPTION_KEY` dan hanya endpoint token yang boleh membacanya. Migration ketiga belas menambahkan `node_status_logs`, `notification_settings`, `notification_logs`, serta kolom delivery email pada `announcements`.
3. Buat user pertama: **Authentication → Users → Add user** (email + password). Centang **Auto Confirm User** — sejak fitur [Email Verification](#email-verification--reset-password) aktif, akun dengan email belum terverifikasi hanya bisa membuka `/verify-email` dan tidak bisa memakai panel.
4. Atur **Authentication → URL Configuration**: isi **Site URL** dengan `NEXT_PUBLIC_APP_URL` (mis. `https://panel.wangstore.web.id`) dan tambahkan `https://panel.wangstore.web.id/auth/callback` ke **Redirect URLs** supaya link verifikasi email & reset password kembali ke panel. Pastikan **Authentication → Providers → Email → Confirm email** aktif bila ingin pendaftaran baru wajib verifikasi, dan isi **SMTP** (Auth → SMTP) agar email benar-benar terkirim.
5. Jadikan Owner Panel pertama — di SQL Editor:
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
| `NEXT_PUBLIC_BASE_DOMAIN` | base domain Subdomain Manager, default `wangstore.web.id` |
| `TERMINAL_SERVICE_URL` | URL HTTPS terminal service eksternal, mis. `https://terminal.wangstore.web.id` |
| `TERMINAL_JWT_SECRET` | secret HS256 yang sama dengan terminal service (**rahasia — hanya server**) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth Google Drive (auto backup) — lihat [Auto Backup](#auto-backup-system-cloud-storage) |
| `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` | OAuth Dropbox (auto backup) |
| `ONEDRIVE_CLIENT_ID` / `ONEDRIVE_CLIENT_SECRET` | OneDrive — **coming soon** (UI sudah ada, tombol disabled) |
| `STORAGE_TOKEN_ENCRYPTION_KEY` | enkripsi kredensial cloud storage (AES-256-GCM), `openssl rand -hex 32` |
| `CRON_SECRET` | secret Vercel Cron (`Authorization: Bearer`), `openssl rand -hex 32` |
| `SMTP_HOST` / `SMTP_PORT` | host dan port SMTP untuk notifikasi email otomatis |
| `SMTP_SECURE` | `true` untuk TLS langsung (umumnya port 465), `false` untuk STARTTLS (umumnya 587) |
| `SMTP_USER` / `SMTP_PASSWORD` | kredensial SMTP server (**rahasia — hanya server**) |
| `SMTP_FROM` | alamat pengirim email notifikasi |

> `WINGS_SEED_NODE_TOKEN` hanya dibaca sekali oleh endpoint seed (dienkripsi lalu disimpan).
> Setelah seed sukses, boleh dikosongkan/dihapus dari env.

### 3. Deploy

```bash
npm install
npm run build      # verifikasi lokal
vercel deploy      # atau connect repo di dashboard Vercel
```

Set domain `panel.wangstore.web.id` ke project Vercel.

### VPS Terminal eksternal

Setelah menjalankan [`012_vps_terminal.sql`](supabase/migrations/012_vps_terminal.sql), user dapat menambahkan VPS sendiri dari halaman `/vps` melalui tombol **+ Tambah VPS**. Form mengirim credential melalui HTTPS ke API panel; API langsung mengenkripsinya memakai `encryptSecret(...)` dari `lib/storage/crypto.ts` sebelum disimpan. Credential plaintext tidak disimpan atau dikembalikan ke browser.

Pemilik VPS dapat melihat, mengedit, dan menghapus VPS miliknya. Owner Panel/Admin dapat mengelola semua VPS; VPS yang dibagikan hanya tampil read-only bagi user penerima. Saat user membuka `/vps/{id}/terminal`, `GET /api/vps/{id}/terminal-token` memeriksa owner/assignment, mendekripsi credential di server, lalu menerbitkan JWT HS256 35 menit untuk `TERMINAL_SERVICE_URL`.

Card VPS juga mengambil CPU, RAM, dan Disk melalui SSH setiap 10 detik. Halaman `/vps/{id}/files` menyediakan browse, editor Monaco, upload, download, rename, pembuatan file/folder, dan hapus melalui SFTP. Operasi tulis file hanya tersedia bagi owner VPS atau Owner Panel/Admin; user yang menerima assignment melihat mode read-only.

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

### VPS Terminal API (panel internal)

| Endpoint | Fungsi |
|---|---|
| `GET /api/vps` | Daftar VPS yang dimiliki/di-assign ke user, tanpa credential |
| `POST /api/vps` | User login menambahkan VPS miliknya; credential langsung dienkripsi server-side |
| `GET/PATCH/DELETE /api/vps/{id}` | Baca metadata, ubah, atau hapus VPS; hanya owner atau Owner Panel/Admin |
| `GET /api/vps/{id}/terminal-token` | User yang punya akses menerima `{ token, wsUrl }`; credential didekripsi server-side dan tidak dikembalikan sebagai field terpisah |
| `GET /api/vps/{id}/stats` | CPU, RAM, dan Disk VPS; cache process-local 10 detik |
| `GET /api/vps/{id}/files?path=/` | List direktori melalui SFTP |
| `GET /api/vps/{id}/files/read?path=...` | Baca isi file untuk editor |
| `POST /api/vps/{id}/files/write` | Tulis isi file (owner/admin) |
| `POST /api/vps/{id}/files/mkdir` | Buat folder (owner/admin) |
| `POST /api/vps/{id}/files/rename` | Rename file/folder (owner/admin) |
| `POST /api/vps/{id}/files/upload` | Upload multipart file (maks. 10 MB, owner/admin) |
| `GET /api/vps/{id}/files/download?path=...` | Download file (maks. 25 MB) |
| `DELETE /api/vps/{id}/files?path=...` | Hapus file/folder (owner/admin) |
| `GET /vps` | GUI daftar, monitoring, dan tambah/edit/hapus VPS |
| `GET /vps/{id}/terminal` | Terminal xterm.js via `wss://terminal.wangstore.web.id?token=...` |
| `GET /vps/{id}/files` | File Manager VPS dengan editor Monaco |

Terminal service menggunakan pesan JSON `{ type: "data", data: "<base64>" }`, `{ type: "resize", cols, rows }`, serta status/error seperti yang didukung UI.

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

- **Auth & RBAC** — login Supabase Auth (email+password), register mandiri (`/register`) dengan
  **verifikasi email wajib**, **lupa/reset password** lewat link email, role `admin`/`user`,
  permission granular per server (`server_users.permissions`: `console`, `console.send`,
  `start/stop/restart/kill`, `files.read/edit`, `backups`, `settings`).
  Lihat [Email Verification & Reset Password](#email-verification--reset-password).
- **Announcement System** — admin broadcast pengumuman ke semua user panel; tampil sebagai banner
  berwarna (info/warning/danger/success) di Dashboard & Servers, bisa di-dismiss per pengumuman,
  punya tanggal kedaluwarsa, dan dikelola di `/admin/announcements`.
  Lihat [Announcement System](#announcement-system).
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
- **Subdomain Manager (Network)** — setiap server dapat punya satu subdomain sendiri
  (mis. `kenz.wangstore.web.id` — base domain dari `NEXT_PUBLIC_BASE_DOMAIN`) yang langsung
  mengarah ke IP:port server via reverse proxy Wings. Tab **Network** di halaman server:
  subdomain aktif (badge status, tombol copy, hapus), form daftar dengan validasi realtime
  (huruf kecil/angka/strip, 3–32 karakter, blacklist nama sistem, cek ketersediaan via
  `GET /api/servers/{id}/subdomain?check=`), dan preview `[nama].[base domain]`. Endpoint:
  `GET`/`POST`/`DELETE /api/servers/{id}/subdomain`.
  **Satu subdomain per server**: begitu server punya subdomain aktif, form register tidak
  muncul lagi di UI (hanya subdomain aktif + tombol hapus) dan `POST` menjawab `409`
  *"Server ini sudah memiliki subdomain aktif"* — hapus dulu untuk mendaftarkan yang baru.
  **Tanpa kuota per user**: siapa pun yang punya akses ke server tersebut boleh daftar dan
  hapus — Owner Panel/Admin, pemilik server (`servers.owner_id`), atau anggota yang terdaftar
  di `server_users`. Aturan itu satu tempat di `lib/subdomains/access.ts`
  (`hasServerAccess` / `requireServerAccess`) dan dipakai bersama oleh API route serta
  halaman Network supaya UI dan API tidak pernah beda.
  Admin memantau semua subdomain di `/admin/subdomains` (tabel subdomain, server, owner,
  port, tanggal dibuat + hapus per row).
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
- **Admin** — dua halaman khusus Owner Panel & Admin:
  - **Backup Monitor** (`/admin/backups`): semua backup log dari seluruh user/server dalam satu
    tampilan. Kartu statistik (backup hari ini, total storage terpakai, sukses vs gagal hari ini,
    jumlah jadwal aktif), tabel 20 baris/halaman dengan filter status/provider/rentang tanggal,
    search nama server atau email owner, sort waktu, auto refresh 30 detik, dan baris yang bisa
    di-expand untuk melihat `error_message` pada backup yang gagal. Data diambil dari
    `backup_logs` dengan service role (bypass RLS) lewat `GET /api/admin/backup-logs`.
  - **Auto Backups** (`/admin/backup-schedules`): overview semua jadwal + status terakhir +
    tombol **Force run**.

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
| `GET /api/admin/backup-logs` | monitoring semua backup log (Owner Panel & Admin): filter `status` (`all\\|pending\\|running\\|done\\|failed`), `provider`, `from`/`to` (`YYYY-MM-DD`), `q`, `sort` (`desc\\|asc`), `page` (20/halaman) + kartu statistik |

> Bergantung pada Remote API aktif: Wings melaporkan hasil backup ke
> `POST /api/remote/backups/{uuid}` (sudah ada). Tanpa itu, job menunggu sampai timeout
> (240 d) lalu tercatat `failed` di backup_logs.

## Email Verification & Reset Password

Semua aliran email auth memakai Supabase Auth (panel tidak mengirim email sendiri).

### Alur

| Alur | Langkah |
|---|---|
| Register | `/register` → `supabase.auth.signUp()` (username dikirim lewat `options.data`, dipakai trigger `handle_new_user`) → Supabase mengirim email verifikasi → user diarahkan ke `/verify-email` |
| Verifikasi | user klik link di email → `/auth/callback?type=signup&code=…` → `exchangeCodeForSession` → redirect `/dashboard?verified=1` (toast "Email terverifikasi") |
| Belum verifikasi | `middleware.ts` memblokir semua halaman & `/api/*` (403 JSON) kecuali `/verify-email`; halaman itu menawarkan tombol **Kirim ulang email verifikasi** (`supabase.auth.resend`, cooldown 30 detik) |
| Lupa password | `/login` → **Lupa password?** → `/forgot-password` → `supabase.auth.resetPasswordForEmail()` dengan `redirectTo` = `{NEXT_PUBLIC_APP_URL}/auth/callback?type=recovery` |
| Reset password | link email → `/auth/callback?type=recovery` → sesi recovery → `/reset-password` (password baru + konfirmasi) → `updateUser({ password })` → sign out → `/login?reset=success` → toast **"Password berhasil diubah"** |

`/reset-password` juga menerima token langsung dari Supabase (`?code=…` atau
`?token_hash=…&type=recovery`) bila Site URL diarahkan ke sana — jadi alurnya tetap jalan walau
`/auth/callback` tidak dipakai.

### Route publik

`middleware.ts` memperlakukan path berikut sebagai publik: `/login`, `/register`, `/verify-email`,
`/forgot-password`, `/reset-password`, `/auth/callback`, `/status`, `GET /api/status`, dan
`GET /api/announcements`. User yang
sudah login **dan** terverifikasi di-redirect dari halaman auth itu ke `/dashboard` (pengecualian:
`/reset-password`, karena sesi recovery memang dipakai di sana).

### Konfigurasi Supabase (wajib)

1. **Authentication → Providers → Email** — aktifkan **Confirm email**. Bila dimatikan, `signUp`
   langsung membuat sesi dan `/verify-email` otomatis dilewati.
2. **Authentication → URL Configuration** — **Site URL** = `NEXT_PUBLIC_APP_URL`, dan tambahkan
   `{NEXT_PUBLIC_APP_URL}/auth/callback` ke **Redirect URLs**. Tanpa ini Supabase menolak
   `emailRedirectTo` dan link di email tidak kembali ke panel.
3. **Authentication → SMTP** — isi SMTP sendiri (email bawaan Supabase dibatasi ±2/jam) supaya
   email verifikasi & reset benar-benar terkirim.
4. **Authentication → Rate Limits** — batas resend dikontrol Supabase; UI menahan tombol 30 detik
   dan menampilkan pesan bila limit tercapai.

> Akun yang dibuat admin lewat `POST /api/admin/users` tetap dibuat dengan `email_confirm: true`
> (langsung terverifikasi), jadi user hasil invite admin tidak terblokir guard `/verify-email`.
> Notifikasi kecil (toast) memakai `lib/utils/toast.ts` + `<Toaster />` di `app/layout.tsx`.

## Public Status Page

Halaman status publik tersedia di `/status` dan dapat dipasang pada domain
`https://status.wangstore.web.id`. Halaman ini tidak membutuhkan login, menampilkan status
semua node Wings, latency, uptime 90 hari, serta 90 kotak riwayat harian. Data dikumpulkan oleh
Vercel Cron setiap jam melalui `GET /api/system` Wings dan disimpan di `node_status_logs` selama
maksimal 90 hari.

| Endpoint | Auth | Fungsi |
|---|---|---|
| `GET /api/status` | publik | node, status terkini, latency, uptime 90 hari, history harian, overall, dan last updated |
| `GET /api/cron/node-status` | `CRON_SECRET` | health check node per jam, simpan log, cleanup >90 hari, trigger node offline |
| `GET /api/cron/server-status` | `CRON_SECRET` | polling server Wings tiap 5 menit dan trigger server crash |

`online` berarti Wings merespons di bawah 1 detik, `degraded` berarti latency minimal 1 detik
atau node sedang maintenance, dan `offline` berarti request Wings gagal. Tambahkan domain custom
`status.wangstore.web.id` di Vercel Project Settings → Domains, lalu buat DNS Cloudflare:
`CNAME status cname.vercel-dns.com` (proxy DNS dapat tetap aktif jika konfigurasi Vercel
menerimanya). Middleware otomatis me-rewrite root domain status ke route `/status`; deploy route
`/status` dari project yang sama.

## Email Notifications

Migration: [`013_status_notifications.sql`](supabase/migrations/013_status_notifications.sql).
`lib/notifications.ts` merender template dan mengirim email melalui SMTP server-side dengan
Nodemailer. Credential SMTP tidak pernah dikirim ke browser dan setiap delivery dicatat di
tabel `notification_logs`.

Pengguna mengatur toggle **Backup gagal**, **Backup berhasil**, **Server crash**, **Node offline**,
email alternatif, dan tombol **Test — kirim email** di `/settings/notifications`. Pengaturan
memiliki default: backup gagal, server crash, dan node offline aktif; backup berhasil nonaktif.

- Backup failed/success dipicu dari `lib/storage/backupJob.ts`.
- Server crash dipicu ketika polling 5 menit melihat transisi `running → offline`.
- Node offline dipicu ketika polling node melihat transisi `online → offline` dan dikirim ke semua
  Owner Panel/Admin yang sudah memverifikasi email.
- Announcement aktif dengan toggle email akan dikirim ke semua user aktif yang sudah memverifikasi
  email, dalam batch 10 email per detik. `announcements.email_sent` baru menjadi `true` setelah
  semua email berhasil; menonaktifkan announcement menghentikan batch berikutnya.

## Announcement System

Admin (Owner Panel & Admin) broadcast pengumuman ke semua user panel.
Migration: [`011_announcements.sql`](supabase/migrations/011_announcements.sql).

### Skema

Tabel `announcements`: `id`, `title`, `content`, `type` (`info` \| `warning` \| `danger` \|
`success`), `is_active`, `send_email`, `email_sent`, `created_by` (→ `users.id`, `ON DELETE SET NULL`),
`created_at`, `expires_at` (`null` = permanen sampai dinonaktifkan). `send_email` mengontrol
broadcast email; `email_sent` hanya true setelah seluruh recipient verified berhasil menerima email.

"Sedang tayang" = `is_active = true` **dan** (`expires_at IS NULL` **atau** `expires_at > now()`).
Aturan itu satu tempat di `lib/announcements.ts` (`isAnnouncementExpired`,
`filterLiveAnnouncements`) dan dipakai bersama oleh API route serta banner, jadi UI dan API tidak
pernah beda.

### Admin — `/admin/announcements`

Tabel semua pengumuman (judul + preview konten, tipe, status **Tayang/Nonaktif/Kedaluwarsa**,
tanggal dibuat + pembuat, tanggal kedaluwarsa) dengan pencarian dan filter status, plus tombol
**+ Buat pengumuman**, **Edit**, **Aktifkan/Nonaktifkan**, dan **Hapus**. Form buat/edit berisi
judul, konten (textarea), tipe, dan tanggal kedaluwarsa opsional (`datetime-local`), dilengkapi
preview banner sesuai warna tipenya, serta toggle **Kirim notifikasi email** (default aktif).
Tabel admin menampilkan status pengiriman email.

### Banner di panel user

`components/announcements/AnnouncementBanners.tsx` dipasang di `DashboardShell` dan hanya aktif di
path yang terdaftar pada `ANNOUNCEMENT_BANNER_PATHS` (default: `/dashboard`, `/servers`).

- Warna mengikuti tipe: **info** biru, **warning** kuning, **danger** merah, **success** hijau.
- Beberapa pengumuman aktif → ditumpuk vertikal di bawah navbar.
- Tombol ✕ menutup banner dan menyimpan ID-nya di `localStorage`
  (kunci `hyunk.announcements.dismissed`), jadi tidak muncul lagi untuk user itu.
- Disegarkan tiap 60 detik; pengumuman yang sudah lewat `expires_at` hilang sendiri.
- Gagal memuat pengumuman tidak pernah mengganggu halaman (fail-safe: banner tidak tampil).

### API routes

| Endpoint | Auth | Fungsi |
|---|---|---|
| `GET /api/announcements` | publik | semua pengumuman yang sedang tayang (maks 20, hanya kolom aman) |
| `GET /api/admin/announcements` | Owner Panel & Admin | semua pengumuman + username pembuat + jumlah yang tayang |
| `POST /api/admin/announcements` | Owner Panel & Admin | buat pengumuman `{ title, content, type?, expires_at?, send_email? }`; default `send_email: true` |
| `PATCH /api/admin/announcements/[id]` | Owner Panel & Admin | edit sebagian field, toggle `is_active`/`send_email`, `expires_at: null` = permanen |
| `DELETE /api/admin/announcements/[id]` | Owner Panel & Admin | hapus pengumuman |

Semua aksi admin dicatat di audit log (`/activity`) sebagai `admin:announcement-create`,
`admin:announcement-update`, dan `admin:announcement-delete`.

## Batasan yang disengaja (mengikuti brief)

- ❌ Tidak ada billing/payment. ❌ Tidak ada auto-provisioning massal.
- ❌ Panel tidak pernah menyentuh `/var/lib/pterodactyl/volumes` kecuali perintah eksplisit
  user lewat UI (file manager/backup).
- ❌ "Hapus permanen server + data" selalu butuh konfirmasi ganda (ketik nama server).
  Mode default hanya menghapus record panel.
- Live stats per server bergantung pada `GET /api/servers/{uuid}` Wings (polling ringan) dan
  stream WebSocket; Vercel serverless **tidak** menjaga koneksi WS persistent — itu sebabnya
  browser yang memegang socket.

## Theme & Appearance

Kustomisasi tampilan ada di **Appearance** (sidebar) atau lewat tombol 🎨 di topbar (drawer cepat).

- **Tema warna** (9): Dark (default), Light, Ocean, Forest, Sakura, Ember, Midnight Purple, Slate, System (ikut OS).
  Tema dipasang lewat `next-themes` (atribut `data-theme` di `<html>`).
- **Latar**: solid (warna tema), gradient animasi, 6 wallpaper bawaan (`public/wallpapers/`), atau foto sendiri
  (disimpan di localStorage sebagai base64, dikompres otomatis ke ±2.5 MB).
- **Glassmorphism** untuk sidebar & card dengan opacity 30–90%, **warna aksen** bebas + 8 preset,
  **ukuran font** (Small/Medium/Large), dan **compact mode**.
- Semua preferensi tersimpan di localStorage (`hyunk-theme`, `hyunk-appearance`, `hyunk-appearance-bg`)
  dan diterapkan sebagai CSS variables di `document.documentElement` sebelum halaman tergambar
  (inline script di `<head>`, lihat `lib/appearance/init-script.ts`).
- Untuk membaca/mengubah preferensi dari komponen mana pun: `useAppearance()` (`hooks/useAppearance.ts`).
- Menambah tema baru: tambah entri di `PALETTES` (`lib/appearance/config.ts`) — 8 warna dasar
  (`bgPrimary`, `bgSecondary`, `bgSidebar`, `textPrimary`, `textSecondary`, `accent`, `border`, `card`).

## Struktur

```
app/            → halaman (App Router) + API routes (panel + remote)
  (auth)/       → login, register, verify-email, forgot-password, reset-password
  auth/callback → landing link email Supabase (verifikasi signup & reset password)
components/     → UI, layout, console (websocket), console/file manager server, power, backup, users,
                  terminal/ (xterm.js VPS terminal), vps/ (VPS cards, monitoring, SFTP file manager),
                  announcements/ (banner pengumuman), admin/ (AnnouncementsAdmin, SubdomainsAdmin),
                  notifications/ (email settings), status/ (public status page),
                  theme/ (ThemeProvider, AppearanceControls, drawer appearance), ui/Toaster (toast global)
hooks/          → useWingsConsole (websocket), useServerStatus (polling)
lib/
  wings/        → client.ts (SATU-SATUNYA pintu ke Wings), crypto.ts (AES-256-GCM),
                  jwt.ts (HS256 token kompatibel wings), types.ts, resolve.ts
  remote/       → auth.ts (validasi wings→panel), config.ts (settings/process builder)
  supabase/     → client browser/server/service
  auth/         → session.ts, rbac.ts (checkPermission)
  announcements.ts → aturan pengumuman (tipe, validasi, kedaluwarsa) — dipakai API & banner
  notifications.ts / announcement-email.ts → SMTP template, preference guard, delivery log, broadcast batch
  cron.ts → validasi CRON_SECRET untuk semua cron
  appearance/   → config.ts (palet & default), apply.ts (CSS variables), init-script.ts (anti-flash),
                  storage.ts, image.ts (kompres foto custom)
  storage/      → auto backup: crypto.ts (enkripsi kredensial), schedule.ts (next_run_at),
                  tokens.ts (refresh OAuth), gdrive/dropbox/s3/sftp/webdav.ts (upload
                  streaming), backupJob.ts (pipeline cron/manual/admin)
  terminal/     → jwt.ts (JWT HS256 35 menit untuk terminal service eksternal)
  vps/          → access.ts/http.ts (owner/assignment guard), ssh.ts (SSH/SFTP),
                  stats.ts (monitoring + cache 10 detik), validation.ts
  utils/        → format.ts, constants.ts, toast.ts (toast store), app-url.ts (emailRedirectTo auth)
supabase/migrations/001_initial.sql
supabase/migrations/002_role_management.sql
supabase/migrations/003_egg_system.sql
supabase/migrations/004_auto_download.sql
supabase/migrations/005_auto_backup.sql
supabase/migrations/006_server_subdomains.sql
supabase/migrations/007_auto_server_users.sql
supabase/migrations/008_count_user_subdomains.sql
supabase/migrations/009_drop_subdomain_quota.sql
supabase/migrations/010_add_backup_schedule_permission.sql
supabase/migrations/011_announcements.sql
supabase/migrations/012_vps_terminal.sql
supabase/migrations/013_status_notifications.sql
```

## Catatan operasional

- **Timeout Vercel**: cron server-status/node-status dan announcement email memakai `maxDuration: 300`;
  pastikan plan Vercel mendukung durasi tersebut. Semua panggilan wings di repo ini
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
