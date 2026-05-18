import { describe, expect, it } from 'vitest'
import type { Database } from '../../db/client'
import { rolePermission } from '../../db/schema'
import { createDrizzleAuthorizationRepository } from './drizzle-repository'

describe('createDrizzleAuthorizationRepository', () => {
  it('replaces role permissions without a D1 transaction', async () => {
    const db = new FakeDb()
    const repository = createDrizzleAuthorizationRepository(db as unknown as Database)

    await repository.replaceRolePermissions('role-1', ['permission-2', 'permission-3'])

    expect(db.deletes).toEqual([{ table: rolePermission }])
    expect(db.inserts).toEqual([
      {
        table: rolePermission,
        values: [
          { roleId: 'role-1', permissionId: 'permission-2' },
          { roleId: 'role-1', permissionId: 'permission-3' },
        ],
      },
    ])
  })

  it('clears role permissions without inserting an empty permission list', async () => {
    const db = new FakeDb()
    const repository = createDrizzleAuthorizationRepository(db as unknown as Database)

    await repository.replaceRolePermissions('role-1', [])

    expect(db.deletes).toEqual([{ table: rolePermission }])
    expect(db.inserts).toEqual([])
  })
})

class FakeDb {
  readonly inserts: Array<{ table: unknown; values: unknown }> = []
  readonly deletes: Array<{ table: unknown }> = []

  delete(table: unknown) {
    return {
      where: async () => {
        this.deletes.push({ table })
      },
    }
  }

  insert(table: unknown) {
    return {
      values: async (values: unknown) => {
        this.inserts.push({ table, values })
      },
    }
  }

  async transaction() {
    throw new Error('Unexpected D1 transaction')
  }

  async batch(statements: unknown[]) {
    return statements
  }
}
