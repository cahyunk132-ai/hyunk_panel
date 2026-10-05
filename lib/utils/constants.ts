export const APP_NAME = 'HYUNK PANEL';
export const APP_TAGLINE = 'One Panel. Every Node. Every Server.';

/** Preset stop per tipe server — dipakai Remote API (process_configuration.stop). */
export const DEFAULT_STOP_COMMANDS: Array<{ match: RegExp; value: string }> = [
  { match: /source/i, value: 'quit' },
];

/** Endpoint Wings yang diizinkan keluar dari satu tempat: lib/wings/client.ts */
export const WINGS_DEFAULT_PORT = 8080;

/** TTL sementara untuk token WebSocket console (5 menit — sesuai aturan keamanan). */
export const WS_TOKEN_TTL_SECONDS = 300;

/** Panjang maksimum konten file yang boleh diedit di browser (2 MB). */
export const MAX_EDITABLE_FILE_BYTES = 2 * 1024 * 1024;
