import { NextRequest, NextResponse } from 'next/server'
import { bookAppointment } from '../../../../lib/calendar.js'
import { prisma } from '../../../../lib/prisma.js'

// ─── POST /api/calendar/book ─────────────────────────────────────────────────

/**
 * Books an appointment for a lead.
 *
 * Body:
 *   businessId       - Required
 *   leadId           - Required
 *   startTime        - ISO string, required
 *   appointmentType  - e.g. "Consultation", "Showing", "HVAC Estimate"
 *   durationMinutes  - Default 60
 *   notes            - Optional
 *   location         - Optional
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { businessId, leadId, startTime, appointmentType, durationMinutes, notes, location } = body

  if (!businessId || !leadId || !startTime) {
    return NextResponse.json(
      { error: 'businessId, leadId, and startTime are required' },
      { status: 400 },
    )
  }

  const [lead, business] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: String(leadId) },
      select: { id: true, name: true, phone: true, email: true },
    }),
    prisma.business.findUnique({
      where: { id: String(businessId) },
      select: { id: true, timezone: true },
    }),
  ])

  if (!lead) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  if (!business) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 })
  }

  try {
    const result = await bookAppointment({
      leadId: lead.id,
      businessId: business.id,
      leadName: lead.name,
      leadPhone: lead.phone ?? undefined,
      leadEmail: lead.email ?? undefined,
      appointmentType: String(appointmentType ?? 'Consultation'),
      startTime: new Date(String(startTime)),
      durationMinutes: typeof durationMinutes === 'number' ? durationMinutes : 60,
      notes: notes ? String(notes) : undefined,
      location: location ? String(location) : undefined,
      timezone: business.timezone ?? 'America/New_York',
    })

    return NextResponse.json({
      success: true,
      appointmentId: result.appointmentId,
      calendarEventId: result.calendarEventId,
      confirmationText: result.confirmationText,
      meetLink: result.meetLink,
    })
  } catch (err) {
    console.error('[Calendar Book] Error:', err)
    return NextResponse.json({ error: 'Failed to book appointment' }, { status: 500 })
  }
}
