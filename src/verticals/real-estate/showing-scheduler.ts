import { prisma } from '../../lib/prisma.js'
import { relationshipMemory } from '../../memory/relationship-memory.js'
import { sendSMS } from '../../lib/messaging.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShowingSlot {
  start: Date
  end: Date
  available: boolean
  formattedTime: string
}

export interface BookedShowing {
  appointmentId: string
  leadId: string
  propertyAddress: string
  scheduledAt: Date
  confirmationText: string
  agentNotification: string
}

// ─── Showing Scheduler ────────────────────────────────────────────────────────

/**
 * Books a property showing and creates all associated records.
 * Sends SMS confirmation to lead (wired in Phase 7) and
 * notifies the agent (or owner for solo agents).
 *
 * @param params.leadId          - Lead being scheduled
 * @param params.businessId      - Business (agent/brokerage)
 * @param params.propertyAddress - Address being shown
 * @param params.scheduledAt     - Showing datetime
 * @param params.agentId         - Agent assigned (optional, defaults to owner)
 * @param params.notes           - Any special instructions
 */
export async function bookShowing(params: {
  leadId: string
  businessId: string
  propertyAddress: string
  scheduledAt: Date
  agentId?: string
  notes?: string
}): Promise<BookedShowing> {
  const { leadId, businessId, propertyAddress, scheduledAt, agentId, notes } = params

  // Create appointment record
  const appointment = await prisma.appointment.create({
    data: {
      leadId,
      businessId,
      scheduledAt,
      duration: 60,
      type: 'SHOWING',
      status: 'CONFIRMED',
      notes: [
        propertyAddress ? `Property: ${propertyAddress}` : '',
        agentId ? `Agent: ${agentId}` : '',
        notes ?? '',
      ].filter(Boolean).join(' | ') || null,
    },
  })

  // Update RealEstateLead showing count
  await prisma.realEstateLead.upsert({
    where: { leadId },
    create: {
      leadId,
      type: 'BUYER',
      preApproved: false,
      showingsBooked: 1,
    },
    update: {
      showingsBooked: { increment: 1 },
    },
  })

  // Update memory with showing booking
  await relationshipMemory.upsertLead(leadId, {
    showing_booked: scheduledAt.toLocaleString(),
    property_address: propertyAddress,
  })

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { name: true, phone: true },
  })

  const firstName = (lead?.name ?? 'there').split(' ')[0] ?? 'there'
  const formattedTime = scheduledAt.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  const confirmationText = `Hi ${firstName}! Your showing is confirmed:\n📍 ${propertyAddress}\n🗓 ${formattedTime}\nReply STOP to cancel.`

  const agentNotification = `New showing booked:\nLead: ${lead?.name ?? 'Unknown'} (${lead?.phone ?? 'no phone'})\nProperty: ${propertyAddress}\nTime: ${formattedTime}\nAppt ID: ${appointment.id}`

  if (lead?.phone) {
    void sendSMS(lead.phone, confirmationText).catch((err) => {
      console.error('[ShowingScheduler] SMS to lead failed:', err)
    })
  }
  console.log(`[ShowingScheduler] Agent notification: ${agentNotification.slice(0, 80)}`)

  return {
    appointmentId: appointment.id,
    leadId,
    propertyAddress,
    scheduledAt,
    confirmationText,
    agentNotification,
  }
}

/**
 * Sends a reminder for an upcoming showing.
 * Called by the Railway worker appointment reminder cron.
 *
 * @param appointmentId  - Appointment to remind about
 * @param minutesBefore  - How far in advance (1440 = 24h, 120 = 2h, 30 = 30min)
 */
export async function sendShowingReminder(
  appointmentId: string,
  minutesBefore: number,
): Promise<void> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      lead: { select: { name: true, phone: true } },
    },
  })

  if (!appointment || appointment.status !== 'CONFIRMED') return

  const firstName = (appointment.lead.name).split(' ')[0] ?? 'there'
  const property = appointment.notes?.match(/Property: ([^|]+)/)?.[1]?.trim() ?? 'your showing'

  let message: string
  if (minutesBefore >= 1440) {
    message = `Hi ${firstName}, reminder: you have a showing tomorrow for ${property}. See you then!`
  } else if (minutesBefore >= 120) {
    message = `Hi ${firstName}, your showing for ${property} is in 2 hours. Looking forward to it!`
  } else {
    message = `Hi ${firstName}, your showing starts in 30 minutes. The agent will meet you at the property.`
  }

  if (appointment.lead.phone) {
    await sendSMS(appointment.lead.phone, message).catch((err) => {
      console.error('[ShowingScheduler] Reminder SMS failed:', err)
    })
  }

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { remindersSent: { increment: 1 } },
  })
}

/**
 * Handles a no-show — updates memory and triggers a reschedule sequence.
 * Called by the Railway worker when appointment time passes with status CONFIRMED.
 *
 * @param appointmentId - The showing that was missed
 */
export async function handleNoShow(appointmentId: string): Promise<void> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { leadId: true, businessId: true, notes: true },
  })

  if (!appointment) return

  // Mark as no-show
  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: 'NO_SHOW' },
  })

  // Update memory — adjust strategy on next contact
  await relationshipMemory.upsertLead(appointment.leadId, {
    no_show: `Missed showing ${new Date().toLocaleDateString()}`,
    follow_up_note: 'No-showed a confirmed showing — be gentle but direct on next contact',
  })

  // Adjust lead score downward
  await prisma.lead.update({
    where: { id: appointment.leadId },
    data: { score: { decrement: 15 } },
  })

  // Attempt reschedule outreach
  const lead = await prisma.lead.findUnique({
    where: { id: appointment.leadId },
    select: { phone: true, name: true },
  })

  if (lead?.phone) {
    const firstName = lead.name.split(' ')[0] ?? 'there'
    void sendSMS(
      lead.phone,
      `Hi ${firstName}, we missed you at your showing today. Want to find another time that works? Just reply or call us.`,
    ).catch((err) => {
      console.error('[ShowingScheduler] No-show SMS failed:', err)
    })
  }

  console.log(`[ShowingScheduler] No-show recorded for appt ${appointmentId}`)
}

/**
 * Returns all upcoming showings for a business, ordered by date.
 * Used by the morning briefing and dashboard.
 *
 * @param businessId - Business to list showings for
 * @param days       - How many days ahead to look (default: 7)
 */
export async function getUpcomingShowings(businessId: string, days = 7) {
  const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000)

  return prisma.appointment.findMany({
    where: {
      businessId,
      type: 'SHOWING',
      status: 'CONFIRMED',
      scheduledAt: { lte: cutoff, gte: new Date() },
    },
    include: {
      lead: { select: { name: true, phone: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  })
}
