import { createManagementWebhookRoutes } from '@server/http/routes/management/webhooks'
import * as webhooksUsecase from '@server/usecases/webhooks'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../../test-deps'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createManagementWebhookRoutes', () => {
  it('reads webhook endpoints from the deps webhook usecase', async () => {
    const result = {
      items: [
        {
          id: 'wh_1',
          url: 'https://app.example.com/webhooks/auth',
          events: ['user.created'],
          enabled: true,
          organizationId: null,
          secretPrefix: 'whsec_sec',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      pagination: { page: Math.floor(0 / 1) + 1, pageSize: 1, totalItems: 1, totalPages: Math.ceil(1 / 1) },
    }
    const listEndpoints = vi.fn().mockResolvedValue(result)
    const listWebhookEndpoints = vi
      .spyOn(webhooksUsecase, 'listWebhookEndpoints')
      .mockImplementation((_deps, query) => listEndpoints(query))

    const app = new Hono()
    app.use('*', async (c, next) => {
      const user = { id: 'admin-1', role: 'admin' }
      c.set('principal', { session: { session: { id: 'session-1' }, user }, user })
      c.set('deps', createTestDeps())
      await next()
    })
    app.route('/', createManagementWebhookRoutes())
    const response = await app.request('/?page=1&pageSize=1')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(result)
    expect(listWebhookEndpoints).toHaveBeenCalled()
    expect(listEndpoints).toHaveBeenCalledWith({ page: 1, pageSize: 1 })
  })
})
