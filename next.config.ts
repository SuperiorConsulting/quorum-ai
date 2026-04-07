import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Next.js 15: moved out of experimental
  serverExternalPackages: [
    '@prisma/client',
    '@prisma/adapter-pg',
    'pg',
    'twilio',
    '@anthropic-ai/sdk',
    'socket.io',
    'bcryptjs',
  ],

  webpack: (config, { isServer }) => {
    // Allow webpack to resolve .js imports that map to .ts source files
    config.resolve.extensionAlias = {
      '.js':  ['.ts', '.tsx', '.js', '.jsx'],
      '.jsx': ['.tsx', '.jsx'],
    }

    // Mark server-only packages as external in client bundles
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs:            false,
        net:           false,
        tls:           false,
        dns:           false,
        child_process: false,
      }
    }

    return config
  },
}

export default nextConfig
