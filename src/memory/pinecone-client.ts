import { Pinecone, type Index } from '@pinecone-database/pinecone'
import OpenAI from 'openai'

/** Dimension for text-embedding-3-small. Fixed — do not change after first upsert. */
const EMBEDDING_DIMENSION = 1536
const EMBEDDING_MODEL = 'text-embedding-3-small'

/** Metadata stored alongside each vector in Pinecone. */
export interface InteractionVector {
  leadId: string
  businessId: string
  channel: string
  sentiment: number
  outcome: string
  timestamp: string
  /** Truncated transcript stored in metadata for inspection (max 1000 chars). */
  transcriptSnippet: string
  /** Required by Pinecone RecordMetadata constraint. */
  [key: string]: string | number | boolean
}

let _pinecone: Pinecone | null = null
let _openai: OpenAI | null = null

function getPinecone(): Pinecone {
  if (!_pinecone) {
    const apiKey = process.env['PINECONE_API_KEY']
    if (!apiKey) throw new Error('PINECONE_API_KEY is not set')
    _pinecone = new Pinecone({ apiKey })
  }
  return _pinecone
}

function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env['OPENAI_API_KEY']
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
    _openai = new OpenAI({ apiKey })
  }
  return _openai
}

/**
 * Returns the Pinecone index, creating it if it does not yet exist.
 * Uses the PINECONE_INDEX_NAME env variable (default: "quorum-leads").
 */
async function getIndex(): Promise<Index<InteractionVector>> {
  const pc = getPinecone()
  const indexName = process.env['PINECONE_INDEX_NAME'] ?? 'quorum-leads'

  const { indexes = [] } = await pc.listIndexes()
  const exists = indexes.some((idx) => idx.name === indexName)

  if (!exists) {
    await pc.createIndex({
      name: indexName,
      dimension: EMBEDDING_DIMENSION,
      metric: 'cosine',
      spec: {
        serverless: {
          cloud: 'aws',
          region: process.env['PINECONE_ENVIRONMENT'] ?? 'us-east-1',
        },
      },
      waitUntilReady: true,
    })
  }

  return pc.index<InteractionVector>(indexName)
}

/**
 * Generates a text embedding vector using OpenAI text-embedding-3-small.
 * Used for all Pinecone upserts and queries.
 */
async function embed(text: string): Promise<number[]> {
  const openai = getOpenAI()
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000), // token safety — model limit is ~8k tokens
  })
  const first = response.data[0]
  if (!first) throw new Error('No embedding returned from OpenAI')
  return first.embedding
}

/**
 * Upserts a single interaction vector into Pinecone.
 * Namespace is scoped to businessId so cross-business leakage is impossible.
 *
 * @param interactionId - Unique ID from the Interaction table (used as vector ID)
 * @param transcript    - Full conversation transcript to embed
 * @param metadata      - Structured metadata stored alongside the vector
 */
export async function upsertInteraction(
  interactionId: string,
  transcript: string,
  metadata: InteractionVector,
): Promise<void> {
  const index = await getIndex()
  const vector = await embed(transcript)

  await index.namespace(metadata.businessId).upsert({
    records: [
      {
        id: interactionId,
        values: vector,
        metadata: {
          ...metadata,
          transcriptSnippet: transcript.slice(0, 1000),
        },
      },
    ],
  })
}

/**
 * Upserts a lead profile summary vector (used when a lead is first created
 * or when their profile is significantly updated).
 *
 * @param leadId     - Used as the vector ID (prefixed with "profile_")
 * @param summary    - Text summary of the lead's profile to embed
 * @param metadata   - Metadata with leadId and businessId at minimum
 */
export async function upsertLeadProfile(
  leadId: string,
  summary: string,
  metadata: Pick<InteractionVector, 'leadId' | 'businessId'> & Record<string, string | number>,
): Promise<void> {
  const index = await getIndex()
  const vector = await embed(summary)

  await index.namespace(metadata.businessId).upsert({
    records: [
      {
        id: `profile_${leadId}`,
        values: vector,
        metadata: metadata as unknown as InteractionVector,
      },
    ],
  })
}

/**
 * Semantic similarity search across all interactions for a given business.
 * Returns the top-k most similar past conversations to the query text.
 *
 * @param businessId - Namespace to search within (no cross-business leakage)
 * @param query      - Natural language query (e.g. "lead objected on price, $400K budget")
 * @param topK       - Number of results to return (default: 5)
 */
export async function semanticSearch(
  businessId: string,
  query: string,
  topK: number = 5,
): Promise<Array<{ id: string; score: number; metadata: InteractionVector }>> {
  const index = await getIndex()
  const vector = await embed(query)

  const results = await index.namespace(businessId).query({
    vector,
    topK,
    includeMetadata: true,
  })

  return (results.matches ?? []).map((match) => ({
    id: match.id,
    score: match.score ?? 0,
    metadata: match.metadata as InteractionVector,
  }))
}

/**
 * Deletes all vectors associated with a lead (profile + all interactions).
 * Used only during account deletion — never during normal operation.
 */
export async function deleteLeadVectors(
  leadId: string,
  businessId: string,
  interactionIds: string[],
): Promise<void> {
  const index = await getIndex()
  const idsToDelete = [`profile_${leadId}`, ...interactionIds]
  await index.namespace(businessId).deleteMany(idsToDelete)
}
