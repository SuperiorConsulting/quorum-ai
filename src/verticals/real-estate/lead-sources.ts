import { prisma } from '../../lib/prisma.js'
import { relationshipMemory } from '../../memory/relationship-memory.js'
import { reAgent } from './re-agent.js'
import { notifyLeadNew } from '../../lib/n8n-client.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type RELeadSource =
  | 'zillow'
  | 'realtor_com'
  | 'facebook_ads'
  | 'google_ads'
  | 'web_form'
  | 'manual'
  | 'referral'

export interface InboundRELead {
  source: RELeadSource
  name: string
  phone?: string
  email?: string
  /** Property the lead inquired about, if source is listing-based */
  propertyAddress?: string
  propertyPrice?: number
  /** Raw message or inquiry text */
  message?: string
  /** Source-specific metadata */
  metadata?: Record<string, unknown>
}

export interface ProcessedLead {
  leadId: string
  isNew: boolean
  source: RELeadSource
  /** Whether Quorum's 3-second response window was met */
  respondedWithin3s: boolean
}

// ─── Lead intake handler ──────────────────────────────────────────────────────

/**
 * Primary entry point for all real estate lead sources.
 * Processes an inbound lead in under 3 seconds — the critical window
 * where most leads decide whether to engage.
 *
 * Flow:
 * 1. Resolve or create lead in DB
 * 2. Initialize relationship memory
 * 3. Create RealEstateLead record with property context
 * 4. Trigger Quorum's first outreach via best available channel
 * 5. Log timing — 3-second SLA is non-negotiable
 *
 * @param businessId - Business receiving the lead
 * @param lead       - Inbound lead data from the source
 */
export async function processInboundRELead(
  businessId: string,
  lead: InboundRELead,
): Promise<ProcessedLead> {
  const startTime = Date.now()

  // Step 1: Resolve or create lead
  const existing = await prisma.lead.findFirst({
    where: {
      businessId,
      OR: [
        lead.phone ? { phone: lead.phone } : {},
        lead.email ? { email: lead.email } : {},
      ].filter((c) => Object.keys(c).length > 0),
    },
    select: { id: true },
  })

  const isNew = !existing
  let leadId: string

  if (existing) {
    leadId = existing.id
    // Update last interaction for returning lead
    await prisma.lead.update({
      where: { id: leadId },
      data: { lastInteractionAt: new Date() },
    })
  } else {
    const newLead = await prisma.lead.create({
      data: {
        businessId,
        name: lead.name,
        phone: lead.phone ?? null,
        email: lead.email ?? null,
        channel: 'SMS',
        source: lead.source,
        vertical: 'REAL_ESTATE',
        pipelineStage: 'NEW',
        score: 15,
        dealValue: lead.propertyPrice ? lead.propertyPrice * 0.03 : null, // ~3% commission estimate
      },
    })
    leadId = newLead.id
  }

  // Step 2: Initialize memory with source context
  const memoryData: Record<string, unknown> = {
    lead_source: lead.source,
    first_inquiry: new Date().toISOString(),
  }
  if (lead.propertyAddress) memoryData['inquired_property'] = lead.propertyAddress
  if (lead.propertyPrice) memoryData['property_price_range'] = `$${lead.propertyPrice.toLocaleString()}`
  if (lead.message) memoryData['initial_inquiry'] = lead.message.slice(0, 200)

  await relationshipMemory.upsertLead(leadId, memoryData)

  // Step 3: Initialize RealEstateLead record
  const existingRE = await prisma.realEstateLead.findUnique({ where: { leadId } })
  if (!existingRE) {
    // Infer type from source and message
    const inferredType = inferLeadType(lead)
    await reAgent.updateQualification(leadId, {
      type: inferredType,
      budget: lead.propertyPrice ? Math.round(lead.propertyPrice * 1.1) : undefined,
    })
  }

  // Step 4: Trigger Quorum's first outreach
  // Phase 7 will wire the actual send — for now log and mark timing
  const firstMessage = buildInitialOutreach(lead)
  const channel = lead.phone ? 'SMS' : lead.email ? 'EMAIL' : 'VOICE'

  console.log(`[RE Lead Sources] New ${lead.source} lead: ${lead.name} | Channel: ${channel}`)
  console.log(`[RE Lead Sources] First outreach: ${firstMessage.slice(0, 100)}`)
  // Phase 7: await sendSMS(lead.phone, firstMessage) or sendEmail(lead.email, ...)

  const respondedWithin3s = (Date.now() - startTime) < 3000
  console.log(`[RE Lead Sources] Response time: ${Date.now() - startTime}ms | Within 3s: ${respondedWithin3s}`)

  // Notify n8n — triggers CRM intake, ad platform sync, and agent routing workflows
  if (isNew) {
    notifyLeadNew({
      leadId,
      businessId,
      leadName: lead.name,
      phone: lead.phone,
      email: lead.email,
      vertical: 'REAL_ESTATE',
      source: lead.source,
      score: 15,
    })
  }

  return { leadId, isNew, source: lead.source, respondedWithin3s }
}

// ─── Source-specific webhook handlers ─────────────────────────────────────────

/**
 * Handles Zillow Premier Agent lead webhooks.
 * Zillow sends leads as a POST with their proprietary format.
 */
export function parseZillowWebhook(body: Record<string, unknown>): InboundRELead {
  const contact = body['contact'] as Record<string, unknown> | undefined
  const listing = body['listing'] as Record<string, unknown> | undefined

  return {
    source: 'zillow',
    name: String(contact?.['displayName'] ?? contact?.['name'] ?? 'Unknown'),
    phone: contact?.['phone'] ? String(contact['phone']) : undefined,
    email: contact?.['email'] ? String(contact['email']) : undefined,
    propertyAddress: listing?.['address'] ? String(listing['address']) : undefined,
    propertyPrice: listing?.['price'] ? Number(listing['price']) : undefined,
    message: contact?.['message'] ? String(contact['message']) : undefined,
    metadata: body,
  }
}

/**
 * Handles Realtor.com lead webhooks.
 */
export function parseRealtorComWebhook(body: Record<string, unknown>): InboundRELead {
  const lead = body['lead'] as Record<string, unknown> | undefined
  const property = body['property'] as Record<string, unknown> | undefined

  return {
    source: 'realtor_com',
    name: `${lead?.['first_name'] ?? ''} ${lead?.['last_name'] ?? ''}`.trim() || 'Unknown',
    phone: lead?.['phone'] ? String(lead['phone']) : undefined,
    email: lead?.['email'] ? String(lead['email']) : undefined,
    propertyAddress: property?.['address'] ? String(property['address']) : undefined,
    propertyPrice: property?.['list_price'] ? Number(property['list_price']) : undefined,
    message: lead?.['comments'] ? String(lead['comments']) : undefined,
    metadata: body,
  }
}

/**
 * Handles generic web form submissions.
 * Expects standard fields: name, phone, email, message, property_address, property_price.
 */
export function parseWebFormWebhook(body: Record<string, unknown>): InboundRELead {
  return {
    source: (body['source'] as RELeadSource) ?? 'web_form',
    name: String(body['name'] ?? 'Unknown'),
    phone: body['phone'] ? String(body['phone']) : undefined,
    email: body['email'] ? String(body['email']) : undefined,
    propertyAddress: body['property_address'] ? String(body['property_address']) : undefined,
    propertyPrice: body['property_price'] ? Number(body['property_price']) : undefined,
    message: body['message'] ? String(body['message']) : undefined,
    metadata: body,
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function inferLeadType(lead: InboundRELead): 'BUYER' | 'SELLER' | 'INVESTOR' | 'RENTER' {
  const text = [lead.message ?? '', JSON.stringify(lead.metadata ?? {})].join(' ').toLowerCase()
  if (text.includes('sell') || text.includes('list')) return 'SELLER'
  if (text.includes('invest') || text.includes('rental') || text.includes('flip')) return 'INVESTOR'
  if (text.includes('rent') || text.includes('lease')) return 'RENTER'
  return 'BUYER'
}

function buildInitialOutreach(lead: InboundRELead): string {
  const firstName = lead.name.split(' ')[0] ?? 'there'
  const property = lead.propertyAddress

  if (lead.source === 'zillow' && property) {
    return `Hey ${firstName}! Thanks for your interest in ${property}. I'd love to tell you more about it and help you find the right fit. What questions do you have?`
  }

  if (lead.source === 'realtor_com' && property) {
    return `Hi ${firstName}, saw your inquiry on ${property}. Great taste — want to set up a showing this week?`
  }

  return `Hey ${firstName}, thanks for reaching out! I'm Quorum, and I'm here to help you find exactly what you're looking for. What are you working with — buying, selling, or investing?`
}
