import { prisma } from '../../lib/prisma.js'
import { relationshipMemory } from '../../memory/relationship-memory.js'
import { detectAndIntercept } from '../../agents/competitor-intercept.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type HomeServiceTrade =
  | 'HVAC'
  | 'ROOFING'
  | 'PLUMBING'
  | 'ELECTRICAL'
  | 'SOLAR'
  | 'PEST_CONTROL'
  | 'WINDOWS'
  | 'LANDSCAPING'
  | 'GENERAL'

export type UrgencyTier = 'EMERGENCY' | 'URGENT' | 'SCHEDULED' | 'EXPLORATORY'

export interface HSContext {
  systemPromptBlock: string
  detectedTrade: HomeServiceTrade
  urgencyTier: UrgencyTier
  /** If EMERGENCY: book same-day. If URGENT: book within 24h. */
  targetBookingWindow: string
  estimatedJobValue: { min: number; max: number }
}

// ─── Trade detection ──────────────────────────────────────────────────────────

const TRADE_SIGNALS: Record<HomeServiceTrade, string[]> = {
  HVAC: ['ac', 'air conditioning', 'furnace', 'heat', 'hvac', 'heating', 'cooling', 'duct', 'thermostat', 'no air', 'no heat'],
  ROOFING: ['roof', 'shingle', 'gutter', 'leak', 'attic', 'soffit', 'fascia', 'storm damage'],
  PLUMBING: ['pipe', 'drain', 'toilet', 'faucet', 'water heater', 'leak', 'clog', 'sewer', 'flood', 'no hot water'],
  ELECTRICAL: ['electrical', 'outlet', 'breaker', 'panel', 'wiring', 'light', 'no power', 'spark', 'generator'],
  SOLAR: ['solar', 'panels', 'energy bill', 'renewable', 'battery backup', 'photovoltaic'],
  PEST_CONTROL: ['pest', 'bug', 'insect', 'termite', 'ant', 'roach', 'rodent', 'mouse', 'rat', 'spider', 'bed bug'],
  WINDOWS: ['window', 'door', 'glass', 'siding', 'insulation', 'draft', 'foggy glass'],
  LANDSCAPING: ['lawn', 'yard', 'tree', 'landscape', 'sprinkler', 'garden', 'mulch', 'mowing'],
  GENERAL: [],
}

const EMERGENCY_SIGNALS = [
  'no heat', 'no ac', 'no hot water', 'flooding', 'water everywhere', 'gas smell',
  'no power', 'sparks', 'smoke', 'fire', 'burst pipe', 'sewage backup',
  'roof caving', 'collapsed', 'emergency', 'urgent help',
]

const URGENT_SIGNALS = [
  'not working', 'broken', 'stopped working', 'went out', 'not cooling',
  'not heating', 'leaking', 'running constantly', 'strange noise', 'smell',
]

// ─── Job value estimates by trade ────────────────────────────────────────────

const JOB_VALUE_RANGES: Record<HomeServiceTrade, { min: number; max: number }> = {
  HVAC:         { min: 3000, max: 12000 },
  ROOFING:      { min: 5000, max: 25000 },
  PLUMBING:     { min: 500, max: 8000 },
  ELECTRICAL:   { min: 800, max: 10000 },
  SOLAR:        { min: 15000, max: 40000 },
  PEST_CONTROL: { min: 300, max: 2500 },
  WINDOWS:      { min: 3000, max: 20000 },
  LANDSCAPING:  { min: 500, max: 8000 },
  GENERAL:      { min: 500, max: 10000 },
}

// ─── System prompts per trade ─────────────────────────────────────────────────

const BASE_HS_PERSONA = `You understand home services deeply — HVAC systems, roofing, plumbing, electrical, solar, pest control, windows, and landscaping. You know:
- Most homeowners are stressed when they call — their home is affected right now
- 68% of homeowners choose the FIRST company that responds and sounds competent
- Same-day or next-day estimates close at 3x the rate of next-week appointments
- Never let an urgency signal go unaddressed — triage immediately

YOUR PRIORITY ORDER:
1. Triage the urgency (emergency → urgent → scheduled → exploratory)
2. Qualify the problem (what broke, how long, own or rent)
3. Book the fastest possible appointment
4. Never let a competitor name slide without a gentle battle card response`

const TRADE_CONTEXT: Record<HomeServiceTrade, string> = {
  HVAC: `HVAC CONTEXT: Average system replacement: $5,000-$12,000. Service call: $150-$400. No AC in summer = same-day emergency. No heat in winter = same-day emergency. Ask about system age — anything over 15 years is a replacement conversation, not a repair conversation.`,
  ROOFING: `ROOFING CONTEXT: Average full replacement: $8,000-$25,000. Repair: $500-$3,000. Insurance claims are common after storms — offer to help with the claim process. Always book an in-person inspection — never quote over the phone.`,
  PLUMBING: `PLUMBING CONTEXT: Average job: $500-$8,000. Water heater replacement: $1,200-$3,500. Active leaks and sewer backups are EMERGENCIES — book same-day. Always ask if they own or rent (renters need landlord approval for major work).`,
  ELECTRICAL: `ELECTRICAL CONTEXT: Panel upgrades: $2,000-$6,000. Outlet/switch: $150-$400. Sparks, burning smell, or no power are emergencies — treat as safety issues. Permits are required for panel work — mention we handle all permitting.`,
  SOLAR: `SOLAR CONTEXT: Average installation: $18,000-$35,000 before incentives. Federal tax credit: 30%. Payback period: 7-12 years. Leads are in research mode — educate first, then qualify for a free energy audit. Never pressure on solar.`,
  PEST_CONTROL: `PEST CONTROL CONTEXT: Initial treatment: $150-$400. Monthly plans: $40-$100/month. Termites = high urgency (structural damage). Bed bugs = high urgency and high embarrassment for the caller — be extra non-judgmental.`,
  WINDOWS: `WINDOWS CONTEXT: Window replacement: $300-$800 per window, $5,000-$20,000 for whole home. Drafts and foggy glass are common complaints. Energy efficiency angle resonates with homeowners concerned about utility bills. Finance options help close.`,
  LANDSCAPING: `LANDSCAPING CONTEXT: Lawn maintenance: $100-$300/month. Major projects: $2,000-$15,000. Seasonal: spring and fall cleanups are high-volume. Irrigation installs: $3,000-$8,000. Residential clients want reliability over price.`,
  GENERAL: `HOME SERVICES CONTEXT: Qualify the specific trade need first. Book an in-home assessment — never quote complex work over the phone. Always lead with trust signals: licensed, insured, bonded, guaranteed.`,
}

// ─── HSAgent ─────────────────────────────────────────────────────────────────

export class HSAgent {
  /**
   * Returns the home services context for an inbound message.
   * Detects the trade, triages urgency, and builds the system prompt block.
   *
   * @param leadId     - Lead being spoken with
   * @param businessId - Home services business
   * @param message    - Inbound message to analyze
   */
  async getContext(leadId: string, businessId: string, message: string): Promise<HSContext> {
    const lower = message.toLowerCase()

    const detectedTrade = this.detectTrade(lower)
    const urgencyTier = this.triageUrgency(lower)
    const estimatedJobValue = JOB_VALUE_RANGES[detectedTrade] ?? JOB_VALUE_RANGES.GENERAL!

    const targetBookingWindow =
      urgencyTier === 'EMERGENCY' ? 'TODAY — same-day dispatch' :
      urgencyTier === 'URGENT'    ? 'Within 24 hours' :
      urgencyTier === 'SCHEDULED' ? 'Next available slot this week' :
      'Within 1-2 weeks'

    // Check for competitor mention and load battle card
    const competitorResult = await detectAndIntercept(message, businessId)
    const competitorBlock = competitorResult.detected
      ? `\n\n${competitorResult.interceptPrompt}`
      : ''

    const systemPromptBlock = [
      BASE_HS_PERSONA,
      `\nTRADE DETECTED: ${detectedTrade}`,
      TRADE_CONTEXT[detectedTrade],
      `\nURGENCY TIER: ${urgencyTier} — Target booking window: ${targetBookingWindow}`,
      `Estimated job value: $${estimatedJobValue.min.toLocaleString()} - $${estimatedJobValue.max.toLocaleString()}`,
      competitorBlock,
    ].join('\n')

    // Store urgency and trade in memory for continuity
    await relationshipMemory.upsertLead(leadId, {
      detected_trade: detectedTrade,
      urgency_tier: urgencyTier,
      estimated_job_value: `$${estimatedJobValue.min.toLocaleString()}-$${estimatedJobValue.max.toLocaleString()}`,
    }).catch(() => {}) // Non-fatal

    return {
      systemPromptBlock,
      detectedTrade,
      urgencyTier,
      targetBookingWindow,
      estimatedJobValue,
    }
  }

  /**
   * Updates a lead's score based on urgency tier.
   * Emergency leads jump to score 80+ immediately.
   *
   * @param leadId      - Lead to update
   * @param urgencyTier - Detected urgency
   */
  async applyUrgencyScore(leadId: string, urgencyTier: UrgencyTier): Promise<void> {
    const scoreBoost: Record<UrgencyTier, number> = {
      EMERGENCY:   40,
      URGENT:      25,
      SCHEDULED:   10,
      EXPLORATORY: 0,
    }

    const boost = scoreBoost[urgencyTier]
    if (boost > 0) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { score: { increment: boost } },
      })
    }
  }

  /**
   * Generates a same-day booking confirmation message for emergency leads.
   * Used when Quorum successfully books an emergency dispatch.
   *
   * @param leadName       - Lead's name for personalization
   * @param trade          - Trade being dispatched
   * @param estimatedArrival - When the technician will arrive
   */
  buildEmergencyConfirmation(leadName: string, trade: HomeServiceTrade, estimatedArrival: string): string {
    const firstName = leadName.split(' ')[0] ?? 'there'
    const tradeNames: Record<HomeServiceTrade, string> = {
      HVAC: 'HVAC technician',
      ROOFING: 'roofing specialist',
      PLUMBING: 'plumber',
      ELECTRICAL: 'electrician',
      SOLAR: 'solar technician',
      PEST_CONTROL: 'pest control specialist',
      WINDOWS: 'window specialist',
      LANDSCAPING: 'landscaping crew',
      GENERAL: 'specialist',
    }

    return `${firstName}, you're all set. A ${tradeNames[trade]} will be at your home by ${estimatedArrival}. They'll call 30 minutes before arrival. Is there anything else I should let them know?`
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private detectTrade(lower: string): HomeServiceTrade {
    for (const [trade, signals] of Object.entries(TRADE_SIGNALS)) {
      if (trade === 'GENERAL') continue
      if (signals.some((s) => lower.includes(s))) {
        return trade as HomeServiceTrade
      }
    }
    return 'GENERAL'
  }

  private triageUrgency(lower: string): UrgencyTier {
    if (EMERGENCY_SIGNALS.some((s) => lower.includes(s))) return 'EMERGENCY'
    if (URGENT_SIGNALS.some((s) => lower.includes(s))) return 'URGENT'

    const scheduledSignals = ['estimate', 'quote', 'how much', 'pricing', 'next week', 'sometime']
    if (scheduledSignals.some((s) => lower.includes(s))) return 'SCHEDULED'

    return 'EXPLORATORY'
  }
}

/** Singleton instance. */
export const hsAgent = new HSAgent()
