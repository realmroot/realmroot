import { describe, expect, it, vi } from 'vitest'
import type { Database } from '../../db/client'
import { account, applicationConsent, session, uploadedAsset, user } from '../../db/schema'
import { createUserRepository } from './repository'

vi.mock('../../lib/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed-password'),
}))

describe('createUserRepository', () => {
  it('lists managed users with unfiltered and filtered query branches', async () => {
    const db = new FakeDb()
    db.selectResults.push([userRow({ id: 'user-1' })], [{ value: 1 }], [userRow({ id: 'user-2' })], [{ value: 1 }])
    const repository = createUserRepository(db as unknown as Database)

    await expect(
      repository.listManagedUsers({ limit: 10, offset: 0, sortBy: 'updatedAt', sortDirection: 'asc' }),
    ).resolves.toMatchObject({
      items: [{ id: 'user-1' }],
      total: 1,
    })
    await expect(
      repository.listManagedUsers({
        search: 'Ada',
        searchField: 'name',
        role: 'admin',
        banned: false,
        sortBy: 'email',
        sortDirection: 'desc',
        limit: 5,
        offset: 5,
      }),
    ).resolves.toMatchObject({
      items: [{ id: 'user-2' }],
      total: 1,
    })
  })

  it('creates managed users with and without credential accounts', async () => {
    const db = new FakeDb()
    db.selectResults.push(
      [userRow({ id: 'created-1', email: 'ada@example.com' })],
      [userRow({ id: 'created-2', email: 'grace@example.com' })],
    )
    const repository = createUserRepository(db as unknown as Database)

    await expect(
      repository.createManagedUser({
        email: 'ADA@EXAMPLE.COM',
        displayName: 'Ada',
        username: 'ada',
        role: ['admin', 'support'],
        password: 'password-1',
      }),
    ).resolves.toMatchObject({ id: 'created-1', email: 'ada@example.com' })
    await expect(
      repository.createManagedUser({
        email: 'GRACE@EXAMPLE.COM',
        displayName: 'Grace',
      }),
    ).resolves.toMatchObject({ id: 'created-2', email: 'grace@example.com' })

    expect(db.batches[0]).toHaveLength(2)
    expect(db.batches[1]).toHaveLength(1)
    const [userInsert, accountInsert] = db.batches[0] as FakeStatement[]
    expect(userInsert?.table).toBe(user)
    expect(userInsert?.value).toMatchObject({
      email: 'ada@example.com',
      name: 'Ada',
      username: 'ada',
      role: 'admin,support',
    })
    expect(accountInsert?.table).toBe(account)
    expect(accountInsert?.value).toMatchObject({
      accountId: userInsert?.value.id,
      providerId: 'credential',
      userId: userInsert?.value.id,
      password: 'hashed-password',
    })
    expect(accountInsert?.value.password).not.toBe('password-1')
  })

  it('updates managed users and rejects empty or missing updates', async () => {
    const db = new FakeDb()
    db.updateResults.push([userRow({ id: 'updated-1', email: 'next@example.com', role: 'admin,support' })], [])
    const repository = createUserRepository(db as unknown as Database)

    await expect(
      repository.updateManagedUser('user-1', {
        email: 'NEXT@EXAMPLE.COM',
        emailVerified: true,
        displayName: 'Next',
        username: null,
        avatarAssetId: null,
        role: ['admin', 'support'],
      }),
    ).resolves.toMatchObject({
      id: 'updated-1',
      email: 'next@example.com',
      role: 'admin,support',
    })
    expect(db.updateCalls[0]).toMatchObject({
      table: user,
      value: {
        email: 'next@example.com',
        emailVerified: true,
        name: 'Next',
        username: null,
        avatarAssetId: null,
        role: 'admin,support',
      },
    })
    await expect(repository.updateManagedUser('user-1', {})).rejects.toMatchObject({
      message: 'No user fields were provided.',
    })
    await expect(repository.updateManagedUser('missing', { displayName: 'Missing' })).rejects.toMatchObject({
      message: 'User not found.',
    })
  })

  it('updates account profile and validates avatar references', async () => {
    const db = new FakeDb()
    db.selectResults.push([{ id: 'asset-1' }], [], [{ id: 'asset-2' }])
    db.updateResults.push([userRow({ id: 'user-1', name: 'Ada Lovelace' })], [])
    const repository = createUserRepository(db as unknown as Database)

    await expect(repository.updateProfile('user-1', {})).rejects.toMatchObject({
      message: 'No profile fields were provided.',
    })
    await expect(repository.assertAccountAvatarReference('user-1', undefined)).resolves.toBeUndefined()
    await expect(repository.assertAccountAvatarReference('user-1', null)).resolves.toBeUndefined()
    await expect(repository.assertAccountAvatarReference('user-1', 'asset-1')).resolves.toBeUndefined()
    await expect(repository.assertAccountAvatarReference('user-1', 'missing')).rejects.toMatchObject({
      message: 'Avatar asset does not exist for this user.',
    })
    await expect(repository.assertAdminAvatarReference(undefined)).resolves.toBeUndefined()
    await expect(repository.assertAdminAvatarReference(null)).resolves.toBeUndefined()
    await expect(repository.assertAdminAvatarReference('asset-2')).resolves.toBeUndefined()

    await expect(
      repository.updateProfile('user-1', {
        displayName: 'Ada Lovelace',
        username: 'ada',
        avatarAssetId: undefined,
      }),
    ).resolves.toMatchObject({ displayName: 'Ada Lovelace' })
    await expect(repository.updateProfile('missing', { displayName: 'Missing' })).rejects.toMatchObject({
      message: 'User not found.',
    })
    expect(db.selectCalls.filter((call) => call.table === uploadedAsset)).toHaveLength(3)
    expect(db.wherePredicates.length).toBeGreaterThanOrEqual(3)
  })

  it('rejects missing admin avatar references', async () => {
    const db = new FakeDb()
    db.selectResults.push([])
    const repository = createUserRepository(db as unknown as Database)

    await expect(repository.assertAdminAvatarReference('missing')).rejects.toMatchObject({
      message: 'Avatar asset does not exist.',
    })
  })

  it('lists account collections and counts missing totals as zero', async () => {
    const db = new FakeDb()
    const now = new Date('2026-01-01T00:00:00Z')
    db.selectResults.push(
      [{ id: 'account-1', accountId: 'github-1', providerId: 'github', createdAt: now, updatedAt: now }],
      [{ value: 1 }],
      [
        {
          id: 'consent-1',
          applicationId: 'app-1',
          applicationName: 'Portal',
          applicationSlug: 'portal',
          scopes: ['openid'],
          permissions: ['read:profile'],
          grantedAt: now,
          expiresAt: null,
        },
      ],
      [{ value: 1 }],
      [
        {
          id: 'session-1',
          expiresAt: now,
          createdAt: now,
          updatedAt: now,
          ipAddress: '127.0.0.1',
          userAgent: 'Vitest',
          activeOrganizationId: null,
          impersonatedBy: null,
        },
      ],
      [],
    )
    const repository = createUserRepository(db as unknown as Database)

    await expect(repository.listLinkedAccounts('user-1', { limit: 2, offset: 4 })).resolves.toMatchObject({
      items: [{ id: 'account-1' }],
      total: 1,
      limit: 2,
      offset: 4,
    })
    await expect(repository.listConsentedApplications('user-1', { limit: 3, offset: 6 })).resolves.toMatchObject({
      items: [{ id: 'consent-1', applicationName: 'Portal' }],
      total: 1,
      limit: 3,
      offset: 6,
    })
    await expect(repository.listSessions('user-1', { limit: 4, offset: 8 })).resolves.toMatchObject({
      items: [{ id: 'session-1' }],
      total: 0,
      limit: 4,
      offset: 8,
    })
    expect(db.selectCalls.map((call) => call.table)).toEqual([
      account,
      account,
      applicationConsent,
      applicationConsent,
      session,
      session,
    ])
    expect(db.wherePredicates).toHaveLength(6)
  })

  it('finds, deletes, and rejects missing users and sessions', async () => {
    const db = new FakeDb()
    db.selectResults.push(
      [userRow({ id: 'user-1' })],
      [],
      [userRow({ id: 'user-2' })],
      [{ token: 'session-token' }],
      [],
    )
    const repository = createUserRepository(db as unknown as Database)

    await expect(repository.getUser('user-1')).resolves.toMatchObject({ id: 'user-1' })
    await expect(repository.getUser('missing')).rejects.toMatchObject({ message: 'User not found.' })
    await expect(repository.deleteManagedUser('user-2')).resolves.toBeUndefined()
    await expect(repository.getSessionToken('user-1', 'session-1')).resolves.toBe('session-token')
    await expect(repository.getSessionToken('user-1', 'missing')).rejects.toMatchObject({
      message: 'Session not found.',
    })
    expect(db.deleteCount).toBe(2)
    expect(db.deleteCalls.map((call) => call.table)).toEqual([session, user])
    expect(db.wherePredicates.length).toBeGreaterThanOrEqual(5)
  })
})

interface FakeStatement {
  table: unknown
  value: Record<string, unknown>
}

class FakeDb {
  readonly selectResults: unknown[][] = []
  readonly updateResults: unknown[][] = []
  readonly batches: unknown[][] = []
  readonly selectCalls: Array<{ selection: unknown; table: unknown }> = []
  readonly wherePredicates: unknown[] = []
  readonly updateCalls: Array<{ table: unknown; value: unknown }> = []
  readonly deleteCalls: Array<{ table: unknown }> = []
  deleteCount = 0

  select(selection?: unknown) {
    return new SelectQuery(this, this.selectResults.shift() ?? [], selection)
  }

  insert(table: unknown) {
    return {
      values: (value: Record<string, unknown>) => ({ table, value }),
    }
  }

  batch(statements: unknown[]) {
    this.batches.push(statements)
    return Promise.resolve([])
  }

  update(table: unknown) {
    return {
      set: (value: unknown) => ({
        where: () => ({
          returning: () => {
            this.updateCalls.push({ table, value })
            return Promise.resolve(this.updateResults.shift() ?? [])
          },
        }),
      }),
    }
  }

  delete(table: unknown) {
    return {
      where: () => {
        this.deleteCalls.push({ table })
        this.deleteCount += 1
        return Promise.resolve()
      },
    }
  }
}

class SelectQuery {
  constructor(
    private readonly db: FakeDb,
    private readonly result: unknown[],
    private readonly selection: unknown,
  ) {}

  from(table: unknown) {
    this.db.selectCalls.push({ selection: this.selection, table })
    return this
  }

  innerJoin() {
    return this
  }

  where(predicate: unknown) {
    this.db.wherePredicates.push(predicate)
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

  // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.result).then(onfulfilled, onrejected)
  }
}

function userRow(overrides: Partial<ReturnType<typeof baseUserRow>> = {}) {
  return {
    ...baseUserRow(),
    ...overrides,
  }
}

function baseUserRow() {
  const now = new Date('2026-01-01T00:00:00Z')
  return {
    id: 'user-1',
    name: 'Ada Lovelace',
    username: 'ada',
    displayUsername: null,
    email: 'ada@example.com',
    emailVerified: false,
    twoFactorEnabled: false,
    image: null,
    avatarAssetId: null,
    role: 'user',
    banned: false,
    banReason: null,
    banExpires: null,
    createdAt: now,
    updatedAt: now,
  }
}
