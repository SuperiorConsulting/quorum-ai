import { prisma } from '../lib/prisma.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BattleCard {
  competitorName: string
  weaknesses: string[]
  ourAdvantages: string[]
  pricingNotes: string
  proofPoints: string[]
  talkingPoints: string[]
}

export type CompetitorDetectionResult =
  | {
      detected: true
      competitorName: string
      battleCard: BattleCard | null
      /** Injected into Quorum's system prompt when competitor is mentioned */
      interceptPrompt: string
    }
  | { detected: false }

// ─── Known competitor name aliases ───────────────────────────────────────────
// Normalized so "GoHighLevel", "GHL", "Go High Level" all resolve to one name

const COMPETITOR_ALIASES: Record<string, string> = {
  'gohighlevel': 'GoHighLevel',
  'go high level': 'GoHighLevel',
  'ghl': 'GoHighLevel',
  'vapi': 'Vapi',
  'air.ai': 'Air.ai',
  'airai': 'Air.ai',
  'smith.ai': 'Smith.ai',
  'smithai': 'Smith.ai',
  'drift': 'Drift',
  'agentforce': 'Agentforce',
  'salesforce': 'Salesforce',
  'hubspot': 'HubSpot',
  'activecampaign': 'ActiveCampaign',
  'active campaign': 'ActiveCampaign',
  'podium': 'Podium',
  'birdeye': 'Birdeye',
  'bird eye': 'Birdeye',
  'reputation.com': 'Reputation.com',
}

/**
 * Normalizes a raw competitor name from user speech to a canonical name.
 * Returns null if the name is not recognized.
 */
function normalizeCompetitorName(raw: string): string | null {
  const lower = raw.toLowerCase().trim()
  return COMPETITOR_ALIASES[lower] ?? null
}

/**
 * Scans a message for mentions of any known competitor.
 * Returns the first competitor found, or null.
 *
 * @param text - The lead's raw message
 */
function scanForCompetitor(text: string): string | null {
  const lower = text.toLowerCase()
  for (const [alias, canonical] of Object.entries(COMPETITOR_ALIASES)) {
    if (lower.includes(alias)) return canonical
  }
  return null
}

// ─── CompetitorIntercept ──────────────────────────────────────────────────────

/**
 * Checks a message for competitor mentions and loads the appropriate battle card.
 * Returns a full intercept result that Quorum injects into its system prompt.
 *
 * @param text       - The lead's raw message
 * @param businessId - Used to look up business-specific battle cards in the DB
 */
export async function detectAndIntercept(
  text: string,
  businessId: string,
): Promise<CompetitorDetectionResult> {
  const detected = scanForCompetitor(text)
  if (!detected) return { detected: false }

  const battleCard = await getBattleCard(detected, businessId)
  const interceptPrompt = buildInterceptPrompt(detected, battleCard)

  return {
    detected: true,
    competitorName: detected,
    battleCard,
    interceptPrompt,
  }
}

/**
 * Retrieves a battle card for a specific competitor from the database.
 * Falls back to a generic intercept if no card exists.
 *
 * @param competitorName - Canonical competitor name
 * @param businessId     - Business whose battle card library to search
 */
export async function getBattleCard(
  competitorName: string,
  businessId: string,
): Promise<BattleCard | null> {
  const normalized = normalizeCompetitorName(competitorName) ?? competitorName

  const competitor = await prisma.competitor.findFirst({
    where: {
      businessId,
      name: { contains: normalized, mode: 'insensitive' },
    },
  })

  if (!competitor) return null

  return {
    competitorName: competitor.name,
    weaknesses: parseList(competitor.weaknesses),
    ourAdvantages: parseList(competitor.ourAdvantages),
    pricingNotes: competitor.pricingNotes ?? '',
    proofPoints: parseList(competitor.proofPoints),
    talkingPoints: parseList(competitor.talkingPoints),
  }
}

/**
 * Builds a system prompt injection for competitor intercept.
 * Used by Quorum to smoothly redirect when a competitor is mentioned.
 *
 * @param competitorName - The competitor that was mentioned
 * @param battleCard     - Loaded battle card, or null for generic guidance
 */
function buildInterceptPrompt(competitorName: string, battleCard: BattleCard | null): string {
  if (!battleCard) {
    return `COMPETITOR ALERT: The lead mentioned ${competitorName}.
Do not attack ${competitorName} directly. Instead:
1. Acknowledge they are exploring options — that is smart
2. Ask what specifically they like about ${competitorName} (surface their criteria)
3. Position against their stated criteria: "The thing most people find when they compare is..."
4. Focus on Quorum's #1 differentiator: relationship memory that never resets across any channel
5. Ask: "When you have evaluated tools before, what made you go with one over the other?"`
  }

  const weaknesses = battleCard.weaknesses.slice(0, 3).map((w) => `- ${w}`).join('\n')
  const advantages = battleCard.ourAdvantages.slice(0, 3).map((a) => `- ${a}`).join('\n')
  const points = battleCard.talkingPoints.slice(0, 2).map((p) => `- ${p}`).join('\n')

  return `COMPETITOR ALERT: The lead mentioned ${competitorName}.
Battle card loaded. Use these facts naturally — do NOT recite them as a list.

${competitorName} weaknesses (weave in conversationally):
${weaknesses}

Our advantages over ${competitorName}:
${advantages}

Talking points:
${points}

${battleCard.pricingNotes ? `Pricing context: ${battleCard.pricingNotes}` : ''}

${battleCard.proofPoints.length > 0 ? `Proof point to use: "${battleCard.proofPoints[0]}"` : ''}

Approach: Acknowledge ${competitorName} exists. Ask what they specifically like about it. Then bridge to what ${competitorName} cannot do (relationship memory, daily briefings, self-learning playbook). Never be dismissive.`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parses a newline- or comma-delimited string into an array of non-empty strings. */
function parseList(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Lists all competitors configured for a business.
 * Used by the dashboard to display the battle card library.
 *
 * @param businessId - Business to look up
 */
export async function listCompetitors(businessId: string): Promise<BattleCard[]> {
  const competitors = await prisma.competitor.findMany({
    where: { businessId },
    orderBy: { name: 'asc' },
  })

  return competitors.map((c) => ({
    competitorName: c.name,
    weaknesses: parseList(c.weaknesses),
    ourAdvantages: parseList(c.ourAdvantages),
    pricingNotes: c.pricingNotes ?? '',
    proofPoints: parseList(c.proofPoints),
    talkingPoints: parseList(c.talkingPoints),
  }))
}
