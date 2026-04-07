import StripeLib from 'stripe'
import { prisma } from './prisma.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuorumPlan = 'STARTER' | 'GROWTH' | 'ENTERPRISE'

export interface PlanConfig {
  name: string
  setupFeeAmount: number  // cents
  monthlyAmount: number   // cents
  stripePriceId: string   // from env
  stripeSetupPriceId: string
  features: string[]
}

export interface CheckoutResult {
  url: string
  sessionId: string
}

export interface SubscriptionResult {
  subscriptionId: string
  customerId: string
  status: string
  currentPeriodEnd: Date
}

// ─── Plan config ──────────────────────────────────────────────────────────────

export const PLAN_CONFIG: Record<QuorumPlan, PlanConfig> = {
  STARTER: {
    name: 'Starter',
    setupFeeAmount: 49700,  // $497
    monthlyAmount: 49700,   // $497/mo
    stripePriceId:      process.env['STRIPE_STARTER_MONTHLY_PRICE_ID'] ?? '',
    stripeSetupPriceId: process.env['STRIPE_STARTER_SETUP_PRICE_ID'] ?? '',
    features: [
      'Up to 500 leads',
      'SMS + Email outreach',
      'Voice AI (500 min/mo)',
      'Morning briefings',
      'GoHighLevel sync',
      '1 vertical',
    ],
  },
  GROWTH: {
    name: 'Growth',
    setupFeeAmount: 99700,  // $997
    monthlyAmount: 99700,   // $997/mo
    stripePriceId:      process.env['STRIPE_GROWTH_MONTHLY_PRICE_ID'] ?? '',
    stripeSetupPriceId: process.env['STRIPE_GROWTH_SETUP_PRICE_ID'] ?? '',
    features: [
      'Up to 2,500 leads',
      'SMS + Email + Voice',
      'Voice AI (2,000 min/mo)',
      'Win-back sequences',
      'Multi-vertical support',
      'Real estate brokerage routing',
      'Priority support',
    ],
  },
  ENTERPRISE: {
    name: 'Enterprise',
    setupFeeAmount: 299700, // $2,997
    monthlyAmount: 299700,  // $2,997/mo
    stripePriceId:      process.env['STRIPE_ENTERPRISE_MONTHLY_PRICE_ID'] ?? '',
    stripeSetupPriceId: process.env['STRIPE_ENTERPRISE_SETUP_PRICE_ID'] ?? '',
    features: [
      'Unlimited leads',
      'Voice AI (unlimited)',
      'Custom voice cloning',
      'All 14 verticals',
      'White-label available',
      'Dedicated success manager',
      'Custom n8n workflows',
      'SLA guarantee',
    ],
  },
}

// ─── Stripe client ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StripeInstance = any

function getStripe(): StripeInstance {
  const key = process.env['STRIPE_SECRET_KEY']
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  // StripeLib is the constructor function in v22
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return new (StripeLib as unknown as new (key: string, opts: Record<string, string>) => StripeInstance)(key, {
    apiVersion: '2025-03-31.basil',
  })
}

// ─── Checkout ─────────────────────────────────────────────────────────────────

/**
 * Creates a Stripe Checkout Session for a new business signing up.
 * Collects setup fee + starts monthly subscription.
 *
 * @param businessId   - Quorum business ID (used for metadata)
 * @param plan         - Plan to subscribe to
 * @param ownerEmail   - Business owner's email
 * @param successUrl   - Redirect after successful payment
 * @param cancelUrl    - Redirect if user cancels
 */
export async function createCheckoutSession(
  businessId: string,
  plan: QuorumPlan,
  ownerEmail: string,
  successUrl: string,
  cancelUrl: string,
): Promise<CheckoutResult> {
  const stripe = getStripe()
  const config = PLAN_CONFIG[plan]

  const lineItems: Array<{ price?: string; price_data?: Record<string, unknown>; quantity: number }> = []

  // Setup fee (one-time)
  if (config.stripeSetupPriceId) {
    lineItems.push({ price: config.stripeSetupPriceId, quantity: 1 })
  }

  // Monthly subscription
  if (config.stripePriceId) {
    lineItems.push({ price: config.stripePriceId, quantity: 1 })
  }

  // Fallback: inline price if price IDs not configured
  if (lineItems.length === 0) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: { name: `Quorum ${config.name} — Setup Fee` },
        unit_amount: config.setupFeeAmount,
      },
      quantity: 1,
    })
  }

  const hasSubscriptionPrices = lineItems.some((li) => li.price)

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const session = await stripe.checkout.sessions.create({
    mode: hasSubscriptionPrices ? 'subscription' : 'payment',
    customer_email: ownerEmail,
    line_items: lineItems,
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    metadata: {
      businessId,
      plan,
      quorum: 'true',
    },
    subscription_data: hasSubscriptionPrices
      ? { metadata: { businessId, plan }, trial_period_days: 0 }
      : undefined,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
  })

  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    url: (session.url as string) ?? '',
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    sessionId: session.id as string,
  }
}

/**
 * Creates a standalone payment link (for one-off invoices, upgrade fees, etc.).
 *
 * @param businessId  - Business to associate payment with
 * @param amount      - Amount in cents
 * @param description - What the payment is for
 * @param successUrl  - Redirect after payment
 */
export async function createPaymentLink(
  businessId: string,
  amount: number,
  description: string,
  successUrl: string,
): Promise<string> {
  const stripe = getStripe()

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: description },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    metadata: { businessId, description },
  })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return (session.url as string) ?? ''
}

// ─── Subscription management ──────────────────────────────────────────────────

/**
 * Retrieves subscription details for a business.
 *
 * @param businessId - Quorum business ID
 */
export async function getSubscription(businessId: string): Promise<SubscriptionResult | null> {
  const sub = await prisma.subscription.findUnique({
    where: { businessId },
    select: { stripeSubscriptionId: true, status: true },
  })

  if (!sub?.stripeSubscriptionId) return null

  try {
    const stripe = getStripe()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const customerId = typeof stripeSub.customer === 'string' ? stripeSub.customer : (stripeSub.customer as { id: string }).id
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const periodEnd = stripeSub.current_period_end as number

    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      subscriptionId: stripeSub.id as string,
      customerId: customerId as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      status: stripeSub.status as string,
      currentPeriodEnd: new Date(periodEnd * 1000),
    }
  } catch (err) {
    console.error('[Stripe] getSubscription error:', err)
    return null
  }
}

/**
 * Cancels a subscription at period end.
 *
 * @param businessId - Quorum business ID
 */
export async function cancelSubscription(businessId: string): Promise<boolean> {
  const sub = await prisma.subscription.findUnique({
    where: { businessId },
    select: { stripeSubscriptionId: true },
  })

  if (!sub?.stripeSubscriptionId) return false

  try {
    const stripe = getStripe()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    })

    await prisma.subscription.update({
      where: { businessId },
      data: { status: 'CANCELLED' },
    })

    return true
  } catch (err) {
    console.error('[Stripe] cancelSubscription error:', err)
    return false
  }
}

// ─── Webhook handler ──────────────────────────────────────────────────────────

/**
 * Processes incoming Stripe webhook events.
 * Must be called with the raw body (not parsed JSON) for signature verification.
 *
 * @param rawBody      - Raw request body as string
 * @param signature    - Stripe-Signature header value
 */
export async function handleStripeWebhook(
  rawBody: string,
  signature: string,
): Promise<{ handled: boolean; event: string }> {
  const stripe = getStripe()
  const secret = process.env['STRIPE_WEBHOOK_SECRET']
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not set')

  let event: Record<string, unknown>
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    event = stripe.webhooks.constructEvent(rawBody, signature, secret) as Record<string, unknown>
  } catch (err) {
    console.error('[Stripe] Webhook signature verification failed:', err)
    throw new Error('Invalid Stripe webhook signature')
  }

  const eventType = event['type'] as string
  const obj = event['data'] !== null && typeof event['data'] === 'object'
    ? (event['data'] as Record<string, unknown>)['object'] as Record<string, unknown>
    : {}

  switch (eventType) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(obj)
      break
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(obj)
      break
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(obj)
      break
    case 'invoice.payment_failed':
      await handlePaymentFailed(obj)
      break
    case 'invoice.payment_succeeded':
      await handlePaymentSucceeded(obj)
      break
    default:
      break
  }

  return { handled: true, event: eventType }
}

// ─── Webhook sub-handlers ─────────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Record<string, unknown>): Promise<void> {
  const metadata = session['metadata'] as Record<string, string> | undefined
  const businessId = metadata?.['businessId']
  const plan = metadata?.['plan'] as QuorumPlan | undefined

  if (!businessId || !plan) {
    console.warn('[Stripe] checkout.session.completed missing businessId/plan metadata')
    return
  }

  const customerId = typeof session['customer'] === 'string' ? session['customer'] : ''
  const subscriptionId = typeof session['subscription'] === 'string' ? session['subscription'] : ''

  // Get plan pricing
  const config = PLAN_CONFIG[plan]
  const setupFee = config?.setupFeeAmount ?? 0
  const monthly = config?.monthlyAmount ?? 0

  await prisma.subscription.upsert({
    where: { businessId },
    create: {
      businessId,
      plan,
      status: 'ACTIVE',
      setupFeeAmount: setupFee / 100,
      monthlyRetainer: monthly / 100,
      stripeSubscriptionId: subscriptionId,
      nextBillingAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    update: {
      plan,
      status: 'ACTIVE',
      stripeSubscriptionId: subscriptionId || undefined,
    },
  })

  await prisma.business.update({
    where: { id: businessId },
    data: { plan },
  })

  console.log(`[Stripe] Checkout complete — business ${businessId} on ${plan} (customer ${customerId})`)
}

async function handleSubscriptionUpdated(sub: Record<string, unknown>): Promise<void> {
  const subId = sub['id'] as string
  if (!subId) return

  const status = (sub['status'] as string).toUpperCase()
  const periodEnd = sub['current_period_end'] as number | undefined

  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: subId },
    data: {
      status: (status === 'ACTIVE' ? 'ACTIVE' : status === 'PAST_DUE' ? 'PAST_DUE' : 'CANCELLED') as 'ACTIVE' | 'PAST_DUE' | 'CANCELLED',
      ...(periodEnd ? { nextBillingAt: new Date(periodEnd * 1000) } : {}),
    },
  })
}

async function handleSubscriptionDeleted(sub: Record<string, unknown>): Promise<void> {
  const subId = sub['id'] as string
  if (!subId) return

  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: subId },
    data: { status: 'CANCELLED' },
  })

  const metadata = sub['metadata'] as Record<string, string> | undefined
  const businessId = metadata?.['businessId']
  if (businessId) {
    await prisma.business.update({
      where: { id: businessId },
      data: { plan: 'STARTER' }, // Downgrade to lowest paid tier or keep at STARTER
    })
    console.log(`[Stripe] Subscription cancelled — business ${businessId}`)
  }
}

async function handlePaymentFailed(invoice: Record<string, unknown>): Promise<void> {
  const subId = typeof invoice['subscription'] === 'string' ? invoice['subscription'] : null
  if (!subId) return

  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: subId },
    data: { status: 'PAST_DUE' },
  })

  console.warn(`[Stripe] Payment failed for subscription ${subId}`)
}

async function handlePaymentSucceeded(invoice: Record<string, unknown>): Promise<void> {
  const subId = typeof invoice['subscription'] === 'string' ? invoice['subscription'] : null
  if (!subId) return

  const periodEnd = invoice['period_end'] as number | undefined

  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: subId },
    data: {
      status: 'ACTIVE',
      ...(periodEnd ? { nextBillingAt: new Date(periodEnd * 1000) } : {}),
    },
  })
}
