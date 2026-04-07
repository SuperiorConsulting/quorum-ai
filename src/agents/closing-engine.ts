import type { LeadMemory } from '../memory/relationship-memory.js'
import type { EmotionAnalysis } from './emotion-intel.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClosingStrategy = 'SPIN' | 'CHALLENGER' | 'MEDDIC' | 'DIRECT' | 'NURTURE'

export interface StrategySelection {
  strategy: ClosingStrategy
  reasoning: string
  /** Injected into the Quorum system prompt to guide this specific interaction */
  tacticalPrompt: string
}

// ─── Strategy definitions ─────────────────────────────────────────────────────

const STRATEGY_PROMPTS: Record<ClosingStrategy, string> = {
  SPIN: `Use the SPIN selling method. Ask questions in this order:
- SITUATION: Understand their current setup ("What are you using right now?")
- PROBLEM: Surface pain points ("What's the biggest challenge with that?")
- IMPLICATION: Amplify the cost of inaction ("What does that cost you each month?")
- NEED-PAYOFF: Let them articulate the value ("So if we solved that, what would that mean for you?")
Never pitch until they have verbalized their own pain. Then close on the value they described.`,

  CHALLENGER: `Use the Challenger method. Your job is to teach, tailor, and take control.
- TEACH: Share a commercial insight they don't already know ("Most businesses in your space are losing X because...")
- TAILOR: Connect it directly to their specific situation and role
- TAKE CONTROL: Be direct about the path forward — don't ask for permission to proceed
- Reframe their thinking. Challenge comfortable assumptions. Be confident, not pushy.
Never agree with "I need to think about it" — probe what specifically they need to think about.`,

  MEDDIC: `Use the MEDDIC qualification framework to uncover whether this is a real opportunity.
- METRICS: What is the measurable impact for them? ("What does a 20% close rate lift mean in revenue?")
- ECONOMIC BUYER: Do they have authority? ("Who else would need to be involved in this decision?")
- DECISION CRITERIA: What do they care about most? ("What would make this an obvious yes for you?")
- DECISION PROCESS: How do they buy? ("What does your typical process look like once you decide?")
- IDENTIFY PAIN: What is the compelling event? ("What happens if you don't change anything?")
- CHAMPION: Can they advocate internally? ("Who else on your team would benefit from this?")
Focus on discovery. Do not pitch until MEDDIC is complete.`,

  DIRECT: `This lead is ready. Use a direct close approach.
- Acknowledge their readiness without overselling
- Present one clear option — not three choices
- Use a soft assumptive close: "The next step would be..." not "Would you like to..."
- If they hesitate, ask: "What would need to be true for you to move forward today?"
- Have a payment link or booking link ready to send immediately after verbal agreement`,

  NURTURE: `This lead is not ready to buy today. Shift to a relationship-building mode.
- Do NOT push for a decision
- Provide genuine value: a relevant insight, a market update, a useful resource
- End with a soft check-in question that keeps the relationship warm
- Set a specific next contact date: "Let me follow up with you in X weeks when you said you'd have more clarity"
- Goal: stay top of mind without creating pressure`,
}

// ─── Strategy selection logic ─────────────────────────────────────────────────

/**
 * Selects the optimal closing strategy for this specific lead interaction.
 *
 * Decision logic:
 * - DIRECT:     Buying signal detected OR stage is NEGOTIATING
 * - NURTURE:    Sentiment < -20 OR stage is NEW with very low score
 * - MEDDIC:     Stage is QUALIFYING and deal value is high (> $5K)
 * - CHALLENGER: Returning lead with objections OR cooling sentiment trend
 * - SPIN:       Default for most QUALIFYING and PROPOSAL stage interactions
 *
 * @param stage     - Lead's current pipeline stage
 * @param emotion   - Result from emotionIntel.analyzeEmotion()
 * @param memory    - Full relationship memory from RelationshipMemory.getMemory()
 */
export function selectStrategy(
  stage: string,
  emotion: EmotionAnalysis,
  memory: LeadMemory,
): StrategySelection {
  const dealValue = memory.lead.dealValue ?? 0
  const interactionCount = memory.interactions.length
  const hasObjectionHistory = memory.interactions.some((i) => i.objectionRaised !== null)

  // DIRECT: they are clearly ready
  if (emotion.buyingSignal || stage === 'NEGOTIATING') {
    return {
      strategy: 'DIRECT',
      reasoning: emotion.buyingSignal
        ? `Buying signal detected: "${emotion.triggerPhrase}"`
        : 'Lead is in NEGOTIATING stage — close now',
      tacticalPrompt: STRATEGY_PROMPTS.DIRECT,
    }
  }

  // NURTURE: lead is cold, hostile, or brand new with no engagement
  if (emotion.sentiment < -20 || (stage === 'NEW' && interactionCount === 0)) {
    return {
      strategy: 'NURTURE',
      reasoning:
        emotion.sentiment < -20
          ? `Negative sentiment (${emotion.sentiment}) — do not push`
          : 'First contact with new lead — build rapport before qualifying',
      tacticalPrompt: STRATEGY_PROMPTS.NURTURE,
    }
  }

  // MEDDIC: high-value deal in early qualification
  if ((stage === 'QUALIFYING' || stage === 'NEW') && dealValue > 5000) {
    return {
      strategy: 'MEDDIC',
      reasoning: `High-value opportunity ($${dealValue.toLocaleString()}) — qualify rigorously before investing more time`,
      tacticalPrompt: STRATEGY_PROMPTS.MEDDIC,
    }
  }

  // CHALLENGER: returning lead who has objected before or is cooling
  if (
    (interactionCount > 2 && hasObjectionHistory) ||
    memory.sentimentTrend === 'cooling'
  ) {
    return {
      strategy: 'CHALLENGER',
      reasoning: hasObjectionHistory
        ? 'Lead has raised objections before — reframe with Challenger insight'
        : 'Sentiment is cooling — challenge comfortable status quo',
      tacticalPrompt: STRATEGY_PROMPTS.CHALLENGER,
    }
  }

  // SPIN: default for most qualifying and proposal conversations
  return {
    strategy: 'SPIN',
    reasoning: `Stage ${stage} with ${interactionCount} prior interactions — use SPIN to surface pain and build value`,
    tacticalPrompt: STRATEGY_PROMPTS.SPIN,
  }
}

/**
 * Returns the closing framework prompt for a given strategy.
 * Used when building Quorum's system prompt for a specific conversation.
 */
export function getStrategyPrompt(strategy: ClosingStrategy): string {
  return STRATEGY_PROMPTS[strategy]
}

/**
 * Returns the recommended next pipeline stage based on the current stage
 * and outcome of an interaction.
 *
 * @param currentStage - Current pipeline stage
 * @param outcome      - What happened in the interaction
 */
export function getNextStage(
  currentStage: string,
  outcome: 'booked' | 'closed' | 'objected' | 'ghosted' | 'progressed',
): string {
  const stageMap: Record<string, Record<string, string>> = {
    NEW:         { booked: 'QUALIFYING', closed: 'CLOSED_WON', objected: 'NEW',         ghosted: 'NEW',         progressed: 'QUALIFYING' },
    QUALIFYING:  { booked: 'PROPOSAL',   closed: 'CLOSED_WON', objected: 'QUALIFYING',  ghosted: 'WIN_BACK',    progressed: 'PROPOSAL'   },
    PROPOSAL:    { booked: 'NEGOTIATING',closed: 'CLOSED_WON', objected: 'PROPOSAL',    ghosted: 'WIN_BACK',    progressed: 'NEGOTIATING'},
    NEGOTIATING: { booked: 'NEGOTIATING',closed: 'CLOSED_WON', objected: 'PROPOSAL',    ghosted: 'WIN_BACK',    progressed: 'CLOSED_WON' },
    WIN_BACK:    { booked: 'QUALIFYING', closed: 'CLOSED_WON', objected: 'WIN_BACK',    ghosted: 'CLOSED_LOST', progressed: 'QUALIFYING' },
  }

  return stageMap[currentStage]?.[outcome] ?? currentStage
}
