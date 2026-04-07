import type { Metadata } from 'next'
import { OnboardingWizard } from '../../components/onboarding/OnboardingWizard.js'

export const metadata: Metadata = {
  title: 'Get Started — Quorum AI',
  description: 'Set up your 24/7 AI sales intelligence in minutes.',
}

export default function OnboardingPage() {
  return <OnboardingWizard />
}
