// ─── Types ────────────────────────────────────────────────────────────────────

export type ObjectionType =
  | 'price'
  | 'timing'
  | 'competitor'
  | 'authority'
  | 'need_more_info'
  | 'ai_concern'
  | 'setup_fee'
  | 'trust'
  | 'no_response'
  | 'unknown'

export interface DetectedObjection {
  type: ObjectionType
  confidence: 'high' | 'medium' | 'low'
  rawPhrase: string
}

export interface ObjectionResponse {
  type: ObjectionType
  /** The reframe to use before the response */
  acknowledge: string
  /** The core response — word-for-word guidance for Quorum */
  response: string
  /** Follow-up question to keep the conversation moving */
  bridge: string
}

// ─── Detection patterns ───────────────────────────────────────────────────────

const OBJECTION_PATTERNS: Array<{
  type: ObjectionType
  phrases: string[]
}> = [
  {
    type: 'price',
    phrases: [
      'too expensive', 'too much', 'can\'t afford', 'out of budget', 'costs too much',
      'that\'s a lot', 'way too much', 'not in the budget', 'don\'t have that kind of money',
      'cheaper option', 'more affordable', 'price is too high',
    ],
  },
  {
    type: 'timing',
    phrases: [
      'not the right time', 'bad timing', 'come back later', 'maybe next quarter',
      'need to think', 'let me think', 'not ready', 'not now', 'give me some time',
      'revisit this', 'check back', 'in a few months',
    ],
  },
  {
    type: 'competitor',
    phrases: [
      'already have someone', 'already using', 'working with', 'our current',
      'switched to', 'going with', 'looking at', 'comparing',
    ],
  },
  {
    type: 'authority',
    phrases: [
      'need to talk to', 'have to ask', 'check with my', 'run it by',
      'not my decision', 'need approval', 'partner needs to', 'wife', 'husband',
      'board', 'team', 'boss',
    ],
  },
  {
    type: 'need_more_info',
    phrases: [
      'send me more info', 'send me information', 'email me', 'send me something',
      'want to read more', 'need to research', 'do my homework', 'look into it',
    ],
  },
  {
    type: 'ai_concern',
    phrases: [
      'ai', 'robot', 'not a real person', 'sounds fake', 'is this ai',
      'are you real', 'talking to a bot', 'automated',
    ],
  },
  {
    type: 'setup_fee',
    phrases: [
      'setup fee', 'upfront cost', 'one time fee', 'why do i pay', 'what\'s the setup for',
      'why setup', 'setup charge',
    ],
  },
  {
    type: 'trust',
    phrases: [
      'how do i know', 'prove it', 'show me', 'seems too good', 'skeptical',
      'heard this before', 'guarantee', 'what if it doesn\'t work', 'results',
    ],
  },
  {
    type: 'no_response',
    phrases: [],
  },
]

// ─── Response playbook ────────────────────────────────────────────────────────

const OBJECTION_RESPONSES: Record<ObjectionType, ObjectionResponse> = {
  price: {
    type: 'price',
    acknowledge: "I hear you — and price is always worth talking through.",
    response: `Here's the honest math: a human sales rep fully loaded — salary, taxes, benefits, training — runs $6,700 a month on average. Quorum is $1,497. And Quorum answers every call at 2am, never has a bad day, and remembers every conversation perfectly. The question isn't whether this costs money. It's whether the gap between what you're closing now and what you should be closing is worth $1,497 a month to fix.`,
    bridge: "What does a missed lead actually cost you right now?",
  },
  timing: {
    type: 'timing',
    acknowledge: "Totally fair — timing matters.",
    response: `The thing about timing is that your competitors don't wait. Every week that goes by, leads are calling you and getting voicemail, or calling someone else and getting answered. The reason most businesses tell me 'now isn't the right time' is because they haven't yet felt the full cost of not having this. What would need to change for timing to feel right?`,
    bridge: "Is it a budget timing thing, or something else going on in the business?",
  },
  competitor: {
    type: 'competitor',
    acknowledge: "Makes sense — I'd want to know what you're working with.",
    response: `Here's what I'd ask you to compare: does your current solution remember every conversation this lead has ever had with you, across every channel, without resetting? Does it call you every morning at 8am to tell you exactly which deals closed overnight and which lead to call first? Most tools are reactive — they log what happened. Quorum is proactive — it decides what happens next. That's a different category.`,
    bridge: "What's the one thing your current setup doesn't do that you wish it did?",
  },
  authority: {
    type: 'authority',
    acknowledge: "Of course — big decisions should involve the right people.",
    response: `Totally understand. Here's what I'd suggest: let me give you everything you need to make this a 5-minute conversation with them. The ROI math, what's included, what setup looks like. If you walk in with the numbers, it's not a decision meeting — it's a formality. Would it help if I put together a one-page summary specifically for that conversation?`,
    bridge: "When do you typically meet with them — end of week, start of week?",
  },
  need_more_info: {
    type: 'need_more_info',
    acknowledge: "Happy to send something over.",
    response: `I'll be direct with you though — most people who ask for more information are really asking a different question. They want to know if this actually works, or if the numbers hold up, or if there's a catch. Which of those is it for you? Because I'd rather answer that question right now than have something sit in your inbox.`,
    bridge: "What's the specific thing you'd want the email to address?",
  },
  ai_concern: {
    type: 'ai_concern',
    acknowledge: "That's a fair question and I want to be straight with you.",
    response: `Quorum is powered by AI, yes. But here's what that actually means in practice: it knows your business inside and out, it remembers every conversation you've ever had with every lead, and it sounds like a real person because it's trained specifically on your voice and your business — not some generic script. The leads who've interacted with Quorum don't ask if it's AI. They ask when they can get started.`,
    bridge: "What's the specific concern — is it about how it sounds, or something else?",
  },
  setup_fee: {
    type: 'setup_fee',
    acknowledge: "Good question — and it's worth explaining exactly what that covers.",
    response: `The setup fee isn't a software activation. It's six specific deliverables: we train Quorum on your entire knowledge base, configure its voice and persona, wire it into your CRM and calendar, build out battle cards for your top competitors, extract your best closing language from real conversations, and run a 30-day optimization pass after go-live. That's 40+ hours of work. The fee is what ensures Quorum actually performs — not just technically functions.`,
    bridge: "Which of those pieces is most important to you?",
  },
  trust: {
    type: 'trust',
    acknowledge: "You should be skeptical — that's the right instinct.",
    response: `Here's what I'd offer: instead of taking my word for it, let's look at the math together. If Quorum closes one extra deal per month that you would have otherwise missed — one lead who called at 11pm, one follow-up that slipped — what does that deal worth at your average transaction size? For most businesses, that single deal pays for the entire month. Everything else is upside. Plus we stand behind it with a performance guarantee on the Enterprise plan.`,
    bridge: "What would a fair test look like to you?",
  },
  no_response: {
    type: 'no_response',
    acknowledge: "I know life gets busy.",
    response: `I don't want to keep reaching out if the timing genuinely isn't right. But I also know that leads don't stop calling just because you're busy — they just stop leaving messages and call someone else. If there's a specific reason this hasn't moved forward, I'd rather know that than guess. What's actually going on?`,
    bridge: "Is this still something you're thinking about, or should I close this out?",
  },
  unknown: {
    type: 'unknown',
    acknowledge: "I want to make sure I understand what you're saying.",
    response: `Help me out here — what's the main thing that's giving you pause? I'd rather address the real concern than guess at it.`,
    bridge: "What would need to be true for this to be an obvious yes?",
  },
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Detects whether a message contains a known objection pattern.
 * Returns null if no objection is detected.
 *
 * @param text - The lead's raw message
 */
export function detectObjection(text: string): DetectedObjection | null {
  const lower = text.toLowerCase()

  for (const { type, phrases } of OBJECTION_PATTERNS) {
    if (phrases.length === 0) continue
    const matchedPhrase = phrases.find((p) => lower.includes(p))
    if (matchedPhrase) {
      // Confidence: high if the phrase is 3+ words, medium if 2 words, low if 1 word
      const wordCount = matchedPhrase.split(' ').length
      const confidence = wordCount >= 3 ? 'high' : wordCount === 2 ? 'medium' : 'low'
      return { type, confidence, rawPhrase: matchedPhrase }
    }
  }

  return null
}

/**
 * Returns the word-for-word response playbook for a detected objection type.
 * Injects business-specific context where available.
 *
 * @param type           - The detected objection type
 * @param businessName   - Used to personalize the response
 */
export function getObjectionResponse(
  type: ObjectionType,
  businessName?: string,
): ObjectionResponse {
  const response = OBJECTION_RESPONSES[type] ?? OBJECTION_RESPONSES.unknown
  if (!response) return OBJECTION_RESPONSES.unknown!

  if (businessName) {
    return {
      ...response,
      response: response.response.replace(/Quorum/g, businessName),
    }
  }

  return response
}

/**
 * Formats a complete objection response as a single natural-language string
 * that can be injected directly into Quorum's system prompt.
 *
 * @param type         - Objection type
 * @param businessName - Business name for personalization
 */
export function formatObjectionGuidance(type: ObjectionType, businessName?: string): string {
  const { acknowledge, response, bridge } = getObjectionResponse(type, businessName)
  return `Objection detected (${type}). Handle it this way:
Acknowledge: "${acknowledge}"
Response: "${response}"
Bridge back with: "${bridge}"`
}
