import { NextRequest, NextResponse } from 'next/server'
import { handleStripeWebhook } from '../../../lib/stripe.js'

// ─── POST — Stripe webhook ────────────────────────────────────────────────────

/**
 * Stripe sends webhook events here.
 * IMPORTANT: Must read raw body before any parsing — Stripe verifies the signature
 * against the exact raw bytes.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe-Signature header' }, { status: 400 })
  }

  // Read raw body — do NOT use req.json()
  const rawBody = await req.text()

  try {
    const result = await handleStripeWebhook(rawBody, signature)
    return NextResponse.json({ received: true, event: result.event })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook processing failed'
    console.error('[Stripe Webhook] Error:', err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

// ─── GET — health check ───────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: 'ok', service: 'stripe-webhook' })
}
