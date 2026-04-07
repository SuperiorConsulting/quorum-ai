import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../lib/prisma.js'
import { relationshipMemory } from '../memory/relationship-memory.js'
import { analyzeEmotion } from './emotion-intel.js'
import { selectStrategy } from './closing-engine.js'
import { detectObjection, formatObjectionGuidance } from './objection-handler.js'
import { detectAndIntercept, getBattleCard } from './competitor-intercept.js'
import { enrollInSequence, cancelLeadSequences } from './followup-agent.js'
import { enrollInWinback, handleWinbackResponse } from './winback-agent.js'
import { updateContact, logActivity } from '../crm/ghl-client.js'
import { notifyLeadQualified, notifyScoreThreshold, notifyDealClosed, notifyEscalation } from '../lib/n8n-client.js'
import { verticalAgent } from '../verticals/vertical-agent.js'
import { reAgent } from '../verticals/real-estate/re-agent.js'
import { hsAgent } from '../verticals/home-services/hs-agent.js'
// @ts-ignore — Prisma 7 generates non-standard module layout
import type { Stage, Channel } from '../generated/prisma/client.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type InboundChannel = 'VOICE' | 'SMS' | 'EMAIL' | 'CHAT'

export type QuorumAction =
  | 'respond_only'
  | 'book_appointment'
  | 'send_payment_link'
  | 'trigger_followup'
  | 'escalate_to_human'

export interface ProcessInboundResult {
  response: string
  action: QuorumAction
  leadId: string
  interactionId: string
  sentiment: number
  buyingSignal: boolean
  strategy: string
}

export interface ToolResult {
  toolName: string
  result: unknown
}

// ─── Quorum system prompt ─────────────────────────────────────────────────────

function buildSystemPrompt(params: {
  businessName: string
  services: string
  pricing: string
  guarantees: string
  strategy: string
  memoryContext: string
  objectionGuidance: string
  competitorIntercept: string
  isReturningLead: boolean
  leadName: string
  recommendedOpening: string
  verticalContext?: string
}): string {
  return `You are Quorum, the AI sales intelligence for ${params.businessName}.

You are warm, confident, authoritative, and fully human-sounding. You know this business inside and out — every service, price, guarantee, and competitor weakness. You have a persistent memory of every person you have ever spoken with and you use it naturally. You never sound like you are reading from a script. You are having a real relationship-based conversation. You never mention being an AI unless directly asked. Your mission: every conversation ends with a close, a booked appointment, or a clear next step. You are The Deciding Intelligence.

BUSINESS KNOWLEDGE:
Services: ${params.services}
Pricing: ${params.pricing}
Guarantee: ${params.guarantees}

${params.verticalContext ? `VERTICAL INTELLIGENCE:\n${params.verticalContext}` : ''}

RELATIONSHIP MEMORY FOR THIS LEAD:
${params.memoryContext}

${params.isReturningLead
  ? `This is a RETURNING LEAD. You know them. Use the memory above naturally. Open with something specific you remember. Recommended opening: "${params.recommendedOpening}"`
  : `This is a NEW LEAD. Begin qualifying naturally. Your first goal is to understand their situation and build rapport. Do NOT pitch until you know their pain.`
}

CLOSING STRATEGY FOR THIS INTERACTION:
${params.strategy}

${params.objectionGuidance ? `OBJECTION DETECTED:\n${params.objectionGuidance}` : ''}

${params.competitorIntercept ? `${params.competitorIntercept}` : ''}

RULES:
- Never end without a next step: close, book, or hand off
- Never mention AI, Anthropic, or Claude
- Never read from a script — be conversational
- If you need to look something up, use your tools
- If a competitor is mentioned and no battle card guidance is above, probe their criteria before responding
- Maximum 3 sentences per response unless the lead is asking a detailed question
- Always close with a question or a clear call to action`
}

// ─── Tool definitions for Claude ─────────────────────────────────────────────

const QUORUM_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_lead_memory',
    description: 'Retrieve the full relationship memory profile for a lead. Use before making any personalized statement.',
    input_schema: {
      type: 'object',
      properties: {
        leadId: { type: 'string', description: 'The lead database ID' },
      },
      required: ['leadId'],
    },
  },
  {
    name: 'update_lead_memory',
    description: 'Store new facts learned during this conversation (budget, timeline, preferences, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        leadId: { type: 'string' },
        data: { type: 'object', description: 'Key-value pairs of facts to store' },
      },
      required: ['leadId', 'data'],
    },
  },
  {
    name: 'send_sms',
    description: 'Send an SMS message to a lead. Use for follow-up after a voice call or when they prefer text.',
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['phone', 'message'],
    },
  },
  {
    name: 'make_outbound_call',
    description: 'Initiate an outbound Vapi call to a lead using a prepared script.',
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        script: { type: 'string', description: 'Opening script for the call' },
      },
      required: ['phone', 'script'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Book a calendar appointment for a lead. Use when they agree to meet.',
    input_schema: {
      type: 'object',
      properties: {
        leadId: { type: 'string' },
        slot: { type: 'string', description: 'ISO datetime string for the appointment' },
        type: {
          type: 'string',
          enum: ['SHOWING', 'CONSULTATION', 'CALL', 'LISTING_APPT', 'OTHER'],
        },
        notes: { type: 'string' },
      },
      required: ['leadId', 'slot', 'type'],
    },
  },
  {
    name: 'send_payment_link',
    description: 'Generate and send a Stripe payment link to close a deal.',
    input_schema: {
      type: 'object',
      properties: {
        leadId: { type: 'string' },
        amount: { type: 'number', description: 'Amount in dollars' },
        description: { type: 'string' },
      },
      required: ['leadId', 'amount', 'description'],
    },
  },
  {
    name: 'update_crm',
    description: 'Update the lead stage and notes in GoHighLevel CRM.',
    input_schema: {
      type: 'object',
      properties: {
        leadId: { type: 'string' },
        stage: { type: 'string' },
        notes: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['leadId', 'stage'],
    },
  },
  {
    name: 'get_competitor_battlecard',
    description: 'Retrieve battle card data for a competitor mentioned by the lead.',
    input_schema: {
      type: 'object',
      properties: {
        competitorName: { type: 'string' },
        businessId: { type: 'string' },
      },
      required: ['competitorName', 'businessId'],
    },
  },
  {
    name: 'analyze_sentiment',
    description: 'Analyze the emotional tone of a message for buying signals and objections.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
      },
      required: ['text'],
    },
  },
  {
    name: 'trigger_followup_sequence',
    description: 'Enroll a lead in a follow-up sequence (FOLLOW_UP, WIN_BACK, NURTURE).',
    input_schema: {
      type: 'object',
      properties: {
        leadId: { type: 'string' },
        sequenceType: {
          type: 'string',
          enum: ['FOLLOW_UP', 'WIN_BACK', 'NURTURE', 'ONBOARDING'],
        },
      },
      required: ['leadId', 'sequenceType'],
    },
  },
  {
    name: 'escalate_to_human',
    description: 'Hand off to the human owner when the lead demands it, situation is complex, or a deal is ready to close above a value threshold.',
    input_schema: {
      type: 'object',
      properties: {
        leadId: { type: 'string' },
        reason: { type: 'string' },
        urgency: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        transcript: { type: 'string', description: 'Summary of the conversation so far' },
      },
      required: ['leadId', 'reason', 'urgency'],
    },
  },
]

// ─── Tool execution ───────────────────────────────────────────────────────────

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  businessId: string,
): Promise<unknown> {
  switch (toolName) {
    case 'get_lead_memory': {
      const memory = await relationshipMemory.getMemory(toolInput['leadId'] as string)
      return {
        facts: memory.mem0Facts.map((f) => f.memory),
        sentiment_trend: memory.sentimentTrend,
        recommended_opening: memory.recommendedOpening,
        pipeline_stage: memory.lead.pipelineStage,
        interactions_count: memory.interactions.length,
      }
    }

    case 'update_lead_memory': {
      await relationshipMemory.upsertLead(
        toolInput['leadId'] as string,
        toolInput['data'] as Record<string, unknown>,
      )
      return { success: true }
    }

    case 'send_sms': {
      // Phase 7 will wire real Twilio call here
      console.log(`[Quorum tool] send_sms to ${toolInput['phone']}: ${String(toolInput['message']).slice(0, 80)}`)
      return { success: true, stub: 'Phase 7 will wire Twilio' }
    }

    case 'make_outbound_call': {
      // Phase 5 will wire Vapi outbound call here
      console.log(`[Quorum tool] make_outbound_call to ${toolInput['phone']}`)
      return { success: true, stub: 'Phase 5 will wire Vapi' }
    }

    case 'book_appointment': {
      const appointment = await prisma.appointment.create({
        data: {
          leadId: toolInput['leadId'] as string,
          businessId,
          scheduledAt: new Date(toolInput['slot'] as string),
          type: toolInput['type'] as 'SHOWING' | 'CONSULTATION' | 'CALL' | 'LISTING_APPT' | 'OTHER',
          notes: (toolInput['notes'] as string | undefined) ?? null,
          status: 'CONFIRMED',
        },
      })
      // Phase 7 will also create Google Calendar event and send confirmation SMS
      return { success: true, appointmentId: appointment.id }
    }

    case 'send_payment_link': {
      // Phase 7 will wire Stripe here
      console.log(`[Quorum tool] send_payment_link $${toolInput['amount']} to lead ${toolInput['leadId']}`)
      return { success: true, url: 'https://stripe.com/placeholder', stub: 'Phase 7 will wire Stripe' }
    }

    case 'update_crm': {
      const lead = await prisma.lead.findUnique({
        where: { id: toolInput['leadId'] as string },
        select: { ghlContactId: true },
      })
      if (lead?.ghlContactId) {
        void updateContact(lead.ghlContactId, {
          tags: toolInput['tags'] as string[] | undefined,
        })
      }
      // Also update stage in our DB
      await prisma.lead.update({
        where: { id: toolInput['leadId'] as string },
        data: { pipelineStage: toolInput['stage'] as Stage },
      })
      return { success: true }
    }

    case 'get_competitor_battlecard': {
      const card = await getBattleCard(
        toolInput['competitorName'] as string,
        toolInput['businessId'] as string ?? businessId,
      )
      return card ?? { message: 'No battle card found — use generic intercept approach' }
    }

    case 'analyze_sentiment': {
      const { analyzeEmotion: analyze } = await import('./emotion-intel.js')
      return await analyze(toolInput['text'] as string)
    }

    case 'trigger_followup_sequence': {
      const seqType = toolInput['sequenceType'] as string
      if (seqType === 'WIN_BACK') {
        const id = await enrollInWinback(toolInput['leadId'] as string, businessId)
        return { success: true, sequenceId: id }
      }
      const result = await enrollInSequence(
        toolInput['leadId'] as string,
        seqType as 'FOLLOW_UP' | 'ONBOARDING' | 'NURTURE',
        businessId,
      )
      return { success: true, ...result }
    }

    case 'escalate_to_human': {
      // Notify owner via SMS — Phase 7 wires Twilio
      const ownerPhone = process.env['OWNER_PHONE_NUMBER']
      const urgency = toolInput['urgency'] as string
      const reason = toolInput['reason'] as string
      console.log(`[Quorum] ESCALATE (${urgency}): ${reason} | owner: ${ownerPhone}`)
      // Phase 7: await sendSMS(ownerPhone, `QUORUM ESCALATION [${urgency.toUpperCase()}]: ${reason}`)
      return { success: true, escalated: true }
    }

    default:
      return { error: `Unknown tool: ${toolName}` }
  }
}

// ─── Quorum orchestrator ──────────────────────────────────────────────────────

let _anthropic: Anthropic | null = null

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
    _anthropic = new Anthropic({ apiKey })
  }
  return _anthropic
}

/**
 * Main Quorum entry point. Processes any inbound lead message across any channel.
 *
 * Pipeline (per architecture spec):
 * 1. Load relationship memory
 * 2. Detect returning vs new lead
 * 3. Analyze emotion
 * 4. Select closing strategy
 * 5. Detect competitor mentions
 * 6. Build system prompt with full context
 * 7. Call Claude claude-sonnet-4-6 with tool use (loop until final response)
 * 8. Execute any tool calls
 * 9. Return response to caller (caller sends to lead immediately)
 * 10. addInteraction() — awaited
 * 11. GHL sync — fire-and-forget
 * 12. Socket.io push — fire-and-forget (handled by caller via returned result)
 *
 * @param params.channel    - Which channel this message came from
 * @param params.leadId     - Lead's database ID (resolved by caller from phone/email)
 * @param params.message    - The lead's raw message text
 * @param params.businessId - Business this interaction belongs to
 */
export async function processInbound(params: {
  channel: InboundChannel
  leadId: string
  message: string
  businessId: string
}): Promise<ProcessInboundResult> {
  const { channel, leadId, message, businessId } = params

  // ── Step 1: Load relationship memory ──────────────────────────────────────
  const memory = await relationshipMemory.getMemory(leadId)
  const isReturningLead = memory.interactions.length > 0

  // ── Step 2: Handle win-back response ──────────────────────────────────────
  if (memory.lead.pipelineStage === 'WIN_BACK') {
    await handleWinbackResponse(leadId)
  }

  // ── Step 3: Analyze emotion ───────────────────────────────────────────────
  const lastTranscript = memory.interactions[0]?.transcript ?? undefined
  const emotion = await analyzeEmotion(message, lastTranscript)

  // ── Step 4: Select closing strategy ──────────────────────────────────────
  const strategySelection = selectStrategy(memory.lead.pipelineStage, emotion, memory)

  // ── Step 5: Detect competitor + objection + vertical context (parallel) ───
  const [competitorResult, objection, verticalCtx] = await Promise.all([
    detectAndIntercept(message, businessId),
    Promise.resolve(detectObjection(message)),
    verticalAgent.getContext(businessId, message),
  ])

  // ── Step 5b: Load dedicated vertical module if applicable ─────────────────
  let dedicatedVerticalBlock = ''
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true, services: true, pricing: true, guarantees: true, vertical: true },
  })

  if (business?.vertical === 'REAL_ESTATE') {
    const reCtx = await reAgent.getContext(leadId, businessId, message)
    dedicatedVerticalBlock = reCtx.systemPromptBlock
    // Apply urgency score boost for pre-approved buyers with short timelines
    if (reCtx.qualificationScore > 70) {
      await prisma.lead.update({ where: { id: leadId }, data: { score: { increment: 10 } } })
    }
  } else if (business?.vertical === 'HOME_SERVICES') {
    const hsCtx = await hsAgent.getContext(leadId, businessId, message)
    dedicatedVerticalBlock = hsCtx.systemPromptBlock
    await hsAgent.applyUrgencyScore(leadId, hsCtx.urgencyTier)
  } else {
    // All other verticals: use the universal registry context
    dedicatedVerticalBlock = verticalCtx.systemPromptBlock
  }

  // ── Step 6: Build business context for system prompt ─────────────────────
  const memoryContext = buildMemoryContext(memory)
  const objectionGuidance = objection
    ? formatObjectionGuidance(objection.type, business?.name)
    : ''
  const competitorIntercept =
    competitorResult.detected ? competitorResult.interceptPrompt : ''

  const systemPrompt = buildSystemPrompt({
    businessName: business?.name ?? 'this business',
    services: JSON.stringify(business?.services ?? {}),
    pricing: JSON.stringify(business?.pricing ?? {}),
    guarantees: business?.guarantees ?? 'satisfaction guaranteed',
    strategy: strategySelection.tacticalPrompt,
    memoryContext,
    objectionGuidance,
    competitorIntercept,
    isReturningLead,
    leadName: memory.lead.name,
    recommendedOpening: memory.recommendedOpening,
    verticalContext: dedicatedVerticalBlock || undefined,
  })

  // ── Step 7: Claude tool-use loop ──────────────────────────────────────────
  const anthropic = getAnthropic()
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: message },
  ]

  let finalResponse = ''
  let chosenAction: QuorumAction = 'respond_only'

  // Tool use loop — Claude may call multiple tools before producing final text
  for (let attempt = 0; attempt < 8; attempt++) {
    const claudeResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools: QUORUM_TOOLS,
      messages,
    })

    if (claudeResponse.stop_reason === 'end_turn') {
      // Final text response — extract it
      const textBlock = claudeResponse.content.find((b) => b.type === 'text')
      finalResponse = textBlock?.type === 'text' ? textBlock.text : ''
      break
    }

    if (claudeResponse.stop_reason === 'tool_use') {
      // Process all tool calls in this response
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of claudeResponse.content) {
        if (block.type !== 'tool_use') continue

        const toolInput = block.input as Record<string, unknown>
        const result = await executeTool(block.name, toolInput, businessId)

        // Infer action from tool name
        if (block.name === 'book_appointment') chosenAction = 'book_appointment'
        else if (block.name === 'send_payment_link') chosenAction = 'send_payment_link'
        else if (block.name === 'trigger_followup_sequence') chosenAction = 'trigger_followup'
        else if (block.name === 'escalate_to_human') chosenAction = 'escalate_to_human'

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        })
      }

      // Append Claude's response and tool results to the message history
      messages.push({ role: 'assistant', content: claudeResponse.content })
      messages.push({ role: 'user', content: toolResults })
      continue
    }

    // Unexpected stop reason
    break
  }

  if (!finalResponse) {
    finalResponse = `Hey ${memory.lead.name.split(' ')[0]}, give me just one moment and I'll get right back to you.`
  }

  // ── Step 8: Persist interaction record ───────────────────────────────────
  const interaction = await prisma.interaction.create({
    data: {
      leadId,
      businessId,
      channel: channel as Channel,
      direction: 'INBOUND',
      transcript: `[Lead]: ${message}\n[Quorum]: ${finalResponse}`,
      sentiment: emotion.sentiment,
      emotionDetected: emotion.emotion,
      buyingSignal: emotion.buyingSignal,
      objectionRaised: objection?.rawPhrase ?? null,
      competitorMentioned: competitorResult.detected ? competitorResult.competitorName : null,
      outcome: chosenAction,
    },
  })

  // ── Step 9 (await): addInteraction — memory must be current before next msg
  await relationshipMemory.addInteraction(leadId, {
    interactionId: interaction.id,
    channel,
    direction: 'INBOUND',
    transcript: `[Lead]: ${message}\n[Quorum]: ${finalResponse}`,
    sentiment: emotion.sentiment,
    emotionDetected: emotion.emotion,
    buyingSignal: emotion.buyingSignal,
    objectionRaised: objection?.rawPhrase ?? undefined,
    competitorMentioned: competitorResult.detected ? competitorResult.competitorName : undefined,
    outcome: chosenAction,
  })

  // ── Step 10 (fire-and-forget): GHL sync + n8n events ─────────────────────
  void (async () => {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: {
          ghlContactId: true,
          pipelineStage: true,
          score: true,
          name: true,
          phone: true,
          email: true,
          vertical: true,
          dealValue: true,
          source: true,
        },
      })

      // GHL sync
      if (lead?.ghlContactId) {
        await updateContact(lead.ghlContactId, {})
        await logActivity(lead.ghlContactId, `Quorum ${channel} interaction. Action: ${chosenAction}. Sentiment: ${emotion.sentiment}`)
      }

      if (!lead) return

      const n8nBase = {
        leadId,
        businessId,
        leadName: lead.name,
        phone: lead.phone ?? undefined,
        email: lead.email ?? undefined,
        vertical: lead.vertical ?? undefined,
        score: lead.score ?? 0,
        source: lead.source ?? undefined,
      }

      const stage = String(lead.pipelineStage)

      // Fire n8n: lead qualified (score ≥ 70)
      if ((lead.score ?? 0) >= 70 && stage === 'QUALIFYING') {
        notifyLeadQualified(n8nBase)
      }

      // Fire n8n: deal closed
      if (stage === 'CLOSED_WON') {
        notifyDealClosed({
          ...n8nBase,
          dealValue: lead.dealValue ?? 0,
          closedAt: new Date().toISOString(),
          channel,
        })
      }

      // Fire n8n: escalation when emotion is very negative
      if (emotion.sentiment < -60 && String(emotion.urgency) === 'HIGH') {
        notifyEscalation({
          ...n8nBase,
          reason: 'High urgency + very negative sentiment detected',
          urgency: 'HIGH',
          lastMessage: message.slice(0, 200),
        })
      }
    } catch (err) {
      console.error('[Quorum] GHL/n8n fire-and-forget error (non-fatal):', err)
    }
  })()

  // ── Step 12 (fire-and-forget): Socket.io push ────────────────────────────
  void (async () => {
    try {
      const { emitConversation, emitLeadUpdated } = await import('../lib/socket-server.js')
      const currentLead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { score: true, pipelineStage: true, name: true },
      })
      emitConversation({
        leadId,
        leadName: currentLead?.name ?? '',
        businessId,
        channel,
        direction: 'INBOUND',
        message,
        response: finalResponse,
        sentiment: emotion.sentiment,
        buyingSignal: emotion.buyingSignal,
        action: chosenAction,
        timestamp: new Date().toISOString(),
      })
      if (currentLead) {
        emitLeadUpdated({
          leadId,
          businessId,
          name: currentLead.name,
          score: currentLead.score ?? 0,
          previousScore: memory.mem0Facts.length > 0 ? (currentLead.score ?? 0) - 5 : currentLead.score ?? 0,
          pipelineStage: String(currentLead.pipelineStage),
          channel,
        })
      }
    } catch {
      // Socket.io not initialized in this process — non-fatal
    }
  })()

  return {
    response: finalResponse,
    action: chosenAction,
    leadId,
    interactionId: interaction.id,
    sentiment: emotion.sentiment,
    buyingSignal: emotion.buyingSignal,
    strategy: strategySelection.strategy,
  }
}

/**
 * Resolves or creates a lead record from an inbound phone number or email.
 * Called by channel adapters (Vapi webhook, Twilio inbound) before processInbound.
 *
 * @param businessId - Business receiving the inbound contact
 * @param channel    - Which channel the contact came from
 * @param phone      - Caller/sender phone number (E.164 format)
 * @param email      - Sender email address
 * @param name       - Name if known (from caller ID, form submission, etc.)
 */
export async function resolveOrCreateLead(params: {
  businessId: string
  channel: InboundChannel
  phone?: string
  email?: string
  name?: string
  source?: string
}): Promise<string> {
  const { businessId, channel, phone, email, name, source } = params

  // Try to find by phone first, then email
  const existing = await prisma.lead.findFirst({
    where: {
      businessId,
      OR: [
        phone ? { phone } : {},
        email ? { email } : {},
      ].filter((c) => Object.keys(c).length > 0),
    },
    select: { id: true },
  })

  if (existing) return existing.id

  // New lead
  const lead = await prisma.lead.create({
    data: {
      businessId,
      name: name ?? 'Unknown',
      phone: phone ?? null,
      email: email ?? null,
      channel: channel as Channel,
      source: source ?? channel,
      pipelineStage: 'NEW',
      score: 10,
    },
  })

  // Initialize memory profile
  await relationshipMemory.upsertLead(lead.id, {
    source: source ?? channel,
    firstContact: new Date().toISOString(),
  })

  return lead.id
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function buildMemoryContext(memory: Awaited<ReturnType<typeof relationshipMemory.getMemory>>): string {
  const lines: string[] = []

  if (memory.mem0Facts.length > 0) {
    lines.push('Known facts about this lead:')
    lines.push(...memory.mem0Facts.slice(0, 10).map((f) => `  - ${f.memory}`))
  }

  if (memory.interactions.length > 0) {
    lines.push(`\nInteraction history (${memory.interactions.length} total):`)
    const recent = memory.interactions.slice(0, 3)
    for (const i of recent) {
      lines.push(
        `  [${i.createdAt.toLocaleDateString()} ${i.channel}] Sentiment: ${i.sentiment} | Signal: ${i.buyingSignal ? 'YES' : 'no'} | Objection: ${i.objectionRaised ?? 'none'}`,
      )
    }
  }

  lines.push(`\nSentiment trend: ${memory.sentimentTrend}`)
  lines.push(`Pipeline stage: ${memory.lead.pipelineStage}`)
  lines.push(`Lead score: ${memory.lead.score}/100`)

  if (memory.lead.dealValue) {
    lines.push(`Deal value: $${memory.lead.dealValue.toLocaleString()}`)
  }

  return lines.join('\n') || 'No prior history — this is a new lead.'
}
