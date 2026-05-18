import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSetupRepository } from './repository'

describe('createSetupRepository', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates exactly one bootstrap admin user and credential account', async () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')

    const db = new FakeD1Database()
    const setup = createSetupRepository(db as unknown as D1Database)

    await expect(
      setup.createBootstrapAdmin({
        email: 'admin@example.com',
        password: 'password-1',
        passwordHash: 'hashed-password',
        name: 'Admin User',
        username: 'admin',
      }),
    ).resolves.toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      email: 'admin@example.com',
      role: 'admin',
    })

    expect(db.users).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'admin@example.com',
        emailVerified: true,
        name: 'Admin User',
        role: 'admin',
        username: 'admin',
      },
    ])
    expect(db.accounts).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000002',
        accountId: '00000000-0000-4000-8000-000000000001',
        password: 'hashed-password',
        providerId: 'credential',
        userId: '00000000-0000-4000-8000-000000000001',
      },
    ])
    await expect(setup.hasUsers()).resolves.toBe(true)
  })

  it('rejects bootstrap creation after any user exists', async () => {
    const db = new FakeD1Database()
    db.users.push({
      id: 'user-1',
      email: 'existing@example.com',
      emailVerified: true,
      name: 'Existing User',
      role: null,
      username: null,
    })
    const setup = createSetupRepository(db as unknown as D1Database)

    await expect(
      setup.createBootstrapAdmin({
        email: 'admin@example.com',
        password: 'password-1',
        passwordHash: 'hashed-password',
        name: 'Admin User',
      }),
    ).rejects.toThrow('Setup is locked after the first user exists.')

    expect(db.users).toHaveLength(1)
    expect(db.accounts).toHaveLength(0)
  })
})

interface FakeUser {
  id: string
  email: string
  emailVerified: boolean
  name: string
  role: string | null
  username: string | null
}

interface FakeAccount {
  id: string
  accountId: string
  providerId: string
  userId: string
  password: string
}

class FakeD1Database {
  readonly users: FakeUser[] = []
  readonly accounts: FakeAccount[] = []

  prepare(sql: string) {
    return new FakeD1PreparedStatement(this, sql)
  }

  async batch(statements: FakeD1PreparedStatement[]) {
    return statements.map((statement) => statement.run())
  }
}

class FakeD1PreparedStatement {
  private params: unknown[] = []

  constructor(
    private readonly db: FakeD1Database,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]) {
    this.params = params
    return this
  }

  async first<T>() {
    return (this.db.users.length > 0 ? { value: 1 } : null) as T | null
  }

  run() {
    if (this.sql.startsWith('insert into user')) {
      return this.insertUser()
    }

    if (this.sql.startsWith('insert into account')) {
      return this.insertAccount()
    }

    throw new Error(`Unexpected SQL: ${this.sql}`)
  }

  private insertUser() {
    if (this.db.users.length === 0) {
      this.db.users.push({
        id: this.params[0] as string,
        name: this.params[1] as string,
        username: (this.params[2] as string | null) ?? null,
        email: this.params[3] as string,
        emailVerified: true,
        role: 'admin',
      })
      return d1Result(1)
    }

    return d1Result(0)
  }

  private insertAccount() {
    const userId = this.params[1] as string
    const adminUser = this.db.users.find((user) => user.id === userId && user.role === 'admin')

    if (adminUser) {
      this.db.accounts.push({
        id: this.params[0] as string,
        accountId: userId,
        providerId: 'credential',
        userId,
        password: this.params[2] as string,
      })
      return d1Result(1)
    }

    return d1Result(0)
  }
}

function d1Result(changes: number) {
  return {
    success: true,
    meta: {
      changes,
    },
    results: [],
  } as unknown as D1Result
}
