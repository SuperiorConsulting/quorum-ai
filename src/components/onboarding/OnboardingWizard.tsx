'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OnboardingPayload } from '../../app/api/onboarding/route.js'
import { BusinessBasics } from './steps/BusinessBasics.js'
import { VerticalSelect } from './steps/VerticalSelect.js'
import { GHLSetup } from './steps/GHLSetup.js'
import { TwilioSetup } from './steps/TwilioSetup.js'
import { CalendarSetup } from './steps/CalendarSetup.js'
import { VoiceClone } from './steps/VoiceClone.js'
import { PlanSelect } from './steps/PlanSelect.js'
import { LaunchConfirm } from './steps/LaunchConfirm.js'

// ─── Step config ──────────────────────────────────────────────────────────────

const STEPS = [
  { id: 'basics',    label: 'Basics',    required: true  },
  { id: 'vertical',  label: 'Industry',  required: true  },
  { id: 'ghl',       label: 'CRM',       required: false },
  { id: 'twilio',    label: 'SMS',       required: false },
  { id: 'calendar',  label: 'Calendar',  required: false },
  { id: 'voice',     label: 'Voice',     required: false },
  { id: 'plan',      label: 'Plan',      required: true  },
  { id: 'launch',    label: 'Launch',    required: true  },
]

// ─── Validation ───────────────────────────────────────────────────────────────

function validateStep(step: number, data: Partial<OnboardingPayload>): string | null {
  if (step === 0) {
    if (!data.businessName?.trim()) return 'Business name is required'
    if (!data.ownerName?.trim())    return 'Your name is required'
    if (!data.ownerEmail?.trim())   return 'Your email is required'
    if (!data.businessPhone?.trim()) return 'Business phone is required'
  }
  if (step === 1) {
    if (!data.vertical) return 'Please select your industry'
  }
  return null
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OnboardingWizard() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [data, setData] = useState<Partial<OnboardingPayload>>({ plan: 'GROWTH', services: [] })
  const [businessId, setBusinessId] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState('')

  function update(updates: Partial<OnboardingPayload>) {
    setData((prev) => ({ ...prev, ...updates }))
    setError('')
  }

  async function saveProgress(payload: Partial<OnboardingPayload>) {
    const res = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const { error: e } = (await res.json()) as { error: string }
      throw new Error(e ?? 'Save failed')
    }
    const { businessId: id } = (await res.json()) as { businessId: string; activated: boolean }
    return id
  }

  async function handleNext() {
    const validationError = validateStep(step, data)
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    setError('')

    try {
      // Save progress to DB at each step (upsert-safe)
      const id = await saveProgress(data)
      if (!businessId) setBusinessId(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      setSaving(false)
      return
    }

    setSaving(false)
    setStep((s) => s + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleLaunch() {
    setLaunching(true)
    setError('')

    try {
      const id = await saveProgress({ ...data, confirmed: true })
      if (!businessId) setBusinessId(id)
      const bId = businessId ?? id
      router.push(`/pricing/success?plan=${data.plan ?? 'STARTER'}&onboarded=1&businessId=${bId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Launch failed')
      setLaunching(false)
    }
  }

  function handleBack() {
    setError('')
    setStep((s) => s - 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const isLast = step === STEPS.length - 1
  const progress = ((step) / (STEPS.length - 1)) * 100

  return (
    <div className="min-h-screen bg-[#04050a] text-white flex flex-col">
      {/* Top bar */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-indigo-400 text-lg">⬡</span>
          <span className="text-xs font-bold tracking-widest font-mono text-white">QUORUM</span>
        </div>
        <span className="text-xs text-slate-600 font-mono">
          Step {step + 1} of {STEPS.length}
        </span>
      </nav>

      {/* Progress bar */}
      <div className="h-0.5 bg-white/5 flex-shrink-0">
        <div
          className="h-full bg-indigo-500 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Step pills */}
      <div className="flex items-center justify-center gap-1 px-6 py-4 flex-shrink-0 overflow-x-auto">
        {STEPS.map((s, i) => (
          <div
            key={s.id}
            className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-mono transition-all ${
              i === step
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                : i < step
                ? 'text-slate-500'
                : 'text-slate-700'
            }`}
          >
            {i < step && <span className="text-emerald-500">✓</span>}
            {s.label}
          </div>
        ))}
      </div>

      {/* Content */}
      <main className="flex-1 flex items-start justify-center px-6 py-8">
        <div className="w-full max-w-lg">
          <StepContent
            step={step}
            data={data}
            onChange={update}
            businessId={businessId}
            launching={launching}
          />

          {error && (
            <p className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
              {error}
            </p>
          )}

          {/* Navigation */}
          <div className="flex items-center gap-3 mt-8">
            {step > 0 && (
              <button
                type="button"
                onClick={handleBack}
                disabled={saving || launching}
                className="px-5 py-2.5 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
              >
                Back
              </button>
            )}

            {isLast ? (
              <button
                type="button"
                onClick={handleLaunch}
                disabled={launching}
                className="flex-1 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-white font-bold text-sm transition-colors shadow-lg shadow-indigo-500/25"
              >
                {launching ? 'Launching…' : 'Launch Quorum ⬡'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                disabled={saving}
                className="flex-1 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-white font-semibold text-sm transition-colors"
              >
                {saving ? 'Saving…' : STEPS[step + 1] ? `Next: ${STEPS[step + 1]?.label}` : 'Continue'}
              </button>
            )}
          </div>

          {/* Skip hint for optional steps */}
          {!STEPS[step]?.required && !isLast && (
            <p className="text-center text-xs text-slate-700 mt-4">
              This step is optional.{' '}
              <button
                type="button"
                onClick={handleNext}
                disabled={saving}
                className="text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors"
              >
                Skip for now
              </button>
            </p>
          )}
        </div>
      </main>
    </div>
  )
}

// ─── Step renderer ────────────────────────────────────────────────────────────

function StepContent({
  step,
  data,
  onChange,
  businessId,
  launching,
}: {
  step: number
  data: Partial<OnboardingPayload>
  onChange: (u: Partial<OnboardingPayload>) => void
  businessId?: string
  launching: boolean
}) {
  switch (step) {
    case 0: return <BusinessBasics data={data} onChange={onChange} />
    case 1: return <VerticalSelect data={data} onChange={onChange} />
    case 2: return <GHLSetup data={data} onChange={onChange} />
    case 3: return <TwilioSetup data={data} onChange={onChange} />
    case 4: return <CalendarSetup data={data} onChange={onChange} />
    case 5: return <VoiceClone data={data} onChange={onChange} businessId={businessId} />
    case 6: return <PlanSelect data={data} onChange={onChange} />
    case 7: return <LaunchConfirm data={data} businessId={businessId} launching={launching} />
    default: return null
  }
}
