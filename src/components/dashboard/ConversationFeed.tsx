'use client'

import { motion, AnimatePresence } from 'framer-motion'
import type { ConversationEvent, DealClosedEvent, AppointmentBookedEvent } from '../../lib/socket-server.js'

interface ConversationFeedProps {
  conversations: ConversationEvent[]
  recentDeals: DealClosedEvent[]
  recentAppointments: AppointmentBookedEvent[]
}

function sentimentBar(score: number) {
  const pct = Math.round(((score + 100) / 200) * 100)
  const color = score >= 30 ? 'bg-emerald-500' : score >= -20 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function channelIcon(channel: string) {
  const map: Record<string, string> = {
    SMS:   '💬',
    EMAIL: '✉️',
    VOICE: '📞',
    CHAT:  '🌐',
  }
  return map[channel] ?? '•'
}

export function ConversationFeed({
  conversations,
  recentDeals,
  recentAppointments,
}: ConversationFeedProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div>
          <h2 className="text-sm font-semibold text-white tracking-wide">Live Feed</h2>
          <p className="text-xs text-slate-500 mt-0.5">Conversations · Deals · Appointments</p>
        </div>
        <div className="flex items-center gap-3">
          {recentDeals.length > 0 && (
            <span className="text-xs text-emerald-400 font-medium">
              ${recentDeals.reduce((s, d) => s + d.dealValue, 0).toLocaleString()} closed
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-[10px] text-slate-500">LIVE</span>
          </div>
        </div>
      </div>

      {/* Deal / appointment flash banners */}
      <div className="space-y-1 px-3 pt-2">
        <AnimatePresence>
          {recentDeals.slice(0, 2).map((deal) => (
            <motion.div
              key={`deal-${deal.leadId}-${deal.closedAt}`}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-900/30 border border-emerald-500/20"
            >
              <span className="text-base">🎉</span>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-emerald-300 font-medium">
                  {deal.leadName}
                </span>
                <span className="text-xs text-emerald-500"> closed </span>
                <span className="text-xs text-emerald-300 font-bold">
                  ${deal.dealValue.toLocaleString()}
                </span>
              </div>
            </motion.div>
          ))}

          {recentAppointments.slice(0, 1).map((appt) => (
            <motion.div
              key={`appt-${appt.appointmentId}`}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-900/30 border border-indigo-500/20"
            >
              <span className="text-base">📅</span>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-indigo-300 font-medium">{appt.leadName}</span>
                <span className="text-xs text-indigo-500"> booked </span>
                <span className="text-xs text-indigo-300">{appt.appointmentType}</span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Conversation stream */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 scrollbar-thin scrollbar-thumb-white/10 mt-1">
        <AnimatePresence initial={false}>
          {conversations.map((conv, idx) => (
            <motion.div
              key={`${conv.leadId}-${conv.timestamp}-${idx}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="rounded-lg bg-[#0d0f18] border border-white/5 p-3 space-y-2"
            >
              {/* Conv header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{channelIcon(conv.channel)}</span>
                  <span className="text-xs font-medium text-white">{conv.leadName}</span>
                  {conv.buyingSignal && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-400 font-medium">
                      BUYING SIGNAL
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {sentimentBar(conv.sentiment)}
                  <span className="text-[10px] text-slate-600">
                    {new Date(conv.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
              </div>

              {/* Lead message */}
              <div className="text-xs text-slate-400 leading-relaxed line-clamp-2">
                <span className="text-slate-600 mr-1">›</span>{conv.message}
              </div>

              {/* Quorum response */}
              {conv.response && (
                <div className="text-xs text-indigo-300/80 leading-relaxed line-clamp-2 border-l-2 border-indigo-600/40 pl-2">
                  {conv.response}
                </div>
              )}

              {/* Action badge */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 font-mono uppercase">
                  {conv.action}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <div className="w-8 h-8 rounded-full bg-indigo-900/30 flex items-center justify-center">
              <span className="text-indigo-400 text-sm">⬡</span>
            </div>
            <p className="text-xs text-slate-600">Waiting for conversations...</p>
          </div>
        )}
      </div>
    </div>
  )
}
