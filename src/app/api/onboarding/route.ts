import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma.js'
import { sendTemplatedEmail } from '../../../lib/messaging.js'
import { cloneVoice } from '../../../voice/elevenlabs-client.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnboardingPayload {
  // Step 1 — Business basics
  businessName: string
  ownerName: string
  ownerEmail: string
  businessPhone: string
  businessEmail: string
  // Step 2 — Vertical
  vertical: string
  services: string[]
  // Step 3 — GHL
  ghlApiKey?: string
  ghlLocationId?: string
  ghlPipelineId?: string
  // Step 4 — Twilio
  twilioPhone?: string
  // Step 5 — Calendar
  googleCalendarId?: string
  timezone?: string
  // Step 6 — Voice clone
  voiceCloneName?: string
  // Step 7 — Pricing
  plan?: string
  // Step 8 — Confirmed
  confirmed?: boolean
}

// ─── POST — Create or update onboarding record ───────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: OnboardingPayload
  try {
    body = await req.json() as OnboardingPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { businessName, ownerName, ownerEmail, businessPhone } = body

  if (!businessName || !ownerName || !ownerEmail || !businessPhone) {
    return NextResponse.json(
      { error: 'businessName, ownerName, ownerEmail, and businessPhone are required' },
      { status: 400 },
    )
  }

  try {
    // Find existing business by ownerEmail, then upsert-by-id (email isn't @unique)
    const existing = await prisma.business.findFirst({
      where: { email: ownerEmail },
      select: { id: true },
    })

    const business = existing
      ? await prisma.business.update({
          where: { id: existing.id },
          data: {
            name:          businessName,
            phone:         businessPhone,
            vertical:      normalizeVertical(body.vertical),
            services:      body.services ?? [],
            ghlLocationId: body.ghlLocationId ?? null,
            plan:          normalizePlan(body.plan),
          },
          select: { id: true, name: true, email: true, isActive: true },
        })
      : await prisma.business.create({
          data: {
            name:          businessName,
            ownerId:       ownerEmail, // Placeholder until auth (Phase 14)
            phone:         businessPhone,
            email:         businessEmail(body),
            vertical:      normalizeVertical(body.vertical),
            services:      body.services ?? [],
            pricing:       {},
            ghlLocationId: body.ghlLocationId ?? null,
            voiceCloneId:  null,
            plan:          normalizePlan(body.plan),
            isActive:      false,
          },
          select: { id: true, name: true, email: true, isActive: true },
        })

    // Store GHL API key in env-style if provided (businesses can share key)
    if (body.ghlApiKey) {
      process.env['GHL_API_KEY']      = body.ghlApiKey
      process.env['GHL_LOCATION_ID']  = body.ghlLocationId ?? ''
      process.env['GHL_PIPELINE_ID']  = body.ghlPipelineId ?? ''
    }

    // If this is the final confirmation step, activate + send welcome email
    if (body.confirmed) {
      await prisma.business.update({
        where: { id: business.id },
        data: { isActive: true },
      })

      const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

      await sendTemplatedEmail(ownerEmail, 'onboarding_welcome', {
        ownerName,
        businessName,
        dashboardUrl: `${appUrl}/dashboard?businessId=${business.id}`,
      }).catch((err) => {
        console.error('[Onboarding] Welcome email failed:', err)
      })

      console.log(`[Onboarding] Business activated: ${business.id} — ${businessName}`)
    }

    return NextResponse.json({
      businessId: business.id,
      activated: body.confirmed ?? false,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Onboarding failed'
    console.error('[Onboarding] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── POST /api/onboarding/voice — Upload voice clone files ───────────────────

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const businessId = searchParams.get('businessId')
  const voiceName  = searchParams.get('voiceName')

  if (!businessId || !voiceName) {
    return NextResponse.json({ error: 'businessId and voiceName required' }, { status: 400 })
  }

  try {
    const formData = await req.formData()
    const files = formData.getAll('files') as File[]

    if (files.length === 0) {
      return NextResponse.json({ error: 'At least one audio file required' }, { status: 400 })
    }

    const audioFiles: Array<{ buffer: Buffer; filename: string }> = []
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer()
      audioFiles.push({
        buffer: Buffer.from(arrayBuffer),
        filename: file.name,
      })
    }

    const result = await cloneVoice(businessId, voiceName, audioFiles)

    return NextResponse.json({
      voiceCloneId: result.voiceId,
      name: result.name,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Voice clone failed'
    console.error('[Onboarding] Voice clone error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function businessEmail(body: OnboardingPayload): string {
  return body.businessEmail || body.ownerEmail
}

function normalizeVertical(v?: string): 'HOME_SERVICES' | 'REAL_ESTATE' | 'LEGAL' | 'MEDICAL' | 'AUTO' | 'FITNESS' | 'MED_SPA' | 'DENTAL' | 'FINANCIAL' | 'CONTRACTOR' | 'WELLNESS' | 'VETERINARY' | 'RESTAURANT' | 'OTHER' {
  const map: Record<string, 'HOME_SERVICES' | 'REAL_ESTATE' | 'LEGAL' | 'MEDICAL' | 'AUTO' | 'FITNESS' | 'MED_SPA' | 'DENTAL' | 'FINANCIAL' | 'CONTRACTOR' | 'WELLNESS' | 'VETERINARY' | 'RESTAURANT' | 'OTHER'> = {
    HOME_SERVICES: 'HOME_SERVICES',
    REAL_ESTATE:   'REAL_ESTATE',
    LEGAL:         'LEGAL',
    MEDICAL:       'MEDICAL',
    AUTO:          'AUTO',
    FITNESS:       'FITNESS',
    MED_SPA:       'MED_SPA',
    DENTAL:        'DENTAL',
    FINANCIAL:     'FINANCIAL',
    CONTRACTOR:    'CONTRACTOR',
    WELLNESS:      'WELLNESS',
    VETERINARY:    'VETERINARY',
    RESTAURANT:    'RESTAURANT',
  }
  return map[v?.toUpperCase() ?? ''] ?? 'OTHER'
}

function normalizePlan(p?: string): 'STARTER' | 'GROWTH' | 'ENTERPRISE' {
  if (p === 'GROWTH') return 'GROWTH'
  if (p === 'ENTERPRISE') return 'ENTERPRISE'
  return 'STARTER'
}
