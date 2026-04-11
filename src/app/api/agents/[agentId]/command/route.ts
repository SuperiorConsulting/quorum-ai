import { NextRequest, NextResponse } from 'next/server'
import { isValidAgentId, executeAgentCommand } from '../../../../../agents/registry.js'

/**
 * POST /api/agents/[agentId]/command
 *
 * Receives a command string, routes it to the correct agent brain,
 * executes auto-pilot actions where permitted, and returns
 * { result: string, actionsTaken: Action[] }.
 *
 * Authenticated via ATLAS_API_KEY header.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<NextResponse> {
  // ─── Auth ─────────────────────────────────────────────────────────────────
  const apiKey = process.env['ATLAS_API_KEY']
  if (apiKey) {
    const incoming =
      req.headers.get('x-atlas-api-key') ?? req.headers.get('authorization')?.replace('Bearer ', '')
    if (incoming !== apiKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // ─── Agent ID validation ──────────────────────────────────────────────────
  const { agentId } = await params
  if (!isValidAgentId(agentId)) {
    return NextResponse.json(
      { error: `Unknown agent: ${agentId}` },
      { status: 404 },
    )
  }

  // ─── Body parsing ─────────────────────────────────────────────────────────
  let command: string
  try {
    const body = (await req.json()) as unknown
    if (
      typeof body !== 'object' ||
      body === null ||
      !('command' in body) ||
      typeof (body as { command: unknown }).command !== 'string'
    ) {
      return NextResponse.json(
        { error: 'Request body must be { command: string }' },
        { status: 400 },
      )
    }
    command = (body as { command: string }).command.trim()
    if (!command) {
      return NextResponse.json({ error: 'command must not be empty' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ─── Execute ──────────────────────────────────────────────────────────────
  try {
    const response = await executeAgentCommand(agentId, command)
    return NextResponse.json(response, { status: 200 })
  } catch (err) {
    console.error(`[Agents/${agentId}/Command] Execution failed:`, err)
    return NextResponse.json(
      { error: 'Agent execution failed. Check Atlas logs.' },
      { status: 500 },
    )
  }
}
