import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../../lib/prisma.js'
import { relationshipMemory } from '../../memory/relationship-memory.js'
// @ts-ignore — Prisma 7 generated layout
import type { RealEstateLead } from '../../generated/prisma/client.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type RELeadType = 'BUYER' | 'SELLER' | 'INVESTOR' | 'RENTER'

export interface REQualification {
  type: RELeadType
  preApproved: boolean
  budget?: number
  targetNeighborhoods?: string[]
  mustHaves?: string[]
  timeline?: string
  currentSituation?: string
  agentId?: string
}

export interface REAgentContext {
  /** System prompt block injected for RE-specific conversations */
  systemPromptBlock: string
  /** Lead type detected from conversation context */
  detectedType: RELeadType | null
  /** Qualification completeness 0-100 */
  qualificationScore: number
  /** Missing qualification fields */
  missingFields: string[]
  /** Recommended immediate action */
  nextAction: 'qualify' | 'book_showing' | 'book_listing_appt' | 'book_investor_call' | 'nurture'
}

// ─── RE-specific system prompt ────────────────────────────────────────────────

const RE_BASE_PERSONA = `You have deep real estate expertise. You understand:
- The buyer journey: pre-approval → search → offer → inspection → closing (30-90 days)
- The seller journey: pricing strategy → listing prep → marketing → offers → negotiation → closing
- Investor metrics: cap rate, cash-on-cash return, GRM, ARV, hard money
- Mortgage basics: conventional, FHA, VA, DSCR loans, debt-to-income ratios
- Market dynamics: days on market, absorption rate, list-to-sale ratio
- Neighborhood comparables and how to set realistic expectations
- The emotional weight of buying or selling a home — never minimize it

You speak the language of buyers, sellers, and investors fluently and naturally.`

const BUYER_FLOW = `BUYER QUALIFICATION FLOW (ask conversationally — never as a checklist):
1. Are you pre-approved with a lender, or still working on financing? → extract: pre_approved
2. What is your target price range? → extract: budget
3. Which neighborhoods or areas are you focused on? → extract: target_neighborhoods
4. Timeline: are you hoping to be in something within 30 days, or further out? → extract: timeline
5. What are your must-haves vs nice-to-haves? → extract: must_haves
6. Are you currently renting — what is your lease situation? → extract: current_situation
7. Have you been working with another agent? → extract: prior_agent

GOAL: Book a showing or buyer consultation call.
PRE-APPROVED + DEFINED CRITERIA + <90 DAY TIMELINE = Hot buyer. Book a showing today.`

const SELLER_FLOW = `SELLER QUALIFICATION FLOW (ask conversationally):
1. Why are you thinking of selling? → extract: sell_motivation
2. When are you hoping to be moved out by? → extract: move_out_timeline
3. Do you have a sense of what you would list for? → extract: listing_price_expectation
4. Have you had any agents come through yet? → extract: prior_agents
5. What is most important to you in choosing an agent? → extract: agent_criteria

GOAL: Book a listing appointment at the property.
MOTIVATED SELLER + TIMELINE + NO AGENT = Listing appointment within 48 hours.`

const INVESTOR_FLOW = `INVESTOR QUALIFICATION FLOW:
1. Fix-and-flip, long-term rental, or short-term rental? → extract: investment_strategy
2. Target acquisition price and cap rate? → extract: target_metrics
3. Financing in place or using hard money? → extract: financing_type
4. How many properties are you looking to acquire this year? → extract: volume_target

GOAL: Book a strategy call or property tour.
PRE-FINANCED + CLEAR STRATEGY + REPEAT BUYER = Priority lead. Same-day follow-up.`

const LONG_TERM_NURTURE = `LONG-TERM NURTURE PROTOCOL:
If lead says 6+ months out → Contact monthly with:
- Market updates for their target neighborhoods
- New listings matching their exact criteria from memory
- Mortgage rate updates tied to their budget
- Personal memory reference: "Hey [Name], you mentioned [area] under $380K with good schools. Three listings just hit that match — want me to send them over?"
This is Quorum's #1 differentiator in real estate. No other tool does this.`

// ─── REAgent ──────────────────────────────────────────────────────────────────

let _anthropic: Anthropic | null = null

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const key = process.env['ANTHROPIC_API_KEY']
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set')
    _anthropic = new Anthropic({ apiKey: key })
  }
  return _anthropic
}

export class REAgent {
  /**
   * Returns the full RE context for a conversation, including system prompt block,
   * lead type detection, and recommended next action.
   *
   * @param leadId     - Lead being spoken with
   * @param businessId - Real estate business context
   * @param message    - Current inbound message
   */
  async getContext(leadId: string, businessId: string, message: string): Promise<REAgentContext> {
    const [memory, reLead] = await Promise.all([
      relationshipMemory.getMemory(leadId),
      prisma.realEstateLead.findUnique({ where: { leadId } }),
    ])

    const detectedType = await this.detectLeadType(message, reLead)
    const { score, missing } = this.scoreQualification(reLead, detectedType)

    const flowPrompt = this.getFlowPrompt(detectedType ?? 'BUYER')
    const systemPromptBlock = [
      RE_BASE_PERSONA,
      flowPrompt,
      LONG_TERM_NURTURE,
      reLead ? this.buildMemoryBlock(reLead, memory.lead.name) : '',
    ].filter(Boolean).join('\n\n')

    const nextAction = this.determineNextAction(score, detectedType, reLead)

    return {
      systemPromptBlock,
      detectedType,
      qualificationScore: score,
      missingFields: missing,
      nextAction,
    }
  }

  /**
   * Creates or updates a RealEstateLead record with qualification data
   * extracted from the conversation.
   *
   * @param leadId - Lead to update
   * @param data   - Partial qualification data from this interaction
   */
  async updateQualification(leadId: string, data: Partial<REQualification>): Promise<void> {
    const existing = await prisma.realEstateLead.findUnique({ where: { leadId } })

    if (existing) {
      await prisma.realEstateLead.update({
        where: { leadId },
        data: {
          type: data.type ?? existing.type,
          preApproved: data.preApproved ?? existing.preApproved,
          budget: data.budget ?? existing.budget,
          targetNeighborhoods: data.targetNeighborhoods ?? existing.targetNeighborhoods ?? undefined,
          mustHaves: data.mustHaves ?? existing.mustHaves ?? undefined,
          timeline: data.timeline ?? existing.timeline,
          currentSituation: data.currentSituation ?? existing.currentSituation,
          agentId: data.agentId ?? existing.agentId,
        },
      })
    } else {
      await prisma.realEstateLead.create({
        data: {
          leadId,
          type: data.type ?? 'BUYER',
          preApproved: data.preApproved ?? false,
          budget: data.budget,
          targetNeighborhoods: data.targetNeighborhoods,
          mustHaves: data.mustHaves,
          timeline: data.timeline,
          currentSituation: data.currentSituation,
        },
      })
    }

    // Mirror key facts into relationship memory for universal access
    const memoryData: Record<string, unknown> = {}
    if (data.type) memoryData['re_type'] = data.type
    if (data.budget) memoryData['budget'] = `$${data.budget.toLocaleString()}`
    if (data.timeline) memoryData['timeline'] = data.timeline
    if (data.targetNeighborhoods?.length) memoryData['target_neighborhoods'] = data.targetNeighborhoods.join(', ')
    if (data.preApproved !== undefined) memoryData['pre_approved'] = data.preApproved ? 'yes' : 'no'

    if (Object.keys(memoryData).length > 0) {
      await relationshipMemory.upsertLead(leadId, memoryData)
    }
  }

  /**
   * Generates a personalized monthly nurture message for a long-timeline lead.
   * Uses their memory profile to reference specific criteria they mentioned.
   *
   * @param leadId     - Lead to nurture
   * @param businessId - Business context
   */
  async generateNurtureMessage(leadId: string, businessId: string): Promise<string> {
    const [memory, reLead, business] = await Promise.all([
      relationshipMemory.getMemory(leadId),
      prisma.realEstateLead.findUnique({ where: { leadId } }),
      prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }),
    ])

    const firstName = memory.lead.name.split(' ')[0] ?? memory.lead.name
    const neighborhoods = Array.isArray(reLead?.targetNeighborhoods)
      ? (reLead.targetNeighborhoods as string[]).join(' or ')
      : 'your target areas'
    const budget = reLead?.budget ? `under $${reLead.budget.toLocaleString()}` : 'your budget'

    const anthropic = getAnthropic()
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Write a short, warm, personalized SMS nurture message from a real estate agent to a buyer who is 6+ months out.

Lead name: ${firstName}
Target area: ${neighborhoods}
Budget: ${budget}
Last contact: ${memory.lead.lastInteractionAt?.toLocaleDateString() ?? 'a few weeks ago'}
Known facts: ${memory.mem0Facts.slice(0, 3).map(f => f.memory).join('; ')}

The message should:
- Reference something specific they mentioned (area, budget, criteria)
- Mention a market update relevant to their search
- End with one easy question
- Sound natural, not like a form letter
- Be under 160 characters for SMS

Return only the message text.`
      }]
    })

    return response.content[0]?.type === 'text'
      ? response.content[0].text
      : `Hey ${firstName}, checking in — the market in ${neighborhoods} has shifted recently. Still targeting ${budget}? Have a few new listings worth a look.`
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async detectLeadType(
    message: string,
    existing: RealEstateLead | null,
  ): Promise<RELeadType | null> {
    if (existing?.type) return existing.type as RELeadType

    const lower = message.toLowerCase()
    if (lower.includes('sell') || lower.includes('list my') || lower.includes('selling')) return 'SELLER'
    if (lower.includes('invest') || lower.includes('rental') || lower.includes('flip') || lower.includes('cap rate')) return 'INVESTOR'
    if (lower.includes('rent') || lower.includes('apartment') || lower.includes('lease')) return 'RENTER'
    if (lower.includes('buy') || lower.includes('looking for') || lower.includes('home') || lower.includes('house')) return 'BUYER'
    return null
  }

  private getFlowPrompt(type: RELeadType): string {
    switch (type) {
      case 'SELLER': return SELLER_FLOW
      case 'INVESTOR': return INVESTOR_FLOW
      default: return BUYER_FLOW
    }
  }

  private scoreQualification(
    reLead: RealEstateLead | null,
    type: RELeadType | null,
  ): { score: number; missing: string[] } {
    if (!reLead) return { score: 0, missing: ['type', 'pre_approved', 'budget', 'timeline', 'target_neighborhoods'] }

    const fields: Array<[string, boolean]> = [
      ['type', !!type],
      ['pre_approved', true], // we know because the record exists
      ['budget', !!reLead.budget],
      ['timeline', !!reLead.timeline],
      ['target_neighborhoods', Array.isArray(reLead.targetNeighborhoods) && (reLead.targetNeighborhoods as string[]).length > 0],
      ['must_haves', Array.isArray(reLead.mustHaves) && (reLead.mustHaves as string[]).length > 0],
    ]

    const missing = fields.filter(([, has]) => !has).map(([name]) => name)
    const score = Math.round((fields.filter(([, has]) => has).length / fields.length) * 100)

    return { score, missing }
  }

  private determineNextAction(
    score: number,
    type: RELeadType | null,
    reLead: RealEstateLead | null,
  ): REAgentContext['nextAction'] {
    if (score < 30) return 'qualify'
    if (type === 'SELLER') return 'book_listing_appt'
    if (type === 'INVESTOR') return 'book_investor_call'
    if (reLead?.preApproved && score >= 70) return 'book_showing'
    if (score >= 50) return 'book_showing'
    return 'nurture'
  }

  private buildMemoryBlock(reLead: RealEstateLead, leadName: string): string {
    const firstName = leadName.split(' ')[0] ?? leadName
    const lines = [`WHAT WE KNOW ABOUT ${firstName.toUpperCase()}:`]

    if (reLead.type) lines.push(`- Lead type: ${reLead.type}`)
    if (reLead.preApproved) lines.push('- Pre-approved: YES — hot buyer signal')
    if (reLead.budget) lines.push(`- Budget: $${reLead.budget.toLocaleString()}`)
    if (reLead.timeline) lines.push(`- Timeline: ${reLead.timeline}`)
    if (Array.isArray(reLead.targetNeighborhoods) && (reLead.targetNeighborhoods as string[]).length > 0) {
      lines.push(`- Target areas: ${(reLead.targetNeighborhoods as string[]).join(', ')}`)
    }
    if (Array.isArray(reLead.mustHaves) && (reLead.mustHaves as string[]).length > 0) {
      lines.push(`- Must-haves: ${(reLead.mustHaves as string[]).join(', ')}`)
    }
    if (reLead.currentSituation) lines.push(`- Current situation: ${reLead.currentSituation}`)
    if (reLead.showingsBooked > 0) lines.push(`- Showings booked: ${reLead.showingsBooked}`)

    return lines.join('\n')
  }
}

/** Singleton instance. */
export const reAgent = new REAgent()
