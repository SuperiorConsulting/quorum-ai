import { prisma } from '../lib/prisma.js'
import { sendSMS, sendEmail } from '../lib/messaging.js'

// ─── Review Harvesting Agent ──────────────────────────────────────────────────
//
// Workflow:
// 1. Scan CLOSED_WON leads with no ReviewRequest yet
// 2. Send a personalized review request (SMS preferred, email fallback)
// 3. After 5 days with no COMPLETED status, send one follow-up
// 4. Never send more than 2 touches per lead
//
// Platform priority: Google → Facebook → Yelp (configurable via business.vertical)

const REVIEW_PLATFORMS: Record<string, { platform: string; urlTemplate: string }> = {
  REAL_ESTATE:   { platform: 'google',   urlTemplate: 'https://g.page/r/{placeId}/review' },
  HOME_SERVICES: { platform: 'google',   urlTemplate: 'https://g.page/r/{placeId}/review' },
  MED_SPA:       { platform: 'google',   urlTemplate: 'https://g.page/r/{placeId}/review' },
  DENTAL:        { platform: 'google',   urlTemplate: 'https://g.page/r/{placeId}/review' },
  LEGAL:         { platform: 'google',   urlTemplate: 'https://g.page/r/{placeId}/review' },
  MEDICAL:       { platform: 'google',   urlTemplate: 'https://g.page/r/{placeId}/review' },
  FITNESS:       { platform: 'google',   urlTemplate: 'https://g.page/r/{placeId}/review' },
  AUTO:          { platform: 'google',   urlTemplate: 'https://g.page/r/{placeId}/review' },
  FINANCIAL:     { platform: 'google',   urlTemplate: 'https://g.page/r/{placeId}/review' },
  CONTRACTOR:    { platform: 'google',   urlTemplate: 'https://g.page/r/{placeId}/review' },
  WELLNESS:      { platform: 'google',   urlTemplate: 'https://g.page/r/{placeId}/review' },
  VETERINARY:    { platform: 'google',   urlTemplate: 'https://g.page/r/{placeId}/review' },
  RESTAURANT:    { platform: 'yelp',     urlTemplate: 'https://www.yelp.com/biz/{bizSlug}' },
  OTHER:         { platform: 'google',   urlTemplate: 'https://g.page/r/{placeId}/review' },
}

const FOLLOW_UP_DELAY_MS = 5 * 24 * 60 * 60 * 1000 // 5 days

// ─── Main exports ─────────────────────────────────────────────────────────────

/**
 * Scans all CLOSED_WON leads with no review request and enqueues them.
 * Called by the Railway worker once per day.
 */
export async function enqueueNewReviewRequests(businessId?: string): Promise<number> {
  const wonLeads = await prisma.lead.findMany({
    where: {
      ...(businessId ? { businessId } : {}),
      pipelineStage: 'CLOSED_WON',
      reviewRequests: { none: {} },
      OR: [{ phone: { not: null } }, { email: { not: null } }],
    },
    select: { id: true, businessId: true, channel: true },
    take: 200,
  })

  let enqueued = 0
  for (const lead of wonLeads) {
    try {
      await prisma.reviewRequest.create({
        data: {
          leadId:    lead.id,
          businessId: lead.businessId,
          channel:   lead.channel === 'EMAIL' ? 'EMAIL' : 'SMS',
          status:    'PENDING',
        },
      })
      enqueued++
    } catch (err) {
      // @@unique([leadId]) violation means it already exists — skip
      const msg = err instanceof Error ? err.message : ''
      if (!msg.includes('Unique constraint')) {
        console.error(`[ReviewHarvester] Failed to enqueue lead ${lead.id}:`, err)
      }
    }
  }

  return enqueued
}

/**
 * Sends all pending review requests that haven't been sent yet.
 * Called by the Railway worker once per day.
 */
export async function sendPendingReviewRequests(): Promise<{ sent: number; errors: number }> {
  const pending = await prisma.reviewRequest.findMany({
    where: { status: 'PENDING' },
    include: {
      lead:     { select: { name: true, phone: true, email: true } },
      business: { select: { name: true, vertical: true } },
    },
    take: 100,
  })

  let sent = 0
  let errors = 0

  for (const req of pending) {
    try {
      const reviewUrl = buildReviewUrl(req.businessId, String(req.business.vertical))
      const firstName = req.lead.name.split(' ')[0] ?? req.lead.name
      const businessName = req.business.name

      if (req.channel === 'SMS' && req.lead.phone) {
        const message = buildSmsRequest(firstName, businessName, reviewUrl)
        await sendSMS(req.lead.phone, message)
      } else if (req.lead.email) {
        const { subject, html } = buildEmailRequest(firstName, businessName, reviewUrl)
        await sendEmail(req.lead.email, subject, html)
      } else {
        // No contact method — skip
        await prisma.reviewRequest.update({
          where: { id: req.id },
          data: { status: 'SKIPPED' },
        })
        continue
      }

      await prisma.reviewRequest.update({
        where: { id: req.id },
        data: {
          status:       'SENT',
          requestSentAt: new Date(),
          reviewUrl,
          platform:     REVIEW_PLATFORMS[String(req.business.vertical)]?.platform ?? 'google',
        },
      })
      sent++

      console.log(`[ReviewHarvester] Sent review request to ${req.lead.name} (${req.channel})`)
    } catch (err) {
      console.error(`[ReviewHarvester] Error sending to ${req.lead.name}:`, err)
      errors++
    }
  }

  return { sent, errors }
}

/**
 * Sends follow-up messages to SENT requests where 5+ days have passed.
 * Called by the Railway worker once per day.
 */
export async function sendReviewFollowUps(): Promise<{ sent: number; errors: number }> {
  const cutoff = new Date(Date.now() - FOLLOW_UP_DELAY_MS)

  const due = await prisma.reviewRequest.findMany({
    where: {
      status:        'SENT',
      requestSentAt: { lte: cutoff },
    },
    include: {
      lead:     { select: { name: true, phone: true, email: true } },
      business: { select: { name: true } },
    },
    take: 100,
  })

  let sent = 0
  let errors = 0

  for (const req of due) {
    try {
      const firstName = req.lead.name.split(' ')[0] ?? req.lead.name
      const reviewUrl = req.reviewUrl ?? ''

      if (req.channel === 'SMS' && req.lead.phone) {
        const message = buildSmsFollowUp(firstName, reviewUrl)
        await sendSMS(req.lead.phone, message)
      } else if (req.lead.email) {
        const { subject, html } = buildEmailFollowUp(firstName, req.business.name, reviewUrl)
        await sendEmail(req.lead.email, subject, html)
      } else {
        await prisma.reviewRequest.update({
          where: { id: req.id },
          data: { status: 'SKIPPED' },
        })
        continue
      }

      await prisma.reviewRequest.update({
        where: { id: req.id },
        data: {
          status:        'FOLLOWED_UP',
          followUpSentAt: new Date(),
        },
      })
      sent++

      console.log(`[ReviewHarvester] Follow-up sent to ${req.lead.name}`)
    } catch (err) {
      console.error(`[ReviewHarvester] Follow-up error for ${req.lead.name}:`, err)
      errors++
    }
  }

  return { sent, errors }
}

/**
 * Marks a review request as completed when a lead confirms they left a review.
 * Called from processInbound when a FOLLOWED_UP/SENT lead sends a positive reply.
 */
export async function markReviewCompleted(leadId: string): Promise<void> {
  await prisma.reviewRequest.updateMany({
    where: { leadId, status: { in: ['SENT', 'FOLLOWED_UP'] } },
    data: { status: 'COMPLETED' },
  })
}

// ─── Message builders ─────────────────────────────────────────────────────────

function buildSmsRequest(name: string, businessName: string, url: string): string {
  return `Hey ${name}! Working with ${businessName} was genuinely a pleasure. If you have 60 seconds, a quick review would mean the world to us:\n${url}\n\nNo pressure — but it helps us help more people like you.`
}

function buildSmsFollowUp(name: string, url: string): string {
  return `Hi ${name} — just a gentle nudge. If you had a great experience, leaving a quick review goes a long way:\n${url}\n\nThat's the last I'll mention it. Thanks either way!`
}

function buildEmailRequest(
  name: string,
  businessName: string,
  url: string,
): { subject: string; html: string } {
  return {
    subject: `${name}, how did we do?`,
    html: `
      <p>Hi ${name},</p>
      <p>It was a pleasure working with you. If you're happy with the experience, we'd love if you took 60 seconds to share it:</p>
      <p><a href="${url}" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Leave a quick review</a></p>
      <p>Reviews help ${businessName} reach more people who need what we do. They genuinely make a difference.</p>
      <p>Thanks for your trust.</p>
      <p style="color:#94a3b8;font-size:12px;">— The ${businessName} team, powered by Quorum</p>
    `,
  }
}

function buildEmailFollowUp(
  name: string,
  businessName: string,
  url: string,
): { subject: string; html: string } {
  return {
    subject: `One last ask, ${name}`,
    html: `
      <p>Hi ${name},</p>
      <p>I sent this once before but thought I'd try one more time. If your experience with ${businessName} was positive, a quick review helps us more than you might realize:</p>
      <p><a href="${url}" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Leave a review</a></p>
      <p>That's the last you'll hear from me on this. Either way — thank you for choosing us.</p>
      <p style="color:#94a3b8;font-size:12px;">— The ${businessName} team, powered by Quorum</p>
    `,
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function buildReviewUrl(businessId: string, vertical: string): string {
  const platformConfig = REVIEW_PLATFORMS[vertical] ?? REVIEW_PLATFORMS['OTHER']!
  // Use businessId as placeholder — real Google Place ID stored in business config (Phase 14+)
  return platformConfig.urlTemplate
    .replace('{placeId}', businessId)
    .replace('{bizSlug}', businessId)
}
