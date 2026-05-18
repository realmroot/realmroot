import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiError } from '../../lib/errors'
import * as password from '../../lib/password'
import type { OnboardingRepository } from '../../modules/onboarding/repository'
import { onboardingRoutes } from '.'

describe('onboardingRoutes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(password, 'hashPassword').mockResolvedValue('hashed-password')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports whether first-user onboarding is required', async () => {
    const onboarding = createOnboardingRepositoryMock({ hasUsers: false })
    const response = await createTestApp(onboarding).request('/api/onboarding/status')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ required: true })
  })

  it('creates the first admin through the auth signup flow and locks onboarding', async () => {
    const onboarding = createOnboardingRepositoryMock({ hasUsers: false })
    const response = await createTestApp(onboarding).request('/api/onboarding/admin-users', {
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
    expect(onboarding.createBootstrapAdmin).toHaveBeenCalledWith({
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
      onboarding: {
        locked: true,
      },
    })
  })

  it('rejects admin bootstrap after a user exists', async () => {
    const onboarding = createOnboardingRepositoryMock({ hasUsers: true })
    const response = await createTestApp(onboarding).request('/api/onboarding/admin-users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'password-1',
        name: 'Admin User',
      }),
    })

    expect(response.status).toBe(403)
    expect(onboarding.createBootstrapAdmin).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'forbidden',
        message: 'Onboarding is locked after the first user exists.',
      },
    })
  })
})

function createTestApp(onboarding: OnboardingRepository) {
  const app = new Hono()
  app.onError((error, c) => handleApiError(error, c))
  app.route('/api/onboarding', onboardingRoutes(onboarding))
  return app
}

function createOnboardingRepositoryMock(options: { hasUsers: boolean }): OnboardingRepository {
  return {
    hasUsers: vi.fn().mockResolvedValue(options.hasUsers),
    createBootstrapAdmin: vi.fn().mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      role: 'admin',
    }),
  }
}
