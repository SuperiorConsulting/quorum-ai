'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'

interface PricingCardProps {
  planId: string
  name: string
  setupFee: number
  monthly: number
  features: string[]
  highlighted?: boolean
  badge?: string
}

export function PricingCard({
  planId,
  name,
  setupFee,
  monthly,
  features,
  highlighted = false,
  badge,
}: PricingCardProps) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { setError('Email required'); return }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId, email: email.trim() }),
      })

      const data = await res.json() as { url?: string; error?: string }

      if (!res.ok || !data.url) {
        setError(data.error ?? 'Something went wrong')
        return
      }

      window.location.href = data.url
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.3 }}
      className={`relative flex flex-col rounded-2xl border p-8 ${
        highlighted
          ? 'bg-indigo-950/60 border-indigo-500/40 shadow-lg shadow-indigo-500/10'
          : 'bg-[#0d0f18] border-white/8'
      }`}
    >
      {/* Badge */}
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500 text-white shadow-md shadow-indigo-500/30">
            {badge}
          </span>
        </div>
      )}

      {/* Plan name */}
      <div className="mb-6">
        <p className="text-xs text-slate-500 uppercase tracking-widest mb-1 font-mono">Quorum</p>
        <h3 className="text-2xl font-bold text-white">{name}</h3>
      </div>

      {/* Pricing */}
      <div className="mb-6">
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold text-white font-mono">
            ${monthly.toLocaleString()}
          </span>
          <span className="text-slate-500 text-sm">/mo</span>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          + ${setupFee.toLocaleString()} one-time setup
        </p>
      </div>

      {/* Features */}
      <ul className="space-y-3 mb-8 flex-1">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm text-slate-300">
            <span className="text-emerald-400 mt-0.5 flex-shrink-0">✓</span>
            {f}
          </li>
        ))}
      </ul>

      {/* Checkout form */}
      <form onSubmit={(e) => void handleCheckout(e)} className="space-y-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          required
          className="w-full px-4 py-2.5 rounded-lg bg-black/30 border border-white/10 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
        />

        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className={`w-full py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
            highlighted
              ? 'bg-indigo-500 hover:bg-indigo-400 text-white shadow-lg shadow-indigo-500/25 disabled:opacity-50'
              : 'bg-white/8 hover:bg-white/12 text-white border border-white/10 disabled:opacity-50'
          }`}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Redirecting...
            </span>
          ) : (
            `Get Started with ${name}`
          )}
        </button>
      </form>
    </motion.div>
  )
}
