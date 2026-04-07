-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Vertical" ADD VALUE 'MED_SPA';
ALTER TYPE "Vertical" ADD VALUE 'DENTAL';
ALTER TYPE "Vertical" ADD VALUE 'FINANCIAL';
ALTER TYPE "Vertical" ADD VALUE 'CONTRACTOR';
ALTER TYPE "Vertical" ADD VALUE 'WELLNESS';
ALTER TYPE "Vertical" ADD VALUE 'VETERINARY';
ALTER TYPE "Vertical" ADD VALUE 'RESTAURANT';
