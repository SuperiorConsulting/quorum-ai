// @ts-ignore — Prisma 7 generates non-standard module layout; path is correct
import { PrismaClient } from '../generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

declare global {
  // eslint-disable-next-line no-var
  var _quorumPrisma: PrismaClient | undefined
  // eslint-disable-next-line no-var
  var _quorumPool: Pool | undefined
}

function createPool(): Pool {
  if (global._quorumPool && !(global._quorumPool as Pool & { ended?: boolean }).ended) {
    return global._quorumPool
  }
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL is not set')
  const pool = new Pool({ connectionString: url })
  if (process.env['NODE_ENV'] !== 'production') {
    global._quorumPool = pool
  }
  return pool
}

function createPrisma(): PrismaClient {
  const pool = createPool()
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

/** Singleton Prisma client. Use this everywhere — never instantiate PrismaClient directly. */
export const prisma: PrismaClient =
  global._quorumPrisma ?? createPrisma()

if (process.env['NODE_ENV'] !== 'production') {
  global._quorumPrisma = prisma
}
