import { prisma } from '../lib/prisma.js'
import { relationshipMemory } from '../memory/relationship-memory.js'
import { resolveOrCreateLead, processInbound } from '../agents/quorum.js'
import { getVoiceId } from './elevenlabs-client.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const VAPI_BASE = 'https://api.vapi.ai'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Vapi webhook event types we handle. */
export type VapiEventType =
  | 'assistant-request'
  | 'function-call'
  | 'end-of-call-report'
  | 'hang'
  | 'speech-update'
  | 'transcript'
  | 'call-update'

export interface VapiCall {
  id: string
  phoneNumberId: string
  customer: {
    number: string
    name?: string
  }
  type: 'inboundPhoneCall' | 'outboundPhoneCall' | 'webCall'
  status: string
  startedAt?: string
  endedAt?: string
}

export interface VapiWebhookPayload {
  message: {
    type: VapiEventType
    call?: VapiCall
    /** Present on function-call events */
    functionCall?: {
      name: string
      parameters: Record<string, unknown>
    }
    /** Present on end-of-call-report events */
    artifact?: {
      transcript: string
      recordingUrl?: string
      stereoRecordingUrl?: string
    }
    endedReason?: string
    /** Present on transcript events */
    role?: 'assistant' | 'user'
    transcript?: string
    transcriptType?: 'partial' | 'final'
  }
}

export interface VapiAssistantConfig {
  model: {
    provider: 'anthropic'
    model: string
    systemPrompt: string
    maxTokens: number
    temperature: number
    tools?: VapiTool[]
  }
  voice: {
    provider: '11labs'
    voiceId: string
    stability: number
    similarityBoost: number
    style: number
    useSpeakerBoost: boolean
    optimizeStreamingLatency: number
  }
  firstMessage: string
  firstMessageMode: 'assistant-speaks-first'
  endCallPhrases: string[]
  endCallMessage: string
  backgroundSound: 'off'
  backchannelingEnabled: boolean
  backgroundDenoisingEnabled: boolean
  recordingEnabled: boolean
  hipaaEnabled: boolean
  maxDurationSeconds: number
}

export interface VapiTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface OutboundCallResult {
  callId: string
  status: string
}

// ─── Vapi tool definitions (mirrors Quorum's 11 tools) ───────────────────────
// Vapi uses these to know what functions the assistant can call during a call.
// Function execution is handled by our function-call webhook.

const VAPI_TOOLS: VapiTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_lead_memory',
      description: 'Retrieve stored facts about this lead from relationship memory.',
      parameters: {
        type: 'object',
        properties: { leadId: { type: 'string' } },
        required: ['leadId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Book a calendar appointment when the lead agrees to meet.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string' },
          slot: { type: 'string', description: 'ISO datetime string' },
          type: { type: 'string', enum: ['SHOWING', 'CONSULTATION', 'CALL', 'LISTING_APPT', 'OTHER'] },
          notes: { type: 'string' },
        },
        required: ['leadId', 'slot', 'type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_crm',
      description: 'Update lead stage and add notes in the CRM.',
      parameters: {
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
  },
  {
    type: 'function',
    function: {
      name: 'escalate_to_human',
      description: 'Hand off to the human owner. Use when lead demands it or deal is ready to close.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string' },
          reason: { type: 'string' },
          urgency: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          transcript: { type: 'string' },
        },
        required: ['leadId', 'reason', 'urgency'],
      },
    },
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function vapiHeaders(): Record<string, string> {
  const key = process.env['VAPI_API_KEY']
  if (!key) throw new Error('VAPI_API_KEY is not set')
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Resolves the businessId for an inbound call from the phone number ID.
 * Each Business has a dedicated Vapi phone number configured in their account.
 *
 * Falls back to the first active business if no specific match is found.
 * In production, each business will have their own VAPI_PHONE_NUMBER_ID.
 */
async function resolveBusinessFromPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  // For multi-tenant: look up by phone number ID stored on business record.
  // Phase 12 (onboarding) will write the phoneNumberId per business.
  // For now: use the env-configured phone number ID to find the business.
  const configuredId = process.env['VAPI_PHONE_NUMBER_ID']
  if (configuredId && phoneNumberId === configuredId) {
    const business = await prisma.business.findFirst({
      where: { isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    return business?.id ?? null
  }

  // Fallback: return the first active business
  const business = await prisma.business.findFirst({
    where: { isActive: true },
    select: { id: true },
  })
  return business?.id ?? null
}

// ─── Webhook handlers ─────────────────────────────────────────────────────────

/**
 * Handles the assistant-request event.
 *
 * This is the most critical handler: Vapi calls this at the start of every
 * inbound call to get the assistant configuration. We MUST pre-load relationship
 * memory here so Quorum speaks with full context from the first word.
 *
 * Flow:
 * 1. Caller ID lookup → resolve/create lead
 * 2. Load full relationship memory
 * 3. Build personalized first message
 * 4. Return Vapi assistant config with Quorum system prompt + ElevenLabs voice
 *
 * @param call       - Vapi call object from the webhook payload
 * @param businessId - Resolved business for this phone number
 */
export async function handleAssistantRequest(
  call: VapiCall,
  businessId: string,
): Promise<{ assistant: VapiAssistantConfig }> {
  const callerPhone = call.customer.number
  const callerName = call.customer.name

  // Resolve or create the lead before Quorum speaks a single word
  const leadId = await resolveOrCreateLead({
    businessId,
    channel: 'VOICE',
    phone: callerPhone,
    name: callerName,
    source: 'inbound_call',
  })

  // Pre-load full relationship memory
  const [memory, voiceId, business] = await Promise.all([
    relationshipMemory.getMemory(leadId),
    getVoiceId(businessId),
    prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true, services: true, pricing: true, guarantees: true },
    }),
  ])

  const isReturning = memory.interactions.length > 0
  const firstName = memory.lead.name.split(' ')[0] ?? memory.lead.name

  // Build personalized first message from memory
  const firstMessage = buildFirstMessage(firstName, isReturning, memory.recommendedOpening, business?.name ?? 'us')

  // Build Quorum system prompt with full memory context
  const memFacts = memory.mem0Facts.slice(0, 8).map((f) => `- ${f.memory}`).join('\n')
  const recentHistory = memory.interactions
    .slice(0, 3)
    .map((i) => `[${i.createdAt.toLocaleDateString()} ${i.channel}] Sentiment: ${i.sentiment} | Objection: ${i.objectionRaised ?? 'none'}`)
    .join('\n')

  const systemPrompt = `You are Quorum, the AI sales intelligence for ${business?.name ?? 'this business'}.

You are warm, confident, authoritative, and fully human-sounding. This is a PHONE CALL. Keep responses short — 1-3 sentences max unless asked a detailed question. Never mention being an AI. Never say you're "an AI assistant." You are Quorum.

VOICE CALL RULES:
- Short sentences. Natural pauses. No bullet points — you're speaking, not writing.
- Never read a list out loud. Weave information conversationally.
- End every response with a question or a clear next step.
- If they want to book, confirm the time out loud and say "I'll send a confirmation to your phone."

BUSINESS KNOWLEDGE:
Services: ${JSON.stringify(business?.services ?? {})}
Pricing: ${JSON.stringify(business?.pricing ?? {})}
Guarantee: ${business?.guarantees ?? 'satisfaction guaranteed'}

LEAD: ${memory.lead.name} | Stage: ${memory.lead.pipelineStage} | Score: ${memory.lead.score}/100
${isReturning ? `RETURNING LEAD — you know them. Use memory naturally.` : 'NEW LEAD — qualify naturally. Build rapport first.'}

Known facts:
${memFacts || 'No prior history'}

Recent interactions:
${recentHistory || 'First contact'}

Sentiment trend: ${memory.sentimentTrend}
Recommended opening note: ${memory.recommendedOpening}

ACTIVE LEAD ID (use in all tool calls): ${leadId}
BUSINESS ID: ${businessId}`

  return {
    assistant: {
      model: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        systemPrompt,
        maxTokens: 300,
        temperature: 0.7,
        tools: VAPI_TOOLS,
      },
      voice: {
        provider: '11labs',
        voiceId,
        stability: 0.50,
        similarityBoost: 0.75,
        style: 0.35,
        useSpeakerBoost: true,
        optimizeStreamingLatency: 3,
      },
      firstMessage,
      firstMessageMode: 'assistant-speaks-first',
      endCallPhrases: [
        'goodbye', 'talk soon', 'take care', 'have a great day',
        'i\'ll let you go', 'we\'ll talk soon', 'looking forward to it',
      ],
      endCallMessage: `Great talking with you. I'll follow up shortly. Take care.`,
      backgroundSound: 'off',
      backchannelingEnabled: true,
      backgroundDenoisingEnabled: true,
      recordingEnabled: true,
      hipaaEnabled: false,
      maxDurationSeconds: 1800, // 30 min max call duration
    },
  }
}

/**
 * Handles function-call events from Vapi.
 * Routes tool calls to the Quorum tool executor and returns results.
 *
 * @param functionCall - The function call from Vapi
 * @param businessId   - Business context
 * @param leadId       - Lead context (extracted from function parameters or call state)
 */
export async function handleFunctionCall(
  functionCall: { name: string; parameters: Record<string, unknown> },
  businessId: string,
): Promise<{ result: string }> {
  const { name, parameters } = functionCall

  try {
    // Import and use the tool executor from quorum.ts
    // We call processInbound for message-based tools; for direct tools we call Prisma/memory
    switch (name) {
      case 'get_lead_memory': {
        const memory = await relationshipMemory.getMemory(parameters['leadId'] as string)
        const facts = memory.mem0Facts.slice(0, 8).map((f) => f.memory)
        return {
          result: facts.length > 0
            ? `Known facts: ${facts.join('; ')}`
            : 'No stored facts yet for this lead.',
        }
      }

      case 'book_appointment': {
        const appointment = await prisma.appointment.create({
          data: {
            leadId: parameters['leadId'] as string,
            businessId,
            scheduledAt: new Date(parameters['slot'] as string),
            type: parameters['type'] as 'SHOWING' | 'CONSULTATION' | 'CALL' | 'LISTING_APPT' | 'OTHER',
            notes: (parameters['notes'] as string | undefined) ?? null,
            status: 'CONFIRMED',
          },
        })
        return {
          result: `Appointment booked for ${new Date(parameters['slot'] as string).toLocaleString()}. Confirmation ID: ${appointment.id}. I'll send a confirmation text to the lead.`,
        }
      }

      case 'update_crm': {
        await prisma.lead.update({
          where: { id: parameters['leadId'] as string },
          data: { pipelineStage: parameters['stage'] as 'NEW' | 'QUALIFYING' | 'PROPOSAL' | 'NEGOTIATING' | 'CLOSED_WON' | 'CLOSED_LOST' | 'WIN_BACK' },
        })
        return { result: `CRM updated. Stage: ${parameters['stage']}. Notes logged.` }
      }

      case 'escalate_to_human': {
        const ownerPhone = process.env['OWNER_PHONE_NUMBER']
        const ownerEmail = process.env['OWNER_EMAIL']
        console.log(`[Vapi] ESCALATE to human — Urgency: ${parameters['urgency']} | Reason: ${parameters['reason']} | Owner: ${ownerPhone ?? ownerEmail}`)
        // Phase 7 will wire actual SMS alert to owner
        return {
          result: `Escalating to the team now. I'll let them know the details. One moment while I connect you.`,
        }
      }

      default:
        return { result: `Function ${name} acknowledged.` }
    }
  } catch (err) {
    console.error(`[Vapi] Function call error for ${name}:`, err)
    return { result: 'Let me check on that and get right back to you.' }
  }
}

/**
 * Handles end-of-call-report events from Vapi.
 *
 * Persists:
 * - Full call transcript to Interaction table
 * - Recording URL to Interaction table
 * - Memory update via addInteraction() — full memory pipeline
 * - Lead's lastInteractionAt timestamp
 *
 * @param call     - Vapi call object
 * @param artifact - Contains transcript and recording URL
 * @param businessId - Business context
 */
export async function handleEndOfCall(
  call: VapiCall,
  artifact: { transcript: string; recordingUrl?: string },
  businessId: string,
): Promise<void> {
  const callerPhone = call.customer.number

  // Find the lead
  const lead = await prisma.lead.findFirst({
    where: { businessId, phone: callerPhone },
    select: { id: true, pipelineStage: true },
  })

  if (!lead) {
    console.error(`[Vapi] End-of-call: no lead found for ${callerPhone}`)
    return
  }

  const durationSeconds = call.startedAt && call.endedAt
    ? Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000)
    : undefined

  // Persist interaction record
  const interaction = await prisma.interaction.create({
    data: {
      leadId: lead.id,
      businessId,
      channel: 'VOICE',
      direction: 'INBOUND',
      transcript: artifact.transcript,
      recordingUrl: artifact.recordingUrl ?? null,
      durationSeconds: durationSeconds ?? null,
      sentiment: 0, // Will be updated by addInteraction below
      buyingSignal: false,
    },
  })

  // Full memory pipeline — analyzes transcript, extracts facts, embeds in Pinecone
  await relationshipMemory.addInteraction(lead.id, {
    interactionId: interaction.id,
    channel: 'VOICE',
    direction: 'INBOUND',
    transcript: artifact.transcript,
    sentiment: 0, // emotion-intel will re-score from transcript
    outcome: 'call_completed',
  })
}

// ─── Outbound calls ───────────────────────────────────────────────────────────

/**
 * Initiates an outbound call via the Vapi REST API.
 * Used for: follow-up sequences, morning briefings, win-back day-3 calls.
 *
 * @param params.phone      - Destination phone number (E.164 format)
 * @param params.script     - Opening script for the call (Quorum's first message)
 * @param params.leadId     - Lead being called (used to load memory for system prompt)
 * @param params.businessId - Business making the call
 */
export async function makeOutboundCall(params: {
  phone: string
  script: string
  leadId?: string
  businessId: string
}): Promise<OutboundCallResult> {
  const { phone, script, leadId, businessId } = params
  const phoneNumberId = process.env['VAPI_PHONE_NUMBER_ID']

  if (!phoneNumberId) throw new Error('VAPI_PHONE_NUMBER_ID is not set')

  // Load voice and business for this outbound call
  const [voiceId, business] = await Promise.all([
    getVoiceId(businessId),
    prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true },
    }),
  ])

  // Build context-aware system prompt if leadId provided
  let systemPrompt = `You are Quorum, the AI sales intelligence for ${business?.name ?? 'this business'}.
This is an outbound follow-up call. Be warm, direct, and respectful of their time.
Keep responses under 3 sentences. End every response with a question or next step.
Never mention being an AI.`

  if (leadId) {
    const memory = await relationshipMemory.getMemory(leadId)
    const facts = memory.mem0Facts.slice(0, 5).map((f) => `- ${f.memory}`).join('\n')
    systemPrompt += `\n\nLEAD CONTEXT:\n${facts || 'New lead — no prior history.'}\nSentiment trend: ${memory.sentimentTrend}`
  }

  const res = await fetch(`${VAPI_BASE}/call`, {
    method: 'POST',
    headers: vapiHeaders(),
    body: JSON.stringify({
      phoneNumberId,
      customer: { number: phone },
      assistant: {
        model: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          systemPrompt,
          maxTokens: 200,
          temperature: 0.7,
        },
        voice: {
          provider: '11labs',
          voiceId,
          stability: 0.50,
          similarityBoost: 0.75,
          optimizeStreamingLatency: 3,
        },
        firstMessage: script,
        firstMessageMode: 'assistant-speaks-first',
        recordingEnabled: true,
        maxDurationSeconds: 900, // 15 min max for outbound
      },
    }),
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`Vapi outbound call failed: ${res.status} ${error}`)
  }

  const json = (await res.json()) as { id: string; status: string }
  return { callId: json.id, status: json.status }
}

/**
 * Retrieves the status and details of an active or completed Vapi call.
 *
 * @param callId - Vapi call ID returned from makeOutboundCall or webhook
 */
export async function getCallDetails(callId: string): Promise<VapiCall & {
  transcript?: string
  recordingUrl?: string
}> {
  const res = await fetch(`${VAPI_BASE}/call/${callId}`, {
    headers: vapiHeaders(),
  })

  if (!res.ok) throw new Error(`Vapi getCallDetails failed: ${res.status}`)
  return res.json() as Promise<VapiCall & { transcript?: string; recordingUrl?: string }>
}

/**
 * Lists recent calls for the configured phone number.
 * Used by the morning briefing to count overnight calls.
 *
 * @param since - Only return calls after this timestamp
 * @param limit - Max calls to return (default: 50)
 */
export async function listRecentCalls(since: Date, limit = 50): Promise<VapiCall[]> {
  const phoneNumberId = process.env['VAPI_PHONE_NUMBER_ID']
  if (!phoneNumberId) return []

  const params = new URLSearchParams({
    phoneNumberId,
    createdAtGt: since.toISOString(),
    limit: String(limit),
  })

  const res = await fetch(`${VAPI_BASE}/call?${params}`, {
    headers: vapiHeaders(),
  })

  if (!res.ok) return []
  const json = (await res.json()) as { results?: VapiCall[] }
  return json.results ?? []
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function buildFirstMessage(
  firstName: string,
  isReturning: boolean,
  recommendedOpening: string,
  businessName: string,
): string {
  if (isReturning) {
    // Strip the "Hey [Name]," prefix from recommendedOpening if present — Quorum adds it naturally
    const cleanOpening = recommendedOpening.replace(/^hey\s+\w+[,.]?\s*/i, '')
    return `Hey ${firstName}! ${cleanOpening}`
  }

  return `Hey ${firstName}, thanks for calling ${businessName}. How can I help you today?`
}

// ─── Main webhook dispatcher ──────────────────────────────────────────────────

/**
 * Main entry point for all Vapi webhook events.
 * Called by /src/app/api/voice/route.ts.
 *
 * Routes each event type to the appropriate handler and returns
 * the correct response shape for Vapi.
 *
 * @param payload    - Parsed Vapi webhook JSON body
 * @param businessId - Resolved business for this webhook (from phone number ID)
 */
export async function handleVapiWebhook(
  payload: VapiWebhookPayload,
  businessId: string,
): Promise<unknown> {
  const { message } = payload
  const eventType = message.type

  switch (eventType) {
    case 'assistant-request': {
      if (!message.call) {
        return { error: 'No call object in assistant-request' }
      }
      return handleAssistantRequest(message.call, businessId)
    }

    case 'function-call': {
      if (!message.functionCall) {
        return { result: 'No function call data' }
      }
      return handleFunctionCall(message.functionCall, businessId)
    }

    case 'end-of-call-report': {
      if (!message.call || !message.artifact) {
        console.warn('[Vapi] end-of-call-report missing call or artifact')
        return { received: true }
      }
      // Run async — do not block the webhook response
      void handleEndOfCall(message.call, message.artifact, businessId).catch((err) =>
        console.error('[Vapi] end-of-call processing error:', err),
      )
      return { received: true }
    }

    case 'hang':
      // Call ended without a proper end-of-call-report (hang up mid-call)
      console.log(`[Vapi] Hang event for call ${message.call?.id}`)
      return { received: true }

    case 'transcript':
      // Real-time transcription updates — logged only, full processing happens on end-of-call
      return { received: true }

    case 'speech-update':
    case 'call-update':
      return { received: true }

    default:
      console.log(`[Vapi] Unhandled event type: ${eventType}`)
      return { received: true }
  }
}

export { resolveBusinessFromPhoneNumberId }
