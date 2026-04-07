'use client'

import type { OnboardingPayload } from '../../../app/api/onboarding/route.js'

interface Props {
  data: Partial<OnboardingPayload>
  businessId?: string
  launching: boolean
}

const PLAN_LABELS: Record<string, string> = {
  STARTER:    'Starter — $297/mo',
  GROWTH:     'Growth — $597/mo',
  ENTERPRISE: 'Enterprise — $1,497/mo',
}

const VERTICAL_LABELS: Record<string, string> = {
  REAL_ESTATE:   'Real Estate',
  HOME_SERVICES: 'Home Services',
  MED_SPA:       'Med Spa',
  DENTAL:        'Dental',
  LEGAL:         'Law Firms',
  MEDICAL:       'Medical',
  FITNESS:       'Gyms & Fitness',
  AUTO:          'Auto Dealerships',
  FINANCIAL:     'Financial Services',
  CONTRACTOR:    'Contractors',
  WELLNESS:      'Wellness',
  VETERINARY:    'Veterinary',
  RESTAURANT:    'Restaurant',
  OTHER:         'Other',
}

export function LaunchConfirm({ data, businessId, launching }: Props) {
  const rows = [
    { label: 'Business', value: data.businessName },
    { label: 'Owner', value: `${data.ownerName} · ${data.ownerEmail}` },
    { label: 'Industry', value: data.vertical ? VERTICAL_LABELS[data.vertical] : undefined },
    { label: 'Services', value: data.services?.length ? data.services.join(', ') : undefined },
    { label: 'GHL Location', value: data.ghlLocationId },
    { label: 'Twilio phone', value: data.twilioPhone },
    { label: 'Calendar', value: data.googleCalendarId },
    { label: 'Plan', value: data.plan ? PLAN_LABELS[data.plan] : undefined },
  ].filter((r) => r.value)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Ready to launch</h2>
        <p className="text-sm text-slate-500">
          Review your setup below and click Launch Quorum to activate your AI sales intelligence.
        </p>
      </div>

      <div className="bg-[#0d0f18] border border-white/5 rounded-xl overflow-hidden">
        {rows.map(({ label, value }) => (
          <div
            key={label}
            className="flex items-start justify-between px-4 py-3 border-b border-white/5 last:border-0"
          >
            <span className="text-xs text-slate-500 font-medium w-28 flex-shrink-0">{label}</span>
            <span className="text-xs text-slate-300 text-right leading-relaxed">{value}</span>
          </div>
        ))}
      </div>

      {businessId && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3">
          <p className="text-xs text-emerald-400 leading-relaxed">
            Your account has been saved (ID: <span className="font-mono">{businessId.slice(0, 12)}…</span>).
            Clicking Launch will activate your business and send your welcome email.
          </p>
        </div>
      )}

      {launching && (
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Activating Quorum…</p>
        </div>
      )}
    </div>
  )
}
