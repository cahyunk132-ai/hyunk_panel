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
      `connect-src 'self' ${supabaseOrigin} https://api.modrinth.com https://vitals.vercel-insights.com ${websocketSources}`,
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
