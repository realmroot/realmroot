import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('createManagementWebhookRoutes', () => {
  it('uses the default webhook service factory', async () => {
    const service = {
      listEndpoints: vi.fn().mockResolvedValue({
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
      }),
    }
    const createWebhookService = vi.fn().mockReturnValue(service)
    vi.doMock('../../middleware/admin', () => ({
      requireAdmin: () => async (_c: unknown, next: () => Promise<void>) => next(),
    }))
    vi.doMock('../../modules/webhooks/context', () => ({ createWebhookService }))

    const { createManagementWebhookRoutes } = await import('./webhooks')
    const app = createManagementWebhookRoutes()
    const response = await app.request('/endpoints?limit=1&offset=0')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
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
    })
    expect(createWebhookService).toHaveBeenCalled()
    expect(service.listEndpoints).toHaveBeenCalledWith({ limit: 1, offset: 0 })
  })
})
