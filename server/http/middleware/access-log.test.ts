import { accessLog } from '@server/http/middleware/access-log'
import { requestContext } from '@server/http/middleware/request-context'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('access log', () => {
  it('logs Hono-handled server errors with the original exception', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = new Hono()
    app.use('*', requestContext())
    app.use('*', accessLog())
    app.onError((_error, c) => c.json({ error: 'internal' }, 500))
    app.get('/failure', () => {
      throw new Error('Database exploded.')
    })

    const response = await app.request('/failure')

    expect(response.status).toBe(500)
    expect(info).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledOnce()
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
      method: 'GET',
      path: '/failure',
      status: 500,
      errorName: 'Error',
      errorMessage: 'Database exploded.',
    })
    expect(JSON.parse(error.mock.calls[0][0]).errorStack).toContain('Database exploded.')
  })
})
