'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'

interface Props {
  businessId: string
}

export function SetPasswordForm({ businessId }: Props) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState('')
  const [done, setDone]         = useState(false)
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (!email.trim()) {
      setError('Enter the email you used during onboarding.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, businessId }),
      })

      if (!res.ok) {
        const { error: e } = (await res.json()) as { error: string }
        throw new Error(e ?? 'Failed to set password')
      }

      setDone(true)

      // Auto sign-in after setting password
      await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        callbackUrl: '/dashboard',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
        <p className="text-sm text-emerald-400">Password set! Redirecting to your dashboard…</p>
      </div>
    )
  }

  return (
    <div className="bg-[#0d0f18] border border-white/5 rounded-xl p-6 text-left space-y-4">
      <div>
        <p className="text-sm font-semibold text-white mb-1">Create your account password</p>
        <p className="text-xs text-slate-500">You'll use this to sign in to your dashboard.</p>
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="email"
          placeholder="Your email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 transition-colors"
        />
        <input
          type="password"
          placeholder="Choose a password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 transition-colors"
        />
        <input
          type="password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 transition-colors"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-white font-semibold text-sm transition-colors"
        >
          {loading ? 'Setting up…' : 'Set password & go to dashboard'}
        </button>
      </form>
    </div>
  )
}
