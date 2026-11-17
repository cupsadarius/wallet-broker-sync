import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['keytar', 'better-sqlite3'],
  async headers() {
    return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] }]
  },
};

export default nextConfig;
