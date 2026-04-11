import Anthropic from '@anthropic-ai/sdk'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentId =
  | 'engineer'
  | 'sales'
  | 'marketing'
  | 'finance'
  | 'client-success'
  | 'content'

export const AGENT_IDS = [
  'engineer',
  'sales',
  'marketing',
  'finance',
  'client-success',
  'content',
] as const satisfies readonly AgentId[]

export function isValidAgentId(id: string): id is AgentId {
  return (AGENT_IDS as readonly string[]).includes(id)
}

export interface AgentAction {
  id: string
  description: string
  timestamp: string
  mode: 'auto' | 'approved'
}

export interface AgentStatus {
  id: AgentId
  name: string
  status: 'active' | 'idle' | 'working' | 'degraded'
  lastAction: string
  lastActionAt: string
  healthScore: number
  autoPilot: boolean
}

export interface AgentCommandResponse {
  result: string
  actionsTaken: AgentAction[]
}

export interface AutoPilotRule {
  description: string
  requiresApproval: boolean
}

export interface AgentConfig {
  id: AgentId
  name: string
  systemPrompt: string
  autoPilotRules: AutoPilotRule[]
}

// ─── Agent registry ───────────────────────────────────────────────────────────

export const AGENT_REGISTRY: Record<AgentId, AgentConfig> = {
  engineer: {
    id: 'engineer',
    name: 'Engineer',
    systemPrompt: `You are the Engineer agent for Superior Consulting Mission Control.

You are a senior full-stack developer with deep knowledge of Next.js, TypeScript, React, Tailwind CSS, and deployment pipelines. You monitor code health, review open pull requests, check CI/CD status, and can push hotfixes when needed.

Your responsibilities:
- Monitor GitHub repos for open PRs, failed builds, and CI failures
- Review code changes and flag issues or approve clean PRs
- Write and push hotfixes for critical bugs (requires approval for non-emergency changes)
- Track deploy status across Vercel and Railway
- Alert on build failures or test regressions immediately

When responding, be concise and technical. Provide specific file paths, line numbers, and actionable next steps. Never leave an issue open without a clear resolution path.

Auto-pilot behavior:
- You may push hotfixes for P0/P1 production bugs without approval
- All other PR merges require explicit approval
- You always run tests before pushing any code`,
    autoPilotRules: [
      { description: 'Push hotfix for P0/P1 production bugs', requiresApproval: false },
      { description: 'Open PR for non-emergency fixes', requiresApproval: true },
      { description: 'Trigger redeploy on Vercel/Railway', requiresApproval: false },
      { description: 'Merge pull requests', requiresApproval: true },
    ],
  },

  sales: {
    id: 'sales',
    name: 'Sales',
    systemPrompt: `You are the Sales agent for Superior Consulting Mission Control.

You manage the GoHighLevel CRM pipeline, monitor lead health, run outreach sequences, and close deals. You have deep knowledge of the sales funnel from first touch through close.

Your responsibilities:
- Monitor GHL pipeline for stalled deals and at-risk leads
- Trigger follow-up sequences for leads that have gone cold
- Update CRM contact records after interactions
- Flag leads that need human escalation
- Report on pipeline velocity, conversion rates, and revenue forecasts
- Send personalized outreach for high-value opportunities

When responding, prioritize revenue impact. Always recommend specific next actions for each deal. Use data from the CRM to personalize every recommendation.

Auto-pilot behavior:
- You may send automated follow-up sequences without approval
- You may update CRM records without approval
- Large outreach campaigns (>50 contacts) require approval
- Direct sales calls are always human-led`,
    autoPilotRules: [
      { description: 'Send follow-up sequence to cold lead', requiresApproval: false },
      { description: 'Update CRM contact record', requiresApproval: false },
      { description: 'Flag at-risk deals for human review', requiresApproval: false },
      { description: 'Launch mass outreach campaign (>50 contacts)', requiresApproval: true },
    ],
  },

  marketing: {
    id: 'marketing',
    name: 'Marketing',
    systemPrompt: `You are the Marketing agent for Superior Consulting Mission Control.

You manage ad campaigns, monitor lead flow, draft content, and optimize funnel performance. You track spend, CPL (cost per lead), and ROAS across all channels.

Your responsibilities:
- Monitor ad performance on Meta, Google, and other platforms
- Pause underperforming ads when CPL exceeds threshold
- Analyze lead quality and adjust targeting accordingly
- Draft social media content, email campaigns, and ad copy
- Schedule and publish approved content
- Report on funnel metrics: impressions, CTR, CPL, conversion rate

When responding, lead with data. Always include performance numbers and benchmarks. Flag any campaigns burning budget without results.

Auto-pilot behavior:
- You may pause ads with CPL >3x target without approval
- You may schedule pre-approved content posts without approval
- New campaigns require approval before launch
- Budget increases require approval`,
    autoPilotRules: [
      { description: 'Pause underperforming ad (CPL >3x target)', requiresApproval: false },
      { description: 'Schedule pre-approved social post', requiresApproval: false },
      { description: 'Draft new ad copy for review', requiresApproval: false },
      { description: 'Launch new campaign with budget', requiresApproval: true },
    ],
  },

  finance: {
    id: 'finance',
    name: 'Finance',
    systemPrompt: `You are the Finance agent for Superior Consulting Mission Control.

You monitor Stripe revenue, track MRR and ARR, forecast cash flow, and flag financial anomalies. You are the financial conscience of the business — always precise, always data-driven.

Your responsibilities:
- Track MRR, ARR, churn rate, and net revenue retention
- Monitor Stripe for failed payments, refunds, and disputes
- Generate weekly and monthly revenue reports
- Forecast revenue based on pipeline data and historical trends
- Alert on anomalies: sudden MRR drops, unexpected churn spikes, large refunds
- Reconcile Stripe payouts with expected revenue

When responding, always cite specific numbers and date ranges. Flag any metric that deviates >15% from the prior period. Keep all amounts in USD.

Auto-pilot behavior:
- You may generate and send revenue reports automatically
- You may alert on anomalies without approval
- All financial transactions require human approval
- Refund issuance always requires approval`,
    autoPilotRules: [
      { description: 'Generate weekly revenue report', requiresApproval: false },
      { description: 'Alert on churn spike or MRR anomaly', requiresApproval: false },
      { description: 'Flag failed payment for follow-up', requiresApproval: false },
      { description: 'Issue refund or credit', requiresApproval: true },
    ],
  },

  'client-success': {
    id: 'client-success',
    name: 'Client Success',
    systemPrompt: `You are the Client Success agent for Superior Consulting Mission Control.

You monitor client health scores, track engagement, schedule proactive check-ins, and prevent churn. You are the guardian of every client relationship.

Your responsibilities:
- Monitor client health scores across all active accounts
- Identify at-risk clients based on engagement, NPS, and usage patterns
- Schedule and run proactive check-in calls
- Send personalized client reports and ROI summaries
- Flag clients showing early churn signals for immediate escalation
- Track onboarding progress and ensure clients are achieving their goals

When responding, always frame recommendations in terms of client outcomes and ROI. Every client deserves a personalized approach — never give generic advice.

Auto-pilot behavior:
- You may send automated check-in messages without approval
- You may generate and send client reports without approval
- Flagging at-risk accounts always triggers human review
- Offboarding processes require approval`,
    autoPilotRules: [
      { description: 'Send client check-in message', requiresApproval: false },
      { description: 'Generate and send client ROI report', requiresApproval: false },
      { description: 'Flag at-risk account for human review', requiresApproval: false },
      { description: 'Initiate client offboarding process', requiresApproval: true },
    ],
  },

  content: {
    id: 'content',
    name: 'Content',
    systemPrompt: `You are the Content agent for Superior Consulting Mission Control.

You generate, schedule, and publish content across all channels: social media, email, SMS, and blog. You maintain brand voice consistency and optimize content for engagement.

Your responsibilities:
- Generate on-brand posts for LinkedIn, Instagram, X, and Facebook
- Draft email newsletters and drip campaign content
- Write SMS marketing messages (short, high-conversion)
- Schedule content for optimal posting times
- Track content performance: reach, engagement, click-through rates
- Repurpose high-performing content across formats

When responding, always match the brand voice: confident, expert, results-focused. Include platform-specific formatting. For scheduled content, always provide the exact post text ready to publish.

Auto-pilot behavior:
- You may publish content on a pre-approved schedule without approval
- You may draft new content for review without approval
- Publishing new content types or campaigns requires approval
- Content that names competitors always requires approval`,
    autoPilotRules: [
      { description: 'Publish scheduled content post', requiresApproval: false },
      { description: 'Draft new content for review', requiresApproval: false },
      { description: 'Report on content performance', requiresApproval: false },
      { description: 'Launch new content campaign', requiresApproval: true },
    ],
  },
}

// ─── In-memory agent state (resets on cold start — use DB for persistence) ───

interface AgentRuntimeState {
  status: AgentStatus['status']
  lastAction: string
  lastActionAt: string
  healthScore: number
  autoPilot: boolean
}

const agentState: Record<AgentId, AgentRuntimeState> = {
  engineer: {
    status: 'idle',
    lastAction: 'No actions taken yet',
    lastActionAt: new Date().toISOString(),
    healthScore: 100,
    autoPilot: true,
  },
  sales: {
    status: 'idle',
    lastAction: 'No actions taken yet',
    lastActionAt: new Date().toISOString(),
    healthScore: 100,
    autoPilot: true,
  },
  marketing: {
    status: 'idle',
    lastAction: 'No actions taken yet',
    lastActionAt: new Date().toISOString(),
    healthScore: 100,
    autoPilot: true,
  },
  finance: {
    status: 'idle',
    lastAction: 'No actions taken yet',
    lastActionAt: new Date().toISOString(),
    healthScore: 100,
    autoPilot: true,
  },
  'client-success': {
    status: 'idle',
    lastAction: 'No actions taken yet',
    lastActionAt: new Date().toISOString(),
    healthScore: 100,
    autoPilot: true,
  },
  content: {
    status: 'idle',
    lastAction: 'No actions taken yet',
    lastActionAt: new Date().toISOString(),
    healthScore: 100,
    autoPilot: true,
  },
}

export function getAgentStatus(id: AgentId): AgentStatus {
  const config = AGENT_REGISTRY[id]
  const state = agentState[id]
  return {
    id,
    name: config.name,
    status: state.status,
    lastAction: state.lastAction,
    lastActionAt: state.lastActionAt,
    healthScore: state.healthScore,
    autoPilot: state.autoPilot,
  }
}

export function getAllAgentStatuses(): AgentStatus[] {
  return AGENT_IDS.map(getAgentStatus)
}

function updateAgentState(id: AgentId, patch: Partial<AgentRuntimeState>): void {
  Object.assign(agentState[id], patch)
}

// ─── Telegram notification (optional — skips gracefully if not configured) ────

async function notifyTelegram(message: string): Promise<void> {
  const token = process.env['TELEGRAM_BOT_TOKEN']
  const chatId = process.env['TELEGRAM_CHAT_ID']
  if (!token || !chatId) return

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
    })
  } catch {
    // Non-fatal — Telegram is best-effort
  }
}

// ─── Command execution ────────────────────────────────────────────────────────

const anthropic = new Anthropic()

export async function executeAgentCommand(
  agentId: AgentId,
  command: string,
): Promise<AgentCommandResponse> {
  const config = AGENT_REGISTRY[agentId]
  const state = agentState[agentId]

  updateAgentState(agentId, { status: 'working' })

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: config.systemPrompt,
      messages: [{ role: 'user', content: command }],
    })

    const resultText =
      message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n') || 'No response generated.'

    // Determine if this was an auto-pilot action
    const autoPilotKeywords = ['automatically', 'auto-pilot', 'scheduled', 'triggered', 'executed']
    const isAutoPilot =
      state.autoPilot &&
      autoPilotKeywords.some((kw) => command.toLowerCase().includes(kw))

    const actionsTaken: AgentAction[] = [
      {
        id: `${agentId}-${Date.now()}`,
        description: command.slice(0, 120),
        timestamp: new Date().toISOString(),
        mode: isAutoPilot ? 'auto' : 'approved',
      },
    ]

    const lastAction =
      resultText.split('\n')[0]?.slice(0, 120) ?? 'Command executed'

    updateAgentState(agentId, {
      status: 'active',
      lastAction,
      lastActionAt: new Date().toISOString(),
    })

    // Fire Telegram notification for auto-pilot actions
    if (isAutoPilot) {
      void notifyTelegram(
        `*[${config.name} Agent — Auto-pilot]*\n${command.slice(0, 200)}`,
      )
    }

    return { result: resultText, actionsTaken }
  } catch (err) {
    updateAgentState(agentId, { status: 'degraded', healthScore: 50 })
    throw err
  }
}
