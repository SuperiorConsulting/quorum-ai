import { redirect } from 'next/navigation'
import { auth } from '../../lib/auth.js'
import { prisma } from '../../lib/prisma.js'
import { HUD } from '../../components/dashboard/HUD.js'

interface DashboardPageProps {
  searchParams: Promise<{ businessId?: string }>
}

export const metadata = {
  title: 'Quorum HUD — The Deciding Intelligence',
  description: 'Real-time sales intelligence dashboard',
}

/**
 * Dashboard page — server component.
 * Session-gated: unauthenticated users are redirected to /auth/signin by middleware.
 * businessId is always derived from the session to prevent cross-account access.
 */
export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await auth()

  if (!session?.user?.businessId) {
    redirect('/auth/signin')
  }

  const sessionBusinessId = session.user.businessId

  // Allow admins to view other businesses via ?businessId= (owner check enforced)
  const { businessId: qsBusinessId } = await searchParams
  const resolvedBusinessId = qsBusinessId
    ? await resolveAccessibleBusinessId(qsBusinessId, sessionBusinessId)
    : sessionBusinessId

  if (!resolvedBusinessId) {
    redirect('/auth/signin')
  }

  const initialData = await fetchDashboardData(resolvedBusinessId)

  return <HUD businessId={resolvedBusinessId} initialData={initialData} />
}

/**
 * Verifies that the requesting session owns (or is authorized for) the requested businessId.
 * For Phase 14, only allow access to the session's own business.
 */
async function resolveAccessibleBusinessId(
  requestedId: string,
  sessionBusinessId: string,
): Promise<string | null> {
  if (requestedId === sessionBusinessId) return requestedId
  // Multi-business access can be added in a future phase
  return null
}

async function fetchDashboardData(businessId: string) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const todayMidnight = new Date()
  todayMidnight.setHours(0, 0, 0, 0)

  const [
    hotLeads,
    allLeads,
    latestBriefing,
    closedDeals30d,
    upcomingAppointments,
  ] = await Promise.all([
    prisma.lead.findMany({
      where: {
        businessId,
        score: { gte: 80 },
        pipelineStage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
      },
      orderBy: { score: 'desc' },
      take: 25,
      select: {
        id: true, name: true, score: true, pipelineStage: true,
        channel: true, phone: true, email: true,
        lastInteractionAt: true, vertical: true,
      },
    }),

    prisma.lead.groupBy({
      by: ['pipelineStage'],
      where: {
        businessId,
        pipelineStage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
      },
      _count: { id: true },
    }),

    prisma.dailyBriefing.findFirst({
      where: { businessId },
      orderBy: { date: 'desc' },
      select: {
        id: true, date: true, revenueClosedOvernite: true,
        appointmentsBooked: true, hotLeadsCount: true,
        winBackResponses: true, briefingScript: true, delivered: true,
      },
    }),

    prisma.lead.findMany({
      where: { businessId, pipelineStage: 'CLOSED_WON', updatedAt: { gte: thirtyDaysAgo } },
      select: { dealValue: true },
    }),

    prisma.appointment.findMany({
      where: { businessId, status: 'CONFIRMED', scheduledAt: { gte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      take: 10,
      select: {
        id: true, scheduledAt: true, type: true,
        lead: { select: { id: true, name: true, phone: true } },
      },
    }),
  ])

  const pipeline: Record<string, number> = {}
  for (const row of allLeads) {
    pipeline[String(row.pipelineStage)] = row._count.id
  }

  const revenue30d = closedDeals30d.reduce((s, l) => s + (l.dealValue ?? 0), 0)
  const todayAppointmentsCount = upcomingAppointments.filter(
    (a) => a.scheduledAt >= todayMidnight,
  ).length

  return {
    hotLeads,
    pipeline,
    recentInteractions: [],
    latestBriefing,
    revenue30d,
    upcomingAppointments,
    todayAppointmentsCount,
    totalHotLeads: hotLeads.length,
  }
}
