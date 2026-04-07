import { NextRequest, NextResponse } from 'next/server'
import { deliverMorningBriefing, collectOvernightStats } from '../../../agents/morning-briefing.js'

// ─── POST — Trigger a morning briefing manually ───────────────────────────────

/**
 * Manually triggers a morning briefing for a business.
 * Used by the dashboard and for testing.
 *
 * Body: { businessId: string, triggerCall?: boolean }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const businessId = body['businessId'] as string | undefined
  const triggerCall = body['triggerCall'] === true

  if (!businessId) {
    return NextResponse.json({ error: 'businessId required' }, { status: 400 })
  }

  // Simple API key check for manual triggers
  const apiKey = req.headers.get('x-quorum-secret')
  const expected = process.env['QUORUM_WEBHOOK_SECRET']
  if (expected && apiKey !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await deliverMorningBriefing(businessId, triggerCall)
    return NextResponse.json({
      success: true,
      briefingId: result.briefingId,
      stats: result.stats,
      emailSent: result.emailSent,
      callTriggered: result.callTriggered,
      scriptPreview: result.script.slice(0, 200),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Briefing failed'
    console.error('[Briefing API] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── GET — Preview overnight stats without delivering ────────────────────────

/**
 * Returns overnight stats for a business without triggering delivery.
 * Query: ?businessId=xxx
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const businessId = searchParams.get('businessId')

  if (!businessId) {
    return NextResponse.json({ error: 'businessId required' }, { status: 400 })
  }

  try {
    const stats = await collectOvernightStats(businessId)
    return NextResponse.json({ stats })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to collect stats'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
