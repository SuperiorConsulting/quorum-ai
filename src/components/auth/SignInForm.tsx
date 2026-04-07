'use client'

import { useState, useTransition } from 'react'
import { signIn } from 'next-auth/react'

interface Props {
  callbackUrl?: string
  error?: string
}

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: 'Incorrect email or password.',
  Configuration:     'Server configuration error. Contact support.',
  Default:           'Sign in failed. Please try again.',
}

export function SignInForm({ callbackUrl, error }: Props) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState('')
  const [isPending, startTransition] = useTransition()

  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES['Default']!) : localError

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) {
      setLocalError('Email and password are required.')
      return
    }
    setLocalError('')
    startTransition(async () => {
      await signIn('credentials', {
        email:       email.trim().toLowerCase(),
        password,
        callbackUrl: callbackUrl ?? '/dashboard',
      })
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {errorMessage && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <p className="text-sm text-red-400">{errorMessage}</p>
        </div>
      )}

      <label className="block">
        <span className="text-xs text-slate-400 font-medium mb-1.5 block">Email address</span>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
        />
      </label>

      <label className="block">
        <span className="text-xs text-slate-400 font-medium mb-1.5 block">Password</span>
        <input
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
        />
      </label>

      <div className="flex items-center justify-end">
        <a
          href="/auth/forgot-password"
          className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
        >
          Forgot password?
        </a>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-white font-semibold text-sm transition-colors shadow-lg shadow-indigo-500/25"
      >
        {isPending ? 'Signing in…' : 'Sign in to Quorum'}
      </button>
    </form>
  )
}
