'use client'

import { motion } from 'framer-motion'

interface LeadCardProps {
  leadId: string
  name: string
  score: number
  stage: string
  channel: string
  vertical?: string | null
  lastInteractionAt?: Date | string | null
  isNew?: boolean
}

const STAGE_COLORS: Record<string, string> = {
  NEW:         'text-slate-400 bg-slate-800',
  QUALIFYING:  'text-blue-400 bg-blue-900/40',
  PROPOSAL:    'text-violet-400 bg-violet-900/40',
  NEGOTIATING: 'text-amber-400 bg-amber-900/40',
  WIN_BACK:    'text-orange-400 bg-orange-900/40',
  CLOSED_WON:  'text-emerald-400 bg-emerald-900/40',
  CLOSED_LOST: 'text-red-400 bg-red-900/40',
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400'
  if (score >= 60) return 'text-amber-400'
  if (score >= 40) return 'text-blue-400'
  return 'text-slate-400'
}

function scoreRing(score: number): string {
  if (score >= 80) return 'border-emerald-500'
  if (score >= 60) return 'border-amber-500'
  if (score >= 40) return 'border-blue-500'
  return 'border-slate-600'
}

function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return 'never'
  const d = typeof date === 'string' ? new Date(date) : date
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000)
  if (seconds < 60)   return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export function LeadCard({
  name, score, stage, channel, vertical, lastInteractionAt, isNew,
}: LeadCardProps) {
  const stageClass = STAGE_COLORS[stage] ?? 'text-slate-400 bg-slate-800'

  return (
    <motion.div
      layout
      initial={isNew ? { opacity: 0, x: -20 } : false}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#0d0f18] border border-white/5 hover:border-indigo-500/30 transition-colors group cursor-pointer"
    >
      {/* Score ring */}
      <div className={`relative flex-shrink-0 w-10 h-10 rounded-full border-2 ${scoreRing(score)} flex items-center justify-center`}>
        <span className={`text-xs font-bold font-mono ${scoreColor(score)}`}>{score}</span>
      </div>

      {/* Lead info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate leading-tight">{name}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${stageClass}`}>
            {stage.replace('_', ' ')}
          </span>
          {vertical && (
            <span className="text-[10px] text-slate-500">{vertical.toLowerCase().replace('_', ' ')}</span>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="flex-shrink-0 text-right">
        <p className="text-[10px] text-slate-500">{channel}</p>
        <p className="text-[10px] text-slate-600">{timeAgo(lastInteractionAt)}</p>
      </div>
    </motion.div>
  )
}
