'use client'

import type { OnboardingPayload } from '../../../app/api/onboarding/route.js'

interface Props {
  data: Partial<OnboardingPayload>
  onChange: (updates: Partial<OnboardingPayload>) => void
}

export function TwilioSetup({ data, onChange }: Props) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">SMS phone number</h2>
        <p className="text-sm text-slate-500">
          Quorum sends and receives SMS through this Twilio number. All lead conversations
          flow through it.
        </p>
      </div>

      <div className="bg-[#0d0f18] border border-white/5 rounded-xl p-5 space-y-3">
        <p className="text-xs text-slate-500 font-mono uppercase tracking-widest">How it works</p>
        {[
          'A lead texts your Twilio number',
          'Quorum reads the message and checks relationship memory',
          'Quorum responds in seconds — no human needed',
          'All replies sync to your GoHighLevel CRM',
        ].map((s, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
              {i + 1}
            </div>
            <p className="text-xs text-slate-400">{s}</p>
          </div>
        ))}
      </div>

      <label className="block">
        <span className="text-xs text-slate-400 font-medium mb-1.5 block">Twilio phone number</span>
        <input
          type="tel"
          placeholder="+1 (555) 000-0000"
          value={data.twilioPhone ?? ''}
          onChange={(e) => onChange({ twilioPhone: e.target.value })}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
        />
      </label>

      <p className="text-xs text-slate-600">
        Find your number in the Twilio Console under Phone Numbers → Active numbers.
        Quorum will configure the webhook automatically on launch.
      </p>
    </div>
  )
}
