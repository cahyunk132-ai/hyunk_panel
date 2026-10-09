/** @type {import('next').NextConfig} */
const nextConfig = {
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
