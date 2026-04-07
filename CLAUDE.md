# Quorum AI Sales Intelligence — Project Memory

## What This Is
Quorum is a standalone 24/7 autonomous AI sales intelligence system.
NOT embedded in another product. Its own brand, pricing, and market.
Closes deals, books appointments, handles voice/SMS/email/chat 24/7,
delivers daily 8am owner briefings. Core moat: Relationship Memory.

## Existing Stack (already built — build on top of these)
- Vapi AI: already wired for voice orchestration
- Claude tool use: already operational
- Twilio + SendGrid: already in stack for SMS and email

## Full Stack
- Framework: Next.js 15, TypeScript, Tailwind, App Router
- AI: Claude claude-sonnet-4-6 via @anthropic-ai/sdk
- Voice: Vapi AI (existing) + ElevenLabs (voice cloning — new)
- Memory: Pinecone (vectors — new) + Mem0 (structured — new) + PostgreSQL
- CRM: GoHighLevel REST API v2 (new)
- Automation: n8n self-hosted + node-cron (new)
- Comms: Twilio (existing) + SendGrid (existing)
- Calendar: Google Calendar API
- Payments: Stripe
- Realtime: Socket.io
- Deploy: Vercel + Railway

## Brand
Name: Quorum | Tagline: The Deciding Intelligence
Colors: Indigo #6366f1 | Violet #8b5cf6 | Amber #f59e0b | Emerald #10b981
Fonts: Syne (UI) | Syne Mono (data) | Instrument Sans (body)
Logo: Hexagon with Q mark

## Architecture Rules — NEVER BREAK
1. Check relationship memory BEFORE every lead interaction
2. Update memory AFTER every interaction — always append, never delete
3. Never end a conversation without a next step: close, book, or handoff
4. All DB queries through Prisma only
5. All agent logic in /src/agents/
6. All API routes in /src/app/api/
7. Post-response pipeline order is strict:
   - Send response to lead     ← await (lead gets reply immediately)
   - addInteraction()          ← await (memory written before next message)
   - GHL sync                  ← fire-and-forget (no await, non-blocking)
   - Socket.io push            ← fire-and-forget (emit, non-blocking)
8. TypeScript strict mode — no 'any' types anywhere
9. n8n is the scheduler/router only — Quorum fires webhooks TO n8n,
   n8n calls back via /api/webhook/* — Quorum never polls n8n.

## Build Commands
- npm run dev → start development server
- npx prisma studio → view database
- npx prisma migrate dev → run migrations
- npm test → run test suite
