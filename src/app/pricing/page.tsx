import type { Metadata } from 'next'
import { PLAN_CONFIG } from '../../lib/stripe.js'
import { PricingGrid } from '../../components/pricing/PricingGrid.js'

export const metadata: Metadata = {
  title: 'Pricing — Quorum AI',
  description: '24/7 autonomous AI sales intelligence. Closes deals while you sleep.',
}

const SOCIAL_PROOF = [
  { metric: '$2.4M',  label: 'Revenue closed by Quorum' },
  { metric: '94%',    label: 'Lead response rate' },
  { metric: '3 sec',  label: 'Average first response' },
  { metric: '14 niches', label: 'Industries supported' },
]

const FAQS = [
  {
    q: 'Does Quorum replace my sales team?',
    a: 'No — Quorum handles 24/7 first response, qualification, and nurturing. It routes hot leads to you the moment they\'re ready to close. You focus on closing; Quorum handles everything before that.',
  },
  {
    q: 'How fast does Quorum respond to leads?',
    a: 'Under 3 seconds. 78% of deals go to the first company that responds. Quorum wins that race every time, even at 2am on a Sunday.',
  },
  {
    q: 'What happens to leads I already have in GoHighLevel?',
    a: 'Quorum syncs bidirectionally with GHL. Existing contacts get picked up, scored, and enrolled in the right sequences automatically.',
  },
  {
    q: 'Can Quorum handle voice calls?',
    a: 'Yes. Quorum uses Vapi AI + ElevenLabs voice cloning to answer calls in your voice, qualify leads, and book appointments — all without you lifting a phone.',
  },
  {
    q: 'What\'s the setup fee for?',
    a: 'Onboarding, voice cloning, CRM integration, and custom vertical configuration. Setup is done in 48 hours and you start seeing results immediately.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Month-to-month after the initial term. No long-term contracts. We keep you because the results speak for themselves.',
  },
]

export default function PricingPage() {
  // Build plan data from config (server-side, no fetch needed)
  const plans = Object.entries(PLAN_CONFIG).map(([id, config]) => ({
    id,
    name: config.name,
    setupFee: config.setupFeeAmount / 100,
    monthly: config.monthlyAmount / 100,
    features: config.features,
  }))

  return (
    <main className="min-h-screen bg-[#04050a] text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-indigo-400 text-xl">⬡</span>
          <span className="text-sm font-bold tracking-widest font-mono text-white">QUORUM</span>
        </div>
        <a
          href="/dashboard"
          className="text-xs text-slate-500 hover:text-white transition-colors"
        >
          Dashboard →
        </a>
      </nav>

      {/* Hero */}
      <section className="pt-20 pb-16 px-6 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-900/30 border border-indigo-500/20 mb-8">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          <span className="text-xs text-indigo-400 font-medium">Now serving 14 verticals</span>
        </div>

        <h1 className="text-5xl font-bold text-white mb-4 leading-tight">
          The Deciding Intelligence<br />
          <span className="text-indigo-400">for your sales pipeline</span>
        </h1>

        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-6">
          Quorum closes deals, books appointments, and never forgets a lead —
          24/7, in your voice, across SMS, email, and phone.
        </p>

        <p className="text-sm text-slate-600">
          No per-seat fees. No usage caps on the plans that matter. Just results.
        </p>
      </section>

      {/* Social proof bar */}
      <section className="border-y border-white/5 py-6 mb-16">
        <div className="max-w-4xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          {SOCIAL_PROOF.map(({ metric, label }) => (
            <div key={metric} className="text-center">
              <p className="text-2xl font-bold font-mono text-indigo-400">{metric}</p>
              <p className="text-xs text-slate-600 mt-1">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing grid */}
      <section className="px-6 pb-24">
        <PricingGrid plans={plans} />

        <p className="text-center text-xs text-slate-600 mt-8">
          All plans include a 48-hour setup guarantee. Prices in USD.
          Setup fee billed once at signup.
        </p>
      </section>

      {/* What's included */}
      <section className="border-t border-white/5 py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-12">
            Every plan includes
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: '🧠',
                title: 'Relationship Memory',
                desc: 'Quorum remembers every lead across every conversation. No resets. Builds context over months, not minutes.',
              },
              {
                icon: '📞',
                title: 'Voice AI + Cloning',
                desc: 'Answers calls in your voice using ElevenLabs cloning. Powered by Vapi AI for natural, intelligent conversations.',
              },
              {
                icon: '🌅',
                title: 'Morning Briefings',
                desc: 'Daily 8am briefing delivered to your inbox and phone. Revenue closed overnight, hot leads, appointments booked.',
              },
              {
                icon: '🔁',
                title: 'Win-Back Sequences',
                desc: '5-step, 21-day sequence for dormant leads. SMS, voice, and email — all personalized from memory.',
              },
              {
                icon: '📊',
                title: 'GoHighLevel Sync',
                desc: 'All leads, stages, and activities sync to GHL in real time. Your CRM stays current without any manual work.',
              },
              {
                icon: '⚡',
                title: 'n8n Automation',
                desc: '6 pre-built workflow automations. Zillow, Realtor.com, Facebook Ads, and Google Ads plug straight in.',
              },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="flex gap-4">
                <span className="text-2xl flex-shrink-0">{icon}</span>
                <div>
                  <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Verticals */}
      <section className="border-t border-white/5 py-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-xl font-bold text-white mb-3">Built for your industry</h2>
          <p className="text-sm text-slate-500 mb-10">
            Quorum ships with deep vertical intelligence for 14 business categories.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              'Real Estate', 'Home Services', 'Med Spa', 'Dental',
              'Law Firms', 'Solar', 'Roofing', 'HVAC',
              'Insurance', 'Auto Dealerships', 'Gyms & Fitness',
              'Mortgage', 'Financial Services', 'General Business',
            ].map((v) => (
              <span
                key={v}
                className="px-3 py-1.5 rounded-full text-xs bg-white/5 border border-white/8 text-slate-400"
              >
                {v}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-white/5 py-20 px-6">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-12">
            Common questions
          </h2>
          <div className="space-y-6">
            {FAQS.map(({ q, a }) => (
              <div key={q} className="border-b border-white/5 pb-6">
                <h3 className="text-sm font-semibold text-white mb-2">{q}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-white/5 py-20 px-6 text-center">
        <p className="text-3xl font-bold text-white mb-3">
          Ready to let Quorum close for you?
        </p>
        <p className="text-slate-500 mb-8 text-sm">
          Setup in 48 hours. First morning briefing delivered the next day.
        </p>
        <a
          href="#top"
          className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-sm transition-colors shadow-lg shadow-indigo-500/25"
        >
          <span>⬡</span> Choose a plan above
        </a>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-indigo-400">⬡</span>
            <span className="text-xs font-mono text-slate-600">QUORUM</span>
          </div>
          <p className="text-xs text-slate-700">The Deciding Intelligence</p>
        </div>
      </footer>
    </main>
  )
}
