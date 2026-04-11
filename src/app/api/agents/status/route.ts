import { NextResponse } from 'next/server'
import { getAllAgentStatuses } from '../../../../agents/registry.js'

/**
 * GET /api/agents/status
 *
 * Returns current status, last action, and health score for all 6 command staff agents.
 * Polled every 60s by Mission Control.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const statuses = getAllAgentStatuses()
    return NextResponse.json({ agents: statuses }, { status: 200 })
  } catch (err) {
    console.error('[Agents/Status] Failed to retrieve agent statuses:', err)
    return NextResponse.json(
      { error: 'Failed to retrieve agent statuses' },
      { status: 500 },
    )
  }
}
