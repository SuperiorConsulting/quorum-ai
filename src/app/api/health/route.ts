import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma.js'

/**
 * GET /api/health
 *
 * Used by Railway healthcheck and uptime monitors.
 * Returns 200 when DB is reachable, 503 when it isn't.
 */
export async function GET(): Promise<NextResponse> {
  const start = Date.now()

  try {
    // Lightweight DB ping — $queryRaw is cheaper than a real table query
    await prisma.$queryRaw`SELECT 1`

    return NextResponse.json(
      {
        status:  'ok',
        db:      'connected',
        latency: `${Date.now() - start}ms`,
        version: process.env['npm_package_version'] ?? '1.0.0',
        env:     process.env['NODE_ENV'] ?? 'development',
      },
      { status: 200 },
    )
  } catch (err) {
    console.error('[Health] DB ping failed:', err)
    return NextResponse.json(
      {
        status:  'degraded',
        db:      'unreachable',
        latency: `${Date.now() - start}ms`,
        error:   err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 503 },
    )
  }
}
