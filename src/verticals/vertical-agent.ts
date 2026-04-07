import { prisma } from '../lib/prisma.js'
import { relationshipMemory } from '../memory/relationship-memory.js'
import {
  getVerticalConfig,
  buildVerticalSystemPrompt,
  type VerticalKey,
} from './vertical-registry.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VerticalContext {
  /** Full vertical system prompt block to inject into Quorum */
  systemPromptBlock: string
  /** Vertical-specific appointment type for booking tool */
  appointmentType: 'SHOWING' | 'CONSULTATION' | 'CALL' | 'LISTING_APPT' | 'OTHER'
  /** Whether this vertical has a dedicated module (RE, home services) */
  hasDedicatedModule: boolean
  /** Urgency signals detected in message, if any */
  urgencyDetected: string | null
  /** Extracted qualification data from this interaction to store in memory */
  extractedFacts: Record<string, string>
}

export interface QualificationStatus {
  isQualified: boolean
  missingFields: string[]
  extractedData: Record<string, unknown>
  score: number
}

// ─── VerticalAgent ────────────────────────────────────────────────────────────

/**
 * Universal vertical agent. Loads the right vertical config for a business and
 * enriches Quorum's system prompt with vertical-specific intelligence.
 *
 * Called by the API route layer before processInbound() to inject vertical context.
 * For verticals with dedicated modules (REAL_ESTATE, HOME_SERVICES), the dedicated
 * module handles specialized logic — this agent handles everything else.
 */
export class VerticalAgent {
  /**
   * Returns the full vertical context for a business interaction.
   * This is injected into Quorum's system prompt before every conversation.
   *
   * @param businessId - Business to load vertical config for
   * @param message    - Inbound message (scanned for urgency signals)
   */
  async getContext(businessId: string, message: string): Promise<VerticalContext> {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { vertical: true },
    })

    const vertical = (business?.vertical as VerticalKey) ?? 'OTHER'
    const config = getVerticalConfig(vertical)
    const systemPromptBlock = buildVerticalSystemPrompt(vertical)

    // Scan message for urgency signals
    const lowerMessage = message.toLowerCase()
    const urgencyDetected =
      config.urgencySignals.find((signal) => lowerMessage.includes(signal.toLowerCase())) ?? null

    return {
      systemPromptBlock,
      appointmentType: config.appointmentType,
      hasDedicatedModule: vertical === 'REAL_ESTATE' || vertical === 'HOME_SERVICES',
      urgencyDetected,
      extractedFacts: {},
    }
  }

  /**
   * Checks how qualified a lead is based on their stored memory vs
   * the required qualification fields for their vertical.
   *
   * @param leadId     - Lead to check
   * @param businessId - Business (used to determine vertical)
   */
  async getQualificationStatus(leadId: string, businessId: string): Promise<QualificationStatus> {
    const [business, memory] = await Promise.all([
      prisma.business.findUnique({
        where: { id: businessId },
        select: { vertical: true },
      }),
      relationshipMemory.getMemory(leadId),
    ])

    const vertical = (business?.vertical as VerticalKey) ?? 'OTHER'
    const config = getVerticalConfig(vertical)

    // Check which qualification fields we already know from memory
    const knownFacts = new Set(
      memory.mem0Facts.map((f) => f.memory.split(':')[0]?.trim().toLowerCase() ?? ''),
    )

    const missingFields = config.qualificationFlow
      .map((q) => q.extractField)
      .filter((field) => !knownFacts.has(field.toLowerCase()))

    const totalFields = config.qualificationFlow.length
    const knownCount = totalFields - missingFields.length
    const score = Math.round((knownCount / totalFields) * 100)

    return {
      isQualified: score >= 60,
      missingFields,
      extractedData: Object.fromEntries(
        memory.mem0Facts.map((f) => {
          const parts = f.memory.split(':')
          return [parts[0]?.trim() ?? f.memory, parts.slice(1).join(':').trim()]
        }),
      ),
      score,
    }
  }

  /**
   * Extracts qualification facts from a lead's message and stores them in memory.
   * Called after each inbound message to progressively build the lead profile.
   *
   * Uses simple pattern matching for common fields. The AI (via Quorum) handles
   * nuanced extraction during the conversation itself.
   *
   * @param leadId   - Lead to update
   * @param message  - Their message to extract from
   * @param vertical - Which vertical's fields to look for
   */
  async extractAndStore(leadId: string, message: string, vertical: string): Promise<Record<string, string>> {
    const config = getVerticalConfig(vertical)
    const extracted: Record<string, string> = {}
    const lower = message.toLowerCase()

    // Budget extraction
    const budgetMatch = message.match(/\$[\d,]+(?:k|K|m|M)?|\d+(?:,\d{3})*\s*(?:dollars?|k\b)/i)
    if (budgetMatch) {
      extracted['budget'] = budgetMatch[0]
    }

    // Timeline extraction
    const timelineKeywords = [
      '30 days', '60 days', '90 days', 'next month', 'this month',
      '6 months', '3 months', 'next year', 'asap', 'right away',
      'this week', 'next week', 'end of year',
    ]
    const timelineMatch = timelineKeywords.find((t) => lower.includes(t))
    if (timelineMatch) {
      extracted['timeline'] = timelineMatch
    }

    // Urgency from vertical signals
    const urgencySignal = config.urgencySignals.find((s) => lower.includes(s.toLowerCase()))
    if (urgencySignal) {
      extracted['urgency_signal'] = urgencySignal
    }

    // Store non-empty extractions in memory
    if (Object.keys(extracted).length > 0) {
      await relationshipMemory.upsertLead(leadId, extracted)
    }

    return extracted
  }

  /**
   * Returns the recommended next action for a lead based on their
   * qualification status and vertical.
   *
   * @param leadId     - Lead to assess
   * @param businessId - Business context
   */
  async getRecommendedAction(
    leadId: string,
    businessId: string,
  ): Promise<'qualify_further' | 'book_appointment' | 'send_proposal' | 'close'> {
    const [status, lead] = await Promise.all([
      this.getQualificationStatus(leadId, businessId),
      prisma.lead.findUnique({
        where: { id: leadId },
        select: { score: true, pipelineStage: true, closeProbability: true },
      }),
    ])

    if (!lead) return 'qualify_further'

    const stage = lead.pipelineStage
    const score = lead.score ?? 0
    const closeProb = lead.closeProbability ?? 0

    if (stage === 'NEGOTIATING' || closeProb > 0.8) return 'close'
    if (stage === 'PROPOSAL' && score > 60) return 'send_proposal'
    if (status.isQualified && score > 40) return 'book_appointment'
    return 'qualify_further'
  }
}

/** Singleton instance. */
export const verticalAgent = new VerticalAgent()
