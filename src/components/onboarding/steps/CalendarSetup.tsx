'use client'

import type { OnboardingPayload } from '../../../app/api/onboarding/route.js'

interface Props {
  data: Partial<OnboardingPayload>
  onChange: (updates: Partial<OnboardingPayload>) => void
}

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Paris',
  'Australia/Sydney',
]

export function CalendarSetup({ data, onChange }: Props) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Calendar & availability</h2>
        <p className="text-sm text-slate-500">
          Quorum books appointments directly into your Google Calendar — no double-booking,
          ever.
        </p>
      </div>

      <div className="space-y-4">
        <label className="block">
          <span className="text-xs text-slate-400 font-medium mb-1.5 block">Google Calendar ID</span>
          <input
            type="text"
            placeholder="you@gmail.com or calendar_id@group.calendar.google.com"
            value={data.googleCalendarId ?? ''}
            onChange={(e) => onChange({ googleCalendarId: e.target.value })}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
          />
          <p className="text-xs text-slate-600 mt-1.5">
            Find it in Google Calendar → Settings → Your calendar → Calendar ID
          </p>
        </label>

        <label className="block">
          <span className="text-xs text-slate-400 font-medium mb-1.5 block">Your timezone</span>
          <select
            value={data.timezone ?? ''}
            onChange={(e) => onChange({ timezone: e.target.value })}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors appearance-none"
          >
            <option value="" disabled className="bg-slate-900">Select your timezone</option>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz} className="bg-slate-900">
                {tz.replace('_', ' ').replace('/', ' / ')}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs text-slate-600">
        Optional — skip if you don't use appointment booking. Quorum's calendar features
        won't activate until this is configured.
      </p>
    </div>
  )
}
