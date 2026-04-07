import MemoryClient from 'mem0ai'

/** Structured fact stored in Mem0 for a lead. */
export interface LeadFact {
  role: 'user' | 'assistant'
  content: string
}

/** Result from a Mem0 memory search. */
export interface Mem0SearchResult {
  id: string
  memory: string
  score: number
}

/** Full memory entry returned by Mem0 getAll. */
export interface Mem0Memory {
  id: string
  memory: string
  created_at: string
  updated_at: string
}

let _client: MemoryClient | null = null

function getClient(): MemoryClient {
  if (!_client) {
    const apiKey = process.env['MEM0_API_KEY']
    if (!apiKey) throw new Error('MEM0_API_KEY is not set')
    _client = new MemoryClient({ apiKey })
  }
  return _client
}

/** Converts a leadId into a Mem0 user_id namespace. */
function userId(leadId: string): string {
  return `lead_${leadId}`
}

/**
 * Adds one or more facts/messages to a lead's Mem0 memory.
 * Mem0 automatically extracts structured facts from conversational messages.
 *
 * @param leadId   - The lead whose memory to update
 * @param messages - Conversation messages or structured facts to store
 */
export async function addToMem0(leadId: string, messages: LeadFact[]): Promise<void> {
  const client = getClient()
  await client.add(messages, { user_id: userId(leadId) })
}

/**
 * Retrieves all stored memories for a lead.
 * Returns chronologically ordered facts extracted from every past interaction.
 *
 * @param leadId - The lead to retrieve memories for
 */
export async function getAllMemories(leadId: string): Promise<Mem0Memory[]> {
  const client = getClient()
  const result = await client.getAll({ user_id: userId(leadId) })
  return (result as unknown as Mem0Memory[]) ?? []
}

/**
 * Searches a lead's memories for facts related to a query.
 * Used to surface relevant context before generating a sales response.
 *
 * @param leadId - The lead to search memories for
 * @param query  - What to look for (e.g. "budget", "timeline", "objections")
 * @param limit  - Max results to return (default: 10)
 */
export async function searchMemories(
  leadId: string,
  query: string,
  limit: number = 10,
): Promise<Mem0SearchResult[]> {
  const client = getClient()
  const results = await client.search(query, {
    user_id: userId(leadId),
    limit,
  })
  return (results as Mem0SearchResult[]) ?? []
}

/**
 * Deletes all Mem0 memories for a lead.
 * Used only during account deletion — never during normal operation.
 *
 * @param leadId - The lead whose memories to purge
 */
export async function deleteAllMemories(leadId: string): Promise<void> {
  const client = getClient()
  const memories = await getAllMemories(leadId)
  await Promise.allSettled(
    memories.map((m) => client.delete(m.id))
  )
}
