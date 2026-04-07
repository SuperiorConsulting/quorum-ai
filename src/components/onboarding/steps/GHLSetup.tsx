'use client'

import type { OnboardingPayload } from '../../../app/api/onboarding/route.js'

interface Props {
  data: Partial<OnboardingPayload>
  onChange: (updates: Partial<OnboardingPayload>) => void
}

export function GHLSetup({ data, onChange }: Props) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Connect GoHighLevel</h2>
        <p className="text-sm text-slate-500">
          Quorum syncs leads, stages, and activities to your GHL account in real time.
          All fields are optional — you can add these later.
        </p>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
        <p className="text-xs text-amber-300 leading-relaxed">
          Find your API key in GHL → Settings → Integrations → API Key. Your Location ID
          is in Settings → Business Profile. Create a pipeline in Opportunities → Pipelines.
        </p>
      </div>

      <div className="space-y-4">
        <Field
          label="GHL API key"
          placeholder="ey..."
          value={data.ghlApiKey ?? ''}
          onChange={(v) => onChange({ ghlApiKey: v })}
          type="password"
        />
        <Field
          label="Location ID"
          placeholder="abc123xyz"
          value={data.ghlLocationId ?? ''}
          onChange={(v) => onChange({ ghlLocationId: v })}
        />
        <Field
          label="Pipeline ID"
          placeholder="pipeline_abc123"
          value={data.ghlPipelineId ?? ''}
          onChange={(v) => onChange({ ghlPipelineId: v })}
        />
      </div>

      <p className="text-xs text-slate-600">
        Don't have GoHighLevel yet?{' '}
        <span className="text-slate-500">Skip this step — you can configure it later from your dashboard.</span>
      </p>
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
        autoComplete="off"
        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
      />
    </label>
  )
}
