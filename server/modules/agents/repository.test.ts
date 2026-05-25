import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import type { Database } from '../../db/client'
import { agent, agentCapabilityGrant, agentHost, approvalRequest } from '../../db/schema'
import { createDrizzleAgentRepository } from './repository'

describe('createDrizzleAgentRepository', () => {
  it('lists protocol records for account and admin presentation', async () => {
    const db = new FakeDb({
      [getTableConfig(agentHost).name]: [{ id: 'host-1', createdAt: new Date('2026-01-04T00:00:00.000Z') }],
      [getTableConfig(agent).name]: [{ id: 'agent-1', createdAt: new Date('2026-01-03T00:00:00.000Z') }],
      [getTableConfig(agentCapabilityGrant).name]: [{ id: 'grant-1', createdAt: new Date('2026-01-02T00:00:00.000Z') }],
      [getTableConfig(approvalRequest).name]: [{ id: 'approval-1', createdAt: new Date('2026-01-01T00:00:00.000Z') }],
    })
    const repository = createDrizzleAgentRepository(db as unknown as Database)

    await expect(repository.listHosts({ limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [{ id: 'host-1' }],
      total: 1,
    })
    await expect(repository.listAgents({ limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [{ id: 'agent-1' }],
      total: 1,
    })
    await expect(repository.listCapabilityGrants({ limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [{ id: 'grant-1' }],
      total: 1,
    })
    await expect(repository.listApprovalRequests({ limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [{ id: 'approval-1' }],
      total: 1,
    })
    await expect(repository.listAgentsForUser('user-1', { limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [{ id: 'agent-1' }],
      total: 1,
    })
    await expect(repository.listHostsForAgents([])).resolves.toEqual([])
    await expect(repository.listHostsForAgents(['host-1'])).resolves.toMatchObject([{ id: 'host-1' }])
    await expect(repository.listCapabilityGrantsForUser('user-1')).resolves.toMatchObject([{ id: 'grant-1' }])
  })

  it('revokes associated approval requests when revoking agents and hosts', async () => {
    const rows = {
      [getTableConfig(agentHost).name]: [{ id: 'host-1', status: 'active' }],
      [getTableConfig(agent).name]: [{ id: 'agent-1', hostId: 'host-1', status: 'active' }],
      [getTableConfig(agentCapabilityGrant).name]: [{ id: 'grant-1', agentId: 'agent-1', status: 'active' }],
      [getTableConfig(approvalRequest).name]: [
        { id: 'approval-1', agentId: 'agent-1', hostId: 'host-1', status: 'approved' },
      ],
    }
    const repository = createDrizzleAgentRepository(new FakeDb(rows) as unknown as Database)

    await repository.revokeAgent('agent-1')

    expect(rows[getTableConfig(agent).name]).toMatchObject([{ status: 'revoked' }])
    expect(rows[getTableConfig(agentCapabilityGrant).name]).toMatchObject([{ status: 'revoked' }])
    expect(rows[getTableConfig(approvalRequest).name]).toMatchObject([{ status: 'revoked' }])

    rows[getTableConfig(approvalRequest).name][0] = {
      id: 'approval-1',
      agentId: 'agent-1',
      hostId: 'host-1',
      status: 'pending',
    }

    await repository.revokeHost('host-1')

    expect(rows[getTableConfig(agentHost).name]).toMatchObject([{ status: 'revoked' }])
    expect(rows[getTableConfig(approvalRequest).name]).toMatchObject([{ status: 'revoked' }])

    await repository.revokeAgentForUser('agent-1', 'user-1')
    await repository.revokeCapabilityGrantForUser('grant-1', 'user-1')
    await repository.revokeCapabilityGrant('grant-1')

    expect(rows[getTableConfig(agentCapabilityGrant).name]).toMatchObject([{ status: 'revoked' }])
  })

  it('fails fast when revoking unknown protocol records', async () => {
    const repository = createDrizzleAgentRepository(new FakeDb() as unknown as Database)

    await expect(repository.revokeAgent('missing')).rejects.toThrow('Agent was not found.')
    await expect(repository.revokeAgentForUser('missing', 'user-1')).rejects.toThrow('Agent was not found.')
    await expect(repository.revokeHost('missing')).rejects.toThrow('Agent host was not found.')
    await expect(repository.revokeCapabilityGrant('missing')).rejects.toThrow('Agent capability grant was not found.')
    await expect(repository.revokeCapabilityGrantForUser('missing', 'user-1')).rejects.toThrow(
      'Agent capability grant was not found.',
    )
  })
})

class FakeDb {
  constructor(private readonly rows: Record<string, unknown[]> = {}) {}

  select(selection?: Record<string, unknown>) {
    return new SelectBuilder(this.rows, selection)
  }

  update(table: Parameters<typeof getTableConfig>[0]) {
    return new UpdateBuilder(this.rows, getTableConfig(table).name)
  }
}

class SelectBuilder {
  private tableName = ''
  private rowLimit: number | null = null
  private rowOffset = 0

  constructor(
    private readonly rows: Record<string, unknown[]>,
    private readonly selection?: Record<string, unknown>,
  ) {}

  from(table: Parameters<typeof getTableConfig>[0]) {
    this.tableName = getTableConfig(table).name
    return this
  }

  orderBy() {
    return this
  }

  limit(limit: number) {
    this.rowLimit = limit
    return this
  }

  offset(offset: number) {
    this.rowOffset = offset
    return this
  }

  where() {
    return this
  }

  // biome-ignore lint/suspicious/noThenProperty: the fake mimics Drizzle's awaitable query builder.
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected)
  }

  private result() {
    const rows = this.rows[this.tableName] ?? []
    if (this.selection && 'total' in this.selection) return [{ total: rows.length }]
    const start = this.rowOffset
    const end = this.rowLimit === null ? undefined : start + this.rowLimit
    return rows.slice(start, end)
  }
}

class UpdateBuilder {
  private patch: Record<string, unknown> = {}

  constructor(
    private readonly rows: Record<string, unknown[]>,
    private readonly tableName: string,
  ) {}

  set(patch: Record<string, unknown>) {
    this.patch = patch
    return this
  }

  where() {
    for (const row of this.rows[this.tableName] ?? []) Object.assign(row as Record<string, unknown>, this.patch)
    return Promise.resolve()
  }
}
