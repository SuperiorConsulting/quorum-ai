/**
 * Quorum → n8n outbound webhook client.
 *
 * Architecture rule: Quorum fires webhooks TO n8n. n8n calls back via /api/webhook/*.
 * Quorum never polls n8n. All calls here are fire-and-forget by design.
 *
 * Each workflow has its own webhook path registered in n8n.
 * Set N8N_WEBHOOK_BASE_URL in env to your n8n cloud instance URL.
 */

// ─── Workflow event types ─────────────────────────────────────────────────────

export type N8nWorkflowEvent =
  | 'lead.new'
  | 'lead.qualified'
  | 'lead.score_threshold'
  | 'appointment.booked'
  | 'deal.closed'
  | 'review.request'
  | 'winback.enroll'
  | 'lead.escalate'

/** Maps each event to its n8n webhook path */
const WORKFLOW_PATHS: Record<N8nWorkflowEvent, string> = {
  'lead.new':             '/webhook/quorum-lead-intake',
  'lead.qualified':       '/webhook/quorum-lead-qualified',
  'lead.score_threshold': '/webhook/quorum-score-threshold',
  'appointment.booked':   '/webhook/quorum-appointment-booked',
  'deal.closed':          '/webhook/quorum-deal-closed',
  'review.request':       '/webhook/quorum-review-request',
  'winback.enroll':       '/webhook/quorum-winback-enroll',
  'lead.escalate':        '/webhook/quorum-escalate',
}

// ─── Payload types ────────────────────────────────────────────────────────────

export interface N8nLeadPayload {
  leadId: string
  businessId: string
  leadName: string
  phone?: string
  email?: string
  vertical?: string
  source?: string
  score?: number
}

export interface N8nAppointmentPayload {
  leadId: string
  businessId: string
  leadName: string
  leadPhone?: string
  leadEmail?: string
  appointmentId: string
  appointmentType: string
  scheduledAt: string
  location?: string
}

export interface N8nDealPayload {
  leadId: string
  businessId: string
  leadName: string
  leadPhone?: string
  leadEmail?: string
  dealValue: number
  closedAt: string
  channel: string
}

export interface N8nEscalationPayload {
  leadId: string
  businessId: string
  leadName: string
  phone?: string
  reason: string
  urgency: 'HIGH' | 'MEDIUM' | 'LOW'
  lastMessage: string
}

// ─── Fire webhook ─────────────────────────────────────────────────────────────

/**
 * Fires an outbound webhook to n8n. Always fire-and-forget — never awaited
 * in the main request pipeline.
 *
 * @param event   - Which n8n workflow to trigger
 * @param payload - Data to send
 */
export async function fireN8nWebhook(
  event: N8nWorkflowEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const baseUrl = process.env['N8N_WEBHOOK_BASE_URL']
  if (!baseUrl) {
    console.warn(`[n8n] N8N_WEBHOOK_BASE_URL not set — skipping ${event}`)
    return
  }

  const path = WORKFLOW_PATHS[event]
  const url = `${baseUrl}${path}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        source: 'quorum',
        ...payload,
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      console.warn(`[n8n] Webhook ${event} → ${res.status}`)
    } else {
      console.log(`[n8n] Fired ${event}`)
    }
  } catch (err) {
    // Non-fatal — n8n is a side-effect, never block the main pipeline
    console.error(`[n8n] Webhook ${event} failed (non-fatal):`, err)
  }
}

// ─── Typed helpers ────────────────────────────────────────────────────────────

/** Fire when a new lead is created — triggers n8n lead intake workflow. */
export function notifyLeadNew(payload: N8nLeadPayload): void {
  void fireN8nWebhook('lead.new', payload as unknown as Record<string, unknown>)
}

/** Fire when a lead crosses the qualification threshold (score ≥ 70). */
export function notifyLeadQualified(payload: N8nLeadPayload): void {
  void fireN8nWebhook('lead.qualified', payload as unknown as Record<string, unknown>)
}

/** Fire when a lead score changes significantly (crossing 50 or 80). */
export function notifyScoreThreshold(
  payload: N8nLeadPayload & { previousScore: number; newScore: number; threshold: number },
): void {
  void fireN8nWebhook('lead.score_threshold', payload as unknown as Record<string, unknown>)
}

/** Fire after an appointment is successfully booked. */
export function notifyAppointmentBooked(payload: N8nAppointmentPayload): void {
  void fireN8nWebhook('appointment.booked', payload as unknown as Record<string, unknown>)
}

/** Fire when a deal is marked CLOSED_WON. */
export function notifyDealClosed(payload: N8nDealPayload): void {
  void fireN8nWebhook('deal.closed', payload as unknown as Record<string, unknown>)
}

/** Fire to request a Google review — n8n waits 24h then calls back. */
export function notifyReviewRequest(payload: N8nLeadPayload & { reviewUrl?: string }): void {
  void fireN8nWebhook('review.request', payload as unknown as Record<string, unknown>)
}

/** Fire to enroll a lead in win-back — n8n can also trigger this from dormancy check. */
export function notifyWinbackEnroll(payload: N8nLeadPayload & { daysDormant: number }): void {
  void fireN8nWebhook('winback.enroll', payload as unknown as Record<string, unknown>)
}

/** Fire when a lead needs immediate human escalation. */
export function notifyEscalation(payload: N8nEscalationPayload): void {
  void fireN8nWebhook('lead.escalate', payload as unknown as Record<string, unknown>)
}
