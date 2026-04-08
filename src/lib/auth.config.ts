import type { NextAuthConfig } from 'next-auth'

/**
 * Edge-compatible auth config — no Node.js built-ins, no Prisma.
 * Used by middleware to validate JWT without hitting the database.
 * Full auth config (with Credentials provider + Prisma) is in auth.ts.
 */
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: '/auth/signin',
    error:  '/auth/signin',
  },

  callbacks: {
    // Authorize access to protected routes using JWT only (no DB call)
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn  = !!auth?.user
      const isProtected =
        nextUrl.pathname.startsWith('/dashboard') ||
        nextUrl.pathname.startsWith('/onboarding')

      if (isProtected) return isLoggedIn
      return true
    },

    jwt({ token, user }) {
      if (user) {
        token['businessId'] = (user as { businessId: string }).businessId
      }
      return token
    },

    session({ session, token }) {
      if (session.user && token['businessId']) {
        (session.user as { businessId?: string }).businessId = token['businessId'] as string
      }
      return session
    },
  },

  providers: [], // Credentials provider added in auth.ts (Node.js only)
  session: { strategy: 'jwt' },
  secret: process.env['NEXTAUTH_SECRET'] ?? 'quorum-dev-secret-change-in-production',
}
