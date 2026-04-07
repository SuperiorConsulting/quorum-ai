import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../lib/prisma.js'
import { sendTemplatedEmail } from '../lib/messaging.js'
import { makeOutboundCall } from '../voice/vapi-client.js'
import { listRecentCalls } from '../voice/vapi-client.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OvernightStats {
  revenueClosedOvernite: number
  dealsCount: number
  appointmentsBooked: number
  hotLeadsCount: number
  winBackResponses: number
  newLeadsCount: number
  topLead: { name: string; score: number } | null
}

export interface BriefingResult {
  briefingId: string
  businessId: string
  stats: OvernightStats
  script: string
  emailSent: boolean
  callTriggered: boolean
}

// ─── Stats collection ─────────────────────────────────────────────────────────

/**
 * Collects all overnight stats for a business (midnight → now).
 *
 * @param businessId - Business to pull stats for
 * @param since      - Start of the window (default: midnight local time)
 */
export async function collectOvernightStats(
  businessId: string,
  since?: Date,
): Promise<OvernightStats> {
  const windowStart = since ?? getLocalMidnight()

  const [
    closedDeals,
    appointmentsBooked,
    hotLeads,
    newLeads,
    winBackResponses,
  ] = await Promise.all([
    // Revenue: leads that moved to CLOSED_WON overnight
    prisma.lead.findMany({
      where: {
        businessId,
        pipelineStage: 'CLOSED_WON',
        updatedAt: { gte: windowStart },
      },
      select: { dealValue: true, name: true, score: true },
    }),

    // Appointments booked overnight
    prisma.appointment.count({
      where: {
        businessId,
        createdAt: { gte: windowStart },
        status: { not: 'CANCELLED' },
      },
    }),

    // Hot leads (score ≥ 80)
    prisma.lead.count({
      where: {
        businessId,
        score: { gte: 80 },
        pipelineStage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
      },
    }),

    // New leads that came in overnight
    prisma.lead.count({
      where: {
        businessId,
        createdAt: { gte: windowStart },
      },
    }),

    // Win-back responses: interactions from leads in WIN_BACK stage overnight
    prisma.interaction.count({
      where: {
        businessId,
        direction: 'INBOUND',
        createdAt: { gte: windowStart },
        lead: { pipelineStage: 'WIN_BACK' },
      },
    }),
  ])

  const revenueClosedOvernite = closedDeals.reduce(
    (sum, d) => sum + (d.dealValue ?? 0),
    0,
  )

  // Top lead by score among all active leads
  const topLeadRecord = await prisma.lead.findFirst({
    where: {
      businessId,
      pipelineStage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
    },
    orderBy: { score: 'desc' },
    select: { name: true, score: true },
  })

  return {
    revenueClosedOvernite,
    dealsCount: closedDeals.length,
    appointmentsBooked,
    hotLeadsCount: hotLeads,
    winBackResponses,
    newLeadsCount: newLeads,
    topLead: topLeadRecord
      ? { name: topLeadRecord.name, score: topLeadRecord.score ?? 0 }
      : null,
  }
}

// ─── Script generation ────────────────────────────────────────────────────────

/**
 * Uses Claude to write a concise, energizing morning briefing script.
 * Designed to be read aloud by Vapi or scanned in 30 seconds.
 *
 * @param businessName - Business name for personalization
 * @param stats        - Overnight stats
 */
export async function generateBriefingScript(
  businessName: string,
  stats: OvernightStats,
): Promise<string> {
  const client = new Anthropic()

  const prompt = `You are writing a morning business briefing for ${businessName}. Keep it under 120 words. Energizing, direct, no fluff. Mention specific numbers. End with today's #1 priority action.

Overnight stats:
- Revenue closed: $${stats.revenueClosedOvernite.toLocaleString()} across ${stats.dealsCount} deal${stats.dealsCount !== 1 ? 's' : ''}
- Appointments booked: ${stats.appointmentsBooked}
- Hot leads (80+ score): ${stats.hotLeadsCount}
- Win-back responses: ${stats.winBackResponses}
- New leads overnight: ${stats.newLeadsCount}
${stats.topLead ? `- Top lead right now: ${stats.topLead.name} at ${stats.topLead.score}/100` : ''}

Write the briefing. No greeting like "Good morning" — jump straight into the intel. Do not use bullet points. Prose only.`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })

  const block = response.content[0]
  return block?.type === 'text' ? block.text.trim() : buildFallbackScript(businessName, stats)
}

// ─── Briefing delivery ────────────────────────────────────────────────────────

/**
 * Runs the full morning briefing pipeline for a single business:
 * 1. Collect overnight stats
 * 2. Generate Claude briefing script
 * 3. Save DailyBriefing record
 * 4. Send email to business owner
 * 5. Optionally trigger Vapi outbound call
 *
 * @param businessId     - Business to brief
 * @param triggerCall    - Whether to also call the owner via Vapi
 */
export async function deliverMorningBriefing(
  businessId: string,
  triggerCall = false,
): Promise<BriefingResult> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, email: true, phone: true, ownerId: true },
  })

  if (!business) throw new Error(`Business ${businessId} not found`)

  const today = new Date()
  const dateLabel = today.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  // Step 1: Collect stats
  const stats = await collectOvernightStats(businessId)

  // Step 2: Generate script
  const script = await generateBriefingScript(business.name, stats).catch(() =>
    buildFallbackScript(business.name, stats),
  )

  // Step 3: Save record
  const briefing = await prisma.dailyBriefing.create({
    data: {
      businessId,
      date: today,
      revenueClosedOvernite: stats.revenueClosedOvernite,
      dealsCount: stats.dealsCount,
      appointmentsBooked: stats.appointmentsBooked,
      hotLeadsCount: stats.hotLeadsCount,
      winBackResponses: stats.winBackResponses,
      briefingScript: script,
      delivered: false,
    },
  })

  // Step 4: Send email
  let emailSent = false
  if (business.email) {
    try {
      await sendTemplatedEmail(business.email, 'morning_briefing_summary', {
        date: dateLabel,
        revenueClosedOvernite: stats.revenueClosedOvernite.toLocaleString(),
        appointmentsBooked: stats.appointmentsBooked,
        hotLeadsCount: stats.hotLeadsCount,
        winBackResponses: stats.winBackResponses,
        briefingScript: script,
      })
      emailSent = true
      console.log(`[Briefing] Email sent to ${business.email}`)
    } catch (err) {
      console.error('[Briefing] Email failed:', err)
    }
  }

  // Step 5: Optional Vapi call
  let callTriggered = false
  if (triggerCall && business.phone) {
    try {
      const callScript = `Good morning. Here's your Quorum briefing for ${dateLabel}. ${script} That's your morning intel. Have a great day.`
      await makeOutboundCall({
        phone: business.phone,
        script: callScript,
        businessId: business.id,
      })
      callTriggered = true
      console.log(`[Briefing] Vapi call triggered to ${business.phone}`)
    } catch (err) {
      console.error('[Briefing] Vapi call failed:', err)
    }
  }

  // Mark delivered
  await prisma.dailyBriefing.update({
    where: { id: briefing.id },
    data: { delivered: emailSent || callTriggered },
  })

  // Socket.io push — dashboard briefing panel update
  void (async () => {
    try {
      const { emitBriefingReady } = await import('../lib/socket-server.js')
      emitBriefingReady({
        businessId,
        briefingId: briefing.id,
        stats: {
          revenueClosedOvernite: stats.revenueClosedOvernite,
          appointmentsBooked: stats.appointmentsBooked,
          hotLeadsCount: stats.hotLeadsCount,
          winBackResponses: stats.winBackResponses,
        },
      })
    } catch {
      // Non-fatal
    }
  })()

  console.log(
    `[Briefing] Delivered for ${business.name} | Revenue: $${stats.revenueClosedOvernite} | Appts: ${stats.appointmentsBooked} | Hot: ${stats.hotLeadsCount}`,
  )

  return {
    briefingId: briefing.id,
    businessId,
    stats,
    script,
    emailSent,
    callTriggered,
  }
}

/**
 * Runs morning briefings for ALL active businesses.
 * Called by the Railway worker cron at 8:00am.
 *
 * @param triggerCalls - Whether to trigger Vapi calls (opt-in per deployment)
 */
export async function runAllMorningBriefings(triggerCalls = false): Promise<void> {
  const businesses = await prisma.business.findMany({
    where: {
      subscription: { status: 'ACTIVE' },
    },
    select: { id: true, name: true },
  })

  console.log(`[Briefing] Running morning briefings for ${businesses.length} businesses`)

  const results = await Promise.allSettled(
    businesses.map((b) => deliverMorningBriefing(b.id, triggerCalls)),
  )

  let succeeded = 0
  let failed = 0
  for (const result of results) {
    if (result.status === 'fulfilled') succeeded++
    else {
      failed++
      console.error('[Briefing] Business briefing failed:', result.reason)
    }
  }

  console.log(`[Briefing] Complete — ${succeeded} delivered, ${failed} failed`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns midnight of the current local day as a UTC Date. */
function getLocalMidnight(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** Fallback script if Claude call fails. */
function buildFallbackScript(businessName: string, stats: OvernightStats): string {
  const parts: string[] = []

  if (stats.revenueClosedOvernite > 0) {
    parts.push(`$${stats.revenueClosedOvernite.toLocaleString()} closed overnight across ${stats.dealsCount} deal${stats.dealsCount !== 1 ? 's' : ''}.`)
  } else {
    parts.push('No deals closed overnight — time to push.')
  }

  if (stats.appointmentsBooked > 0) {
    parts.push(`${stats.appointmentsBooked} appointment${stats.appointmentsBooked !== 1 ? 's' : ''} booked.`)
  }

  if (stats.hotLeadsCount > 0) {
    parts.push(`${stats.hotLeadsCount} hot lead${stats.hotLeadsCount !== 1 ? 's' : ''} need attention today.`)
  }

  if (stats.topLead) {
    parts.push(`Top priority: ${stats.topLead.name} at ${stats.topLead.score}/100 — reach out first.`)
  }

  return parts.join(' ')
}

// Re-export listRecentCalls for worker use
export { listRecentCalls }
