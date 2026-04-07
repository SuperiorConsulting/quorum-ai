import type { Metadata } from 'next'
import { SignInForm } from '../../../components/auth/SignInForm.js'

export const metadata: Metadata = {
  title: 'Sign In — Quorum AI',
}

interface SignInPageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { callbackUrl, error } = await searchParams

  return (
    <main className="min-h-screen bg-[#04050a] text-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 mb-6">
            <span className="text-indigo-400 text-2xl">⬡</span>
            <span className="text-sm font-bold tracking-widest font-mono text-white">QUORUM</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Welcome back</h1>
          <p className="text-slate-500 text-sm">Sign in to your sales intelligence dashboard.</p>
        </div>

        <SignInForm callbackUrl={callbackUrl} error={error} />

        <p className="text-center text-xs text-slate-700">
          New to Quorum?{' '}
          <a href="/pricing" className="text-slate-500 hover:text-white transition-colors underline underline-offset-2">
            See pricing
          </a>
        </p>
      </div>
    </main>
  )
}
