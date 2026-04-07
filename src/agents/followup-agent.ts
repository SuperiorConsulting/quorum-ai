import { prisma } from '../lib/prisma.js'
import { relationshipMemory } from '../memory/relationship-memory.js'
import { sendSMS, sendEmail } from '../lib/messaging.js'
import { makeOutboundCall } from '../voice/vapi-client.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type FollowUpSequenceType = 'FOLLOW_UP' | 'ONBOARDING' | 'NURTURE'

export interface SequenceStep {
  stepNumber: number
  channel: 'SMS' | 'EMAIL' | 'VOICE'
  delayHours: number
  /** Message template — {name} and {memoryDetail} are replaced at send time */
  messageTemplate: string
}

export interface EnrollResult {
  sequenceId: string
  leadId: string
  sequenceType: FollowUpSequenceType
  firstActionAt: Date
}

// ─── Sequence definitions ─────────────────────────────────────────────────────

const SEQUENCES: Record<FollowUpSequenceType, SequenceStep[]> = {
  FOLLOW_UP: [
    {
      stepNumber: 1,
      channel: 'SMS',
      delayHours: 24,
      messageTemplate: `Hey {name}, just following up from our conversation. Did you get a chance to think things over? Happy to answer any questions.`,
    },
    {
      stepNumber: 2,
      channel: 'SMS',
      delayHours: 72, // 3 days after step 1
      messageTemplate: `{name}, I wanted to share something relevant — {memoryDetail}. Thought it might be useful as you're thinking through this. Worth a quick call?`,
    },
    {
      stepNumber: 3,
      channel: 'VOICE',
      delayHours: 120, // 5 days after step 2
      messageTemplate: `Hi {name}, this is Quorum following up for {businessName}. I wanted to see where things landed on your end. Do you have two minutes?`,
    },
    {
      stepNumber: 4,
      channel: 'EMAIL',
      delayHours: 168, // 7 days after step 3
      messageTemplate: `Subject: Quick question, {name}\n\nI want to make sure we haven't missed anything on our end. Is there a specific concern that's kept this from moving forward? I'd rather know than guess.\n\nHappy to get on a call today if that helps.`,
    },
    {
      stepNumber: 5,
      channel: 'SMS',
      delayHours: 240, // 10 days after step 4
      messageTemplate: `{name}, last message from me on this for now. If the timing ever makes more sense, I'll be here. Good luck with everything.`,
    },
  ],

  ONBOARDING: [
    {
      stepNumber: 1,
      channel: 'EMAIL',
      delayHours: 0,
      messageTemplate: `Subject: Welcome to {businessName} — here's what happens next\n\nWelcome aboard, {name}. Your account is being set up right now. Here's what to expect over the next 48 hours...`,
    },
    {
      stepNumber: 2,
      channel: 'SMS',
      delayHours: 2,
      messageTemplate: `{name}, your setup is underway. You'll hear from us within 24 hours with your first configuration call time. Reply STOP to opt out.`,
    },
    {
      stepNumber: 3,
      channel: 'EMAIL',
      delayHours: 48,
      messageTemplate: `Subject: {name}, your Quorum setup is complete\n\nEverything is live. Here's your dashboard access and what to watch for in your first morning briefing tomorrow at 8am...`,
    },
  ],

  NURTURE: [
    {
      stepNumber: 1,
      channel: 'EMAIL',
      delayHours: 168, // 1 week
      messageTemplate: `Subject: {name} — something worth knowing\n\nThought you'd find this useful: {memoryDetail}. No action needed — just wanted to stay on your radar as you think things through.`,
    },
    {
      stepNumber: 2,
      channel: 'SMS',
      delayHours: 336, // 2 weeks after step 1
      messageTemplate: `Hey {name}, checking in. Things change — if the timing is better now, I'd love to reconnect. Worth 10 minutes?`,
    },
    {
      stepNumber: 3,
      channel: 'EMAIL',
      delayHours: 672, // 4 weeks after step 2
      messageTemplate: `Subject: Still thinking about it, {name}?\n\nI know this wasn't the right moment when we last spoke. Curious if anything has changed. Happy to revisit with fresh eyes.`,
    },
  ],
}

// ─── FollowUpAgent ────────────────────────────────────────────────────────────

/**
 * Enrolls a lead in a follow-up sequence.
 * Calculates the first action time based on the sequence definition.
 * Only one active sequence per lead — silently skips if already enrolled.
 *
 * @param leadId       - The lead to enroll
 * @param sequenceType - Which sequence to run
 * @param businessId   - Business context for the sequence
 */
export async function enrollInSequence(
  leadId: string,
  sequenceType: FollowUpSequenceType,
  businessId: string,
): Promise<EnrollResult> {
  // Check if already in an active sequence of this type
  const existing = await prisma.followUpSequence.findFirst({
    where: { leadId, sequenceType, status: 'ACTIVE' },
  })

  if (existing) {
    return {
      sequenceId: existing.id,
      leadId,
      sequenceType,
      firstActionAt: existing.nextActionAt ?? new Date(),
    }
  }

  const steps = SEQUENCES[sequenceType]
  if (!steps || steps.length === 0) {
    throw new Error(`No steps defined for sequence type: ${sequenceType}`)
  }

  const firstStep = steps[0]!
  const firstActionAt = new Date(Date.now() + firstStep.delayHours * 60 * 60 * 1000)

  const sequence = await prisma.followUpSequence.create({
    data: {
      leadId,
      businessId,
      sequenceType,
      currentStep: 1,
      totalSteps: steps.length,
      nextActionAt: firstActionAt,
      status: 'ACTIVE',
    },
  })

  return {
    sequenceId: sequence.id,
    leadId,
    sequenceType,
    firstActionAt,
  }
}

/**
 * Processes the next due step for a follow-up sequence.
 * Called by the Railway worker every 30 minutes.
 * Sends the appropriate message and advances the sequence to the next step.
 *
 * @param sequenceId - The FollowUpSequence record ID
 */
export async function processNextStep(sequenceId: string): Promise<void> {
  const sequence = await prisma.followUpSequence.findUnique({
    where: { id: sequenceId },
    include: { lead: { select: { name: true, phone: true, email: true, businessId: true } } },
  })

  if (!sequence || sequence.status !== 'ACTIVE') return
  if (!sequence.nextActionAt || sequence.nextActionAt > new Date()) return

  const steps = SEQUENCES[sequence.sequenceType as FollowUpSequenceType]
  if (!steps) return

  const currentStepDef = steps[sequence.currentStep - 1]
  if (!currentStepDef) {
    // Sequence completed
    await prisma.followUpSequence.update({
      where: { id: sequenceId },
      data: { status: 'COMPLETED' },
    })
    return
  }

  // Build personalized message using memory
  const message = await personalizeMessage(
    currentStepDef.messageTemplate,
    sequence.leadId,
    sequence.lead.name,
    sequence.businessId,
  )

  // Send via appropriate channel — messaging.ts wired in Phase 7
  await dispatchMessage(currentStepDef.channel, sequence.lead, message)

  // Advance to next step or mark complete
  const isLastStep = sequence.currentStep >= (steps.length)
  const nextStep = steps[sequence.currentStep] // 0-indexed next

  await prisma.followUpSequence.update({
    where: { id: sequenceId },
    data: {
      status: isLastStep ? 'COMPLETED' : 'ACTIVE',
      currentStep: { increment: 1 },
      nextActionAt: nextStep
        ? new Date(Date.now() + nextStep.delayHours * 60 * 60 * 1000)
        : null,
    },
  })
}

/**
 * Finds all follow-up sequences with a nextActionAt in the past and processes them.
 * Entry point called by the Railway worker cron every 30 minutes.
 */
export async function processDueSequences(): Promise<{ processed: number; errors: number }> {
  const due = await prisma.followUpSequence.findMany({
    where: {
      status: 'ACTIVE',
      nextActionAt: { lte: new Date() },
    },
    take: 50,
  })

  let processed = 0
  let errors = 0

  for (const seq of due) {
    try {
      await processNextStep(seq.id)
      processed++
    } catch (err) {
      console.error(`[FollowUpAgent] Error processing sequence ${seq.id}:`, err)
      errors++
    }
  }

  return { processed, errors }
}

/**
 * Cancels all active sequences for a lead.
 * Called when a lead closes (WON or LOST) or enrolls in win-back.
 */
export async function cancelLeadSequences(leadId: string): Promise<void> {
  await prisma.followUpSequence.updateMany({
    where: { leadId, status: 'ACTIVE' },
    data: { status: 'CANCELLED' },
  })
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function personalizeMessage(
  template: string,
  leadId: string,
  leadName: string,
  businessId: string,
): Promise<string> {
  const firstName = leadName.split(' ')[0] ?? leadName

  // Pull a specific memory detail for personalization
  let memoryDetail = 'your recent conversation'
  try {
    const memory = await relationshipMemory.getMemory(leadId)
    const topFact = memory.mem0Facts[0]?.memory
    if (topFact) memoryDetail = topFact
  } catch {
    // Non-fatal — use default
  }

  // Get business name
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true },
  })

  return template
    .replace(/{name}/g, firstName)
    .replace(/{memoryDetail}/g, memoryDetail)
    .replace(/{businessName}/g, business?.name ?? 'us')
}

type LeadContact = { phone: string | null; email: string | null; name: string; businessId?: string }

async function dispatchMessage(
  channel: 'SMS' | 'EMAIL' | 'VOICE',
  lead: LeadContact,
  message: string,
): Promise<void> {
  console.log(`[FollowUpAgent] DISPATCH ${channel} to ${lead.name}: ${message.slice(0, 80)}`)

  if (channel === 'SMS' && lead.phone) {
    await sendSMS(lead.phone, message)
  } else if (channel === 'EMAIL' && lead.email) {
    await sendEmail(
      lead.email,
      `Following up — ${lead.name}`,
      `<p>${message}</p>`,
    )
  } else if (channel === 'VOICE' && lead.phone) {
    await makeOutboundCall({ phone: lead.phone, script: message, businessId: lead.businessId ?? '' })
  } else {
    console.warn(`[FollowUpAgent] No contact info for ${channel} dispatch to ${lead.name}`)
  }
}
