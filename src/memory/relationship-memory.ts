import Anthropic from '@anthropic-ai/sdk'
// @ts-ignore — Prisma 7 generates non-standard module layout
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import {
  upsertInteraction,
  upsertLeadProfile,
  semanticSearch as pineconeSearch,
} from './pinecone-client.js'
import { addToMem0, getAllMemories, searchMemories } from './mem0-client.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AddInteractionInput {
  interactionId: string
  channel: string
  direction: 'INBOUND' | 'OUTBOUND'
  transcript: string
  sentiment: number
  emotionDetected?: string
  buyingSignal?: boolean
  objectionRaised?: string
  competitorMentioned?: string
  outcome?: string
  durationSeconds?: number
}

export interface LeadMemory {
  lead: {
    id: string
    name: string
    phone: string | null
    email: string | null
    pipelineStage: string
    score: number
    dealValue: number | null
    closeProbability: number | null
    lastInteractionAt: Date | null
  }
  memoryProfile: {
    preferences: unknown
    keyFacts: unknown
    sentimentHistory: unknown
    closingInsights: unknown
    personalDetails: unknown
  } | null
  interactions: Array<{
    id: string
    channel: string
    direction: string
    transcript: string | null
    sentiment: number
    buyingSignal: boolean
    objectionRaised: string | null
    competitorMentioned: string | null
    outcome: string | null
    createdAt: Date
  }>
  mem0Facts: Array<{ id: string; memory: string; created_at: string; updated_at: string }>
  sentimentTrend: 'warming' | 'cooling' | 'flat'
  recommendedOpening: string
}

export interface SalesInsights {
  recommendedOpening: string
  expectedObjections: string[]
  optimalOffer: string
  closeProbability: number
  reasoning: string
}

export interface LearningPatterns {
  winningPatterns: string[]
  bestCallWindows: string[]
  mostEffectiveOffers: string[]
  commonObjections: Array<{ objection: string; successfulResponse: string }>
  avgInteractionsToClose: number
}

export interface SemanticSearchResult {
  interactionId: string
  score: number
  leadId: string
  channel: string
  sentiment: number
  outcome: string
  transcriptSnippet: string
  timestamp: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Waits for a fixed number of milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retries an async operation once after a delay, then writes to FailedMemoryWrite
 * on second failure. Never throws — memory failures must never block lead responses.
 */
async function withMemoryRetry(
  operation: () => Promise<void>,
  fallbackData: {
    leadId: string
    businessId: string
    interactionData: Record<string, unknown>
    failureReason: string
  },
): Promise<void> {
  try {
    await operation()
    return
  } catch (firstError) {
    // First failure: wait 500ms and retry once
    await delay(500)
    try {
      await operation()
      return
    } catch (secondError) {
      // Second failure: write to fallback table, never throw
      const reason =
        secondError instanceof Error ? secondError.message : String(secondError)
      try {
        await prisma.failedMemoryWrite.create({
          data: {
            leadId: fallbackData.leadId,
            businessId: fallbackData.businessId,
            interactionData: fallbackData.interactionData as Prisma.InputJsonValue,
            failureReason: `${fallbackData.failureReason}: ${reason}`,
            attemptCount: 1,
            resolved: false,
          },
        })
      } catch {
        // If even the fallback write fails, log to stderr and give up
        console.error(
          '[RelationshipMemory] CRITICAL: FailedMemoryWrite insert failed for lead',
          fallbackData.leadId,
        )
      }
    }
  }
}

/** Calculates sentiment trend from the last 5 interactions. */
function calculateSentimentTrend(
  interactions: Array<{ sentiment: number }>,
): 'warming' | 'cooling' | 'flat' {
  if (interactions.length < 2) return 'flat'
  const recent = interactions.slice(-5)
  const first = recent[0]?.sentiment ?? 0
  const last = recent[recent.length - 1]?.sentiment ?? 0
  const delta = last - first
  if (delta > 10) return 'warming'
  if (delta < -10) return 'cooling'
  return 'flat'
}

/** Generates a text summary of a lead profile for Pinecone embedding. */
function buildLeadProfileSummary(
  lead: { name: string; vertical: string | null; pipelineStage: string },
  profile: { keyFacts: unknown; personalDetails: unknown; preferences: unknown } | null,
  recentTranscripts: string[],
): string {
  const facts = profile?.keyFacts ? JSON.stringify(profile.keyFacts) : ''
  const details = profile?.personalDetails ? JSON.stringify(profile.personalDetails) : ''
  const transcriptSample = recentTranscripts.slice(0, 3).join(' | ')
  return [
    `Lead: ${lead.name}`,
    `Vertical: ${lead.vertical ?? 'unknown'}`,
    `Stage: ${lead.pipelineStage}`,
    facts ? `Key facts: ${facts}` : '',
    details ? `Personal details: ${details}` : '',
    transcriptSample ? `Recent context: ${transcriptSample}` : '',
  ]
    .filter(Boolean)
    .join('. ')
}

// ─── RelationshipMemory ───────────────────────────────────────────────────────

let _anthropic: Anthropic | null = null

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
    _anthropic = new Anthropic({ apiKey })
  }
  return _anthropic
}

export class RelationshipMemory {
  /**
   * Creates or updates a lead profile in both Mem0 and Pinecone simultaneously.
   * Called when a new lead is created or when profile data is materially updated.
   *
   * @param leadId - The lead's database ID
   * @param data   - Partial profile facts to store (budget, timeline, etc.)
   */
  async upsertLead(
    leadId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { memoryProfile: true, interactions: { orderBy: { createdAt: 'desc' }, take: 3 } },
    })
    if (!lead) throw new Error(`Lead ${leadId} not found`)

    const businessId = lead.businessId
    const profileSummary = buildLeadProfileSummary(
      lead,
      lead.memoryProfile,
      lead.interactions.map((i) => i.transcript ?? '').filter(Boolean),
    )

    // Update MemoryProfile in PostgreSQL
    await prisma.memoryProfile.upsert({
      where: { leadId },
      create: {
        leadId,
        keyFacts: data as Prisma.InputJsonValue,
        preferences: {} as Prisma.InputJsonValue,
        sentimentHistory: [] as unknown as Prisma.InputJsonValue,
        closingInsights: {} as Prisma.InputJsonValue,
        personalDetails: {} as Prisma.InputJsonValue,
      },
      update: {
        keyFacts: data as Prisma.InputJsonValue,
        lastUpdatedAt: new Date(),
      },
    })

    // Mem0: store profile facts as structured memory
    const mem0Messages = Object.entries(data).map(([key, value]) => ({
      role: 'user' as const,
      content: `${key}: ${String(value)}`,
    }))

    await withMemoryRetry(
      () => addToMem0(leadId, mem0Messages),
      { leadId, businessId, interactionData: { type: 'upsertLead', data }, failureReason: 'Mem0 upsert failed' },
    )

    // Pinecone: embed the profile summary
    await withMemoryRetry(
      () => upsertLeadProfile(leadId, profileSummary, { leadId, businessId }),
      { leadId, businessId, interactionData: { type: 'upsertLeadProfile', profileSummary }, failureReason: 'Pinecone upsert failed' },
    )
  }

  /**
   * Retrieves the full relationship profile for a lead.
   * Called BEFORE every Quorum interaction — this is what makes Quorum never forget.
   *
   * Returns all past interactions, sentiment history, extracted facts,
   * buying signals, objections, close probability trend, and the
   * recommended opening line for the next contact.
   *
   * @param leadId - The lead's database ID
   */
  async getMemory(leadId: string): Promise<LeadMemory> {
    const [lead, mem0Facts] = await Promise.all([
      prisma.lead.findUnique({
        where: { id: leadId },
        include: {
          memoryProfile: true,
          interactions: {
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
              id: true,
              channel: true,
              direction: true,
              transcript: true,
              sentiment: true,
              buyingSignal: true,
              objectionRaised: true,
              competitorMentioned: true,
              outcome: true,
              createdAt: true,
            },
          },
        },
      }),
      getAllMemories(leadId).catch(() => []),
    ])

    if (!lead) throw new Error(`Lead ${leadId} not found`)

    const sentimentTrend = calculateSentimentTrend(lead.interactions)

    // Build recommended opening from memory context
    const recommendedOpening = this.buildRecommendedOpening(lead, mem0Facts, sentimentTrend)

    return {
      lead: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        pipelineStage: lead.pipelineStage,
        score: lead.score,
        dealValue: lead.dealValue,
        closeProbability: lead.closeProbability,
        lastInteractionAt: lead.lastInteractionAt,
      },
      memoryProfile: lead.memoryProfile
        ? {
            preferences: lead.memoryProfile.preferences,
            keyFacts: lead.memoryProfile.keyFacts,
            sentimentHistory: lead.memoryProfile.sentimentHistory,
            closingInsights: lead.memoryProfile.closingInsights,
            personalDetails: lead.memoryProfile.personalDetails,
          }
        : null,
      interactions: lead.interactions,
      mem0Facts,
      sentimentTrend,
      recommendedOpening,
    }
  }

  /**
   * Appends a completed interaction to the relationship history.
   * Re-embeds the conversation in Pinecone, updates Mem0 structured fields,
   * extracts new personal facts, and updates the sentiment score.
   *
   * Per the post-response pipeline contract: this must be awaited before
   * the next inbound message from this lead is processed.
   *
   * @param leadId      - The lead's database ID
   * @param interaction - The completed interaction data
   */
  async addInteraction(
    leadId: string,
    interaction: AddInteractionInput,
  ): Promise<void> {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { businessId: true, pipelineStage: true },
    })
    if (!lead) throw new Error(`Lead ${leadId} not found`)

    const businessId = lead.businessId
    const { interactionId, transcript, sentiment } = interaction

    // Pinecone: embed this interaction for semantic search
    await withMemoryRetry(
      () =>
        upsertInteraction(interactionId, transcript, {
          leadId,
          businessId,
          channel: interaction.channel,
          sentiment,
          outcome: interaction.outcome ?? 'unknown',
          timestamp: new Date().toISOString(),
          transcriptSnippet: transcript.slice(0, 1000),
        }),
      {
        leadId,
        businessId,
        interactionData: { type: 'interaction', interactionId, transcript: transcript.slice(0, 500) },
        failureReason: 'Pinecone interaction embed failed',
      },
    )

    // Mem0: store conversation as structured memory for fact extraction
    await withMemoryRetry(
      () =>
        addToMem0(leadId, [
          { role: 'user', content: transcript },
          ...(interaction.outcome
            ? [{ role: 'assistant' as const, content: `Outcome: ${interaction.outcome}` }]
            : []),
        ]),
      {
        leadId,
        businessId,
        interactionData: { type: 'mem0Interaction', interactionId, transcript: transcript.slice(0, 500) },
        failureReason: 'Mem0 interaction write failed',
      },
    )

    // Update lead's sentiment score and lastInteractionAt in PostgreSQL
    await this.updateSentiment(leadId, sentiment, `Interaction ${interactionId}`)

    // Update lead score based on buying signals and sentiment
    const scoreAdjustment =
      (interaction.buyingSignal ? 10 : 0) +
      (sentiment > 50 ? 5 : sentiment < -20 ? -5 : 0)

    if (scoreAdjustment !== 0) {
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          score: { increment: scoreAdjustment },
          lastInteractionAt: new Date(),
        },
      })
    } else {
      await prisma.lead.update({
        where: { id: leadId },
        data: { lastInteractionAt: new Date() },
      })
    }
  }

  /**
   * Updates a lead's sentiment score and appends to their sentiment history.
   * Calculates and stores the trend: warming / cooling / flat.
   *
   * @param leadId - The lead's database ID
   * @param score  - Sentiment score from -100 (hostile) to 100 (enthusiastic)
   * @param reason - What drove this sentiment reading
   */
  async updateSentiment(leadId: string, score: number, reason: string): Promise<void> {
    const profile = await prisma.memoryProfile.findUnique({ where: { leadId } })

    const existingHistory = Array.isArray(profile?.sentimentHistory)
      ? (profile.sentimentHistory as Array<{ score: number; reason: string; at: string }>)
      : []

    const updatedHistory = [
      ...existingHistory,
      { score, reason, at: new Date().toISOString() },
    ]

    const trend = calculateSentimentTrend(updatedHistory.map((h) => ({ sentiment: h.score })))

    await prisma.memoryProfile.upsert({
      where: { leadId },
      create: {
        leadId,
        sentimentHistory: updatedHistory as unknown as Prisma.InputJsonValue,
        preferences: {} as Prisma.InputJsonValue,
        keyFacts: {} as Prisma.InputJsonValue,
        closingInsights: {} as Prisma.InputJsonValue,
        personalDetails: {} as Prisma.InputJsonValue,
      },
      update: {
        sentimentHistory: updatedHistory as unknown as Prisma.InputJsonValue,
        closingInsights: { trend, lastScore: score, lastReason: reason } as Prisma.InputJsonValue,
        lastUpdatedAt: new Date(),
      },
    })
  }

  /**
   * Calls Claude claude-sonnet-4-6 with the lead's full memory context to generate
   * actionable sales intelligence for the next interaction.
   *
   * Returns: recommended opening line, expected objections, optimal offer or angle,
   * close probability with reasoning.
   *
   * @param leadId - The lead's database ID
   */
  async getSalesInsights(leadId: string): Promise<SalesInsights> {
    const memory = await this.getMemory(leadId)
    const anthropic = getAnthropic()

    const context = `
Lead: ${memory.lead.name}
Pipeline Stage: ${memory.lead.pipelineStage}
Lead Score: ${memory.lead.score}/100
Deal Value: ${memory.lead.dealValue ? `$${memory.lead.dealValue.toLocaleString()}` : 'unknown'}
Current Close Probability: ${memory.lead.closeProbability ? `${Math.round(memory.lead.closeProbability * 100)}%` : 'unknown'}
Sentiment Trend: ${memory.sentimentTrend}
Last Interaction: ${memory.lead.lastInteractionAt?.toLocaleDateString() ?? 'never'}

Stored Facts (Mem0):
${memory.mem0Facts.map((f) => `- ${f.memory}`).join('\n') || 'None yet'}

Recent Interactions (last ${memory.interactions.length}):
${memory.interactions
  .slice(0, 5)
  .map(
    (i) =>
      `[${i.createdAt.toLocaleDateString()} ${i.channel}] Sentiment: ${i.sentiment} | Signal: ${i.buyingSignal ? 'YES' : 'no'} | Objection: ${i.objectionRaised ?? 'none'} | Outcome: ${i.outcome ?? 'unknown'}`,
  )
  .join('\n') || 'No interactions yet'}
`.trim()

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `You are Quorum's sales intelligence engine. Analyze this lead's relationship history and return a JSON object with exactly these fields:
- recommendedOpening: string (specific, memory-based opening line — not generic)
- expectedObjections: string[] (top 3 likely objections based on history)
- optimalOffer: string (best angle or offer for this specific lead right now)
- closeProbability: number (0 to 1, your confidence this lead closes within 30 days)
- reasoning: string (2-3 sentence explanation of your analysis)

Lead context:
${context}

Return only valid JSON. No markdown fences. No explanation outside the JSON.`,
        },
      ],
    })

    const raw = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '{}'
    try {
      return JSON.parse(raw) as SalesInsights
    } catch {
      return {
        recommendedOpening: `Hey ${memory.lead.name}, following up on our last conversation.`,
        expectedObjections: ['price', 'timing', 'need to think about it'],
        optimalOffer: 'Present value proposition and ask for a decision',
        closeProbability: 0.3,
        reasoning: 'Unable to parse Claude response — using safe defaults.',
      }
    }
  }

  /**
   * Analyzes all closed deals for a business to extract self-improving playbook insights.
   * Called by the learning engine on a schedule — not on every interaction.
   *
   * @param businessId - The business to analyze
   */
  async getLearningPatterns(businessId: string): Promise<LearningPatterns> {
    const closedDeals = await prisma.interaction.findMany({
      where: {
        businessId,
        lead: { pipelineStage: 'CLOSED_WON' },
      },
      include: { lead: { select: { name: true, vertical: true, dealValue: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    if (closedDeals.length === 0) {
      return {
        winningPatterns: [],
        bestCallWindows: [],
        mostEffectiveOffers: [],
        commonObjections: [],
        avgInteractionsToClose: 0,
      }
    }

    // Aggregate objections and outcomes from closed deals
    const objections = closedDeals
      .map((i) => i.objectionRaised)
      .filter((o): o is string => o !== null)

    const outcomes = closedDeals
      .map((i) => i.outcome)
      .filter((o): o is string => o !== null)

    // Hourly distribution of winning interactions
    const hourCounts: Record<number, number> = {}
    for (const interaction of closedDeals) {
      const hour = new Date(interaction.createdAt).getHours()
      hourCounts[hour] = (hourCounts[hour] ?? 0) + 1
    }
    const bestHours = Object.entries(hourCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([hour]) => `${hour}:00–${Number(hour) + 1}:00`)

    // Average interactions per closed lead
    const leadIds = [...new Set(closedDeals.map((i) => i.leadId))]
    const interactionCounts = await Promise.all(
      leadIds.map((lid) =>
        prisma.interaction.count({ where: { leadId: lid } }),
      ),
    )
    const avgInteractions =
      interactionCounts.length > 0
        ? interactionCounts.reduce((a, b) => a + b, 0) / interactionCounts.length
        : 0

    // Use Claude to extract patterns from the raw data
    const anthropic = getAnthropic()
    const patternMessage = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Analyze these sales patterns from ${closedDeals.length} closed deals and return a JSON object with:
- winningPatterns: string[] (top 5 conversation patterns that led to closes)
- mostEffectiveOffers: string[] (top 3 most effective offers/angles)
- commonObjections: Array<{objection: string, successfulResponse: string}> (top 3)

Objections raised in closed deals: ${objections.slice(0, 30).join(', ')}
Outcomes from closed deals: ${outcomes.slice(0, 30).join(', ')}

Return only valid JSON. No markdown fences.`,
        },
      ],
    })

    const raw =
      patternMessage.content[0]?.type === 'text' ? patternMessage.content[0].text.trim() : '{}'
    let parsed: Partial<LearningPatterns> = {}
    try {
      parsed = JSON.parse(raw) as Partial<LearningPatterns>
    } catch {
      parsed = {}
    }

    return {
      winningPatterns: parsed.winningPatterns ?? [],
      bestCallWindows: bestHours,
      mostEffectiveOffers: parsed.mostEffectiveOffers ?? [],
      commonObjections: parsed.commonObjections ?? [],
      avgInteractionsToClose: Math.round(avgInteractions * 10) / 10,
    }
  }

  /**
   * Vector-searches all lead interactions for a business to find
   * past conversations semantically similar to the query.
   * Used by the agent brain for pattern matching before generating a response.
   *
   * @param businessId - The business namespace to search within
   * @param query      - Natural language query
   * @param topK       - Number of results (default: 5)
   */
  async semanticSearch(
    businessId: string,
    query: string,
    topK: number = 5,
  ): Promise<SemanticSearchResult[]> {
    const results = await pineconeSearch(businessId, query, topK)
    return results.map((r) => ({
      interactionId: r.id,
      score: r.score,
      leadId: r.metadata.leadId,
      channel: r.metadata.channel,
      sentiment: r.metadata.sentiment,
      outcome: r.metadata.outcome,
      transcriptSnippet: r.metadata.transcriptSnippet,
      timestamp: r.metadata.timestamp,
    }))
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  /**
   * Generates a recommended opening line using memory context.
   * Used in getMemory() — intentionally lightweight (no Claude call)
   * so it runs fast before every interaction.
   */
  private buildRecommendedOpening(
    lead: { name: string; lastInteractionAt: Date | null },
    mem0Facts: Array<{ memory: string }>,
    trend: 'warming' | 'cooling' | 'flat',
  ): string {
    const name = lead.name.split(' ')[0] ?? lead.name
    const daysSince = lead.lastInteractionAt
      ? Math.floor((Date.now() - lead.lastInteractionAt.getTime()) / 86400000)
      : null

    // Surface the most specific fact from Mem0 for a personalized opener
    const specificFact = mem0Facts.find(
      (f) =>
        f.memory.toLowerCase().includes('budget') ||
        f.memory.toLowerCase().includes('timeline') ||
        f.memory.toLowerCase().includes('looking for') ||
        f.memory.toLowerCase().includes('concern'),
    )

    if (specificFact) {
      return `Hey ${name} — following up on what you mentioned: ${specificFact.memory.slice(0, 120)}. Wanted to see where things stand.`
    }

    if (daysSince !== null && daysSince > 7 && trend === 'warming') {
      return `Hey ${name}, it's been ${daysSince} days — good timing to reconnect. Where are you in your thinking?`
    }

    if (trend === 'cooling') {
      return `Hey ${name}, wanted to check in and make sure we haven't missed anything on our end.`
    }

    return `Hey ${name}, following up from our last conversation. Do you have a few minutes?`
  }
}

/** Singleton instance — import this everywhere instead of instantiating directly. */
export const relationshipMemory = new RelationshipMemory()
