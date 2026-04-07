import type { Metadata } from 'next'
import Link from 'next/link'
import { SetPasswordForm } from '../../../components/auth/SetPasswordForm.js'

export const metadata: Metadata = {
  title: 'Welcome to Quorum — Setup Complete',
}

interface SuccessPageProps {
  searchParams: Promise<{ plan?: string; session_id?: string; businessId?: string; onboarded?: string }>
}

const PLAN_LABELS: Record<string, string> = {
  STARTER:    'Starter',
  GROWTH:     'Growth',
  ENTERPRISE: 'Enterprise',
}

export default async function SuccessPage({ searchParams }: SuccessPageProps) {
  const { plan, session_id, businessId, onboarded } = await searchParams
  const planLabel = (plan && PLAN_LABELS[plan]) ?? 'Quorum'
  const fromOnboarding = onboarded === '1'

  return (
    <main className="min-h-screen bg-[#04050a] text-white flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Logo */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-indigo-900/40 border border-indigo-500/30 flex items-center justify-center">
            <span className="text-3xl text-indigo-400">⬡</span>
          </div>
        </div>

        {/* Success message */}
        <div>
          <p className="text-emerald-400 text-sm font-medium mb-2 tracking-wide">
            {fromOnboarding ? 'Onboarding complete' : 'Payment confirmed'}
          </p>
          <h1 className="text-3xl font-bold text-white mb-3">
            Welcome to Quorum {planLabel}.
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            Your AI sales intelligence is being configured. You'll receive a welcome
            email with next steps, and your first morning briefing arrives tomorrow at 8:00am.
          </p>
        </div>

        {/* Set password — shown when coming from onboarding wizard */}
        {fromOnboarding && businessId && (
          <SetPasswordForm businessId={businessId} />
        )}

        {/* What happens next */}
        <div className="bg-[#0d0f18] border border-white/5 rounded-xl p-6 text-left space-y-4">
          <p className="text-xs text-slate-500 uppercase tracking-widest font-mono">What happens next</p>
          {[
            { step: '1', text: 'Welcome email sent to your inbox with setup details', done: true },
            { step: '2', text: 'Quorum team configures your voice clone and verticals (48h)', done: false },
            { step: '3', text: 'First morning briefing delivered at 8:00am tomorrow', done: false },
            { step: '4', text: 'Quorum goes live — answers every call and message', done: false },
          ].map(({ step, text, done }) => (
            <div key={step} className="flex items-start gap-3">
              <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5 ${
                done ? 'bg-emerald-500 text-white' : 'bg-white/5 text-slate-600 border border-white/10'
              }`}>
                {done ? '✓' : step}
              </div>
              <p className="text-sm text-slate-400">{text}</p>
            </div>
          ))}
        </div>

        {/* Session ID for reference */}
        {session_id && (
          <p className="text-[10px] text-slate-700 font-mono">
            Reference: {session_id.slice(0, 24)}...
          </p>
        )}

        {/* CTA */}
        <div className="flex flex-col gap-3">
          <Link
            href="/dashboard"
            className="w-full py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-sm text-center transition-colors"
          >
            Open Dashboard
          </Link>
          <Link
            href="/pricing"
            className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/8 text-slate-400 text-sm text-center transition-colors border border-white/8"
          >
            Back to pricing
          </Link>
        </div>
      </div>
    </main>
  )
}
