'use client'

import { useRef, useState } from 'react'
import type { OnboardingPayload } from '../../../app/api/onboarding/route.js'

interface Props {
  data: Partial<OnboardingPayload>
  onChange: (updates: Partial<OnboardingPayload>) => void
  businessId?: string
}

export function VoiceClone({ data, onChange, businessId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(false)
  const [error, setError] = useState('')

  async function handleUpload() {
    if (!businessId || files.length === 0 || !data.voiceCloneName) return
    setUploading(true)
    setError('')

    try {
      const form = new FormData()
      files.forEach((f) => form.append('files', f))

      const res = await fetch(
        `/api/onboarding?businessId=${encodeURIComponent(businessId)}&voiceName=${encodeURIComponent(data.voiceCloneName)}`,
        { method: 'PUT', body: form },
      )
      if (!res.ok) {
        const { error: e } = (await res.json()) as { error: string }
        throw new Error(e ?? 'Upload failed')
      }
      setUploaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Clone your voice</h2>
        <p className="text-sm text-slate-500">
          Quorum answers calls in your voice using ElevenLabs AI. Upload 1–5 audio clips
          (30 seconds each minimum) for the best quality.
        </p>
      </div>

      <label className="block">
        <span className="text-xs text-slate-400 font-medium mb-1.5 block">Voice clone name</span>
        <input
          type="text"
          placeholder="e.g. Marcus — Professional"
          value={data.voiceCloneName ?? ''}
          onChange={(e) => onChange({ voiceCloneName: e.target.value })}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
        />
      </label>

      {/* Drop zone */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full border-2 border-dashed border-white/10 rounded-xl p-8 text-center hover:border-indigo-500/40 transition-colors group"
      >
        <div className="text-3xl mb-2">🎙️</div>
        <p className="text-sm text-slate-400 group-hover:text-white transition-colors">
          {files.length > 0
            ? `${files.length} file${files.length > 1 ? 's' : ''} selected`
            : 'Click to upload audio files'}
        </p>
        <p className="text-xs text-slate-600 mt-1">MP3, WAV, M4A · 30s–5min each</p>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? [])
          setFiles(picked)
          setUploaded(false)
        }}
      />

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.name} className="flex items-center gap-2 text-xs text-slate-500">
              <span className="text-indigo-400">♪</span>
              {f.name} <span className="text-slate-700">({(f.size / 1024).toFixed(0)} KB)</span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {uploaded && (
        <p className="text-xs text-emerald-400">Voice clone uploaded successfully.</p>
      )}

      {files.length > 0 && !uploaded && businessId && (
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading || !data.voiceCloneName}
          className="w-full py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-white font-semibold text-sm transition-colors"
        >
          {uploading ? 'Uploading...' : 'Upload voice samples'}
        </button>
      )}

      <p className="text-xs text-slate-600">
        Optional — Quorum will use a default voice until you upload samples.
        You can do this any time from your dashboard.
      </p>
    </div>
  )
}
