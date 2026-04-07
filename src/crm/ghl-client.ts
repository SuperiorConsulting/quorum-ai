import { prisma } from '../lib/prisma.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GHLContact {
  id: string
  firstName: string
  lastName: string
  phone?: string
  email?: string
  tags?: string[]
  customFields?: Record<string, string>
}

export interface GHLOpportunity {
  id: string
  name: string
  pipelineId: string
  pipelineStageId: string
  status: 'open' | 'won' | 'lost' | 'abandoned'
  monetaryValue?: number
  contactId: string
}

export interface GHLSyncResult {
  contactId: string
  opportunityId?: string
  action: 'created' | 'updated' | 'skipped'
}

// ─── Stage mapping ─────────────────────────────────────────────────────────────

/** Maps Quorum pipeline stages to GHL stage names (business configures exact IDs in env) */
const STAGE_LABEL_MAP: Record<string, string> = {
  NEW:          'New Lead',
  CONTACTED:    'Contacted',
  QUALIFIED:    'Qualified',
  PROPOSAL:     'Proposal Sent',
  NEGOTIATING:  'Negotiating',
  CLOSED_WON:   'Closed Won',
  CLOSED_LOST:  'Closed Lost',
}

// ─── GHL API client ───────────────────────────────────────────────────────────

function ghlHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  }
}

function getApiKey(): string | null {
  return process.env['GHL_API_KEY'] ?? null
}

function getLocationId(): string | null {
  return process.env['GHL_LOCATION_ID'] ?? null
}

async function ghlFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('GHL_API_KEY not set')

  const url = `https://services.leadconnectorhq.com${path}`
  return fetch(url, {
    ...options,
    headers: {
      ...ghlHeaders(apiKey),
      ...(options.headers ?? {}),
    },
  })
}

// ─── Contact operations ───────────────────────────────────────────────────────

/**
 * Creates a new contact in GHL.
 *
 * @param contact - Contact data to create
 */
export async function createContact(
  contact: Omit<GHLContact, 'id'>,
): Promise<string | null> {
  if (!getApiKey()) {
    console.log('[GHL] No API key — skipping createContact')
    return null
  }

  const locationId = getLocationId()
  if (!locationId) {
    console.warn('[GHL] GHL_LOCATION_ID not set — skipping createContact')
    return null
  }

  try {
    const res = await ghlFetch('/contacts/', {
      method: 'POST',
      body: JSON.stringify({
        locationId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email,
        tags: contact.tags ?? [],
        customFields: buildCustomFieldsArray(contact.customFields ?? {}),
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`[GHL] createContact failed ${res.status}: ${text.slice(0, 200)}`)
      return null
    }

    const data = await res.json() as { contact?: { id?: string } }
    const contactId = data?.contact?.id ?? null
    console.log(`[GHL] Contact created: ${contactId}`)
    return contactId
  } catch (err) {
    console.error('[GHL] createContact error:', err)
    return null
  }
}

/**
 * Updates an existing GHL contact.
 *
 * @param ghlContactId - GHL contact ID
 * @param updates      - Fields to update
 */
export async function updateContact(
  ghlContactId: string,
  updates: Partial<Omit<GHLContact, 'id'>>,
): Promise<boolean> {
  if (!getApiKey()) {
    console.log('[GHL] No API key — skipping updateContact')
    return false
  }

  try {
    const body: Record<string, unknown> = {}
    if (updates.firstName)    body['firstName'] = updates.firstName
    if (updates.lastName)     body['lastName'] = updates.lastName
    if (updates.phone)        body['phone'] = updates.phone
    if (updates.email)        body['email'] = updates.email
    if (updates.tags)         body['tags'] = updates.tags
    if (updates.customFields) body['customFields'] = buildCustomFieldsArray(updates.customFields)

    const res = await ghlFetch(`/contacts/${ghlContactId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      console.error(`[GHL] updateContact failed ${res.status}`)
      return false
    }

    return true
  } catch (err) {
    console.error('[GHL] updateContact error:', err)
    return false
  }
}

/**
 * Looks up a GHL contact by phone or email.
 *
 * @param phone - Phone number to search
 * @param email - Email to search
 */
export async function findContact(
  phone?: string,
  email?: string,
): Promise<string | null> {
  if (!getApiKey()) return null

  const locationId = getLocationId()
  if (!locationId) return null

  try {
    const query = phone ?? email ?? ''
    const res = await ghlFetch(
      `/contacts/?locationId=${locationId}&query=${encodeURIComponent(query)}&limit=1`,
    )

    if (!res.ok) return null

    const data = await res.json() as { contacts?: Array<{ id?: string }> }
    return data?.contacts?.[0]?.id ?? null
  } catch {
    return null
  }
}

// ─── Tag operations ───────────────────────────────────────────────────────────

/**
 * Adds tags to a GHL contact.
 *
 * @param ghlContactId - GHL contact ID
 * @param tags         - Tags to add
 */
export async function addTags(ghlContactId: string, tags: string[]): Promise<boolean> {
  if (!getApiKey() || tags.length === 0) return false

  try {
    const res = await ghlFetch(`/contacts/${ghlContactId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tags }),
    })

    return res.ok
  } catch (err) {
    console.error('[GHL] addTags error:', err)
    return false
  }
}

// ─── Pipeline / opportunity operations ───────────────────────────────────────

/**
 * Moves a contact to a specific pipeline stage.
 * Creates opportunity if it doesn't exist.
 *
 * @param ghlContactId  - GHL contact ID
 * @param stage         - Quorum pipeline stage
 * @param monetaryValue - Deal value
 * @param leadName      - Lead name for opportunity title
 */
export async function moveToStage(
  ghlContactId: string,
  stage: string,
  monetaryValue?: number,
  leadName?: string,
): Promise<boolean> {
  if (!getApiKey()) {
    console.log('[GHL] No API key — skipping moveToStage')
    return false
  }

  const pipelineId = process.env['GHL_PIPELINE_ID']
  const stageId = process.env[`GHL_STAGE_${stage.toUpperCase()}`]

  if (!pipelineId || !stageId) {
    console.warn(`[GHL] Missing GHL_PIPELINE_ID or GHL_STAGE_${stage} env var`)
    return false
  }

  try {
    // Try to find existing opportunity
    const searchRes = await ghlFetch(
      `/opportunities/search?location_id=${getLocationId()}&contact_id=${ghlContactId}&limit=1`,
    )

    let opportunityId: string | null = null
    if (searchRes.ok) {
      const data = await searchRes.json() as { opportunities?: Array<{ id?: string }> }
      opportunityId = data?.opportunities?.[0]?.id ?? null
    }

    const oppBody: Record<string, unknown> = {
      pipelineId,
      pipelineStageId: stageId,
      status: stage === 'CLOSED_WON' ? 'won' : stage === 'CLOSED_LOST' ? 'lost' : 'open',
    }
    if (monetaryValue) oppBody['monetaryValue'] = monetaryValue
    if (leadName) oppBody['name'] = `${leadName} — Quorum`

    if (opportunityId) {
      const res = await ghlFetch(`/opportunities/${opportunityId}`, {
        method: 'PUT',
        body: JSON.stringify(oppBody),
      })
      return res.ok
    } else {
      // Create new opportunity
      oppBody['contactId'] = ghlContactId
      oppBody['locationId'] = getLocationId() ?? ''
      oppBody['name'] = oppBody['name'] ?? `Lead — Quorum`

      const res = await ghlFetch('/opportunities/', {
        method: 'POST',
        body: JSON.stringify(oppBody),
      })
      return res.ok
    }
  } catch (err) {
    console.error('[GHL] moveToStage error:', err)
    return false
  }
}

// ─── Activity / notes ─────────────────────────────────────────────────────────

/**
 * Logs an activity note to a GHL contact.
 *
 * @param ghlContactId - GHL contact ID
 * @param body         - Note content
 * @param type         - Note type
 */
export async function logActivity(
  ghlContactId: string,
  body: string,
  type: 'Call' | 'SMS' | 'Email' | 'Note' = 'Note',
): Promise<boolean> {
  if (!getApiKey()) {
    console.log(`[GHL] logActivity skipped (no key): ${type} — ${body.slice(0, 80)}`)
    return false
  }

  try {
    const res = await ghlFetch(`/contacts/${ghlContactId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body: `[${type}] ${body}` }),
    })

    return res.ok
  } catch (err) {
    console.error('[GHL] logActivity error:', err)
    return false
  }
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

/**
 * Creates a follow-up task in GHL.
 *
 * @param ghlContactId - GHL contact ID
 * @param title        - Task title
 * @param dueDate      - When task is due
 * @param assignedTo   - User ID to assign to
 */
export async function createTask(
  ghlContactId: string,
  title: string,
  dueDate: Date,
  assignedTo?: string,
): Promise<boolean> {
  if (!getApiKey()) {
    console.log(`[GHL] createTask skipped: ${title}`)
    return false
  }

  try {
    const body: Record<string, unknown> = {
      title,
      dueDate: dueDate.toISOString(),
      contactId: ghlContactId,
      completed: false,
    }
    if (assignedTo) body['assignedTo'] = assignedTo

    const res = await ghlFetch(`/contacts/${ghlContactId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(body),
    })

    return res.ok
  } catch (err) {
    console.error('[GHL] createTask error:', err)
    return false
  }
}

// ─── Workflow triggers ────────────────────────────────────────────────────────

/**
 * Triggers a GHL workflow for a contact.
 *
 * @param ghlContactId - GHL contact ID
 * @param workflowId   - GHL workflow ID
 */
export async function triggerWorkflow(
  ghlContactId: string,
  workflowId: string,
): Promise<boolean> {
  if (!getApiKey()) {
    console.log(`[GHL] triggerWorkflow skipped: ${workflowId}`)
    return false
  }

  try {
    const res = await ghlFetch(`/contacts/${ghlContactId}/workflow/${workflowId}`, {
      method: 'POST',
      body: JSON.stringify({}),
    })

    if (!res.ok) {
      console.warn(`[GHL] triggerWorkflow ${workflowId} failed: ${res.status}`)
    }

    return res.ok
  } catch (err) {
    console.error('[GHL] triggerWorkflow error:', err)
    return false
  }
}

// ─── Full sync ────────────────────────────────────────────────────────────────

/**
 * Full sync: finds or creates a GHL contact for a Quorum lead,
 * then updates pipeline stage and logs the interaction.
 * Called fire-and-forget from processInbound.
 *
 * @param leadId  - Quorum lead ID
 * @param message - Last message for activity log
 */
export async function syncLeadToGHL(leadId: string, message: string): Promise<GHLSyncResult | null> {
  if (!getApiKey()) return null

  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        score: true,
        pipelineStage: true,
        dealValue: true,
        vertical: true,
        ghlContactId: true,
      },
    })

    if (!lead) return null

    const [firstName = '', ...lastParts] = lead.name.split(' ')
    const lastName = lastParts.join(' ')

    let ghlContactId = lead.ghlContactId

    // Find or create contact
    if (!ghlContactId) {
      ghlContactId = await findContact(lead.phone ?? undefined, lead.email ?? undefined)

      if (!ghlContactId) {
        const tags = buildVerticalTags(lead.vertical ?? 'OTHER', lead.score ?? 0)
        ghlContactId = await createContact({
          firstName,
          lastName,
          phone: lead.phone ?? undefined,
          email: lead.email ?? undefined,
          tags,
          customFields: {
            quorum_lead_id: lead.id,
            lead_score: String(lead.score ?? 0),
          },
        })
      }

      if (ghlContactId) {
        await prisma.lead.update({
          where: { id: leadId },
          data: { ghlContactId },
        })
      }
    }

    if (!ghlContactId) return { contactId: '', action: 'skipped' }
    const resolvedContactId: string = ghlContactId

    // Update stage
    await moveToStage(
      resolvedContactId,
      lead.pipelineStage,
      lead.dealValue ?? undefined,
      lead.name,
    )

    // Log activity
    await logActivity(
      resolvedContactId,
      `Quorum AI conversation — ${message.slice(0, 200)}`,
      'Note',
    )

    const action = lead.ghlContactId ? 'updated' : 'created'
    console.log(`[GHL] Sync complete for lead ${leadId}: ${action}`)

    return { contactId: resolvedContactId, action }
  } catch (err) {
    console.error('[GHL] syncLeadToGHL error:', err)
    return null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildCustomFieldsArray(fields: Record<string, string>): Array<{ key: string; field_value: string }> {
  return Object.entries(fields).map(([key, field_value]) => ({ key, field_value }))
}

function buildVerticalTags(vertical: string, score: number): string[] {
  const tags = [`quorum`, `vertical:${vertical.toLowerCase().replace('_', '-')}`]
  if (score >= 80) tags.push('hot-lead')
  else if (score >= 50) tags.push('warm-lead')
  else tags.push('cold-lead')
  return tags
}

/** Stage label for display purposes */
export function stageLabel(stage: string): string {
  return STAGE_LABEL_MAP[stage] ?? stage
}
