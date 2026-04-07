# Quorum AI Sales Intelligence — Architecture Specification
**The Deciding Intelligence · 24/7 Autonomous · Relationship-First**

_Approved: 2026-04-06_

---

## 1. System Architecture & Data Flow

### The Spine

Every lead interaction flows through this exact pipeline, in this exact order:

```
Inbound (Voice / SMS / Email / Web)
        ↓
  Channel Adapters
    - Vapi webhook      → /api/voice
    - Twilio inbound    → /api/sms
    - SendGrid inbound  → /api/email
        ↓
  Lead Resolution
    - Phone/email lookup against Lead table
    - Create new Lead record if not found
        ↓
  RelationshipMemory.getMemory(leadId)
    - Pinecone: semantic similarity context
    - Mem0: structured profile (budget, timeline, preferences, sentiment)
    - PostgreSQL: full interaction history, pipeline stage
        ↓
  Quorum Agent Brain
    - Claude claude-sonnet-4-6 with full memory context injected
    - 11 registered tools available
    - Closing Engine selects strategy: SPIN / Challenger / MEDDIC
        ↓
  Action Executor
    - respond_only | book_appointment | send_payment_link
    - trigger_followup | escalate_to_human
        ↓
  Post-Response Pipeline (strict execution order — see §1.2)
```

### 1.1 Memory Architecture

Three layers. All three written on every interaction. Never just one.

| Layer | Service | What it stores |
|---|---|---|
| Vector | Pinecone | Conversation embeddings — enables semantic similarity search |
| Structured | Mem0 | Typed facts: budget, timeline, family, sentiment history, objections |
| Relational | PostgreSQL (Prisma) | System of record: leads, interactions, appointments, pipeline |

**Semantic search use case:** "Find me other leads who objected on price in the real estate vertical with a $400K budget" — this is a Pinecone query, not a SQL query.

### 1.2 Post-Response Pipeline (non-negotiable execution order)

```
1. Send response to lead     ← await  (lead gets reply immediately)
2. addInteraction()          ← await  (memory written before next message arrives)
3. GHL sync                  ← fire-and-forget (Promise, no await — CRM lag acceptable)
4. Socket.io push            ← fire-and-forget (emit, no await — dashboard lag acceptable)
```

Memory staleness before the next inbound message is not acceptable.
CRM and dashboard latency are acceptable.

### 1.3 Multi-Tenancy Boundary

- Every database query scoped by `businessId` — no exceptions
- Session payload: `{ userId, businessId, plan, setupPaid, isActive }`
- Public webhook routes (`/api/voice`, `/api/sms`, `/api/webhook/*`) authenticate via:
  - Phone number match against Business record
  - Secret header (`X-Quorum-Secret`) validated against env variable
  - No session cookie required on inbound webhooks

---

## 2. Integration Boundaries

### 2.1 Service Map

| Layer | Service | Direction | Pattern |
|---|---|---|---|
| Voice | Vapi | Webhook in, REST out | Async handler |
| SMS | Twilio | Webhook in, REST out | Async handler |
| Email | SendGrid | Webhook in, SDK out | Async handler |
| Vectors | Pinecone | SDK bidirectional | upsert + query |
| Structured memory | Mem0 | SDK bidirectional | add + search |
| CRM | GoHighLevel v2 | REST out only | Fire-and-forget |
| Calendar | Google Calendar | OAuth + REST | Async, awaited |
| Payments | Stripe | SDK out + webhook in | Standard pattern |
| Voice synthesis | ElevenLabs | REST out | TTS on every Quorum utterance |
| Automation | n8n cloud | Webhook out + webhook in | See §2.2 |
| Realtime | Socket.io | Server emits, client subscribes | Push only |

### 2.2 n8n Relationship (explicit — also in CLAUDE.md rule 9)

Quorum fires outbound webhooks **to** n8n to trigger workflows.
n8n calls back **to** Quorum via `/api/webhook/*` endpoints.
**Quorum never polls n8n. Quorum is the brain. n8n is the scheduler and router.**

```
Quorum → POST to n8n webhook URL    (trigger: deal closed, lead intake, etc.)
n8n    → POST /api/webhook/*        (callback: sequence step due, reminder fire, etc.)
```

n8n workflows live as JSON files in `/src/automation/n8n-workflows/`.
They are imported into n8n manually or via n8n API during setup.

---

## 3. Error Handling, Testing & Deployment

### 3.1 API Response Contract

Every API route returns this shape — no exceptions:

```ts
type QuorumResponse<T> = {
  success: boolean
  data?: T
  error?: string
  meta?: Record<string, unknown>
}
```

### 3.2 Memory Failure Retry Contract

Memory failures are **non-fatal for the lead response** — the lead always gets a reply.
But nothing is permanently lost.

**Pinecone write failure:**
1. Retry once after 500ms
2. If retry fails: write raw interaction data to `FailedMemoryWrite` table, log error, continue
3. Never block the lead response

**Mem0 write failure:**
1. Retry once after 500ms
2. If retry fails: write raw interaction data to `FailedMemoryWrite` table, log error, continue
3. Never block the lead response

**Recovery:**
A background job runs every hour (Railway worker) that reads unresolved `FailedMemoryWrite` records and attempts to replay them into Pinecone and Mem0. On success: marks `resolved = true`. On continued failure: increments `attemptCount`, leaves `resolved = false` for manual review.

**FailedMemoryWrite schema** (added to Prisma in Phase 2):
```
FailedMemoryWrite {
  id              String    @id @default(cuid())
  leadId          String
  businessId      String
  interactionData Json
  failureReason   String
  attemptCount    Int       @default(1)
  resolved        Boolean   @default(false)
  createdAt       DateTime  @default(now())
}
```

### 3.3 Testing Strategy

| Scope | Tool | What is covered |
|---|---|---|
| Unit | Jest | `RelationshipMemory`, `ClosingEngine` — highest-stakes pure logic |
| Integration | Jest + fixtures | Vapi and Twilio webhook handlers (request fixtures, no live calls) |
| UI | None | Dashboard is event-driven; Socket.io event shape is the contract |
| Manual E2E | Seed script | `/scripts/seed.ts` creates demo business + 10 leads across all stages |

### 3.4 Deployment Architecture

#### Vercel (Next.js app)
- All pages and UI (`/src/app/**`)
- All API routes **except** cron-dependent ones
- Static assets and public routes
- Serverless — no persistent process

#### Railway (two processes)

**Process 1: PostgreSQL database**
- Managed Railway Postgres addon
- Connection string in `DATABASE_URL`

**Process 2: Node.js worker (`/src/worker/index.ts`)**
- Lightweight standalone process — does **not** serve HTTP
- Imports and runs all scheduled tasks:
  - Morning briefing cron: `'0 8 * * *'`
  - Follow-up sequence cron: every 30 minutes (`'*/30 * * * *'`)
  - Win-back campaign cron: daily (`'0 9 * * *'`)
  - Appointment reminder scheduler: every 15 minutes (`'*/15 * * * *'`)
  - Failed memory write replay: every hour (`'0 * * * *'`)
- Communicates with the database directly via Prisma
- Calls internal Quorum API routes (Vercel URL) for actions that require agent logic
- Entry point: `/src/worker/index.ts`
- Railway `Procfile` or `railway.toml` starts it as a separate service

**Why this split:** Vercel is serverless — functions terminate after response. `node-cron` requires a persistent process. The worker on Railway is that persistent process. Vercel handles all user-facing traffic; Railway handles all time-based work.

---

## 4. Build Phase Order

Phases are executed strictly in order. Each phase must run without errors before the next begins.

| Phase | Scope |
|---|---|
| 1 | Project bootstrap — Next.js scaffold, packages, folder structure, env template |
| 2 | Database schema — Prisma models, migration |
| 3 | Relationship memory engine — Pinecone + Mem0 + learning engine |
| 4 | Quorum agent brain — Claude tool use, closing engine, objection handler |
| 5 | Voice system — Vapi extension, ElevenLabs voice cloning |
| 6 | Vertical modules — Real estate + home services |
| 7 | CRM + Calendar + Payments — GHL, Google Calendar, Stripe |
| 8 | Morning briefing system — node-cron, voice delivery, SMS summary |
| 9 | n8n workflow automation — 6 workflow JSON files |
| 10 | Quorum HUD dashboard — three-panel UI, Socket.io, Framer Motion |
| 11 | Pricing page + Stripe checkout — public sales page, ROI calculator |
| 12 | Onboarding flow — 8-step post-purchase wizard |
| 13 | Win-back + review harvesting — 5-step reactivation, review engine |
| 14 | Authentication + multi-tenancy — NextAuth, role-based access |
| 15 | Deployment + scripts — vercel.json, railway.toml, Dockerfile, seed, health-check |

---

_End of architecture specification._
