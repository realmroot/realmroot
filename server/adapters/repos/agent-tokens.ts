import type { AgentTokenRepository } from '@server/usecases/ports'
import { lt } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { agentDpopJti } from '../../db/schema'

export function createDrizzleAgentTokenRepository(db: Database): AgentTokenRepository {
  return {
    async consumeAgentAuthJti(input) {
      return consumeJti(db, { ...input, keyThumbprint: 'agent-auth' })
    },

    async consumeDpopJti(input) {
      return consumeJti(db, input)
    },
  }
}

async function consumeJti(
  db: Database,
  input: { jtiHash: string; keyThumbprint: string; expiresAt: Date; createdAt: Date },
) {
  try {
    await db.delete(agentDpopJti).where(lt(agentDpopJti.expiresAt, input.createdAt))
    await db.insert(agentDpopJti).values(input)
    return true
  } catch (error) {
    if (isUniqueConstraint(error)) return false
    throw error
  }
}

function isUniqueConstraint(error: unknown) {
  let current = error
  while (current instanceof Error) {
    if (/unique constraint|SQLITE_CONSTRAINT/i.test(current.message)) return true
    current = current.cause
  }
  return false
}
