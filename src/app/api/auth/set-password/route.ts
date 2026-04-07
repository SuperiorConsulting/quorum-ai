import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '../../../../lib/prisma.js'

/**
 * POST /api/auth/set-password
 *
 * Sets or resets the password for a business account identified by email.
 * Called after onboarding completion (no auth required — owner just completed signup).
 * A token-based reset flow can be layered on top in Phase 16.
 *
 * Body: { email: string; password: string; businessId: string }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { email?: string; password?: string; businessId?: string }
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { email, password, businessId } = body

  if (!email || !password || !businessId) {
    return NextResponse.json(
      { error: 'email, password, and businessId are required' },
      { status: 400 },
    )
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  // Verify businessId + email match (prevents setting passwords on other accounts)
  const business = await prisma.business.findFirst({
    where: { id: businessId, email: email.toLowerCase().trim() },
    select: { id: true },
  })

  if (!business) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const passwordHash = await bcrypt.hash(password, 12)

  await prisma.business.update({
    where: { id: business.id },
    data: { passwordHash },
  })

  return NextResponse.json({ ok: true })
}
