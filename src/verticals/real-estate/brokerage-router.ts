import { prisma } from '../../lib/prisma.js'
import { relationshipMemory } from '../../memory/relationship-memory.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentProfile {
  agentId: string
  name: string
  phone: string
  email: string
  /** Neighborhoods this agent specializes in */
  specialties: string[]
  /** Current active lead count */
  activeLeads: number
  /** Whether they are currently available */
  available: boolean
}

export interface RoutingDecision {
  leadId: string
  assignedAgentId: string | null
  assignedAgentName: string | null
  routingReason: string
  leadScore: number
  /** If score < 70, Quorum keeps the lead until qualified */
  quorumHandles: boolean
  agentNotification: string | null
}

// ─── Score thresholds ─────────────────────────────────────────────────────────

/** Leads above this score are routed to human agents immediately */
const ROUTE_TO_AGENT_THRESHOLD = 70

/** Leads below this are kept by Quorum until they qualify */
const QUORUM_HANDLES_THRESHOLD = 70

// ─── BrokerageRouter ──────────────────────────────────────────────────────────

/**
 * Routes fully-qualified real estate leads to the right human agent.
 * Quorum handles all leads below the score threshold — agents only receive
 * leads that are pre-qualified, warm, and ready to engage.
 *
 * For solo agents / individual agents: router always assigns to the owner.
 * For brokerages: routes based on specialty, availability, and load.
 *
 * @param leadId     - Lead to route
 * @param businessId - Brokerage or agent business
 */
export async function routeLead(leadId: string, businessId: string): Promise<RoutingDecision> {
  const [lead, memory, reLead] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, name: true, phone: true, score: true, pipelineStage: true },
    }),
    relationshipMemory.getMemory(leadId),
    prisma.realEstateLead.findUnique({
      where: { leadId },
      select: { type: true, targetNeighborhoods: true, preApproved: true, budget: true },
    }),
  ])

  if (!lead) throw new Error(`Lead ${leadId} not found`)

  const score = lead.score ?? 0

  // Below threshold: Quorum handles until lead qualifies
  if (score < QUORUM_HANDLES_THRESHOLD) {
    return {
      leadId,
      assignedAgentId: null,
      assignedAgentName: null,
      routingReason: `Score ${score} < ${ROUTE_TO_AGENT_THRESHOLD} — Quorum continues qualifying`,
      leadScore: score,
      quorumHandles: true,
      agentNotification: null,
    }
  }

  // Above threshold: route to best available agent
  const agents = await getAvailableAgents(businessId)

  const assignedAgent = agents.length > 0
    ? selectBestAgent(agents, reLead?.targetNeighborhoods as string[] | null)
    : null

  const agentName = assignedAgent?.name ?? 'the team'

  // Build agent notification with full lead summary
  const agentNotification = buildAgentNotification(lead, memory, reLead, score)

  // Update lead with assigned agent
  if (assignedAgent) {
    await prisma.realEstateLead.upsert({
      where: { leadId },
      create: { leadId, type: reLead?.type ?? 'BUYER', preApproved: false, agentId: assignedAgent.agentId },
      update: { agentId: assignedAgent.agentId },
    })
  }

  // Phase 7 will wire actual SMS to agent:
  // await sendSMS(assignedAgent.phone, agentNotification)
  console.log(`[BrokerageRouter] Routing ${lead.name} (score ${score}) → ${agentName}`)
  console.log(`[BrokerageRouter] Notification: ${agentNotification.slice(0, 120)}`)

  return {
    leadId,
    assignedAgentId: assignedAgent?.agentId ?? null,
    assignedAgentName: agentName,
    routingReason: assignedAgent
      ? `Score ${score} ≥ ${ROUTE_TO_AGENT_THRESHOLD} — routed to ${agentName} (specialty match)`
      : `Score ${score} ≥ ${ROUTE_TO_AGENT_THRESHOLD} — no agents available, Quorum retains`,
    leadScore: score,
    quorumHandles: !assignedAgent,
    agentNotification,
  }
}

/**
 * Retrieves all available agents for a brokerage.
 * Agents are stored as Business records with OWNER role, linked to this business.
 * For Phase 6: returns a mock list until the agent management UI is built in Phase 12.
 *
 * @param businessId - Brokerage business ID
 */
async function getAvailableAgents(businessId: string): Promise<AgentProfile[]> {
  // Phase 12 will build a proper Agent model.
  // For now: the business owner IS the agent (solo agent pattern).
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { ownerId: true, name: true, phone: true, email: true },
  })

  if (!business) return []

  return [
    {
      agentId: business.ownerId,
      name: business.name,
      phone: business.phone,
      email: business.email,
      specialties: [],
      activeLeads: 0,
      available: true,
    },
  ]
}

/**
 * Selects the best agent based on neighborhood specialty and current load.
 *
 * @param agents              - Available agents
 * @param targetNeighborhoods - Lead's target areas
 */
function selectBestAgent(
  agents: AgentProfile[],
  targetNeighborhoods: string[] | null,
): AgentProfile | null {
  if (agents.length === 0) return null

  // If we have neighborhoods, prefer specialty match
  if (targetNeighborhoods && targetNeighborhoods.length > 0) {
    const specialtyMatch = agents.find((agent) =>
      agent.specialties.some((s) =>
        targetNeighborhoods.some((n) => n.toLowerCase().includes(s.toLowerCase())),
      ),
    )
    if (specialtyMatch) return specialtyMatch
  }

  // Otherwise: lowest active lead count among available agents
  return agents
    .filter((a) => a.available)
    .sort((a, b) => a.activeLeads - b.activeLeads)[0] ?? agents[0] ?? null
}

/**
 * Builds the SMS notification sent to the assigned agent.
 * This is the message they see when Quorum routes a hot lead to them.
 */
function buildAgentNotification(
  lead: { name: string; phone: string | null; score: number },
  memory: Awaited<ReturnType<typeof relationshipMemory.getMemory>>,
  reLead: { type?: string; preApproved?: boolean; budget?: number | null; targetNeighborhoods?: unknown } | null,
  score: number,
): string {
  const lines = [
    `🔥 QUORUM HOT LEAD — Score ${score}/100`,
    `Name: ${lead.name} | Phone: ${lead.phone ?? 'unknown'}`,
  ]

  if (reLead?.type) lines.push(`Type: ${reLead.type}`)
  if (reLead?.preApproved) lines.push('Pre-approved: YES ✓')
  if (reLead?.budget) lines.push(`Budget: $${reLead.budget.toLocaleString()}`)
  if (Array.isArray(reLead?.targetNeighborhoods) && (reLead.targetNeighborhoods as string[]).length > 0) {
    lines.push(`Target: ${(reLead.targetNeighborhoods as string[]).join(', ')}`)
  }

  const topFact = memory.mem0Facts[0]?.memory
  if (topFact) lines.push(`Context: ${topFact}`)

  const lastInteraction = memory.interactions[0]
  if (lastInteraction?.outcome) lines.push(`Last outcome: ${lastInteraction.outcome}`)

  lines.push(`\nQuorum has been warming this lead. Take it from here.`)

  return lines.join('\n')
}

/**
 * Checks all qualified leads that have not yet been routed and routes them.
 * Called by the Railway worker on a schedule.
 *
 * @param businessId - Business to process
 */
export async function processUnroutedLeads(businessId: string): Promise<number> {
  const qualified = await prisma.lead.findMany({
    where: {
      businessId,
      vertical: 'REAL_ESTATE',
      score: { gte: ROUTE_TO_AGENT_THRESHOLD },
      // Not yet assigned to an agent
      realEstateLead: { agentId: null },
      pipelineStage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
    },
    take: 20,
  })

  let routed = 0
  for (const lead of qualified) {
    try {
      const result = await routeLead(lead.id, businessId)
      if (!result.quorumHandles) routed++
    } catch (err) {
      console.error(`[BrokerageRouter] Error routing lead ${lead.id}:`, err)
    }
  }

  return routed
}
