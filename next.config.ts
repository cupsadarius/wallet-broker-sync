import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['keytar', 'better-sqlite3'],
  // pdfjs loads @napi-rs/canvas at runtime (DOMMatrix polyfill), which file tracing cannot see.
  outputFileTracingIncludes: { '/**': ['./node_modules/@napi-rs/canvas*/**'] },
  async redirects() {
    return [
      { source: '/dashboard', destination: '/invest', permanent: false },
      { source: '/dashboard/holdings', destination: '/invest', permanent: false },
      { source: '/dashboard/performance', destination: '/invest?tab=performance', permanent: false },
    ]
  },
  async headers() {
    return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] }]
  },
};

export default nextConfig;
