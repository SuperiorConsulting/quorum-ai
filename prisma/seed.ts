/**
 * Quorum seed script
 *
 * Creates a demo business + sample leads so you can explore the dashboard
 * immediately after deploying. Safe to re-run — uses upsert/findFirst guards.
 *
 * Usage:
 *   npx ts-node --esm prisma/seed.ts
 *   -- or via package.json prisma.seed --
 */

import { config } from 'dotenv'
import bcrypt from 'bcryptjs'

config({ path: '.env.local' })

// Dynamic import after env is loaded so prisma.config.ts picks up DATABASE_URL
const { prisma } = await import('../src/lib/prisma.js')

// ─── Config ───────────────────────────────────────────────────────────────────

const SEED_EMAIL    = process.env['SEED_EMAIL']    ?? 'demo@quorum.ai'
const SEED_PASSWORD = process.env['SEED_PASSWORD'] ?? 'quorum-demo-2024'
const SEED_PHONE    = process.env['SEED_PHONE']    ?? '+15550001234'

// ─── Business ─────────────────────────────────────────────────────────────────

console.log('🌱 Seeding Quorum demo data...\n')

const existing = await prisma.business.findFirst({ where: { email: SEED_EMAIL } })

const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12)

const business = existing
  ? await prisma.business.update({
      where: { id: existing.id },
      data:  { passwordHash, isActive: true },
    })
  : await prisma.business.create({
      data: {
        name:         'Apex Realty Group',
        ownerId:      SEED_EMAIL,
        phone:        SEED_PHONE,
        email:        SEED_EMAIL,
        vertical:     'REAL_ESTATE',
        services:     ['Buyer Representation', 'Seller Representation', 'Property Management'],
        pricing:      {},
        plan:         'GROWTH',
        isActive:     true,
        passwordHash,
      },
    })

console.log(`✅ Business: ${business.name} (${business.id})`)
console.log(`   Email: ${SEED_EMAIL}`)
console.log(`   Password: ${SEED_PASSWORD}\n`)

// ─── Sample leads ─────────────────────────────────────────────────────────────

const SAMPLE_LEADS = [
  {
    name:          'Marcus Johnson',
    phone:         '+15550010001',
    email:         'marcus.johnson@example.com',
    pipelineStage: 'NEGOTIATING' as const,
    score:         87,
    channel:       'SMS'  as const,
    dealValue:     425000,
    vertical:      'REAL_ESTATE' as const,
    lastInteractionAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
  },
  {
    name:          'Sarah Chen',
    phone:         '+15550010002',
    email:         'sarah.chen@example.com',
    pipelineStage: 'PROPOSAL' as const,
    score:         74,
    channel:       'VOICE' as const,
    dealValue:     650000,
    vertical:      'REAL_ESTATE' as const,
    lastInteractionAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5h ago
  },
  {
    name:          'David Okonkwo',
    phone:         '+15550010003',
    email:         'david.okonkwo@example.com',
    pipelineStage: 'QUALIFYING' as const,
    score:         62,
    channel:       'SMS'  as const,
    dealValue:     310000,
    vertical:      'REAL_ESTATE' as const,
    lastInteractionAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1d ago
  },
  {
    name:          'Linda Torres',
    phone:         '+15550010004',
    email:         'linda.torres@example.com',
    pipelineStage: 'CLOSED_WON' as const,
    score:         95,
    channel:       'VOICE' as const,
    dealValue:     890000,
    vertical:      'REAL_ESTATE' as const,
    lastInteractionAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3d ago
  },
  {
    name:          'James Whitfield',
    phone:         '+15550010005',
    email:         'james.whitfield@example.com',
    pipelineStage: 'WIN_BACK' as const,
    score:         38,
    channel:       'EMAIL' as const,
    dealValue:     null,
    vertical:      'REAL_ESTATE' as const,
    lastInteractionAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), // 20d ago
  },
  {
    name:          'Priya Sharma',
    phone:         '+15550010006',
    email:         'priya.sharma@example.com',
    pipelineStage: 'NEW' as const,
    score:         51,
    channel:       'SMS'  as const,
    dealValue:     520000,
    vertical:      'REAL_ESTATE' as const,
    lastInteractionAt: new Date(Date.now() - 30 * 60 * 1000), // 30min ago
  },
]

let leadsCreated = 0
for (const lead of SAMPLE_LEADS) {
  const existingLead = await prisma.lead.findFirst({
    where: { businessId: business.id, email: lead.email },
  })
  if (!existingLead) {
    await prisma.lead.create({
      data: { businessId: business.id, ...lead },
    })
    leadsCreated++
  }
}

console.log(`✅ Leads: ${leadsCreated} created (${SAMPLE_LEADS.length - leadsCreated} already existed)\n`)

// ─── Morning briefing stub ────────────────────────────────────────────────────

const today = new Date()
today.setHours(0, 0, 0, 0)

const briefingExists = await prisma.dailyBriefing.findFirst({
  where: { businessId: business.id, date: { gte: today } },
})

if (!briefingExists) {
  await prisma.dailyBriefing.create({
    data: {
      businessId:            business.id,
      date:                  new Date(),
      revenueClosedOvernite: 425000,
      appointmentsBooked:    2,
      hotLeadsCount:         3,
      winBackResponses:      1,
      briefingScript:        "Good morning. Overnight Quorum closed one deal at $425K with Marcus Johnson — he signed after the 11pm follow-up. You have two consultations booked today. Priya Sharma came in hot at 2am via SMS — score 51 and climbing. Recommend calling her before 9am. Three win-back leads opened their emails last night. Overall pipeline: $2.8M active. Today looks strong.",
      delivered:             false,
    },
  })
  console.log('✅ Morning briefing stub created\n')
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('─────────────────────────────────────')
console.log('Seed complete. Sign in at /auth/signin')
console.log(`Email:    ${SEED_EMAIL}`)
console.log(`Password: ${SEED_PASSWORD}`)
console.log('─────────────────────────────────────')

await prisma.$disconnect()
