import { prisma } from '../lib/prisma.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1'

/**
 * Professional default voice used when no clone has been uploaded.
 * Rachel — calm, professional, authoritative. Works across all verticals.
 */
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'

/** Default model for highest-quality synthesis. */
const DEFAULT_MODEL = 'eleven_turbo_v2_5'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VoiceSettings {
  stability: number
  similarityBoost: number
  style: number
  useSpeakerBoost: boolean
}

export interface CloneVoiceResult {
  voiceId: string
  name: string
}

export interface SynthesisOptions {
  voiceId?: string
  modelId?: string
  settings?: Partial<VoiceSettings>
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.50,
  similarityBoost: 0.75,
  style: 0.35,
  useSpeakerBoost: true,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function apiKey(): string {
  const key = process.env['ELEVENLABS_API_KEY']
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set')
  return key
}

function headers(contentType = 'application/json'): Record<string, string> {
  return {
    'xi-api-key': apiKey(),
    'Content-Type': contentType,
  }
}

// ─── ElevenLabs client ────────────────────────────────────────────────────────

/**
 * Synthesizes speech from text using ElevenLabs.
 * Returns a Buffer containing the audio in MP3 format.
 *
 * Uses the business's cloned voice if available.
 * Falls back to the professional default voice if no clone exists.
 *
 * @param text    - Text to synthesize (max ~5,000 characters per request)
 * @param options - Optional voice ID, model, and voice settings overrides
 */
export async function synthesizeSpeech(
  text: string,
  options: SynthesisOptions = {},
): Promise<Buffer> {
  const voiceId = options.voiceId ?? process.env['ELEVENLABS_VOICE_ID'] ?? DEFAULT_VOICE_ID
  const modelId = options.modelId ?? DEFAULT_MODEL
  const settings = { ...DEFAULT_VOICE_SETTINGS, ...options.settings }

  const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      text: text.slice(0, 5000),
      model_id: modelId,
      voice_settings: {
        stability: settings.stability,
        similarity_boost: settings.similarityBoost,
        style: settings.style,
        use_speaker_boost: settings.useSpeakerBoost,
      },
    }),
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`ElevenLabs synthesis failed: ${res.status} ${error}`)
  }

  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Clones a voice from one or more audio files.
 * Stores the resulting voiceId on the Business record.
 *
 * @param businessId  - Business whose voice is being cloned
 * @param voiceName   - Display name for the cloned voice in ElevenLabs
 * @param audioFiles  - Array of audio file buffers (WAV or MP3, 1-25 files, min 1 min total)
 * @param description - Optional description stored with the voice
 */
export async function cloneVoice(
  businessId: string,
  voiceName: string,
  audioFiles: Array<{ buffer: Buffer; filename: string }>,
  description?: string,
): Promise<CloneVoiceResult> {
  const formData = new FormData()
  formData.append('name', voiceName)
  if (description) formData.append('description', description)

  for (const { buffer, filename } of audioFiles) {
    const blob = new Blob([buffer as unknown as ArrayBuffer], { type: 'audio/mpeg' })
    formData.append('files', blob, filename)
  }

  const res = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey() },
    body: formData,
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`ElevenLabs voice clone failed: ${res.status} ${error}`)
  }

  const json = (await res.json()) as { voice_id: string }
  const voiceId = json.voice_id

  // Persist voiceId to Business record
  await prisma.business.update({
    where: { id: businessId },
    data: { voiceCloneId: voiceId },
  })

  return { voiceId, name: voiceName }
}

/**
 * Returns the active voiceId for a business.
 * Uses the cloned voice if available, falls back to the env default or the
 * professional default voice.
 *
 * @param businessId - Business to look up
 */
export async function getVoiceId(businessId: string): Promise<string> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { voiceCloneId: true },
  })

  return (
    business?.voiceCloneId ??
    process.env['ELEVENLABS_VOICE_ID'] ??
    DEFAULT_VOICE_ID
  )
}

/**
 * Lists all voices available in the ElevenLabs account.
 * Used in the onboarding flow to let the owner select a voice.
 */
export async function listVoices(): Promise<Array<{ voiceId: string; name: string; category: string }>> {
  const res = await fetch(`${ELEVENLABS_BASE}/voices`, {
    headers: { 'xi-api-key': apiKey() },
  })

  if (!res.ok) throw new Error(`ElevenLabs list voices failed: ${res.status}`)

  const json = (await res.json()) as {
    voices: Array<{ voice_id: string; name: string; category: string }>
  }

  return json.voices.map((v) => ({
    voiceId: v.voice_id,
    name: v.name,
    category: v.category,
  }))
}

/**
 * Deletes a cloned voice from ElevenLabs and clears it from the Business record.
 * Used when replacing a voice clone.
 *
 * @param businessId - Business whose voice clone to delete
 * @param voiceId    - ElevenLabs voice ID to delete
 */
export async function deleteVoiceClone(businessId: string, voiceId: string): Promise<void> {
  const res = await fetch(`${ELEVENLABS_BASE}/voices/${voiceId}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': apiKey() },
  })

  if (!res.ok) {
    console.error(`[ElevenLabs] Failed to delete voice ${voiceId}: ${res.status}`)
  }

  await prisma.business.update({
    where: { id: businessId },
    data: { voiceCloneId: null },
  })
}
