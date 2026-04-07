import Anthropic from '@anthropic-ai/sdk'

// ─── Types ────────────────────────────────────────────────────────────────────

export type Emotion =
  | 'excited'
  | 'interested'
  | 'neutral'
  | 'hesitant'
  | 'frustrated'
  | 'angry'
  | 'confused'
  | 'hopeful'
  | 'skeptical'

export type Urgency = 'low' | 'medium' | 'high'

export interface EmotionAnalysis {
  /** -100 (hostile) to 100 (enthusiastic) */
  sentiment: number
  emotion: Emotion
  buyingSignal: boolean
  urgency: Urgency
  /** Specific buying-signal phrase detected, if any */
  triggerPhrase: string | null
  /** Specific objection phrase detected, if any */
  objectionPhrase: string | null
}

// ─── Keyword heuristics (fast path — no Claude call needed) ──────────────────

const BUYING_SIGNAL_PHRASES = [
  'how much', 'what does it cost', 'when can we start', 'how soon',
  "i'm ready", "i'm interested", 'let\'s do it', 'sounds good',
  'where do i sign', 'send me the contract', 'next steps',
  'how do i pay', 'can you send me', 'i want to move forward',
  'can we get started', 'i like it', 'that works for me',
]

const OBJECTION_PHRASES = [
  'too expensive', 'too much', 'can\'t afford', 'out of budget',
  'need to think', 'let me think', 'not sure', 'maybe later',
  'need to talk to', 'have to ask', 'already have', 'currently using',
  'not interested', 'not the right time', 'bad timing',
  'send me more info', 'send me information', 'call me back',
]

const FRUSTRATION_PHRASES = [
  'waste of time', 'this is ridiculous', 'you people', 'forget it',
  'never mind', 'i give up', 'stop calling', 'do not call',
]

function quickHeuristic(text: string): Partial<EmotionAnalysis> {
  const lower = text.toLowerCase()

  const buyingSignal = BUYING_SIGNAL_PHRASES.some((p) => lower.includes(p))
  const triggerPhrase = BUYING_SIGNAL_PHRASES.find((p) => lower.includes(p)) ?? null

  const hasObjection = OBJECTION_PHRASES.some((p) => lower.includes(p))
  const objectionPhrase = OBJECTION_PHRASES.find((p) => lower.includes(p)) ?? null

  const hasFrustration = FRUSTRATION_PHRASES.some((p) => lower.includes(p))

  // Quick sentiment polarity from punctuation and keywords
  const exclamations = (text.match(/!/g) ?? []).length
  const positiveWords = ['great', 'perfect', 'excellent', 'love', 'yes', 'absolutely', 'definitely']
  const negativeWords = ['no', 'not', 'never', 'can\'t', 'won\'t', 'don\'t', 'hate', 'terrible']
  const positiveCount = positiveWords.filter((w) => lower.includes(w)).length
  const negativeCount = negativeWords.filter((w) => lower.includes(w)).length

  let sentiment = 0
  sentiment += positiveCount * 15
  sentiment -= negativeCount * 10
  sentiment += exclamations * 5
  if (buyingSignal) sentiment += 20
  if (hasObjection) sentiment -= 15
  if (hasFrustration) sentiment -= 40

  return {
    buyingSignal,
    triggerPhrase,
    objectionPhrase,
    sentiment: Math.max(-100, Math.min(100, sentiment)),
  }
}

// ─── EmotionIntel ─────────────────────────────────────────────────────────────

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
 * Analyzes a lead's message for emotion, sentiment, buying signals, and urgency.
 *
 * Uses a fast keyword heuristic pass first, then calls Claude claude-sonnet-4-6
 * for nuanced analysis. Both results are merged — Claude's values win on conflict.
 *
 * @param text            - The lead's raw message text
 * @param conversationCtx - Optional prior context (last 1-2 messages) for accuracy
 */
export async function analyzeEmotion(
  text: string,
  conversationCtx?: string,
): Promise<EmotionAnalysis> {
  const heuristic = quickHeuristic(text)
  const anthropic = getAnthropic()

  const context = conversationCtx ? `\nPrior context: ${conversationCtx}` : ''

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `Analyze this sales prospect message for emotional intelligence. Return a JSON object with exactly these fields:
- sentiment: number (-100 hostile to 100 enthusiastic)
- emotion: one of: excited|interested|neutral|hesitant|frustrated|angry|confused|hopeful|skeptical
- buyingSignal: boolean (true if they are showing purchase intent)
- urgency: one of: low|medium|high
- triggerPhrase: string|null (exact phrase showing buying intent, or null)
- objectionPhrase: string|null (exact phrase showing an objection, or null)

Message: "${text}"${context}

Return only valid JSON. No markdown fences.`,
      },
    ],
  })

  const raw = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '{}'

  try {
    const claudeResult = JSON.parse(raw) as EmotionAnalysis
    // Merge: Claude wins on all fields, use heuristic as fallback
    return {
      sentiment: claudeResult.sentiment ?? heuristic.sentiment ?? 0,
      emotion: claudeResult.emotion ?? 'neutral',
      buyingSignal: claudeResult.buyingSignal ?? heuristic.buyingSignal ?? false,
      urgency: claudeResult.urgency ?? 'low',
      triggerPhrase: claudeResult.triggerPhrase ?? heuristic.triggerPhrase ?? null,
      objectionPhrase: claudeResult.objectionPhrase ?? heuristic.objectionPhrase ?? null,
    }
  } catch {
    // Heuristic-only fallback if Claude fails
    return {
      sentiment: heuristic.sentiment ?? 0,
      emotion: 'neutral',
      buyingSignal: heuristic.buyingSignal ?? false,
      urgency: 'low',
      triggerPhrase: heuristic.triggerPhrase ?? null,
      objectionPhrase: heuristic.objectionPhrase ?? null,
    }
  }
}
