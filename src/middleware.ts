import NextAuth from 'next-auth'
import { authConfig } from './lib/auth.config.js'

// Use Edge-compatible config only — no Prisma, no Node.js built-ins
export default NextAuth(authConfig).auth

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/onboarding/:path*',
  ],
}
