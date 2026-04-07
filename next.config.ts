import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Use custom server (server.ts) which adds Socket.io
  // Railway start command: node dist/server.js
  // Local dev: npx ts-node --esm server.ts

  experimental: {
    // Required for server components to use Node.js APIs (prisma, fs, etc.)
    serverComponentsExternalPackages: [
      '@prisma/client',
      '@prisma/adapter-pg',
      'pg',
      'twilio',
      '@anthropic-ai/sdk',
      'socket.io',
    ],
  },

  // Webpack config: mark server-only packages as external in client bundles
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
      }
    }
    return config
  },
}

export default nextConfig
