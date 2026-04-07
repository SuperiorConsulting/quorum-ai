-- CreateEnum
CREATE TYPE "Vertical" AS ENUM ('HOME_SERVICES', 'REAL_ESTATE', 'LEGAL', 'MEDICAL', 'AUTO', 'FITNESS', 'OTHER');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('STARTER', 'GROWTH', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('NEW', 'QUALIFYING', 'PROPOSAL', 'NEGOTIATING', 'CLOSED_WON', 'CLOSED_LOST', 'WIN_BACK');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('VOICE', 'SMS', 'EMAIL', 'CHAT');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('SHOWING', 'CONSULTATION', 'CALL', 'LISTING_APPT', 'OTHER');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "RELeadType" AS ENUM ('BUYER', 'SELLER', 'INVESTOR', 'RENTER');

-- CreateEnum
CREATE TYPE "SequenceType" AS ENUM ('FOLLOW_UP', 'WIN_BACK', 'ONBOARDING', 'NURTURE');

-- CreateEnum
CREATE TYPE "SequenceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'TRIALING');

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "vertical" "Vertical" NOT NULL DEFAULT 'OTHER',
    "services" JSONB NOT NULL,
    "pricing" JSONB NOT NULL,
    "guarantees" TEXT,
    "voiceCloneId" TEXT,
    "ghlLocationId" TEXT,
    "stripeCustomerId" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'STARTER',
    "setupPaid" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "channel" "Channel" NOT NULL DEFAULT 'VOICE',
    "source" TEXT,
    "pipelineStage" "Stage" NOT NULL DEFAULT 'NEW',
    "score" INTEGER NOT NULL DEFAULT 0,
    "dealValue" DOUBLE PRECISION,
    "vertical" "Vertical",
    "ghlContactId" TEXT,
    "memoryProfileId" TEXT,
    "closeProbability" DOUBLE PRECISION,
    "lastInteractionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RealEstateLead" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "RELeadType" NOT NULL,
    "preApproved" BOOLEAN NOT NULL DEFAULT false,
    "budget" DOUBLE PRECISION,
    "targetNeighborhoods" JSONB,
    "mustHaves" JSONB,
    "timeline" TEXT,
    "currentSituation" TEXT,
    "agentId" TEXT,
    "showingsBooked" INTEGER NOT NULL DEFAULT 0,
    "offersSubmitted" INTEGER NOT NULL DEFAULT 0,
    "listingPrice" DOUBLE PRECISION,
    "propertyAddress" TEXT,

    CONSTRAINT "RealEstateLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "direction" "Direction" NOT NULL,
    "transcript" TEXT,
    "sentiment" INTEGER NOT NULL DEFAULT 0,
    "emotionDetected" TEXT,
    "buyingSignal" BOOLEAN NOT NULL DEFAULT false,
    "objectionRaised" TEXT,
    "competitorMentioned" TEXT,
    "outcome" TEXT,
    "durationSeconds" INTEGER,
    "recordingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryProfile" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "preferences" JSONB,
    "keyFacts" JSONB,
    "sentimentHistory" JSONB,
    "closingInsights" JSONB,
    "personalDetails" JSONB,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 60,
    "type" "AppointmentType" NOT NULL DEFAULT 'CONSULTATION',
    "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "calendarEventId" TEXT,
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weaknesses" TEXT,
    "ourAdvantages" TEXT,
    "pricingNotes" TEXT,
    "proofPoints" TEXT,
    "talkingPoints" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpSequence" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sequenceType" "SequenceType" NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "totalSteps" INTEGER NOT NULL,
    "nextActionAt" TIMESTAMP(3),
    "status" "SequenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyBriefing" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "revenueClosedOvernite" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dealsCount" INTEGER NOT NULL DEFAULT 0,
    "appointmentsBooked" INTEGER NOT NULL DEFAULT 0,
    "hotLeadsCount" INTEGER NOT NULL DEFAULT 0,
    "winBackResponses" INTEGER NOT NULL DEFAULT 0,
    "briefingScript" TEXT,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyBriefing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "setupFeeAmount" DOUBLE PRECISION NOT NULL,
    "monthlyRetainer" DOUBLE PRECISION NOT NULL,
    "stripeSubscriptionId" TEXT,
    "status" "SubStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextBillingAt" TIMESTAMP(3),

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FailedMemoryWrite" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "interactionData" JSONB NOT NULL,
    "failureReason" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FailedMemoryWrite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_businessId_idx" ON "Lead"("businessId");

-- CreateIndex
CREATE INDEX "Lead_phone_idx" ON "Lead"("phone");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "Lead_pipelineStage_idx" ON "Lead"("pipelineStage");

-- CreateIndex
CREATE UNIQUE INDEX "RealEstateLead_leadId_key" ON "RealEstateLead"("leadId");

-- CreateIndex
CREATE INDEX "Interaction_leadId_idx" ON "Interaction"("leadId");

-- CreateIndex
CREATE INDEX "Interaction_businessId_idx" ON "Interaction"("businessId");

-- CreateIndex
CREATE INDEX "Interaction_createdAt_idx" ON "Interaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryProfile_leadId_key" ON "MemoryProfile"("leadId");

-- CreateIndex
CREATE INDEX "Appointment_businessId_idx" ON "Appointment"("businessId");

-- CreateIndex
CREATE INDEX "Appointment_scheduledAt_idx" ON "Appointment"("scheduledAt");

-- CreateIndex
CREATE INDEX "Competitor_businessId_idx" ON "Competitor"("businessId");

-- CreateIndex
CREATE INDEX "FollowUpSequence_leadId_idx" ON "FollowUpSequence"("leadId");

-- CreateIndex
CREATE INDEX "FollowUpSequence_nextActionAt_idx" ON "FollowUpSequence"("nextActionAt");

-- CreateIndex
CREATE INDEX "FollowUpSequence_status_idx" ON "FollowUpSequence"("status");

-- CreateIndex
CREATE INDEX "DailyBriefing_businessId_idx" ON "DailyBriefing"("businessId");

-- CreateIndex
CREATE INDEX "DailyBriefing_date_idx" ON "DailyBriefing"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_businessId_key" ON "Subscription"("businessId");

-- CreateIndex
CREATE INDEX "FailedMemoryWrite_resolved_idx" ON "FailedMemoryWrite"("resolved");

-- CreateIndex
CREATE INDEX "FailedMemoryWrite_createdAt_idx" ON "FailedMemoryWrite"("createdAt");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateLead" ADD CONSTRAINT "RealEstateLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryProfile" ADD CONSTRAINT "MemoryProfile_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyBriefing" ADD CONSTRAINT "DailyBriefing_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailedMemoryWrite" ADD CONSTRAINT "FailedMemoryWrite_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
