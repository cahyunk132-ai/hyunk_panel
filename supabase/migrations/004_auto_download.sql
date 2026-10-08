-- ============================================================================
-- HYUNK PANEL — Migration 004: Generic Auto Download System untuk Egg
-- ============================================================================
-- Apply after migration 003.
--
-- Menambahkan konfigurasi auto-download pada egg_versions:
--   download_provider      → 'none' | built-in (paper/purpur/vanilla/fabric/
--                            forge/neoforge/quilt/bedrock) | 'custom'
--   download_url_template  → template URL untuk provider 'custom', mis.
--                            https://example.com/download/{VERSION}/{FILE}
--   download_variables     → key-value untuk substitusi template + override
--                            resolusi built-in (MC_VERSION, BUILD, dsb.)
--   download_filename      → nama file hasil download yang diupload ke Wings
--   download_executable    → true bila file perlu chmod +x (binary non-jar,
--                            mis. bedrock_server)

alter table public.egg_versions
  add column if not exists download_provider text default 'none'
    check (download_provider in (
      'paper','purpur','vanilla','fabric','forge','neoforge','quilt','bedrock','custom','none'
    )),
  add column if not exists download_url_template text,
  add column if not exists download_variables jsonb default '{}'::jsonb,
  add column if not exists download_filename text default 'server.jar',
  add column if not exists download_executable boolean default false;
