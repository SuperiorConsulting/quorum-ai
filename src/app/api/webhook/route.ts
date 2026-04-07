import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma.js'
import { sendSMS, sendEmail, sendTemplatedEmail } from '../../../lib/messaging.js'
import { enrollInWinback } from '../../../agents/winback-agent.js'
import { processInboundRELead } from '../../../verticals/real-estate/lead-sources.js'

// ─── Webhook secret validation ────────────────────────────────────────────────

function validateSecret(req: NextRequest): boolean {
  const secret = process.env['QUORUM_WEBHOOK_SECRET']
  if (!secret) return true // No secret configured — allow all (dev mode)
  const incoming = req.headers.get('x-quorum-secret') ?? req.headers.get('x-webhook-secret')
  return incoming === secret
}

// ─── POST — n8n callback handler ─────────────────────────────────────────────

/**
 * Main callback endpoint for n8n workflows.
 * n8n fires POST requests here after completing its side of each workflow.
 *
 * Body always includes: { event: string, ...payload }
 *
 * Supported events:
 *   lead.intake          — New lead from external source (Zillow, FB Ads, etc.)
 *   lead.review_request  — Time to send review request (n8n waited 24h after close)
 *   lead.winback         — n8n dormancy check found a lead to enroll
 *   lead.escalate_ack    — Agent has been notified, update lead record
 *   appointment.reminder — n8n-scheduled reminder (supplements Calendar cron)
 *   crm.sync_complete    — n8n finished CRM sync, log result
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = body['event'] as string | undefined
  if (!event) {
    return NextResponse.json({ error: 'Missing event field' }, { status: 400 })
  }

  console.log(`[Webhook] n8n callback: ${event}`)

  try {
    switch (event) {
      case 'lead.intake':
        return await handleLeadIntake(body)

      case 'lead.review_request':
        return await handleReviewRequest(body)

      case 'lead.winback':
        return await handleWinbackCallback(body)

      case 'lead.escalate_ack':
        return await handleEscalateAck(body)

      case 'appointment.reminder':
        return await handleAppointmentReminder(body)

      case 'crm.sync_complete':
        return handleCrmSyncComplete(body)

      default:
        console.warn(`[Webhook] Unknown n8n event: ${event}`)
        return NextResponse.json({ received: true, handled: false, event })
    }
  } catch (err) {
    console.error(`[Webhook] Error handling ${event}:`, err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ─── GET — health check ───────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: 'ok', service: 'n8n-webhook-callback' })
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * n8n received a lead from Zillow / Realtor.com / Facebook Ads / Google Ads
 * and normalized it into a standard format before calling back here.
 */
async function handleLeadIntake(body: Record<string, unknown>): Promise<NextResponse> {
  const businessId = body['businessId'] as string
  const source = (body['source'] as string) ?? 'web_form'
  const name = body['name'] as string
  const phone = body['phone'] as string | undefined
  const email = body['email'] as string | undefined
  const propertyAddress = body['propertyAddress'] as string | undefined
  const propertyPrice = body['propertyPrice'] ? Number(body['propertyPrice']) : undefined
  const message = body['message'] as string | undefined
  const vertical = (body['vertical'] as string | undefined) ?? 'REAL_ESTATE'

  if (!businessId || !name) {
    return NextResponse.json({ error: 'businessId and name required' }, { status: 400 })
  }

  if (vertical === 'REAL_ESTATE' || propertyAddress) {
    const result = await processInboundRELead(businessId, {
      source: source as 'zillow' | 'realtor_com' | 'facebook_ads' | 'google_ads' | 'web_form' | 'manual' | 'referral',
      name,
      phone,
      email,
      propertyAddress,
      propertyPrice,
      message,
    })
    return NextResponse.json({ received: true, leadId: result.leadId, isNew: result.isNew })
  }

  // Generic lead intake for non-RE verticals
  const existing = await prisma.lead.findFirst({
    where: {
      businessId,
      OR: [
        phone ? { phone } : {},
        email ? { email } : {},
      ].filter((c) => Object.keys(c).length > 0),
    },
    select: { id: true },
  })

  if (existing) {
    await prisma.lead.update({
      where: { id: existing.id },
      data: { lastInteractionAt: new Date() },
    })
    return NextResponse.json({ received: true, leadId: existing.id, isNew: false })
  }

  const newLead = await prisma.lead.create({
    data: {
      businessId,
      name,
      phone: phone ?? null,
      email: email ?? null,
      channel: phone ? 'SMS' : email ? 'EMAIL' : 'VOICE',
      source,
      pipelineStage: 'NEW',
      score: 15,
    },
  })

  return NextResponse.json({ received: true, leadId: newLead.id, isNew: true })
}

/**
 * n8n waited 24 hours after deal close, now tells Quorum to send the review request.
 */
async function handleReviewRequest(body: Record<string, unknown>): Promise<NextResponse> {
  const leadId = body['leadId'] as string
  const businessId = body['businessId'] as string

  if (!leadId || !businessId) {
    return NextResponse.json({ error: 'leadId and businessId required' }, { status: 400 })
  }

  const [lead, business] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { name: true, phone: true, email: true },
    }),
    prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true, phone: true },
    }),
  ])

  if (!lead || !business) {
    return NextResponse.json({ error: 'Lead or business not found' }, { status: 404 })
  }

  const reviewUrl = (body['reviewUrl'] as string | undefined)
    ?? process.env['GOOGLE_REVIEW_URL']
    ?? ''

  const firstName = lead.name.split(' ')[0] ?? 'there'

  if (lead.phone) {
    await sendSMS(
      lead.phone,
      `Hi ${firstName}, it was great working with ${business.name}! Mind leaving us a quick Google review? It really helps: ${reviewUrl}`,
    ).catch((err) => console.error('[Webhook] Review SMS failed:', err))
  }

  if (lead.email) {
    await sendTemplatedEmail(lead.email, 'review_request', {
      leadName: lead.name,
      businessName: business.name,
      reviewUrl,
    }).catch((err) => console.error('[Webhook] Review email failed:', err))
  }

  console.log(`[Webhook] Review request sent to ${lead.name}`)
  return NextResponse.json({ received: true, sent: true })
}

/**
 * n8n's dormancy check identified a lead to enroll in win-back.
 */
async function handleWinbackCallback(body: Record<string, unknown>): Promise<NextResponse> {
  const leadId = body['leadId'] as string
  const businessId = body['businessId'] as string

  if (!leadId || !businessId) {
    return NextResponse.json({ error: 'leadId and businessId required' }, { status: 400 })
  }

  const sequenceId = await enrollInWinback(leadId, businessId).catch((err) => {
    console.error('[Webhook] Win-back enroll failed:', err)
    return null
  })

  return NextResponse.json({ received: true, sequenceId })
}

/**
 * n8n confirmed the human agent was notified of an escalation.
 * Update lead record to reflect escalated status.
 */
async function handleEscalateAck(body: Record<string, unknown>): Promise<NextResponse> {
  const leadId = body['leadId'] as string
  const agentNotified = body['agentNotified'] as string | undefined

  if (!leadId) {
    return NextResponse.json({ error: 'leadId required' }, { status: 400 })
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      pipelineStage: 'QUALIFYING',
      lastInteractionAt: new Date(),
    },
  }).catch(() => {})

  console.log(`[Webhook] Escalation ack for ${leadId} — agent: ${agentNotified ?? 'unknown'}`)
  return NextResponse.json({ received: true })
}

/**
 * n8n triggered an appointment reminder (supplements the Railway cron).
 */
async function handleAppointmentReminder(body: Record<string, unknown>): Promise<NextResponse> {
  const appointmentId = body['appointmentId'] as string
  const minutesBefore = Number(body['minutesBefore'] ?? 60)

  if (!appointmentId) {
    return NextResponse.json({ error: 'appointmentId required' }, { status: 400 })
  }

  const { sendReminder } = await import('../../../lib/calendar.js')
  await sendReminder(appointmentId, minutesBefore)

  return NextResponse.json({ received: true })
}

/**
 * n8n confirms a CRM sync was completed — log it.
 */
function handleCrmSyncComplete(body: Record<string, unknown>): NextResponse {
  const leadId = body['leadId'] as string
  const ghlContactId = body['ghlContactId'] as string | undefined
  console.log(`[Webhook] CRM sync complete — lead ${leadId}, GHL contact ${ghlContactId ?? 'none'}`)
  return NextResponse.json({ received: true })
}
