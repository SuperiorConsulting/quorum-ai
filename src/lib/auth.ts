import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma.js'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const email    = String(credentials.email).toLowerCase().trim()
        const password = String(credentials.password)

        const business = await prisma.business.findFirst({
          where: { email },
          select: { id: true, name: true, email: true, passwordHash: true },
        })

        if (!business || !business.passwordHash) return null

        const valid = await bcrypt.compare(password, business.passwordHash)
        if (!valid) return null

        return {
          id:         business.id,
          email:      business.email,
          name:       business.name,
          businessId: business.id,
        }
      },
    }),
  ],

  callbacks: {
    // Persist businessId in the JWT
    jwt({ token, user }) {
      if (user) {
        token['businessId'] = (user as { businessId: string }).businessId
      }
      return token
    },
    // Expose businessId in session.user
    session({ session, token }) {
      if (session.user && token['businessId']) {
        (session.user as { businessId?: string }).businessId = token['businessId'] as string
      }
      return session
    },
  },

  pages: {
    signIn:  '/auth/signin',
    error:   '/auth/signin',
  },

  session: { strategy: 'jwt' },

  secret: process.env['NEXTAUTH_SECRET'] ?? 'quorum-dev-secret-change-in-production',
})
