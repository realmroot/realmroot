import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('createAgentService', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('creates the agent service from the D1 binding', async () => {
    const db = { id: 'db' }
    const userRepository = { id: 'users' }
    const agentRepository = { id: 'agents' }
    const createDb = vi.fn().mockReturnValue(db)
    const createUserRepository = vi.fn().mockReturnValue(userRepository)
    const createDrizzleAgentRepository = vi.fn().mockReturnValue(agentRepository)
    const AgentService = vi.fn()

    vi.doMock('../../../../../server/db/client', () => ({ createDb }))
    vi.doMock('@server/adapters/repos/users', () => ({ createUserRepository }))
    vi.doMock('@server/adapters/repos/agents', () => ({ createDrizzleAgentRepository }))
    vi.doMock('@server/usecases/agents', () => ({ AgentService }))

    const { createAgentService } = await import('@server/modules/agents/context')
    createAgentService({ env: { DB: 'database-binding' } } as never)

    expect(createDb).toHaveBeenCalledWith('database-binding')
    expect(createUserRepository).toHaveBeenCalledWith(db)
    expect(createDrizzleAgentRepository).toHaveBeenCalledWith(db)
    expect(AgentService).toHaveBeenCalledWith(userRepository, agentRepository)
  })
})
