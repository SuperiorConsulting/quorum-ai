import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Checkout Cancelled — Quorum',
}

export default function CancelPage() {
  return (
    <main className="min-h-screen bg-[#04050a] text-white flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Logo */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-white/10 flex items-center justify-center">
            <span className="text-3xl text-slate-500">⬡</span>
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-white mb-3">No worries — you're still welcome.</h1>
          <p className="text-slate-500 text-sm leading-relaxed">
            You cancelled the checkout. Your progress was not saved and you were not charged.
            Whenever you're ready, Quorum will be here.
          </p>
        </div>

        {/* Objection handlers */}
        <div className="bg-[#0d0f18] border border-white/5 rounded-xl p-6 text-left space-y-4">
          <p className="text-xs text-slate-500 uppercase tracking-widest font-mono mb-4">
            Still on the fence?
          </p>
          {[
            {
              concern: 'Too expensive',
              answer: 'The average Quorum customer closes $8,000–$40,000 in their first 30 days. The ROI is measured in weeks, not years.',
            },
            {
              concern: 'Not sure if it fits my business',
              answer: 'Quorum works across 14 verticals. If you close deals over phone, SMS, or email — Quorum is built for you.',
            },
            {
              concern: 'Need more time',
              answer: 'Fair. There\'s no pressure. The pricing and plans won\'t change.',
            },
          ].map(({ concern, answer }) => (
            <div key={concern} className="border-b border-white/5 pb-4 last:border-0 last:pb-0">
              <p className="text-sm text-white font-medium mb-1">{concern}</p>
              <p className="text-xs text-slate-500 leading-relaxed">{answer}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <Link
            href="/pricing"
            className="w-full py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-sm text-center transition-colors"
          >
            Back to pricing
          </Link>
        </div>
      </div>
    </main>
  )
}
