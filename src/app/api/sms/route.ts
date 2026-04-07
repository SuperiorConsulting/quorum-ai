import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { prisma } from '../../../lib/prisma.js'
import { processInbound, resolveOrCreateLead } from '../../../agents/quorum.js'

// ─── Twilio webhook validation ────────────────────────────────────────────────

function validateTwilioRequest(req: NextRequest, rawBody: string): boolean {
  const authToken = process.env['TWILIO_AUTH_TOKEN']
  if (!authToken) return false

  const signature = req.headers.get('x-twilio-signature') ?? ''
  const url = process.env['NEXT_PUBLIC_APP_URL']
    ? `${process.env['NEXT_PUBLIC_APP_URL']}/api/sms`
    : req.url

  return twilio.validateRequest(authToken, signature, url, Object.fromEntries(
    new URLSearchParams(rawBody).entries(),
  ))
}

// ─── POST — Twilio inbound SMS webhook ───────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read raw body for signature validation
  const rawBody = await req.text()

  // Validate Twilio signature in production
  if (process.env['NODE_ENV'] === 'production') {
    const valid = validateTwilioRequest(req, rawBody)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid Twilio signature' }, { status: 403 })
    }
  }

  // Parse form-encoded body (Twilio sends application/x-www-form-urlencoded)
  const params = Object.fromEntries(new URLSearchParams(rawBody).entries())

  const from    = params['From'] ?? ''
  const to      = params['To'] ?? ''
  const body    = params['Body'] ?? ''
  const smsSid  = params['SmsSid'] ?? ''

  if (!from || !body) {
    return twilioReply('') // Empty response — ignore malformed requests
  }

  // Look up which business owns this Twilio number
  const business = await prisma.business.findFirst({
    where: { phone: to },
    select: { id: true, name: true, phone: true },
  })

  if (!business) {
    console.warn(`[SMS] No business found for Twilio number ${to}`)
    return twilioReply("We're sorry, this number is not currently active.")
  }

  console.log(`[SMS] Inbound from ${from} → ${business.name} | "${body.slice(0, 80)}"`)

  try {
    const leadId = await resolveOrCreateLead({
      businessId: business.id,
      channel: 'SMS',
      phone: from,
    })

    const result = await processInbound({
      businessId: business.id,
      channel: 'SMS',
      leadId,
      message: body,
    })

    return twilioReply(result.response)
  } catch (err) {
    console.error('[SMS] processInbound error:', err)
    // Always reply to avoid Twilio retries
    return twilioReply("Thanks for your message. We'll be in touch shortly.")
  }
}

// ─── GET — health check ───────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: 'ok', service: 'sms-webhook' })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a TwiML response with the given message. Empty string = no reply. */
function twilioReply(message: string): NextResponse {
  const twiml = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`

  return new NextResponse(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
