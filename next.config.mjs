/** @type {import('next').NextConfig} */
const isDevelopment = process.env.NODE_ENV !== 'production';
const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

function originOf(value, fallback) {
  try {
    return value ? new URL(value).origin : fallback;
  } catch {
    return fallback;
  }
}

const appOrigin = originOf(configuredAppUrl, 'https://panel.wangstore.web.id');
const supabaseOrigin = originOf(configuredSupabaseUrl, 'https://*.supabase.co');
const websocketSources = isDevelopment ? 'wss: ws:' : 'wss:';

/** Base domain node/subdomain, dipakai untuk menyusun izin CSP ke Wings. */
const baseDomain = (process.env.NEXT_PUBLIC_BASE_DOMAIN?.trim() || 'wangstore.web.id')
  .replace(/^\.+/, '')
  .replace(/\.+$/, '')
  .toLowerCase();

/**
 * Normalisasi satu entri menjadi CSP host-source.
 * Menerima: `node2.example.com`, `node2.example.com:8080`,
 * `https://node2.example.com:8080`, atau wildcard `*.example.com:*`.
 *
 * Wings SELALU dihubungi lewat https (lihat lib/wings/client.ts), jadi entri
 * tanpa skema dianggap https.
 */
function toHostSource(entry) {
  const value = String(entry ?? '').trim().replace(/\/+$/, '');
  if (!value) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host}`;
    } catch {
      return null;
    }
  }
  return `https://${value}`;
}

/**
 * Daftar origin Wings yang boleh dihubungi BROWSER (bukan server).
 *
 * Upload & download file dilakukan langsung dari browser ke Wings memakai
 * signed JWT (supaya file besar tidak kena limit body 4.5 MB Vercel). Tanpa
 * origin node di `connect-src`, browser memblokir request-nya dengan
 * "Refused to connect ... violates connect-src" dan UI menampilkan
 * "Koneksi ke node terputus saat upload".
 *
 * Urutan prioritas:
 *  1. `NEXT_PUBLIC_WINGS_ORIGINS` — daftar eksplisit (pisahkan dengan koma),
 *     dipakai bila node berada di domain lain di luar base domain.
 *  2. Default: semua subdomain base domain, SEMUA port (`https://*.base:*`),
 *     karena port Wings default 8080 dan CSP tanpa `:port` hanya mengizinkan 443.
 */
const configuredWingsOrigins = (process.env.NEXT_PUBLIC_WINGS_ORIGINS ?? '')
  .split(/[\s,]+/)
  .map(toHostSource)
  .filter(Boolean);

const defaultWingsOrigins = [
  `https://${baseDomain}`,
  `https://*.${baseDomain}`,
  `https://*.${baseDomain}:*`,
  ...(isDevelopment ? [`http://${baseDomain}`, `http://*.${baseDomain}:*`] : []),
];

const wingsOrigins = configuredWingsOrigins.length ? configuredWingsOrigins : defaultWingsOrigins;

/** Terminal VPS memakai WebSocket eksternal (ws:// saat dev, wss:// saat produksi). */
const terminalSources = (() => {
  const raw = process.env.TERMINAL_SERVICE_URL?.trim();
  if (!raw) return [];
  try {
    const url = new URL(raw);
    const wsProtocol = url.protocol === 'https:' ? 'wss:' : url.protocol === 'http:' ? 'ws:' : null;
    return [`${url.protocol}//${url.host}`, ...(wsProtocol ? [`${wsProtocol}//${url.host}`] : [])];
  } catch {
    return [];
  }
})();

const localDevSources = isDevelopment
  ? [
      'http://localhost:*',
      'https://localhost:*',
      'ws://localhost:*',
      'http://127.0.0.1:*',
      'https://127.0.0.1:*',
      'ws://127.0.0.1:*',
    ]
  : [];

const connectSrc = Array.from(
  new Set(
    [
      "'self'",
      supabaseOrigin,
      ...wingsOrigins,
      ...terminalSources,
      ...localDevSources,
      // Plugin/Bedrock addon downloader memanggil Modrinth langsung dari browser.
      'https://api.modrinth.com',
      'https://vitals.vercel-insights.com',
      websocketSources,
    ].filter(Boolean),
  ),
).join(' ');

const securityHeaders = [
  // Keep the panel and any subdomains below panel.wangstore.web.id HTTPS-only.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // The theme initializer is intentionally inline to avoid a theme flash;
      // all other application scripts are emitted by Next from this origin.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      `connect-src ${connectSrc}`,
      // Signed download/upload URL Wings dibuka sebagai navigation/blob, bukan fetch.
      "media-src 'self' blob: https:",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // The panel does not expose private data to arbitrary origins. Keep the
  // browser-facing CORS allowlist limited to the canonical panel origin.
  { key: 'Access-Control-Allow-Origin', value: appOrigin },
  { key: 'Access-Control-Allow-Credentials', value: 'true' },
  { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' },
  { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
];

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  eslint: {
    // ESLint config is not shipped in this repo; don't fail production builds on lint.
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
    // ssh2 (SFTP storage) punya optional native dependency (cpu-features) yang
    // tidak bisa di-bundle — biarkan di node_modules saat runtime serverless.
    serverComponentsExternalPackages: ['ssh2', 'ssh2-sftp-client'],
  },
};

export default nextConfig;
