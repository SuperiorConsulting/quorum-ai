'use client'

import type { OnboardingPayload } from '../../../app/api/onboarding/route.js'

interface Props {
  data: Partial<OnboardingPayload>
  onChange: (updates: Partial<OnboardingPayload>) => void
}

const PLANS = [
  {
    id: 'STARTER',
    name: 'Starter',
    setup: 497,
    monthly: 297,
    features: [
      'AI SMS + email responses',
      'Lead scoring & memory',
      'Morning briefings',
      'GHL sync',
      '1 voice clone',
    ],
  },
  {
    id: 'GROWTH',
    name: 'Growth',
    setup: 997,
    monthly: 597,
    badge: 'Most Popular',
    features: [
      'Everything in Starter',
      'AI voice calls (Vapi)',
      'Win-back sequences',
      'Review harvesting',
      'n8n automation (6 workflows)',
      'Priority support',
    ],
  },
  {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    setup: 2497,
    monthly: 1497,
    features: [
      'Everything in Growth',
      'White-glove onboarding',
      'Custom vertical training',
      'Dedicated success manager',
      'SLA guarantee',
      'Unlimited voice clones',
    ],
  },
]

export function PlanSelect({ data, onChange }: Props) {
  const selected = data.plan ?? 'GROWTH'

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Choose your plan</h2>
        <p className="text-sm text-slate-500">
          You won't be charged yet — payment happens at the final step.
        </p>
      </div>

      <div className="space-y-3">
        {PLANS.map((plan) => (
          <button
            key={plan.id}
            type="button"
            onClick={() => onChange({ plan: plan.id })}
            className={`w-full text-left p-4 rounded-xl border transition-all ${
              selected === plan.id
                ? 'bg-indigo-500/10 border-indigo-500/50'
                : 'bg-white/3 border-white/8 hover:border-white/15'
            }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  selected === plan.id
                    ? 'border-indigo-400 bg-indigo-400'
                    : 'border-white/20'
                }`}>
                  {selected === plan.id && (
                    <div className="w-1.5 h-1.5 rounded-full bg-white" />
                  )}
                </div>
                <span className="text-sm font-bold text-white">{plan.name}</span>
                {plan.badge && (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-medium">
                    {plan.badge}
                  </span>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-white">${plan.monthly}<span className="text-slate-500 font-normal text-xs">/mo</span></p>
                <p className="text-[10px] text-slate-600">${plan.setup} setup</p>
              </div>
            </div>
            <ul className="space-y-1 pl-6">
              {plan.features.map((f) => (
                <li key={f} className="text-xs text-slate-400 flex items-center gap-1.5">
                  <span className="text-indigo-400 text-[10px]">✓</span> {f}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>
    </div>
  )
}
