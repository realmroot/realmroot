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
  })
})

class FakeDb {
  constructor(private readonly rows: Record<string, unknown[]> = {}) {}

  select(selection?: Record<string, unknown>) {
    return new SelectBuilder(this.rows, selection)
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
