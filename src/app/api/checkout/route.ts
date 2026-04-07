import { NextRequest, NextResponse } from 'next/server'
import { createCheckoutSession, PLAN_CONFIG, type QuorumPlan } from '../../../lib/stripe.js'

const VALID_PLANS: QuorumPlan[] = ['STARTER', 'GROWTH', 'ENTERPRISE']

// ─── POST — Create Stripe Checkout Session ────────────────────────────────────

/**
 * Body: { plan: QuorumPlan, businessId: string, email: string }
 * Returns: { url: string } — redirect the browser to this URL
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const plan = body['plan'] as QuorumPlan | undefined
  const businessId = body['businessId'] as string | undefined
  const email = body['email'] as string | undefined

  if (!plan || !VALID_PLANS.includes(plan)) {
    return NextResponse.json(
      { error: `plan must be one of: ${VALID_PLANS.join(', ')}` },
      { status: 400 },
    )
  }

  if (!email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 })
  }

  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'
  const resolvedBusinessId = businessId ?? `pending-${Date.now()}`

  try {
    const session = await createCheckoutSession(
      resolvedBusinessId,
      plan,
      email,
      `${appUrl}/pricing/success?plan=${plan}`,
      `${appUrl}/pricing/cancel`,
    )

    return NextResponse.json({ url: session.url, sessionId: session.sessionId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create checkout session'
    console.error('[Checkout] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── GET — Return plan config for the pricing page ───────────────────────────

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    plans: Object.entries(PLAN_CONFIG).map(([key, config]) => ({
      id: key,
      name: config.name,
      setupFee: config.setupFeeAmount / 100,
      monthly: config.monthlyAmount / 100,
      features: config.features,
    })),
  })
}
