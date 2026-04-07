import { NextRequest, NextResponse } from 'next/server'
import {
  handleVapiWebhook,
  resolveBusinessFromPhoneNumberId,
  type VapiWebhookPayload,
} from '../../../voice/vapi-client.js'

// ─── Response shape ───────────────────────────────────────────────────────────

function ok(data: unknown) {
  return NextResponse.json({ success: true, data })
}

function err(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

// ─── Webhook secret validation ────────────────────────────────────────────────

function validateWebhookSecret(request: NextRequest): boolean {
  const secret = process.env['QUORUM_WEBHOOK_SECRET']
  if (!secret) return true // Not configured — skip validation in dev

  const provided = request.headers.get('x-vapi-secret') ?? request.headers.get('x-quorum-secret')
  return provided === secret
}

// ─── POST /api/voice ─────────────────────────────────────────────────────────
//
// Vapi webhook handler. Receives ALL Vapi events for this phone number.
// Public route — authenticated via webhook secret header, not session.
//
// Event types handled:
//   assistant-request   → return Quorum assistant config (memory pre-loaded)
//   function-call       → execute tool and return result
//   end-of-call-report  → persist transcript, trigger memory pipeline
//   hang/transcript/*   → acknowledged and ignored or logged
//
// Response time matters: Vapi expects assistant-request responses in < 2s.
// Memory is pre-loaded here before Quorum speaks a single word.

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Validate webhook secret
  if (!validateWebhookSecret(request)) {
    return err('Unauthorized', 401)
  }

  let payload: VapiWebhookPayload

  try {
    payload = (await request.json()) as VapiWebhookPayload
  } catch {
    return err('Invalid JSON body')
  }

  const eventType = payload.message?.type
  if (!eventType) {
    return err('Missing message.type in webhook payload')
  }

  // Resolve business from the phone number that received the call
  const phoneNumberId =
    payload.message.call?.phoneNumberId ??
    process.env['VAPI_PHONE_NUMBER_ID'] ??
    ''

  const businessId = await resolveBusinessFromPhoneNumberId(phoneNumberId)

  if (!businessId) {
    console.error(`[Voice webhook] No active business found for phoneNumberId: ${phoneNumberId}`)
    // Return a fallback assistant config so the call does not dead-air
    return NextResponse.json({
      assistant: {
        model: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          systemPrompt: 'You are a professional assistant. Apologize for the technical issue and ask the caller to call back in a few minutes.',
          maxTokens: 100,
        },
        voice: {
          provider: '11labs',
          voiceId: 'EXAVITQu4vr4xnSDxMaL', // Default Rachel voice
        },
        firstMessage: "I apologize — we're experiencing a brief technical issue. Please try calling back in a few minutes. Thank you for your patience.",
      },
    })
  }

  try {
    const result = await handleVapiWebhook(payload, businessId)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Voice webhook] Handler error (event: ${eventType}):`, error)

    // For assistant-request failures: return fallback config, never dead-air
    if (eventType === 'assistant-request') {
      return NextResponse.json({
        assistant: {
          model: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
            systemPrompt: 'You are a helpful sales assistant. Be warm and professional.',
            maxTokens: 200,
          },
          voice: {
            provider: '11labs',
            voiceId: 'EXAVITQu4vr4xnSDxMaL',
          },
          firstMessage: 'Thanks for calling! How can I help you today?',
        },
      })
    }

    return err(message, 500)
  }
}

// ─── GET /api/voice ───────────────────────────────────────────────────────────
// Health check — confirms the voice webhook is reachable.

export async function GET(): Promise<NextResponse> {
  return ok({
    status: 'Quorum voice webhook is live',
    timestamp: new Date().toISOString(),
  })
}
