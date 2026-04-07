'use client'

import type { OnboardingPayload } from '../../../app/api/onboarding/route.js'

interface Props {
  data: Partial<OnboardingPayload>
  onChange: (updates: Partial<OnboardingPayload>) => void
}

const VERTICALS = [
  { id: 'REAL_ESTATE',    label: 'Real Estate',         icon: '🏡' },
  { id: 'HOME_SERVICES',  label: 'Home Services',        icon: '🔧' },
  { id: 'MED_SPA',        label: 'Med Spa',              icon: '💆' },
  { id: 'DENTAL',         label: 'Dental',               icon: '🦷' },
  { id: 'LEGAL',          label: 'Law Firms',            icon: '⚖️' },
  { id: 'MEDICAL',        label: 'Medical',              icon: '🏥' },
  { id: 'FITNESS',        label: 'Gyms & Fitness',       icon: '💪' },
  { id: 'AUTO',           label: 'Auto Dealerships',     icon: '🚗' },
  { id: 'FINANCIAL',      label: 'Financial Services',   icon: '📈' },
  { id: 'CONTRACTOR',     label: 'Contractors',          icon: '🏗️' },
  { id: 'WELLNESS',       label: 'Wellness',             icon: '🌿' },
  { id: 'VETERINARY',     label: 'Veterinary',           icon: '🐾' },
  { id: 'RESTAURANT',     label: 'Restaurant',           icon: '🍽️' },
  { id: 'OTHER',          label: 'Other',                icon: '🏢' },
]

const COMMON_SERVICES: Record<string, string[]> = {
  REAL_ESTATE:   ['Buyer Representation', 'Seller Representation', 'Property Management', 'Commercial Leasing'],
  HOME_SERVICES: ['Plumbing', 'HVAC', 'Electrical', 'Roofing', 'Landscaping', 'Cleaning'],
  MED_SPA:       ['Botox/Fillers', 'Laser Treatments', 'Body Contouring', 'Facials', 'PRP'],
  DENTAL:        ['General Dentistry', 'Orthodontics', 'Cosmetic Dentistry', 'Implants', 'Whitening'],
  LEGAL:         ['Personal Injury', 'Real Estate Law', 'Family Law', 'Criminal Defense', 'Estate Planning'],
  MEDICAL:       ['Primary Care', 'Urgent Care', 'Specialty Consults', 'Telehealth'],
  FITNESS:       ['Personal Training', 'Group Classes', 'Nutrition Coaching', 'Memberships'],
  AUTO:          ['New Vehicle Sales', 'Used Vehicle Sales', 'Service & Repair', 'Financing'],
  FINANCIAL:     ['Wealth Management', 'Mortgage', 'Insurance', 'Tax Planning', 'Retirement Planning'],
  CONTRACTOR:    ['General Contracting', 'Remodeling', 'New Construction', 'Solar Installation'],
  WELLNESS:      ['Chiropractic', 'Massage Therapy', 'Acupuncture', 'Mental Health'],
  VETERINARY:    ['Wellness Exams', 'Surgery', 'Dental Care', 'Emergency Care'],
  RESTAURANT:    ['Dine-In', 'Catering', 'Private Events', 'Delivery'],
  OTHER:         ['Consulting', 'Coaching', 'Events', 'Retail'],
}

export function VerticalSelect({ data, onChange }: Props) {
  const selected = data.vertical ?? ''
  const services = data.services ?? []
  const suggestions = COMMON_SERVICES[selected] ?? []

  function toggleService(s: string) {
    const next = services.includes(s)
      ? services.filter((x) => x !== s)
      : [...services, s]
    onChange({ services: next })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">What kind of business are you?</h2>
        <p className="text-sm text-slate-500">Quorum uses your vertical to personalize every conversation.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {VERTICALS.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange({ vertical: id, services: [] })}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-all ${
              selected === id
                ? 'bg-indigo-500/20 border-indigo-500/60 text-white'
                : 'bg-white/3 border-white/8 text-slate-400 hover:border-white/20 hover:text-white'
            }`}
          >
            <span className="text-base">{icon}</span>
            <span className="font-medium text-xs">{label}</span>
          </button>
        ))}
      </div>

      {selected && suggestions.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 font-medium mb-3">Which services do you offer?</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleService(s)}
                className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
                  services.includes(s)
                    ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                    : 'bg-white/5 border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
