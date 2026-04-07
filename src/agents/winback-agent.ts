import { prisma } from '../lib/prisma.js'
import { relationshipMemory } from '../memory/relationship-memory.js'
import { cancelLeadSequences } from './followup-agent.js'
import { sendSMS, sendEmail } from '../lib/messaging.js'
import { makeOutboundCall } from '../voice/vapi-client.js'

// ─── Win-Back Sequence (5 steps, 21 days) ────────────────────────────────────
//
// Day 1:  SMS  — specific memory reference, soft reopen
// Day 3:  VOICE — Quorum calls, uses memory, asks direct question
// Day 7:  EMAIL — new angle addressing their original objection from memory
// Day 12: SMS  — closing-the-file approach, creates scarcity
// Day 21: EMAIL — soft close, keep door open, free resource
//
// If lead responds at any step → cancel sequence, Quorum takes over via processInbound

const WIN_BACK_STEPS = [
  {
    stepNumber: 1,
    channel: 'SMS' as const,
    delayDays: 1,
    messageTemplate: `Hey {name}, {memoryDetail}. Wanted to reach back out — is this still something you're thinking about?`,
  },
  {
    stepNumber: 2,
    channel: 'VOICE' as const,
    delayDays: 3,
    messageTemplate: `Hi {name}, this is Quorum for {businessName}. I know it's been a while since we spoke. I had a thought about {memoryDetail} and wanted to share it directly. Do you have two minutes?`,
  },
  {
    stepNumber: 3,
    channel: 'EMAIL' as const,
    delayDays: 7,
    messageTemplate: `Subject: A different angle, {name}

Last time we spoke, {objectionContext}. I've been thinking about that.

{objectionReframe}

I'm not trying to pressure you — I genuinely think there's a fit here if the timing is right. Would a quick call this week help clarify things?`,
  },
  {
    stepNumber: 4,
    channel: 'SMS' as const,
    delayDays: 12,
    messageTemplate: `{name}, going to stop reaching out after this. Is there anything that would make this work for you, or should I close this out on my end?`,
  },
  {
    stepNumber: 5,
    channel: 'EMAIL' as const,
    delayDays: 21,
    messageTemplate: `Subject: Keeping the door open, {name}

No pressure from me — I know you'll reach out when the time is right.

In the meantime, I put together {freeResource} that I think you'll find useful regardless. It's yours, no strings.

When things change, I'll be here.`,
  },
]

// ─── WinbackAgent ─────────────────────────────────────────────────────────────

/**
 * Enrolls a dormant lead in the 5-step win-back sequence.
 * Cancels any existing follow-up sequences before enrolling.
 * Safe to call multiple times — skips if already in an active win-back sequence.
 *
 * @param leadId     - The lead to re-engage
 * @param businessId - Business context
 */
export async function enrollInWinback(leadId: string, businessId: string): Promise<string> {
  // Skip if already in active win-back
  const existing = await prisma.followUpSequence.findFirst({
    where: { leadId, sequenceType: 'WIN_BACK', status: 'ACTIVE' },
  })
  if (existing) return existing.id

  // Cancel any other active sequences before enrolling win-back
  await cancelLeadSequences(leadId)

  const firstDelayMs = WIN_BACK_STEPS[0]!.delayDays * 24 * 60 * 60 * 1000
  const firstActionAt = new Date(Date.now() + firstDelayMs)

  const sequence = await prisma.followUpSequence.create({
    data: {
      leadId,
      businessId,
      sequenceType: 'WIN_BACK',
      currentStep: 1,
      totalSteps: WIN_BACK_STEPS.length,
      nextActionAt: firstActionAt,
      status: 'ACTIVE',
    },
  })

  // Update lead stage to WIN_BACK
  await prisma.lead.update({
    where: { id: leadId },
    data: { pipelineStage: 'WIN_BACK' },
  })

  return sequence.id
}

/**
 * Processes the next due step in a win-back sequence.
 * Each step is personalized from the lead's relationship memory — never generic.
 *
 * @param sequenceId - The FollowUpSequence record ID
 */
export async function processWinbackStep(sequenceId: string): Promise<void> {
  const sequence = await prisma.followUpSequence.findUnique({
    where: { id: sequenceId },
    include: {
      lead: {
        select: { id: true, name: true, phone: true, email: true, businessId: true },
      },
    },
  })

  if (!sequence || sequence.status !== 'ACTIVE') return
  if (!sequence.nextActionAt || sequence.nextActionAt > new Date()) return

  const stepDef = WIN_BACK_STEPS[sequence.currentStep - 1]
  if (!stepDef) {
    await prisma.followUpSequence.update({
      where: { id: sequenceId },
      data: { status: 'COMPLETED' },
    })
    return
  }

  const message = await buildWinbackMessage(
    stepDef.messageTemplate,
    sequence.lead.id,
    sequence.lead.name,
    sequence.businessId,
  )

  console.log(
    `[WinbackAgent] Step ${stepDef.stepNumber} via ${stepDef.channel} to ${sequence.lead.name}: ${message.slice(0, 100)}`,
  )

  if (stepDef.channel === 'SMS' && sequence.lead.phone) {
    await sendSMS(sequence.lead.phone, message)
  } else if (stepDef.channel === 'VOICE' && sequence.lead.phone) {
    await makeOutboundCall({ phone: sequence.lead.phone, script: message, businessId: sequence.businessId })
  } else if (stepDef.channel === 'EMAIL' && sequence.lead.email) {
    await sendEmail(
      sequence.lead.email,
      `Checking in, ${sequence.lead.name.split(' ')[0]}`,
      `<p>${message}</p>`,
    )
  } else {
    console.warn(`[WinbackAgent] No contact info for ${stepDef.channel} to ${sequence.lead.name}`)
  }

  const nextStepDef = WIN_BACK_STEPS[sequence.currentStep] // 0-indexed
  const isLastStep = sequence.currentStep >= WIN_BACK_STEPS.length

  await prisma.followUpSequence.update({
    where: { id: sequenceId },
    data: {
      status: isLastStep ? 'COMPLETED' : 'ACTIVE',
      currentStep: { increment: 1 },
      nextActionAt: nextStepDef
        ? new Date(Date.now() + nextStepDef.delayDays * 24 * 60 * 60 * 1000)
        : null,
    },
  })
}

/**
 * Finds all dormant leads (14+ days no interaction) not yet in win-back and enrolls them.
 * Called by the Railway worker daily cron.
 *
 * @param businessId - Business to scan, or undefined for all businesses
 */
export async function enrollDormantLeads(businessId?: string): Promise<number> {
  const dormantCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)

  const dormant = await prisma.lead.findMany({
    where: {
      ...(businessId ? { businessId } : {}),
      lastInteractionAt: { lt: dormantCutoff },
      pipelineStage: { notIn: ['CLOSED_WON', 'CLOSED_LOST', 'WIN_BACK'] },
      // Not already in a win-back sequence
      followUpSequences: {
        none: { sequenceType: 'WIN_BACK', status: 'ACTIVE' },
      },
    },
    take: 100,
  })

  let enrolled = 0
  for (const lead of dormant) {
    try {
      await enrollInWinback(lead.id, lead.businessId)
      enrolled++
    } catch (err) {
      console.error(`[WinbackAgent] Failed to enroll lead ${lead.id}:`, err)
    }
  }

  return enrolled
}

/**
 * Processes all due win-back steps across all businesses.
 * Called by the Railway worker daily cron.
 */
export async function processDueWinbackSteps(): Promise<{ processed: number; errors: number }> {
  const due = await prisma.followUpSequence.findMany({
    where: {
      sequenceType: 'WIN_BACK',
      status: 'ACTIVE',
      nextActionAt: { lte: new Date() },
    },
    take: 100,
  })

  let processed = 0
  let errors = 0

  for (const seq of due) {
    try {
      await processWinbackStep(seq.id)
      processed++
    } catch (err) {
      console.error(`[WinbackAgent] Error on sequence ${seq.id}:`, err)
      errors++
    }
  }

  return { processed, errors }
}

/**
 * Marks a win-back sequence as completed when the lead responds.
 * Called from processInbound when an inbound message is received from a WIN_BACK lead.
 */
export async function handleWinbackResponse(leadId: string): Promise<void> {
  await prisma.followUpSequence.updateMany({
    where: { leadId, sequenceType: 'WIN_BACK', status: 'ACTIVE' },
    data: { status: 'COMPLETED' },
  })

  // Move lead out of WIN_BACK stage back to QUALIFYING
  await prisma.lead.update({
    where: { id: leadId },
    data: { pipelineStage: 'QUALIFYING' },
  })
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function buildWinbackMessage(
  template: string,
  leadId: string,
  leadName: string,
  businessId: string,
): Promise<string> {
  const firstName = leadName.split(' ')[0] ?? leadName

  let memoryDetail = 'our previous conversation'
  let objectionContext = 'the timing wasn\'t right'
  let objectionReframe = 'Sometimes the right solution just needs the right moment.'
  const freeResource = 'a short guide we put together'

  try {
    const memory = await relationshipMemory.getMemory(leadId)

    // Pull most specific fact for personalized reference
    const topFact = memory.mem0Facts[0]?.memory
    if (topFact) memoryDetail = topFact

    // Find original objection from interaction history
    const objectionInteraction = memory.interactions.find((i) => i.objectionRaised)
    if (objectionInteraction?.objectionRaised) {
      objectionContext = `you mentioned ${objectionInteraction.objectionRaised}`
      objectionReframe = buildObjectionReframe(objectionInteraction.objectionRaised)
    }
  } catch {
    // Non-fatal — defaults are good enough
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true },
  })

  return template
    .replace(/{name}/g, firstName)
    .replace(/{memoryDetail}/g, memoryDetail)
    .replace(/{businessName}/g, business?.name ?? 'us')
    .replace(/{objectionContext}/g, objectionContext)
    .replace(/{objectionReframe}/g, objectionReframe)
    .replace(/{freeResource}/g, freeResource)
}

function buildObjectionReframe(objection: string): string {
  const lower = objection.toLowerCase()
  if (lower.includes('price') || lower.includes('cost') || lower.includes('expensive')) {
    return 'The math actually gets more compelling the longer you wait — every missed lead is real revenue. I\'d love to show you the updated numbers.'
  }
  if (lower.includes('time') || lower.includes('busy') || lower.includes('not ready')) {
    return 'The thing about timing is that the leads don\'t wait. But I understand — when things settle down on your end, I\'d love to reconnect with a fresh look.'
  }
  if (lower.includes('think') || lower.includes('decide')) {
    return 'Sometimes a second look with fresh eyes makes all the difference. Happy to walk through it again at whatever pace works for you.'
  }
  return 'Circumstances change, and what didn\'t make sense then might look different now.'
}
