/**
 * Quorum Railway Worker
 *
 * Runs as a separate process alongside the Next.js app on Railway.
 * Handles all scheduled tasks via node-cron:
 *
 *   08:00 daily  — Morning briefings for all active businesses
 *   Every 5 min  — Process due follow-up sequences
 *   Every 5 min  — Process due win-back steps
 *   Every hour   — Replay failed memory writes
 *   Every hour   — Route qualified real estate leads
 *   06:00 daily  — Enroll dormant leads in win-back
 *   Every 30 min — Appointment reminders (24h, 2h, 30min windows)
 *   09:00 daily  — Enqueue + send review requests for CLOSED_WON leads
 *   10:00 daily  — Send review follow-ups (5-day window)
 */

import cron from 'node-cron'
import { runAllMorningBriefings } from '../agents/morning-briefing.js'
import { processDueSequences } from '../agents/followup-agent.js'
import { processDueWinbackSteps, enrollDormantLeads } from '../agents/winback-agent.js'
import {
  enqueueNewReviewRequests,
  sendPendingReviewRequests,
  sendReviewFollowUps,
} from '../agents/review-harvester.js'
import { learningEngine } from '../memory/learning-engine.js'
import { prisma } from '../lib/prisma.js'
import { sendReminder } from '../lib/calendar.js'

// ─── Boot ─────────────────────────────────────────────────────────────────────

console.log('[Worker] Quorum Railway worker starting...')
console.log(`[Worker] Environment: ${process.env['NODE_ENV'] ?? 'development'}`)
console.log(`[Worker] Time: ${new Date().toISOString()}`)

// ─── Cron jobs ────────────────────────────────────────────────────────────────

/**
 * 8:00am daily — Morning briefings
 * Delivers overnight stats + Claude briefing script to all active businesses.
 * Set QUORUM_BRIEFING_CALLS=true in Railway env to also trigger Vapi calls.
 */
cron.schedule('0 8 * * *', async () => {
  console.log('[Worker] [CRON] Morning briefings starting...')
  const triggerCalls = process.env['QUORUM_BRIEFING_CALLS'] === 'true'
  await runAllMorningBriefings(triggerCalls).catch((err) => {
    console.error('[Worker] Morning briefings error:', err)
  })
}, { timezone: 'America/New_York' })

/**
 * Every 5 minutes — Follow-up sequences
 * Processes any sequence steps that are due right now.
 */
cron.schedule('*/5 * * * *', async () => {
  await processDueSequences().catch((err) => {
    console.error('[Worker] Follow-up sequences error:', err)
  })
})

/**
 * Every 5 minutes — Win-back steps
 * Sends win-back messages to dormant leads on schedule.
 */
cron.schedule('*/5 * * * *', async () => {
  await processDueWinbackSteps().catch((err) => {
    console.error('[Worker] Win-back steps error:', err)
  })
})

/**
 * Hourly — Replay failed memory writes
 * Retries up to 50 FailedMemoryWrite records per run.
 */
cron.schedule('0 * * * *', async () => {
  const result = await learningEngine.replayFailedMemoryWrites().catch((err) => {
    console.error('[Worker] Memory replay error:', err)
    return { replayed: 0, failed: 0 }
  })
  if (result.replayed > 0) {
    console.log(`[Worker] Memory replay: ${result.replayed} resolved, ${result.failed} still failing`)
  }
})

/**
 * Hourly — Route qualified real estate leads
 * Picks up any leads that crossed the 70-point threshold since last run.
 */
cron.schedule('15 * * * *', async () => {
  await routeQualifiedRELeads().catch((err) => {
    console.error('[Worker] RE routing error:', err)
  })
})

/**
 * 6:00am daily — Enroll dormant leads in win-back
 * Finds leads with no interaction in 14+ days and starts their win-back sequence.
 */
cron.schedule('0 6 * * *', async () => {
  console.log('[Worker] [CRON] Enrolling dormant leads in win-back...')
  await enrollDormantLeads().catch((err) => {
    console.error('[Worker] Dormant lead enrollment error:', err)
  })
}, { timezone: 'America/New_York' })

/**
 * Every 30 minutes — Appointment reminders
 * Sends reminders for appointments in the 24h, 2h, and 30min windows.
 */
cron.schedule('*/30 * * * *', async () => {
  await processAppointmentReminders().catch((err) => {
    console.error('[Worker] Appointment reminders error:', err)
  })
})

/**
 * 9:00am daily — Enqueue + send new review requests
 * Finds CLOSED_WON leads with no prior review request and fires first touch.
 */
cron.schedule('0 9 * * *', async () => {
  console.log('[Worker] [CRON] Review harvesting — new requests...')
  const enqueued = await enqueueNewReviewRequests().catch((err) => {
    console.error('[Worker] Review enqueue error:', err)
    return 0
  })
  const { sent, errors } = await sendPendingReviewRequests().catch((err) => {
    console.error('[Worker] Review send error:', err)
    return { sent: 0, errors: 0 }
  })
  console.log(`[Worker] Reviews: ${enqueued} enqueued, ${sent} sent, ${errors} errors`)
}, { timezone: 'America/New_York' })

/**
 * 10:00am daily — Review follow-ups
 * Sends one follow-up to leads who received a review request 5+ days ago.
 */
cron.schedule('0 10 * * *', async () => {
  console.log('[Worker] [CRON] Review harvesting — follow-ups...')
  const { sent, errors } = await sendReviewFollowUps().catch((err) => {
    console.error('[Worker] Review follow-up error:', err)
    return { sent: 0, errors: 0 }
  })
  if (sent > 0) {
    console.log(`[Worker] Review follow-ups: ${sent} sent, ${errors} errors`)
  }
}, { timezone: 'America/New_York' })

// ─── Job implementations ──────────────────────────────────────────────────────

async function routeQualifiedRELeads(): Promise<void> {
  const { processUnroutedLeads } = await import('../verticals/real-estate/brokerage-router.js')

  const businesses = await prisma.business.findMany({
    where: { subscription: { status: 'ACTIVE' } },
    select: { id: true },
  })

  let totalRouted = 0
  for (const business of businesses) {
    const routed = await processUnroutedLeads(business.id).catch(() => 0)
    totalRouted += routed
  }

  if (totalRouted > 0) {
    console.log(`[Worker] RE routing: ${totalRouted} leads routed to agents`)
  }
}

async function processAppointmentReminders(): Promise<void> {
  const now = new Date()

  // Define reminder windows: send reminder when appointment is within [min, max] minutes
  const windows = [
    { minutesBefore: 1440, minMs: 23.5 * 60 * 60 * 1000, maxMs: 24.5 * 60 * 60 * 1000 },
    { minutesBefore: 120,  minMs: 1.75 * 60 * 60 * 1000, maxMs: 2.25 * 60 * 60 * 1000 },
    { minutesBefore: 30,   minMs: 25 * 60 * 1000,         maxMs: 35 * 60 * 1000 },
  ]

  for (const window of windows) {
    const windowStart = new Date(now.getTime() + window.minMs)
    const windowEnd   = new Date(now.getTime() + window.maxMs)

    const appointments = await prisma.appointment.findMany({
      where: {
        status: 'CONFIRMED',
        scheduledAt: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true },
    })

    for (const appt of appointments) {
      await sendReminder(appt.id, window.minutesBefore).catch((err) => {
        console.error(`[Worker] Reminder failed for appt ${appt.id}:`, err)
      })
    }

    if (appointments.length > 0) {
      console.log(`[Worker] Sent ${appointments.length} reminder(s) for ${window.minutesBefore}min window`)
    }
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`[Worker] ${signal} received — shutting down gracefully`)
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT',  () => void shutdown('SIGINT'))

// ─── Keep-alive ───────────────────────────────────────────────────────────────

console.log('[Worker] All crons registered. Worker is running.')

// Prevent process from exiting — Railway worker must stay alive
setInterval(() => {
  // Heartbeat every 5 minutes
  const mem = process.memoryUsage()
  console.log(
    `[Worker] Heartbeat — RSS: ${Math.round(mem.rss / 1024 / 1024)}MB | Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
  )
}, 5 * 60 * 1000)
