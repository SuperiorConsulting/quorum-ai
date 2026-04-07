import { google } from 'googleapis'
import { prisma } from './prisma.js'
import { sendSMS, sendEmail } from './messaging.js'
import { notifyAppointmentBooked } from './n8n-client.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TimeSlot {
  start: Date
  end: Date
  /** ISO strings for API responses */
  startISO: string
  endISO: string
}

export interface BookingParams {
  leadId: string
  businessId: string
  leadName: string
  leadPhone?: string
  leadEmail?: string
  appointmentType: string
  startTime: Date
  durationMinutes: number
  notes?: string
  location?: string
  /** Business timezone (IANA format, e.g. 'America/New_York') */
  timezone?: string
}

export interface BookingResult {
  appointmentId: string
  calendarEventId: string
  confirmationText: string
  meetLink: string | undefined
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getOAuth2Client() {
  const clientId     = process.env['GOOGLE_CLIENT_ID']
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET']
  const refreshToken = process.env['GOOGLE_REFRESH_TOKEN']

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Calendar env vars not set (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)')
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })
  return auth
}

function getCalendarId(): string {
  return process.env['GOOGLE_CALENDAR_ID'] ?? 'primary'
}

// ─── Availability ─────────────────────────────────────────────────────────────

/**
 * Returns available booking slots for the next N days.
 * Uses Google's freebusy API to exclude existing events.
 *
 * @param daysAhead      - How many days out to look
 * @param durationMins   - Appointment duration in minutes
 * @param workdayStart   - Hour to start offering slots (default 9)
 * @param workdayEnd     - Hour to stop offering slots (default 17)
 * @param timezone       - IANA timezone string
 */
export async function getAvailableSlots(
  daysAhead: number = 5,
  durationMins: number = 60,
  workdayStart: number = 9,
  workdayEnd: number = 17,
  timezone: string = 'America/New_York',
): Promise<TimeSlot[]> {
  const auth = getOAuth2Client()
  const calendar = google.calendar({ version: 'v3', auth })

  const now = new Date()
  const rangeEnd = new Date(now)
  rangeEnd.setDate(rangeEnd.getDate() + daysAhead)

  // Query busy times
  const freeBusyRes = await calendar.freebusy.query({
    requestBody: {
      timeMin: now.toISOString(),
      timeMax: rangeEnd.toISOString(),
      timeZone: timezone,
      items: [{ id: getCalendarId() }],
    },
  })

  const busyTimes = freeBusyRes.data.calendars?.[getCalendarId()]?.busy ?? []

  const busy: Array<{ start: Date; end: Date }> = busyTimes
    .filter((b) => b.start && b.end)
    .map((b) => ({
      start: new Date(b.start!),
      end:   new Date(b.end!),
    }))

  // Generate candidate slots
  const slots: TimeSlot[] = []
  const cursor = new Date(now)
  cursor.setMinutes(0, 0, 0)
  cursor.setHours(workdayStart)

  // Move to tomorrow if we're past workday end
  if (cursor.getHours() >= workdayEnd) {
    cursor.setDate(cursor.getDate() + 1)
    cursor.setHours(workdayStart, 0, 0, 0)
  }

  while (cursor < rangeEnd && slots.length < 20) {
    const dayOfWeek = cursor.getDay()
    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(workdayStart, 0, 0, 0)
      continue
    }

    if (cursor.getHours() >= workdayEnd) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(workdayStart, 0, 0, 0)
      continue
    }

    const slotEnd = new Date(cursor.getTime() + durationMins * 60000)

    // Check if slot overlaps with any busy period
    const overlaps = busy.some(
      (b) => cursor < b.end && slotEnd > b.start,
    )

    if (!overlaps) {
      slots.push({
        start:    new Date(cursor),
        end:      new Date(slotEnd),
        startISO: cursor.toISOString(),
        endISO:   slotEnd.toISOString(),
      })
    }

    cursor.setMinutes(cursor.getMinutes() + durationMins)
  }

  return slots
}

// ─── Booking ──────────────────────────────────────────────────────────────────

/**
 * Books an appointment: creates Google Calendar event + Quorum Appointment record.
 * Sends SMS/email confirmation to lead.
 *
 * @param params - Booking parameters
 */
export async function bookAppointment(params: BookingParams): Promise<BookingResult> {
  const auth = getOAuth2Client()
  const calendar = google.calendar({ version: 'v3', auth })

  const endTime = new Date(params.startTime.getTime() + params.durationMinutes * 60000)

  const eventRes = await calendar.events.insert({
    calendarId: getCalendarId(),
    conferenceDataVersion: params.leadEmail ? 1 : 0,
    sendUpdates: 'all',
    requestBody: {
      summary: `${params.appointmentType} — ${params.leadName}`,
      description: [
        `Booked via Quorum AI`,
        params.notes ? `Notes: ${params.notes}` : '',
        `Lead ID: ${params.leadId}`,
      ].filter(Boolean).join('\n'),
      start: {
        dateTime: params.startTime.toISOString(),
        timeZone: params.timezone ?? 'America/New_York',
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: params.timezone ?? 'America/New_York',
      },
      location: params.location,
      attendees: params.leadEmail
        ? [{ email: params.leadEmail, displayName: params.leadName }]
        : [],
      conferenceData: params.leadEmail
        ? {
            createRequest: {
              requestId: `quorum-${params.leadId}-${Date.now()}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          }
        : undefined,
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 1440 },
          { method: 'popup', minutes: 30 },
        ],
      },
    },
  })

  const calendarEventId = eventRes.data.id ?? ''
  const meetLink = eventRes.data.conferenceData?.entryPoints?.[0]?.uri

  // Create Quorum Appointment record
  const appointment = await prisma.appointment.create({
    data: {
      leadId:       params.leadId,
      businessId:   params.businessId,
      type:         'CONSULTATION',
      scheduledAt:  params.startTime,
      status:       'CONFIRMED',
      notes:        params.notes,
      calendarEventId,
    },
  })

  // Build confirmation text
  const dateStr = params.startTime.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })
  const timeStr = params.startTime.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })

  const confirmationText = `Your ${params.appointmentType} is confirmed for ${dateStr} at ${timeStr}.${params.location ? ` Location: ${params.location}.` : ''}${meetLink ? ` Join: ${meetLink}` : ''} Reply STOP to cancel.`

  // Send confirmation
  if (params.leadPhone) {
    void sendSMS(params.leadPhone, confirmationText).catch((err) => {
      console.error('[Calendar] SMS confirmation failed:', err)
    })
  }

  if (params.leadEmail) {
    void sendEmail(
      params.leadEmail,
      `Appointment Confirmed — ${params.appointmentType}`,
      buildConfirmationHtml(params, dateStr, timeStr, meetLink ?? undefined),
    ).catch((err) => {
      console.error('[Calendar] Email confirmation failed:', err)
    })
  }

  // Notify n8n + Socket.io — both fire-and-forget
  notifyAppointmentBooked({
    leadId: params.leadId,
    businessId: params.businessId,
    leadName: params.leadName,
    leadPhone: params.leadPhone,
    leadEmail: params.leadEmail,
    appointmentId: appointment.id,
    appointmentType: params.appointmentType,
    scheduledAt: params.startTime.toISOString(),
    location: params.location,
  })

  void (async () => {
    try {
      const { emitAppointmentBooked } = await import('./socket-server.js')
      emitAppointmentBooked({
        leadId: params.leadId,
        businessId: params.businessId,
        leadName: params.leadName,
        appointmentId: appointment.id,
        appointmentType: params.appointmentType,
        scheduledAt: params.startTime.toISOString(),
      })
    } catch { /* Socket.io not initialized — non-fatal */ }
  })()

  return {
    appointmentId: appointment.id,
    calendarEventId,
    confirmationText,
    meetLink: meetLink ?? undefined,
  }
}

// ─── Reminders ────────────────────────────────────────────────────────────────

/**
 * Sends a reminder for an upcoming appointment.
 *
 * @param appointmentId  - Quorum appointment ID
 * @param minutesBefore  - How far in advance (1440 = 24h, 120 = 2h, 30 = 30min)
 */
export async function sendReminder(
  appointmentId: string,
  minutesBefore: number,
): Promise<void> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      lead: { select: { name: true, phone: true, email: true } },
    },
  })

  if (!appointment || appointment.status !== 'CONFIRMED') return

  const lead = appointment.lead
  const timeLabel =
    minutesBefore >= 1440 ? '24 hours' :
    minutesBefore >= 120  ? '2 hours' :
    '30 minutes'

  const timeStr = appointment.scheduledAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  })

  const message = `Reminder: Your appointment is in ${timeLabel} at ${timeStr}. Reply STOP to opt out.`

  if (lead.phone) {
    await sendSMS(lead.phone, message).catch((err) => {
      console.error('[Calendar] Reminder SMS failed:', err)
    })
  }
}

// ─── Cancellation / no-show ───────────────────────────────────────────────────

/**
 * Cancels an appointment and removes the Google Calendar event.
 *
 * @param appointmentId - Quorum appointment ID
 * @param reason        - Reason for cancellation
 */
export async function cancelAppointment(
  appointmentId: string,
  reason?: string,
): Promise<void> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      lead: { select: { name: true, phone: true } },
    },
  })

  if (!appointment) return

  // Cancel in Google Calendar
  if (appointment.calendarEventId) {
    try {
      const auth = getOAuth2Client()
      const calendar = google.calendar({ version: 'v3', auth })
      await calendar.events.delete({
        calendarId: getCalendarId(),
        eventId: appointment.calendarEventId,
        sendUpdates: 'all',
      })
    } catch (err) {
      console.error('[Calendar] Failed to delete calendar event:', err)
    }
  }

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: 'CANCELLED', notes: reason ? `Cancelled: ${reason}` : undefined },
  })

  if (appointment.lead.phone) {
    await sendSMS(
      appointment.lead.phone,
      `Your appointment has been cancelled.${reason ? ` Reason: ${reason}.` : ''} Reply to reschedule.`,
    ).catch(() => {})
  }
}

/**
 * Marks appointment as no-show and decrements lead score.
 *
 * @param appointmentId - Quorum appointment ID
 */
export async function markNoShow(appointmentId: string): Promise<void> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { leadId: true, status: true },
  })

  if (!appointment || appointment.status !== 'CONFIRMED') return

  await Promise.all([
    prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'NO_SHOW' },
    }),
    prisma.lead.update({
      where: { id: appointment.leadId },
      data: { score: { decrement: 15 } },
    }),
  ])
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildConfirmationHtml(
  params: BookingParams,
  dateStr: string,
  timeStr: string,
  meetLink?: string,
): string {
  return `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#6366f1">Appointment Confirmed ✓</h2>
  <p>Hi ${params.leadName.split(' ')[0]},</p>
  <p>Your <strong>${params.appointmentType}</strong> is confirmed:</p>
  <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:16px 0">
    <p style="margin:4px 0">📅 <strong>${dateStr} at ${timeStr}</strong></p>
    ${params.location ? `<p style="margin:4px 0">📍 <strong>${params.location}</strong></p>` : ''}
    ${meetLink ? `<p style="margin:4px 0">🔗 <a href="${meetLink}">Join video call</a></p>` : ''}
    ${params.notes ? `<p style="margin:4px 0">📝 ${params.notes}</p>` : ''}
  </div>
  <p>Need to reschedule? Reply to this email.</p>
  <p style="color:#888;font-size:12px">— Quorum AI</p>
</div>`
}
