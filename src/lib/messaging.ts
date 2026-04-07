import twilio from 'twilio'
import sgMail from '@sendgrid/mail'

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmailTemplateId =
  | 'appointment_confirmation'
  | 'appointment_reminder'
  | 'review_request'
  | 'winback_day1'
  | 'winback_day7'
  | 'winback_day21'
  | 'morning_briefing_summary'
  | 'onboarding_welcome'
  | 'deal_closed'
  | 'payment_receipt'

export interface SMSResult {
  sid: string
  status: string
  to: string
}

export interface EmailResult {
  messageId: string
  to: string
}

// ─── Twilio client ────────────────────────────────────────────────────────────

function getTwilio() {
  const sid = process.env['TWILIO_ACCOUNT_SID']
  const token = process.env['TWILIO_AUTH_TOKEN']
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set')
  return twilio(sid, token)
}

function twilioFrom(): string {
  const from = process.env['TWILIO_PHONE_NUMBER']
  if (!from) throw new Error('TWILIO_PHONE_NUMBER not set')
  return from
}

// ─── SendGrid client ──────────────────────────────────────────────────────────

function initSendGrid() {
  const key = process.env['SENDGRID_API_KEY']
  if (!key) throw new Error('SENDGRID_API_KEY not set')
  sgMail.setApiKey(key)
}

function fromEmail(): string {
  return process.env['SENDGRID_FROM_EMAIL'] ?? 'noreply@quorum.ai'
}

// ─── SMS ──────────────────────────────────────────────────────────────────────

/**
 * Sends an SMS via Twilio.
 * Handles E.164 formatting and truncates messages over 1600 characters.
 *
 * @param to      - Destination phone number (E.164 or US format)
 * @param message - Message body (max 1600 chars; longer messages split automatically by Twilio)
 */
export async function sendSMS(to: string, message: string): Promise<SMSResult> {
  const client = getTwilio()
  const normalized = normalizePhone(to)
  const truncated = message.slice(0, 1600)

  const result = await client.messages.create({
    to: normalized,
    from: twilioFrom(),
    body: truncated,
  })

  return { sid: result.sid, status: result.status, to: normalized }
}

/**
 * Sends a bulk SMS to multiple recipients.
 * Failures for individual numbers are logged but do not throw.
 *
 * @param recipients - Array of phone numbers
 * @param message    - Message body
 */
export async function sendBulkSMS(
  recipients: string[],
  message: string,
): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0

  await Promise.allSettled(
    recipients.map(async (phone) => {
      try {
        await sendSMS(phone, message)
        sent++
      } catch (err) {
        console.error(`[Messaging] SMS failed to ${phone}:`, err)
        failed++
      }
    }),
  )

  return { sent, failed }
}

// ─── Email ────────────────────────────────────────────────────────────────────

/**
 * Sends a transactional email via SendGrid.
 *
 * @param to      - Recipient email address
 * @param subject - Email subject line
 * @param html    - HTML body content
 * @param text    - Plain text fallback (auto-generated from html if not provided)
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<EmailResult> {
  initSendGrid()

  await sgMail.send({
    to,
    from: fromEmail(),
    subject,
    html,
    text: text ?? stripHtml(html),
  })

  return { messageId: `sg-${Date.now()}`, to }
}

/**
 * Sends a templated email using a predefined template.
 *
 * @param to         - Recipient email
 * @param templateId - Which email template to use
 * @param data       - Dynamic data to inject into the template
 */
export async function sendTemplatedEmail(
  to: string,
  templateId: EmailTemplateId,
  data: Record<string, string | number>,
): Promise<EmailResult> {
  const template = EMAIL_TEMPLATES[templateId]
  if (!template) throw new Error(`Email template not found: ${templateId}`)

  const { subject, html } = template(data)
  return sendEmail(to, subject, html)
}

// ─── Email templates ──────────────────────────────────────────────────────────

type TemplateRenderer = (data: Record<string, string | number>) => { subject: string; html: string }

const EMAIL_TEMPLATES: Record<EmailTemplateId, TemplateRenderer> = {
  appointment_confirmation: (d) => ({
    subject: `Your appointment is confirmed — ${d['businessName']}`,
    html: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#6366f1">Appointment Confirmed ✓</h2>
  <p>Hi ${d['leadName']},</p>
  <p>Your <strong>${d['appointmentType']}</strong> is confirmed:</p>
  <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:16px 0">
    <p style="margin:4px 0">📅 <strong>${d['scheduledAt']}</strong></p>
    ${d['location'] ? `<p style="margin:4px 0">📍 <strong>${d['location']}</strong></p>` : ''}
    ${d['notes'] ? `<p style="margin:4px 0">📝 ${d['notes']}</p>` : ''}
  </div>
  <p>Questions? Just reply to this email or text us at ${d['businessPhone']}.</p>
  <p style="color:#888;font-size:12px">— ${d['businessName']}</p>
</div>`,
  }),

  appointment_reminder: (d) => ({
    subject: `Reminder: Your appointment ${d['timeUntil']} — ${d['businessName']}`,
    html: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#6366f1">Reminder: ${d['appointmentType']} ${d['timeUntil']}</h2>
  <p>Hi ${d['leadName']}, just a reminder about your upcoming appointment:</p>
  <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:16px 0">
    <p style="margin:4px 0">📅 <strong>${d['scheduledAt']}</strong></p>
    ${d['location'] ? `<p style="margin:4px 0">📍 ${d['location']}</p>` : ''}
  </div>
  <p>See you soon!</p>
  <p style="color:#888;font-size:12px">— ${d['businessName']}</p>
</div>`,
  }),

  review_request: (d) => ({
    subject: `How was your experience, ${d['leadName']}?`,
    html: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#6366f1">We'd love your feedback</h2>
  <p>Hi ${d['leadName']},</p>
  <p>It was great working with you. If you have 60 seconds, a Google review helps others like you find us:</p>
  <div style="text-align:center;margin:24px 0">
    <a href="${d['reviewUrl']}" style="background:#f59e0b;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
      Leave a Review ⭐
    </a>
  </div>
  <p style="color:#888;font-size:12px">— ${d['businessName']}</p>
</div>`,
  }),

  winback_day7: (d) => ({
    subject: `A different angle, ${d['leadName']}`,
    html: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <p>Hi ${d['leadName']},</p>
  <p>Last time we spoke, ${d['objectionContext']}. I've been thinking about that.</p>
  <p>${d['objectionReframe']}</p>
  <p>I'm not trying to pressure you — I genuinely think there's a fit here if the timing is right. Worth a quick conversation this week?</p>
  <p>Reply to this email or call/text ${d['businessPhone']}.</p>
  <p style="color:#888;font-size:12px">— ${d['businessName']}</p>
</div>`,
  }),

  winback_day21: (d) => ({
    subject: `Keeping the door open, ${d['leadName']}`,
    html: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <p>Hi ${d['leadName']},</p>
  <p>No pressure from me — I know you'll reach out when the time is right.</p>
  <p>In the meantime, I put together something I think you'll find useful regardless:</p>
  <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:16px 0">
    <p><strong>${d['freeResource']}</strong></p>
    <p>${d['resourceDescription']}</p>
  </div>
  <p>When things change, I'll be here.</p>
  <p style="color:#888;font-size:12px">— ${d['businessName']}</p>
</div>`,
  }),

  winback_day1: (d) => ({
    subject: `Hey ${d['leadName']}, checking in`,
    html: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <p>Hi ${d['leadName']},</p>
  <p>${d['memoryDetail']}. Wanted to reach back out — is this still something you're thinking about?</p>
  <p>Happy to jump on a quick call or just chat over email. Whatever works best for you.</p>
  <p style="color:#888;font-size:12px">— ${d['businessName']}</p>
</div>`,
  }),

  morning_briefing_summary: (d) => ({
    subject: `Quorum Morning Briefing — ${d['date']}`,
    html: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#04050a;color:#e5e7eb">
  <h2 style="color:#6366f1;font-family:sans-serif">⬡ QUORUM MORNING BRIEFING</h2>
  <p style="color:#9ca3af">${d['date']}</p>
  <div style="background:#111827;border-radius:12px;padding:20px;margin:16px 0">
    <h3 style="color:#f59e0b;margin-top:0">Overnight Summary</h3>
    <p>💰 Revenue closed: <strong style="color:#10b981">$${d['revenueClosedOvernite']}</strong></p>
    <p>📅 Appointments booked: <strong>${d['appointmentsBooked']}</strong></p>
    <p>🔥 Hot leads (80+): <strong>${d['hotLeadsCount']}</strong></p>
    <p>♻️ Win-back responses: <strong>${d['winBackResponses']}</strong></p>
  </div>
  <div style="background:#111827;border-radius:12px;padding:20px;margin:16px 0">
    <h3 style="color:#6366f1;margin-top:0">Briefing Script</h3>
    <p style="line-height:1.6">${d['briefingScript']}</p>
  </div>
  <p style="color:#6b7280;font-size:12px">Quorum — The Deciding Intelligence</p>
</div>`,
  }),

  onboarding_welcome: (d) => ({
    subject: `Welcome to Quorum — ${d['businessName']} is live`,
    html: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <div style="text-align:center;margin-bottom:32px">
    <h1 style="color:#6366f1;font-size:28px">⬡ QUORUM</h1>
    <p style="color:#888">The Deciding Intelligence</p>
  </div>
  <h2>Welcome aboard, ${d['ownerName']}.</h2>
  <p>Quorum is now live for <strong>${d['businessName']}</strong>. Here's what happens next:</p>
  <ol style="line-height:2">
    <li>Your first morning briefing arrives tomorrow at <strong>8:00am</strong></li>
    <li>Quorum will answer every inbound call and message starting now</li>
    <li>Check your dashboard at <a href="${d['dashboardUrl']}">${d['dashboardUrl']}</a></li>
  </ol>
  <p>Questions? Reply to this email. We're here.</p>
  <p style="color:#888;font-size:12px">— The Quorum Team</p>
</div>`,
  }),

  deal_closed: (d) => ({
    subject: `🎉 Deal closed — $${d['dealValue']}`,
    html: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#04050a;color:#e5e7eb">
  <h2 style="color:#10b981">Deal Closed 🎉</h2>
  <p>${d['leadName']} just became a customer.</p>
  <div style="background:#111827;border-radius:12px;padding:20px;margin:16px 0">
    <p>💰 Deal value: <strong style="color:#10b981">$${d['dealValue']}</strong></p>
    <p>📅 Closed: <strong>${d['closedAt']}</strong></p>
    <p>📞 Channel: <strong>${d['channel']}</strong></p>
    <p>🤖 Closed by: <strong>Quorum</strong></p>
  </div>
  <p style="color:#6b7280;font-size:12px">Quorum — The Deciding Intelligence</p>
</div>`,
  }),

  payment_receipt: (d) => ({
    subject: `Payment confirmed — ${d['businessName']}`,
    html: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#10b981">Payment Confirmed ✓</h2>
  <p>Hi ${d['leadName']},</p>
  <p>We received your payment of <strong>$${d['amount']}</strong> for ${d['description']}.</p>
  <p>Receipt ID: <code>${d['receiptId']}</code></p>
  <p>Questions? Contact us at ${d['businessPhone']}.</p>
  <p style="color:#888;font-size:12px">— ${d['businessName']}</p>
</div>`,
  }),
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalizes a US phone number to E.164 format. */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (phone.startsWith('+')) return phone
  return `+1${digits}`
}

/** Strips HTML tags for plain-text email fallback. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
