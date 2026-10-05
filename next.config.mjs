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
  },
};

export default nextConfig;
