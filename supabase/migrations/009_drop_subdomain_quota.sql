-- ============================================================================
-- HYUNK PANEL — Migration 009: hapus kuota subdomain per user
-- ============================================================================
-- Sistem subdomain berubah jadi: SATU subdomain aktif per server, TANPA kuota
-- per user. Siapa pun yang punya akses ke server (servers.owner_id atau baris di
-- server_users) boleh mendaftarkan & menghapus subdomain server itu.
--
-- Function public.count_user_subdomains(uuid) (migrasi 008) sudah tidak dipakai
-- kode panel — dihapus di sini supaya tidak ada logika kuota yang tertinggal.
-- Batas "satu subdomain per server" tetap dijaga unique index
-- server_subdomains_server_id_key (migrasi 006).
--
-- Aman dijalankan ulang (idempotent). Jalankan setelah 008.
-- ============================================================================

drop function if exists public.count_user_subdomains(uuid);
