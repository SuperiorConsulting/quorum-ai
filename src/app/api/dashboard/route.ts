import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma.js'

/**
 * GET /api/dashboard?businessId=xxx
 *
 * Returns all data needed for the initial dashboard load:
 * - Hot leads (score ≥ 80)
 * - Pipeline counts by stage
 * - Recent interactions (last 20)
 * - Latest daily briefing
 * - 30-day revenue
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const businessId = searchParams.get('businessId')

  if (!businessId) {
    return NextResponse.json({ error: 'businessId required' }, { status: 400 })
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const todayMidnight = new Date()
  todayMidnight.setHours(0, 0, 0, 0)

  const [
    hotLeads,
    allLeads,
    recentInteractions,
    latestBriefing,
    closedDeals30d,
    upcomingAppointments,
  ] = await Promise.all([
    // Hot leads: score ≥ 80, active
    prisma.lead.findMany({
      where: {
        businessId,
        score: { gte: 80 },
        pipelineStage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
      },
      orderBy: { score: 'desc' },
      take: 20,
      select: {
        id: true, name: true, score: true, pipelineStage: true,
        channel: true, phone: true, email: true,
        lastInteractionAt: true, vertical: true,
      },
    }),

    // All active leads for pipeline counts
    prisma.lead.groupBy({
      by: ['pipelineStage'],
      where: {
        businessId,
        pipelineStage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
      },
      _count: { id: true },
    }),

    // Recent interactions (conversation feed seed)
    prisma.interaction.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, direction: true, channel: true, transcript: true,
        sentiment: true, buyingSignal: true, outcome: true, createdAt: true,
        lead: { select: { id: true, name: true, score: true } },
      },
    }),

    // Latest morning briefing
    prisma.dailyBriefing.findFirst({
      where: { businessId },
      orderBy: { date: 'desc' },
      select: {
        id: true, date: true, revenueClosedOvernite: true,
        appointmentsBooked: true, hotLeadsCount: true,
        winBackResponses: true, briefingScript: true, delivered: true,
      },
    }),

    // 30-day revenue from closed deals
    prisma.lead.findMany({
      where: {
        businessId,
        pipelineStage: 'CLOSED_WON',
        updatedAt: { gte: thirtyDaysAgo },
      },
      select: { dealValue: true },
    }),

    // Upcoming appointments (next 7 days)
    prisma.appointment.findMany({
      where: {
        businessId,
        status: 'CONFIRMED',
        scheduledAt: { gte: new Date() },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 10,
      select: {
        id: true, scheduledAt: true, type: true,
        lead: { select: { id: true, name: true, phone: true } },
      },
    }),
  ])

  // Aggregate pipeline counts
  const pipeline: Record<string, number> = {}
  for (const row of allLeads) {
    pipeline[String(row.pipelineStage)] = row._count.id
  }

  // 30-day revenue total
  const revenue30d = closedDeals30d.reduce((sum, l) => sum + (l.dealValue ?? 0), 0)

  // Today's appointments
  const todayAppointments = upcomingAppointments.filter(
    (a) => a.scheduledAt >= todayMidnight,
  )

  return NextResponse.json({
    hotLeads,
    pipeline,
    recentInteractions,
    latestBriefing,
    revenue30d,
    upcomingAppointments,
    todayAppointmentsCount: todayAppointments.length,
    totalHotLeads: hotLeads.length,
  })
}
