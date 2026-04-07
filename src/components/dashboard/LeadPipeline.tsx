'use client'

import { AnimatePresence } from 'framer-motion'
import { LeadCard } from './LeadCard.js'
import type { LeadUpdatedEvent } from '../../lib/socket-server.js'

interface PipelineLead {
  id: string
  name: string
  score: number
  pipelineStage: string
  channel: string
  vertical?: string | null
  lastInteractionAt?: Date | string | null
}

interface LeadPipelineProps {
  initialLeads: PipelineLead[]
  liveUpdates: LeadUpdatedEvent[]
  pipeline: Record<string, number>
  totalHotLeads: number
}

export function LeadPipeline({
  initialLeads,
  liveUpdates,
  pipeline,
  totalHotLeads,
}: LeadPipelineProps) {
  // Merge live updates into the list (score changes bubble up)
  const updatedIds = new Set(liveUpdates.map((u) => u.leadId))
  const liveLeads: PipelineLead[] = liveUpdates.map((u) => ({
    id:                u.leadId,
    name:              u.name,
    score:             u.score,
    pipelineStage:     u.pipelineStage,
    channel:           u.channel,
    vertical:          undefined,
    lastInteractionAt: new Date().toISOString(),
  }))

  const staticLeads = initialLeads.filter((l) => !updatedIds.has(l.id))
  const allLeads = [...liveLeads, ...staticLeads].sort((a, b) => b.score - a.score).slice(0, 25)

  const totalActive = Object.values(pipeline).reduce((s, c) => s + c, 0)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div>
          <h2 className="text-sm font-semibold text-white tracking-wide">Lead Pipeline</h2>
          <p className="text-xs text-slate-500 mt-0.5">{totalActive} active · {totalHotLeads} hot</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] text-slate-500">LIVE</span>
        </div>
      </div>

      {/* Stage summary bar */}
      <div className="px-4 py-2 grid grid-cols-3 gap-1.5 border-b border-white/5">
        {[
          { label: 'New',       key: 'NEW',         color: 'bg-slate-700' },
          { label: 'Qualifying', key: 'QUALIFYING',  color: 'bg-blue-800' },
          { label: 'Proposal',  key: 'PROPOSAL',    color: 'bg-violet-800' },
          { label: 'Negotiating', key: 'NEGOTIATING', color: 'bg-amber-800' },
          { label: 'Win-Back',  key: 'WIN_BACK',    color: 'bg-orange-800' },
          { label: 'Hot (80+)', key: '__hot__',     color: 'bg-emerald-800' },
        ].map(({ label, key, color }) => (
          <div key={key} className="text-center">
            <div className={`text-xs font-bold text-white ${color} rounded px-1 py-0.5`}>
              {key === '__hot__' ? totalHotLeads : (pipeline[key] ?? 0)}
            </div>
            <div className="text-[9px] text-slate-600 mt-0.5 truncate">{label}</div>
          </div>
        ))}
      </div>

      {/* Lead list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 scrollbar-thin scrollbar-thumb-white/10">
        <AnimatePresence>
          {allLeads.map((lead) => (
            <LeadCard
              key={lead.id}
              leadId={lead.id}
              name={lead.name}
              score={lead.score}
              stage={lead.pipelineStage}
              channel={lead.channel}
              vertical={lead.vertical}
              lastInteractionAt={lead.lastInteractionAt}
              isNew={updatedIds.has(lead.id)}
            />
          ))}
        </AnimatePresence>

        {allLeads.length === 0 && (
          <div className="flex items-center justify-center h-40">
            <p className="text-sm text-slate-600">No active leads</p>
          </div>
        )}
      </div>
    </div>
  )
}
