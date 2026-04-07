'use client'

import type { OnboardingPayload } from '../../../app/api/onboarding/route.js'

interface Props {
  data: Partial<OnboardingPayload>
  onChange: (updates: Partial<OnboardingPayload>) => void
}

export function BusinessBasics({ data, onChange }: Props) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Tell us about your business</h2>
        <p className="text-sm text-slate-500">This is how Quorum will introduce itself to your leads.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Field
          label="Business name"
          placeholder="e.g. Apex Realty Group"
          value={data.businessName ?? ''}
          onChange={(v) => onChange({ businessName: v })}
        />
        <Field
          label="Your name"
          placeholder="e.g. Marcus Hale"
          value={data.ownerName ?? ''}
          onChange={(v) => onChange({ ownerName: v })}
        />
        <Field
          label="Your email"
          type="email"
          placeholder="you@example.com"
          value={data.ownerEmail ?? ''}
          onChange={(v) => onChange({ ownerEmail: v })}
        />
        <Field
          label="Business phone"
          type="tel"
          placeholder="+1 (555) 000-0000"
          value={data.businessPhone ?? ''}
          onChange={(v) => onChange({ businessPhone: v })}
        />
        <Field
          label="Business email (optional)"
          type="email"
          placeholder="hello@yourbusiness.com — leave blank to use your email"
          value={data.businessEmail ?? ''}
          onChange={(v) => onChange({ businessEmail: v })}
        />
      </div>
    </div>
  )
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  placeholder?: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400 font-medium mb-1.5 block">{label}</span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
      />
    </label>
  )
}
