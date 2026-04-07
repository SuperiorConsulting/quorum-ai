'use client'

import { signOut } from 'next-auth/react'
import { useSocket } from '../../hooks/useSocket.js'
import { LeadPipeline } from './LeadPipeline.js'
import { ConversationFeed } from './ConversationFeed.js'
import { StatsPanel } from './StatsPanel.js'

interface DashboardData {
  hotLeads: Array<{
    id: string
    name: string
    score: number
    pipelineStage: string
    channel: string
    vertical?: string | null
    lastInteractionAt?: Date | string | null
  }>
  pipeline: Record<string, number>
  recentInteractions: Array<{
    id: string
    direction: string
    channel: string
    transcript: string | null
    sentiment: number | null
    buyingSignal: boolean | null
    outcome: string | null
    createdAt: Date | string
    lead: { id: string; name: string; score: number | null }
  }>
  latestBriefing: {
    id: string
    date: Date | string
    revenueClosedOvernite: number
    appointmentsBooked: number
    hotLeadsCount: number
    winBackResponses: number
    briefingScript?: string | null
    delivered: boolean
  } | null
  revenue30d: number
  upcomingAppointments: Array<{
    id: string
    scheduledAt: Date | string
    type: string
    lead: { id: string; name: string; phone: string | null }
  }>
  todayAppointmentsCount: number
  totalHotLeads: number
}

interface HUDProps {
  businessId: string
  initialData: DashboardData
}

export function HUD({ businessId, initialData }: HUDProps) {
  const socket = useSocket(businessId)

  return (
    <div className="flex flex-col h-screen bg-[#04050a] text-white overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-indigo-400 text-xl font-bold">⬡</span>
          <div>
            <h1 className="text-sm font-bold text-white tracking-widest font-mono">QUORUM</h1>
            <p className="text-[9px] text-slate-600 tracking-widest uppercase">The Deciding Intelligence</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Live connection status */}
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${socket.connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-[10px] text-slate-500 font-mono">
              {socket.connected ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>

          {/* Hot lead count badge */}
          {socket.hotLeads.length > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-900/30 border border-amber-500/20">
              <span className="text-amber-400 text-xs">🔥</span>
              <span className="text-xs text-amber-300 font-bold">{socket.hotLeads.length} hot</span>
            </div>
          )}

          {/* Date */}
          <span className="text-[10px] text-slate-600 font-mono">
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>

          {/* Sign out */}
          <button
            onClick={() => void signOut({ callbackUrl: '/auth/signin' })}
            className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors font-mono"
          >
            sign out
          </button>
        </div>
      </header>

      {/* Three-panel HUD */}
      <div className="flex flex-1 overflow-hidden divide-x divide-white/5">
        {/* Panel 1: Lead Pipeline */}
        <div className="w-[280px] flex-shrink-0 overflow-hidden">
          <LeadPipeline
            initialLeads={initialData.hotLeads}
            liveUpdates={socket.recentLeadUpdates}
            pipeline={initialData.pipeline}
            totalHotLeads={initialData.totalHotLeads + socket.hotLeads.length}
          />
        </div>

        {/* Panel 2: Live Conversation Feed */}
        <div className="flex-1 overflow-hidden min-w-0">
          <ConversationFeed
            conversations={socket.conversations}
            recentDeals={socket.recentDeals}
            recentAppointments={socket.recentAppointments}
          />
        </div>

        {/* Panel 3: Stats + Briefing */}
        <div className="w-[300px] flex-shrink-0 overflow-hidden">
          <StatsPanel
            revenue30d={initialData.revenue30d}
            todayAppointmentsCount={initialData.todayAppointmentsCount}
            totalHotLeads={initialData.totalHotLeads}
            latestBriefing={initialData.latestBriefing}
            liveBriefing={socket.latestBriefing}
            upcomingAppointments={initialData.upcomingAppointments}
          />
        </div>
      </div>
    </div>
  )
}
