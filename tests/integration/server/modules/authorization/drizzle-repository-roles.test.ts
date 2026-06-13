import { createDrizzleAuthorizationRepository } from '@server/adapters/repos/authorization'
import type { Database } from '@server/db/client'
import {
  applicationRoleAssignment,
  memberRoleAssignment,
  organization,
  rolePermission,
  userRoleAssignment,
} from '@server/db/schema'
import { describe, expect, it } from 'vitest'

describe('drizzle-repository.test 2', () => {
  it('assigns roles and groups role permissions by role', async () => {
    const db = new FakeDb()
    db.assignmentRows = [
      {
        assignment: { tokenClaims: { tier: 'gold' } },
        role: roleRow(),
        permission: permissionRow(),
      },
      {
        assignment: { tokenClaims: { tier: 'gold' } },
        role: roleRow(),
        permission: { ...permissionRow(), id: 'permission-2', key: 'contacts.write' },
      },
    ]
    const repository = createDrizzleAuthorizationRepository(db as unknown as Database)

    await repository.assignUserRole(roleAssignment('user-role-1', 'user-1'))
    await repository.assignApplicationRole(roleAssignment('application-role-1', 'application-1'))
    await repository.assignMemberRole(roleAssignment('member-role-1', 'member-1'))
    await repository.assignUserRole({ ...roleAssignment('user-role-2', 'user-2'), expiresAt: undefined })
    await repository.assignApplicationRole({
      ...roleAssignment('application-role-2', 'application-2'),
      expiresAt: undefined,
    })
    await repository.assignMemberRole({ ...roleAssignment('member-role-2', 'member-2'), expiresAt: undefined })
    await expect(
      repository.listUserRoleAssignments('user-1', {
        resourceId: 'resource-1',
        organizationId: 'org-1',
        applicationId: 'app-1',
      }),
    ).resolves.toMatchObject([
      {
        role: { id: 'role-1' },
        permissions: [{ id: 'permission-1' }, { id: 'permission-2' }],
        tokenClaims: { tier: 'gold' },
      },
    ])
    await expect(repository.listApplicationRoleAssignments('application-1', {})).resolves.toHaveLength(1)
    await expect(repository.listMemberRoleAssignments('member-1', {})).resolves.toHaveLength(1)

    expect(db.inserts.map((insert) => insert.table)).toEqual([
      userRoleAssignment,
      applicationRoleAssignment,
      memberRoleAssignment,
      userRoleAssignment,
      applicationRoleAssignment,
      memberRoleAssignment,
    ])
    expect(db.inserts.slice(3).map((insert) => (insert.values as { expiresAt: unknown }).expiresAt)).toEqual([
      null,
      null,
      null,
    ])
    expect(db.conflictIgnored).toBe(6)
  })

  it('groups assignments without optional joined permissions', async () => {
    const db = new FakeDb()
    db.assignmentRows = [
      {
        assignment: { tokenClaims: null },
        role: roleRow(),
        permission: null,
      },
    ]
    const repository = createDrizzleAuthorizationRepository(db as unknown as Database)

    await expect(repository.listUserRoleAssignments('user-1', {})).resolves.toEqual([
      {
        role: expect.objectContaining({ id: 'role-1' }),
        permissions: [],
        tokenClaims: null,
      },
    ])
  })

  it('reports next pagination offsets for longer collections', async () => {
    const db = new FakeDb(new Map<unknown, unknown[]>([[organization, [organizationRow(), organizationRow()]]]))
    const repository = createDrizzleAuthorizationRepository(db as unknown as Database)

    await expect(repository.listOrganizations({ limit: 1, offset: 0 })).resolves.toMatchObject({
      pagination: { total: 2, hasMore: true, nextOffset: 1 },
    })
  })

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

  it('lists permissions assigned to a role', async () => {
    const db = new FakeDb()
    db.assignmentRows = [{ permission: permissionRow() }]
    const repository = createDrizzleAuthorizationRepository(db as unknown as Database)

    await expect(repository.listRolePermissions('role-1')).resolves.toMatchObject([{ id: 'permission-1' }])
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
  readonly updates: Array<{ table: unknown; set: Record<string, unknown> }> = []
  readonly deletes: Array<{ table: unknown }> = []
  readonly selects: unknown[] = []
  conflictIgnored = 0
  assignmentRows: unknown[] = []

  constructor(private readonly rows = new Map<unknown, unknown[]>()) {}

  delete(table: unknown) {
    return {
      where: async () => {
        this.deletes.push({ table })
      },
    }
  }

  insert(table: unknown) {
    return {
      values: (values: unknown) => {
        this.inserts.push({ table, values })
        return {
          // biome-ignore lint/suspicious/noThenProperty: Drizzle insert builders are awaitable, and this fake mirrors that contract.
          then: (resolve: (value: unknown) => void) => Promise.resolve(undefined).then(resolve),
          onConflictDoNothing: async () => {
            this.conflictIgnored += 1
          },
        }
      },
    }
  }

  update(table: unknown) {
    return {
      set: (set: Record<string, unknown>) => ({
        where: async () => {
          this.updates.push({ table, set })
        },
      }),
    }
  }

  select(fields?: unknown) {
    return new FakeSelect(this, fields)
  }

  rowsFor(table: unknown) {
    return this.rows.get(table) ?? []
  }

  totalFor(table: unknown) {
    return this.rowsFor(table).length
  }

  async transaction() {
    throw new Error('Unexpected D1 transaction')
  }

  async batch(statements: unknown[]) {
    return statements
  }
}

class FakeSelect {
  private table: unknown
  private joins = false

  constructor(
    private readonly db: FakeDb,
    private readonly fields?: unknown,
  ) {}

  from(table: unknown) {
    this.table = table
    this.db.selects.push(table)
    return this
  }

  innerJoin() {
    this.joins = true
    return this
  }

  leftJoin() {
    this.joins = true
    return this
  }

  where() {
    return this
  }

  orderBy() {
    return this
  }

  limit() {
    return this
  }

  offset() {
    return this
  }

  // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable, and this fake mirrors that contract.
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected)
  }

  private result() {
    if (this.joins) return this.db.assignmentRows
    if (this.fields && typeof this.fields === 'object' && 'total' in this.fields) {
      return [{ total: this.db.totalFor(this.table) }]
    }
    if (this.db.rowsFor(this.table).length === 0 && this.table === organization) return []
    return this.db.rowsFor(this.table)
  }
}

function date() {
  return new Date('2026-01-01T00:00:00.000Z')
}

function organizationRow() {
  return {
    id: 'org-1',
    slug: 'acme',
    name: 'Acme',
    displayName: 'Acme Inc.',
    logo: null,
    disabled: false,
    disabledReason: null,
    createdAt: date(),
    updatedAt: date(),
  }
}

function _memberRow() {
  return {
    id: 'member-1',
    organizationId: 'org-1',
    userId: 'user-1',
    role: 'owner',
    title: null,
    createdAt: date(),
    updatedAt: date(),
  }
}

function _invitationRow() {
  return {
    id: 'invitation-1',
    organizationId: 'org-1',
    email: 'invitee@example.com',
    role: 'member',
    inviterId: 'admin-1',
    status: 'pending',
    expiresAt: date(),
    acceptedAt: null,
    revokedAt: null,
    createdAt: date(),
  }
}

function _resourceRow() {
  return {
    id: 'resource-1',
    identifier: 'contacts',
    name: 'Contacts API',
    audience: 'https://api.example.com',
    description: null,
    enabled: true,
    tokenClaimsNamespace: null,
    createdAt: date(),
    updatedAt: date(),
  }
}

function _scopeRow() {
  return {
    id: 'scope-1',
    resourceId: 'resource-1',
    value: 'contacts.read',
    description: null,
    required: false,
    tokenClaimName: null,
    includeInAccessToken: true,
    includeInIdToken: false,
  }
}

function permissionRow() {
  return {
    id: 'permission-1',
    resourceId: 'resource-1',
    scopeId: 'scope-1',
    key: 'contacts.read',
    description: null,
    tokenClaimValue: null,
  }
}

function roleRow() {
  return {
    id: 'role-1',
    key: 'admin',
    name: 'Admin',
    description: null,
    resourceId: 'resource-1',
    organizationId: 'org-1',
    applicationId: 'app-1',
    system: true,
    tokenClaimName: null,
    tokenClaimValue: null,
    createdAt: date(),
    updatedAt: date(),
  }
}

function roleAssignment(id: string, subjectId: string) {
  return {
    id,
    roleId: 'role-1',
    subjectId,
    assignedByUserId: 'admin-1',
    tokenClaims: { tier: 'gold' },
    expiresAt: '2026-02-01T00:00:00.000Z',
  }
}
