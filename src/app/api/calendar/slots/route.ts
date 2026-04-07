import { NextRequest, NextResponse } from 'next/server'
import { getAvailableSlots } from '../../../../lib/calendar.js'
import { prisma } from '../../../../lib/prisma.js'

// ─── GET /api/calendar/slots ─────────────────────────────────────────────────

/**
 * Returns available booking slots for a business.
 *
 * Query params:
 *   businessId   - Required
 *   days         - Days ahead to search (default 5)
 *   duration     - Slot duration in minutes (default 60)
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const businessId = searchParams.get('businessId')
  const days       = parseInt(searchParams.get('days') ?? '5', 10)
  const duration   = parseInt(searchParams.get('duration') ?? '60', 10)

  if (!businessId) {
    return NextResponse.json({ error: 'businessId required' }, { status: 400 })
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, timezone: true },
  })

  if (!business) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 })
  }

  try {
    const slots = await getAvailableSlots(
      days,
      duration,
      9,  // workday start
      17, // workday end
      business.timezone ?? 'America/New_York',
    )

    return NextResponse.json({
      slots: slots.map((s) => ({
        start: s.startISO,
        end:   s.endISO,
        label: new Date(s.startISO).toLocaleString('en-US', {
          weekday: 'short',
          month:   'short',
          day:     'numeric',
          hour:    'numeric',
          minute:  '2-digit',
          timeZone: business.timezone ?? 'America/New_York',
        }),
      })),
      count: slots.length,
    })
  } catch (err) {
    console.error('[Calendar Slots] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch slots' }, { status: 500 })
  }
}
