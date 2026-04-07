'use client'

import { motion } from 'framer-motion'
import type { BriefingReadyEvent } from '../../lib/socket-server.js'

interface DailyBriefing {
  id: string
  date: Date | string
  revenueClosedOvernite: number
  appointmentsBooked: number
  hotLeadsCount: number
  winBackResponses: number
  briefingScript?: string | null
  delivered: boolean
}

interface StatsPanelProps {
  revenue30d: number
  todayAppointmentsCount: number
  totalHotLeads: number
  latestBriefing: DailyBriefing | null
  liveBriefing: BriefingReadyEvent | null
  upcomingAppointments: Array<{
    id: string
    scheduledAt: Date | string
    type: string
    lead: { id: string; name: string; phone: string | null }
  }>
}

function StatCard({
  label, value, sub, color = 'text-white', pulse = false,
}: {
  label: string
  value: string | number
  sub?: string
  color?: string
  pulse?: boolean
}) {
  return (
    <div className="bg-[#0d0f18] border border-white/5 rounded-xl p-4">
      <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className={`text-2xl font-bold font-mono ${color} ${pulse ? 'animate-pulse' : ''}`}>
          {value}
        </p>
      </div>
      {sub && <p className="text-[10px] text-slate-600 mt-1">{sub}</p>}
    </div>
  )
}

export function StatsPanel({
  revenue30d,
  todayAppointmentsCount,
  totalHotLeads,
  latestBriefing,
  liveBriefing,
  upcomingAppointments,
}: StatsPanelProps) {
  const briefing = liveBriefing
    ? {
        revenueClosedOvernite: liveBriefing.stats.revenueClosedOvernite,
        appointmentsBooked:    liveBriefing.stats.appointmentsBooked,
        hotLeadsCount:         liveBriefing.stats.hotLeadsCount,
        winBackResponses:      liveBriefing.stats.winBackResponses,
        briefingScript:        null,
        delivered:             true,
      }
    : latestBriefing

  return (
    <div className="flex flex-col h-full overflow-y-auto px-4 py-3 space-y-4 scrollbar-thin scrollbar-thumb-white/10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white tracking-wide">Intelligence</h2>
          <p className="text-xs text-slate-500 mt-0.5">30-day · today · pipeline</p>
        </div>
        <div className="text-lg font-bold text-indigo-400 font-mono">⬡</div>
      </div>

      {/* Key stats grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label="30-Day Revenue"
          value={`$${revenue30d >= 1000 ? `${(revenue30d / 1000).toFixed(1)}k` : revenue30d.toLocaleString()}`}
          sub="closed by Quorum"
          color="text-emerald-400"
        />
        <StatCard
          label="Hot Leads"
          value={totalHotLeads}
          sub="score ≥ 80"
          color="text-amber-400"
          pulse={totalHotLeads > 0}
        />
        <StatCard
          label="Today's Appts"
          value={todayAppointmentsCount}
          sub="confirmed"
          color="text-indigo-400"
        />
        <StatCard
          label="Overnight Revenue"
          value={`$${(briefing?.revenueClosedOvernite ?? 0).toLocaleString()}`}
          sub="since midnight"
          color="text-violet-400"
        />
      </div>

      {/* Morning briefing */}
      {briefing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-[#0d0f18] border border-indigo-500/20 rounded-xl p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">
              Morning Briefing
            </h3>
            {briefing.delivered && (
              <span className="text-[9px] text-emerald-500 bg-emerald-900/30 px-1.5 py-0.5 rounded">
                Delivered
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
            {[
              { label: 'Appts booked',    value: briefing.appointmentsBooked },
              { label: 'Hot leads',       value: briefing.hotLeadsCount },
              { label: 'Win-back resps',  value: briefing.winBackResponses },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-[10px] text-slate-600">{label}</span>
                <span className="text-xs font-mono text-white">{value}</span>
              </div>
            ))}
          </div>

          {briefing.briefingScript && (
            <p className="text-[11px] text-slate-400 leading-relaxed border-t border-white/5 pt-3 line-clamp-4">
              {briefing.briefingScript}
            </p>
          )}
        </motion.div>
      )}

      {/* Upcoming appointments */}
      {upcomingAppointments.length > 0 && (
        <div className="bg-[#0d0f18] border border-white/5 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
            Upcoming
          </h3>
          <div className="space-y-2">
            {upcomingAppointments.slice(0, 5).map((appt) => (
              <div key={appt.id} className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white truncate">{appt.lead.name}</p>
                  <p className="text-[10px] text-slate-600">{appt.type}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] text-slate-400 font-mono">
                    {new Date(appt.scheduledAt).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric',
                    })}
                  </p>
                  <p className="text-[10px] text-slate-600">
                    {new Date(appt.scheduledAt).toLocaleTimeString('en-US', {
                      hour: 'numeric', minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quorum brand footer */}
      <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-slate-600 font-mono">QUORUM</p>
          <p className="text-[9px] text-slate-700">The Deciding Intelligence</p>
        </div>
        <div className="w-6 h-6 rounded bg-indigo-900/40 flex items-center justify-center">
          <span className="text-indigo-400 text-xs">⬡</span>
        </div>
      </div>
    </div>
  )
}
