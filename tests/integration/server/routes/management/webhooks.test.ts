import { createManagementWebhookRoutes } from '@server/http/routes/management/webhooks'
import * as webhooksUsecase from '@server/usecases/webhooks'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createManagementWebhookRoutes', () => {
  it('reads webhook endpoints from the deps webhook usecase', async () => {
    const result = {
      endpoints: [
        {
          id: 'wh_1',
          url: 'https://app.example.com/webhooks/auth',
          events: ['user.created'],
          enabled: true,
          secretPrefix: 'whsec_sec',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      pagination: { limit: 1, offset: 0, total: 1, hasMore: false, nextOffset: null },
    }
    const listEndpoints = vi.fn().mockResolvedValue(result)
    const listWebhookEndpoints = vi
      .spyOn(webhooksUsecase, 'listWebhookEndpoints')
      .mockImplementation((_deps, query) => listEndpoints(query))

    const app = new Hono()
    app.use('*', async (c, next) => {
      const user = { id: 'admin-1', role: 'admin' }
      c.set('authContext', { session: { session: { id: 'session-1' }, user }, user })
      c.set('deps', {} as never)
      await next()
    })
    app.route('/', createManagementWebhookRoutes())
    const response = await app.request('/endpoints?limit=1&offset=0')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(result)
    expect(listWebhookEndpoints).toHaveBeenCalled()
    expect(listEndpoints).toHaveBeenCalledWith({ limit: 1, offset: 0 })
  })
})
