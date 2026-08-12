/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output packs only the required deps + code into
  // .next/standalone — the Docker runtime image ships that and skips
  // the full node_modules tree (~1.5GB → ~200MB).
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'img.bricklink.com' },
    ],
    // Cache Bilder 1 Jahr — LEGO-Teilbilder ändern sich nie
    minimumCacheTTL: 60 * 60 * 24 * 365,
  },
  poweredByHeader: false,
  async headers() {
    // Content-Security-Policy: 'unsafe-inline' + 'unsafe-eval' are required by
    // Next.js dev mode (hot-reload / react-refresh); production Next needs
    // 'unsafe-inline' for its injected style tags. img-src includes
    // img.bricklink.com because part thumbnails come from there.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://img.bricklink.com",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')

    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
        { key: 'Content-Security-Policy', value: csp },
      ],
    }]
  },
};

module.exports = nextConfig;
