'use client'

import { motion } from 'framer-motion'
import { PricingCard } from './PricingCard.js'

interface Plan {
  id: string
  name: string
  setupFee: number
  monthly: number
  features: string[]
}

interface PricingGridProps {
  plans: Plan[]
}

const PLAN_META: Record<string, { highlighted: boolean; badge?: string }> = {
  STARTER:    { highlighted: false },
  GROWTH:     { highlighted: true, badge: 'Most Popular' },
  ENTERPRISE: { highlighted: false },
}

export function PricingGrid({ plans }: PricingGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
      {plans.map((plan, i) => {
        const meta = PLAN_META[plan.id] ?? { highlighted: false }
        return (
          <motion.div
            key={plan.id}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <PricingCard
              planId={plan.id}
              name={plan.name}
              setupFee={plan.setupFee}
              monthly={plan.monthly}
              features={plan.features}
              highlighted={meta.highlighted}
              badge={meta.badge}
            />
          </motion.div>
        )
      })}
    </div>
  )
}
