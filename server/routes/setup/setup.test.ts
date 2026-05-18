import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiError } from '../../lib/errors'
import * as password from '../../lib/password'
import type { SetupRepository } from '../../modules/setup/repository'
import { setupRoutes } from '.'

describe('setupRoutes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(password, 'hashPassword').mockResolvedValue('hashed-password')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports whether first-user setup is required', async () => {
    const setup = createSetupRepositoryMock({ hasUsers: false })
    const response = await createTestApp(setup).request('/api/setup')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ required: true })
  })

  it('creates the first admin through the auth signup flow and locks setup', async () => {
    const setup = createSetupRepositoryMock({ hasUsers: false })
    const response = await createTestApp(setup).request('/api/setup/admin', {
      method: 'POST',
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'password-1',
        name: 'Admin User',
        username: 'admin',
      }),
    })

    expect(response.status).toBe(201)
    expect(password.hashPassword).toHaveBeenCalledWith('password-1')
    expect(setup.createBootstrapAdmin).toHaveBeenCalledWith({
      email: 'admin@example.com',
      password: 'password-1',
      name: 'Admin User',
      username: 'admin',
      passwordHash: 'hashed-password',
    })
    await expect(response.json()).resolves.toEqual({
      user: {
        id: 'user-1',
        email: 'admin@example.com',
        role: 'admin',
      },
      setup: {
        locked: true,
      },
    })
  })

  it('rejects admin bootstrap after a user exists', async () => {
    const setup = createSetupRepositoryMock({ hasUsers: true })
    const response = await createTestApp(setup).request('/api/setup/admin', {
      method: 'POST',
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'password-1',
        name: 'Admin User',
      }),
    })

    expect(response.status).toBe(403)
    expect(setup.createBootstrapAdmin).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'forbidden',
        message: 'Setup is locked after the first user exists.',
      },
    })
  })
})

function createTestApp(setup: SetupRepository) {
  const app = new Hono()
  app.onError((error, c) => handleApiError(error, c))
  app.route('/api/setup', setupRoutes(setup))
  return app
}

function createSetupRepositoryMock(options: { hasUsers: boolean }): SetupRepository {
  return {
    hasUsers: vi.fn().mockResolvedValue(options.hasUsers),
    createBootstrapAdmin: vi.fn().mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      role: 'admin',
    }),
  }
}
