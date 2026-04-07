import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../lib/prisma.js'
import { relationshipMemory } from './relationship-memory.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlaybookInsight {
  businessId: string
  generatedAt: Date
  avgInteractionsToClose: number
  bestCallWindows: string[]
  winningPatterns: string[]
  mostEffectiveOffers: string[]
  commonObjections: Array<{ objection: string; successfulResponse: string }>
  verticalInsights: Record<string, string>
  recommendedNextActions: string[]
}

export interface LeadScoreFactors {
  baseScore: number
  sentimentBonus: number
  buyingSignalBonus: number
  engagementBonus: number
  recencyPenalty: number
  finalScore: number
  factors: string[]
}

// ─── Learning Engine ─────────────────────────────────────────────────────────

let _anthropic: Anthropic | null = null

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
    _anthropic = new Anthropic({ apiKey })
  }
  return _anthropic
}

export class LearningEngine {
  /**
   * Generates a full self-improving playbook for a business.
   * Analyzes all closed deals, surfaces winning patterns, and returns
   * structured insights the agent brain can use to improve close rates.
   *
   * Called by the Railway worker on a monthly schedule.
   * Also available on-demand via /api/briefing for the dashboard.
   *
   * @param businessId - The business to analyze
   */
  async generatePlaybook(businessId: string): Promise<PlaybookInsight> {
    const patterns = await relationshipMemory.getLearningPatterns(businessId)

    // Get vertical breakdown of wins
    const wonByVertical = await prisma.lead.groupBy({
      by: ['vertical'],
      where: { businessId, pipelineStage: 'CLOSED_WON' },
      _count: { id: true },
      _avg: { dealValue: true },
    })

    const verticalInsights: Record<string, string> = {}
    for (const row of wonByVertical) {
      const vertical = row.vertical ?? 'OTHER'
      verticalInsights[vertical] =
        `${row._count.id} closed deals | avg $${Math.round(row._avg.dealValue ?? 0).toLocaleString()}`
    }

    // Get counts for actionable metrics
    const [totalLeads, hotLeads, dormantLeads] = await Promise.all([
      prisma.lead.count({ where: { businessId } }),
      prisma.lead.count({ where: { businessId, score: { gte: 80 } } }),
      prisma.lead.count({
        where: {
          businessId,
          lastInteractionAt: {
            lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          },
          pipelineStage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
        },
      }),
    ])

    // Use Claude to generate recommended next actions
    const anthropic = getAnthropic()
    const actionMessage = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `Based on this business's sales data, generate 5 specific recommended next actions as a JSON array of strings.

Data:
- Total leads: ${totalLeads}
- Hot leads (score 80+): ${hotLeads}
- Dormant leads (14+ days no contact): ${dormantLeads}
- Avg interactions to close: ${patterns.avgInteractionsToClose}
- Best call windows: ${patterns.bestCallWindows.join(', ')}
- Winning patterns: ${patterns.winningPatterns.slice(0, 3).join(' | ')}

Actions should be specific, actionable, and prioritized by revenue impact.
Return only a JSON array of strings. No markdown fences.`,
        },
      ],
    })

    let recommendedNextActions: string[] = []
    try {
      const raw =
        actionMessage.content[0]?.type === 'text' ? actionMessage.content[0].text.trim() : '[]'
      recommendedNextActions = JSON.parse(raw) as string[]
    } catch {
      recommendedNextActions = [
        `Call the ${hotLeads} hot leads today during ${patterns.bestCallWindows[0] ?? 'morning hours'}`,
        `Enroll ${dormantLeads} dormant leads in the win-back sequence`,
        'Review and update competitor battle cards',
      ]
    }

    return {
      businessId,
      generatedAt: new Date(),
      avgInteractionsToClose: patterns.avgInteractionsToClose,
      bestCallWindows: patterns.bestCallWindows,
      winningPatterns: patterns.winningPatterns,
      mostEffectiveOffers: patterns.mostEffectiveOffers,
      commonObjections: patterns.commonObjections,
      verticalInsights,
      recommendedNextActions,
    }
  }

  /**
   * Recalculates a lead's score based on their full interaction history.
   * Factors in: sentiment trend, buying signals, engagement frequency, recency.
   *
   * Called after every interaction to keep scores current.
   *
   * @param leadId - The lead to score
   */
  async recalculateLeadScore(leadId: string): Promise<LeadScoreFactors> {
    const [lead, interactions] = await Promise.all([
      prisma.lead.findUnique({
        where: { id: leadId },
        include: { memoryProfile: true },
      }),
      prisma.interaction.findMany({
        where: { leadId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ])

    if (!lead) throw new Error(`Lead ${leadId} not found`)

    const factors: string[] = []
    let baseScore = 10 // every known lead starts at 10
    let sentimentBonus = 0
    let buyingSignalBonus = 0
    let engagementBonus = 0
    let recencyPenalty = 0

    // Sentiment bonus: up to +30
    const avgSentiment =
      interactions.length > 0
        ? interactions.reduce((sum, i) => sum + i.sentiment, 0) / interactions.length
        : 0
    sentimentBonus = Math.round((avgSentiment / 100) * 30)
    if (sentimentBonus > 0) factors.push(`+${sentimentBonus} sentiment`)

    // Buying signal bonus: +15 per signal, max +30
    const signalCount = interactions.filter((i) => i.buyingSignal).length
    buyingSignalBonus = Math.min(signalCount * 15, 30)
    if (buyingSignalBonus > 0) factors.push(`+${buyingSignalBonus} buying signals (${signalCount})`)

    // Engagement bonus: +2 per interaction, max +20
    engagementBonus = Math.min(interactions.length * 2, 20)
    if (engagementBonus > 0) factors.push(`+${engagementBonus} engagement (${interactions.length} interactions)`)

    // Recency penalty: -10 if no contact in 14+ days
    if (lead.lastInteractionAt) {
      const daysSince = Math.floor(
        (Date.now() - lead.lastInteractionAt.getTime()) / 86400000,
      )
      if (daysSince >= 14) {
        recencyPenalty = -10
        factors.push(`-10 dormant (${daysSince} days)`)
      }
    }

    const finalScore = Math.max(
      0,
      Math.min(100, baseScore + sentimentBonus + buyingSignalBonus + engagementBonus + recencyPenalty),
    )

    // Persist updated score and close probability
    const closeProbability = finalScore / 100
    await prisma.lead.update({
      where: { id: leadId },
      data: { score: finalScore, closeProbability },
    })

    return {
      baseScore,
      sentimentBonus,
      buyingSignalBonus,
      engagementBonus,
      recencyPenalty,
      finalScore,
      factors,
    }
  }

  /**
   * Replays failed memory writes from the FailedMemoryWrite table.
   * Called by the Railway worker every hour.
   * Marks records as resolved on success; increments attemptCount on failure.
   */
  async replayFailedMemoryWrites(): Promise<{ replayed: number; failed: number }> {
    const pending = await prisma.failedMemoryWrite.findMany({
      where: { resolved: false, attemptCount: { lt: 10 } },
      take: 50,
      orderBy: { createdAt: 'asc' },
    })

    let replayed = 0
    let failed = 0

    for (const record of pending) {
      try {
        const data = record.interactionData as Record<string, unknown>
        const type = data['type'] as string | undefined

        if (type === 'interaction' || type === 'mem0Interaction') {
          const { addToMem0: addMem0 } = await import('./mem0-client.js')
          const transcript = (data['transcript'] as string) ?? ''
          await addMem0(record.leadId, [{ role: 'user', content: transcript }])
        } else if (type === 'upsertLeadProfile') {
          const { upsertLeadProfile } = await import('./pinecone-client.js')
          const profileSummary = (data['profileSummary'] as string) ?? ''
          await upsertLeadProfile(record.leadId, profileSummary, {
            leadId: record.leadId,
            businessId: record.businessId,
          })
        }

        await prisma.failedMemoryWrite.update({
          where: { id: record.id },
          data: { resolved: true },
        })
        replayed++
      } catch {
        await prisma.failedMemoryWrite.update({
          where: { id: record.id },
          data: { attemptCount: { increment: 1 } },
        })
        failed++
      }
    }

    return { replayed, failed }
  }
}

/** Singleton instance. */
export const learningEngine = new LearningEngine()
